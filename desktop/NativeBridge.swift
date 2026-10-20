import AppKit
import WebKit
import UniformTypeIdentifiers

final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var window: NSWindow?
    let assets: LocalAssets
    let store: DesktopStore
    var requests: [String: URLSessionDataTask] = [:]
    var didBecomeReady: (() -> Void)?
    // No cookie jar, credential cache, disk response cache, or automatic cross-host redirects.
    private let redirects = SameHostRedirects()
    private lazy var session = URLSession(configuration: .ephemeral, delegate: redirects, delegateQueue: nil)

    init(assets: LocalAssets, store: DesktopStore) {
        self.assets = assets
        self.store = store
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, assets.owns(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "不允许此页面调用本机功能"); return
        }
        let args = body["args"] as? [String: Any] ?? [:]
        switch action {
        case "loadStore":
            do { replyHandler(try store.load() as Any? ?? NSNull(), nil) } catch { replyHandler(nil, error.localizedDescription) }
        case "saveStore":
            guard let text = args["snapshot"] as? String else { replyHandler(nil, "缺少存储内容"); return }
            do { try store.save(text); replyHandler(true, nil) } catch { replyHandler(nil, error.localizedDescription) }
        case "storageInfo": replyHandler(store.root.path, nil)
        case "ready": didBecomeReady?(); replyHandler(true, nil)
        case "copy":
            guard let text = args["text"] as? String else { replyHandler(nil, "缺少复制内容"); return }
            NSPasteboard.general.clearContents()
            replyHandler(NSPasteboard.general.setString(text, forType: .string), nil)
        case "saveFile": saveFile(args, reply: replyHandler)
        case "openFiles": openFiles(args, reply: replyHandler)
        case "pickFolder": pickFolder(args, reply: replyHandler)
        case "scanFolder": scanFolder(args, reply: replyHandler)
        case "request": request(args, reply: replyHandler)
        case "cancelRequest":
            if let id = args["id"] as? String { requests.removeValue(forKey: id)?.cancel() }
            replyHandler(true, nil)
        default: replyHandler(nil, "不支持的本机操作")
        }
    }

    private func saveFile(_ args: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let name = args["name"] as? String, let encoded = args["base64"] as? String,
              let data = Data(base64Encoded: encoded), data.count <= 256 * 1024 * 1024 else {
            reply(nil, "导出内容无效或过大"); return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window!) { response in
            guard response == .OK, let url = panel.url else { reply(false, nil); return }
            do { try data.write(to: url, options: .atomic); reply(true, nil) }
            catch { reply(nil, "保存失败：\(error.localizedDescription)") }
        }
    }

    private func openFiles(_ args: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = args["multiple"] as? Bool ?? true
        let extensions = (args["accept"] as? String ?? "").split(separator: ",").compactMap {
            UTType(filenameExtension: $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ".", with: ""))
        }
        if !extensions.isEmpty { panel.allowedContentTypes = extensions }
        panel.beginSheetModal(for: window!) { response in
            guard response == .OK else { reply([], nil); return }
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let files = try Self.readFiles(panel.urls)
                    DispatchQueue.main.async { reply(files, nil) }
                } catch { DispatchQueue.main.async { reply(nil, "读取失败：\(error.localizedDescription)") } }
            }
        }
    }

    static func readFiles(_ urls: [URL]) throws -> [[String: Any]] {
        try urls.map { url in
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            guard (values.fileSize ?? 0) <= 256 * 1024 * 1024 else { throw BridgeError.message("文件超过 256 MB，请先拆分") }
            let data = try Data(contentsOf: url)
            return ["name": url.lastPathComponent, "base64": data.base64EncodedString(), "modified": (values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000]
        }
    }

    private func pickFolder(_ args: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let source = args["sourceId"] as? String, Self.sources.contains(source) else { reply(nil, "未知记录来源"); return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.showsHiddenFiles = true
        panel.prompt = "允许读取此文件夹"
        panel.message = "只读取你选择的文件夹中的会话记录；不会上传。"
        if let path = try? store.folder(for: source) { panel.directoryURL = URL(fileURLWithPath: path) }
        panel.beginSheetModal(for: window!) { [self] response in
            guard response == .OK, let url = panel.url else { reply(NSNull(), nil); return }
            do { try store.setFolder(url.path, for: source); reply(["name": url.lastPathComponent], nil) }
            catch { reply(nil, error.localizedDescription) }
        }
    }

    private static let sources: Set<String> = ["codex", "claude-code", "workbuddy"]

    private func scanFolder(_ args: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let source = args["sourceId"] as? String, Self.sources.contains(source),
              let path = try? store.folder(for: source) else {
            reply(nil, "请重新选择并授权记录文件夹"); return
        }
        let known = args["known"] as? [String: [String: Double]] ?? [:]
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let result = try Self.scan(URL(fileURLWithPath: path), source: source, known: known)
                DispatchQueue.main.async { reply(result, nil) }
            } catch { DispatchQueue.main.async { reply(nil, "读取记录失败：\(error.localizedDescription)") } }
        }
    }

    static func scan(_ root: URL, source: String, known: [String: [String: Double]]) throws -> [String: Any] {
        let root = root.resolvingSymlinksInPath().standardizedFileURL
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue,
              FileManager.default.isReadableFile(atPath: root.path),
              let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: Array(keys), options: [.skipsPackageDescendants]) else {
            throw BridgeError.message("原文件夹不存在或无法读取，请重新授权")
        }
        var records: [[String: Any]] = []
        var matched = 0, compressed = 0
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: keys)
            if values.isSymbolicLink == true { enumerator.skipDescendants(); continue }
            let canonical = url.resolvingSymlinksInPath().standardizedFileURL
            guard canonical.path.hasPrefix(root.path + "/") else { enumerator.skipDescendants(); continue }
            let path = String(canonical.path.dropFirst(root.path.count + 1))
            if path.split(separator: "/").count > 7 || path.contains("/subagents/") || url.lastPathComponent == "subagents" {
                enumerator.skipDescendants(); continue
            }
            if values.isDirectory == true { continue }
            let name = url.lastPathComponent
            if source == "codex" && name.hasPrefix("rollout-") && name.hasSuffix(".jsonl.zst") { compressed += 1; continue }
            let matches = source == "codex" ? name.hasPrefix("rollout-") && name.hasSuffix(".jsonl") : name.hasSuffix(".jsonl") && !name.hasPrefix("agent-")
            if !matches { continue }
            matched += 1
            let size = Double(values.fileSize ?? 0)
            let modified = (values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000
            let prior = known["\(source):\(path)"]
            if prior?["size"] == size && prior?["modified"] == modified { continue }
            guard size <= 128 * 1024 * 1024 else { throw BridgeError.message("\(name) 超过 128 MB，请改用 Agent 提炼") }
            let text = try String(contentsOf: url, encoding: .utf8)
            records.append(["path": path, "content": text, "size": size, "modified": modified])
        }
        return ["records": records, "matched": matched, "compressed": compressed]
    }

    private func request(_ args: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let id = args["id"] as? String, let address = args["url"] as? String,
              let url = URL(string: address), ["https", "http"].contains(url.scheme ?? ""),
              url.user == nil, url.password == nil else { reply(nil, "接口地址无效"); return }
        var request = URLRequest(url: url, timeoutInterval: 180)
        request.httpMethod = args["method"] as? String ?? "GET"
        request.httpBody = (args["body"] as? String)?.data(using: .utf8)
        for (name, value) in args["headers"] as? [String: String] ?? [:] { request.setValue(value, forHTTPHeaderField: name) }
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                self?.requests.removeValue(forKey: id)
                if let error { reply(nil, error.localizedDescription); return }
                guard let response = response as? HTTPURLResponse else { reply(nil, "服务商没有返回有效响应"); return }
                reply(["status": response.statusCode, "body": String(data: data ?? Data(), encoding: .utf8) ?? ""], nil)
            }
        }
        requests[id] = task
        task.resume()
    }
}

enum BridgeError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

final class SameHostRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        let original = task.originalRequest?.url
        guard original?.host == request.url?.host, original?.scheme == request.url?.scheme, original?.port == request.url?.port else {
            completionHandler(nil); return
        }
        completionHandler(request)
    }
}
