import Foundation
import Network

/// Only immutable application resources are served. User data and the native bridge never use HTTP.
final class LocalAssets {
    let port: UInt16
    let root: URL
    private let listener: NWListener
    private let queue = DispatchQueue(label: "local.promptbox.assets")
    private var connections: [UUID: NWConnection] = [:]

    var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    init(root: URL, port: UInt16) throws {
        self.root = root.resolvingSymlinksInPath()
        self.port = port
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        listener = try NWListener(using: parameters)
    }

    func start(completion: @escaping (Error?) -> Void) {
        var reported = false
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if !reported { reported = true; DispatchQueue.main.async { completion(nil) } }
            case .failed(let error):
                if !reported { reported = true; DispatchQueue.main.async { completion(error) } }
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            let id = UUID()
            self.connections[id] = connection
            connection.stateUpdateHandler = { [weak self] state in
                if case .cancelled = state { self?.connections.removeValue(forKey: id) }
            }
            connection.start(queue: self.queue)
            self.read(connection, data: Data())
        }
        listener.start(queue: queue)
    }

    func stop() {
        listener.cancel()
        queue.async { [self] in
            for connection in connections.values { connection.cancel() }
            connections.removeAll()
        }
    }

    func owns(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == Int(port)
    }

    private func read(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] chunk, _, complete, error in
            guard let self else { connection.cancel(); return }
            var data = data
            if let chunk { data.append(chunk) }
            if data.count > 16384 { self.send(connection, status: 431, body: Data()); return }
            if let header = String(data: data, encoding: .utf8), header.contains("\r\n\r\n") {
                self.respond(connection, header: header)
            } else if complete || error != nil { connection.cancel() }
            else { self.read(connection, data: data) }
        }
    }

    private func respond(_ connection: NWConnection, header: String) {
        let lines = header.components(separatedBy: "\r\n")
        let request = (lines.first ?? "").split(separator: " ").map(String.init)
        let host = lines.first { $0.lowercased().hasPrefix("host:") }?.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard host == "127.0.0.1:\(port)" || host == "localhost:\(port)" else {
            send(connection, status: 403, body: Data()); return
        }
        guard request.count == 3, ["GET", "HEAD"].contains(request[0]) else {
            send(connection, status: 405, body: Data()); return
        }
        guard let path = request[1].components(separatedBy: "?")[0].removingPercentEncoding,
              path.hasPrefix("/"), !path.contains("\0"), !path.contains("\\") else {
            send(connection, status: 400, body: Data()); return
        }
        let relative = path == "/" ? "index.html" : String(path.dropFirst())
        let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"), !relative.split(separator: "/").contains(where: { $0.hasPrefix(".") }),
              let data = try? Data(contentsOf: file) else {
            send(connection, status: 404, body: Data()); return
        }
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8", "svg": "image/svg+xml", "png": "image/png", "json": "application/json", "woff2": "font/woff2"]
        send(connection, status: 200, body: data, mime: types[file.pathExtension] ?? "application/octet-stream", head: request[0] == "HEAD")
    }

    private func send(_ connection: NWConnection, status: Int, body: Data, mime: String = "text/plain", head: Bool = false) {
        let policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: http:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        let headers = "HTTP/1.1 \(status) Response\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: \(policy)\r\nConnection: close\r\n\r\n"
        var data = Data(headers.utf8)
        if !head { data.append(body) }
        connection.send(content: data, completion: .contentProcessed { _ in connection.cancel() })
    }
}
