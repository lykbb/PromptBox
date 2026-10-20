import Foundation

/// The project's data folder is authoritative. WebKit only holds a temporary working copy.
final class DesktopStore {
    let root: URL
    private let file: URL
    private let previous: URL
    private let permissions: URL

    static func defaultRoot(bundle: URL) -> URL {
        var parent = bundle.deletingLastPathComponent()
        for _ in 0..<6 {
            let manifest = parent.appendingPathComponent("package.json")
            if let data = try? Data(contentsOf: manifest),
               let package = try? JSONSerialization.jsonObject(with: data) as? [String: Any], package["name"] as? String == "promptbox" {
                return parent.appendingPathComponent("data", isDirectory: true)
            }
            let next = parent.deletingLastPathComponent()
            if next == parent { break }
            parent = next
        }
        return bundle.deletingLastPathComponent().appendingPathComponent("PromptBox Data", isDirectory: true)
    }

    init(root: URL) throws {
        self.root = root
        file = root.appendingPathComponent("library.json")
        previous = root.appendingPathComponent("library.previous.json")
        permissions = root.appendingPathComponent("folders.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }

    func load() throws -> String? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let data = try Data(contentsOf: file)
        try validate(data)
        return String(data: data, encoding: .utf8)
    }

    func save(_ text: String) throws {
        let data = Data(text.utf8)
        try validate(data)
        if FileManager.default.fileExists(atPath: file.path) {
            let old = try Data(contentsOf: file)
            try validate(old)
            try old.write(to: previous, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: previous.path)
        }
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    private func validate(_ data: Data) throws {
        guard let snapshot = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              snapshot["app"] as? String == "promptbox", snapshot["formatVersion"] as? Int == 1,
              snapshot["tables"] is [String: Any] else {
            throw BridgeError.message("data/library.json 格式无效，已停止写入。请保留文件并检查，或使用 library.previous.json 恢复。")
        }
    }

    private func folders() throws -> [String: String] {
        guard FileManager.default.fileExists(atPath: permissions.path) else { return [:] }
        let data = try Data(contentsOf: permissions)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: String] else { throw BridgeError.message("文件夹授权文件格式无效") }
        return value
    }

    func folder(for source: String) throws -> String? { try folders()[source] }
    func setFolder(_ path: String, for source: String) throws {
        var value = try folders()
        value[source] = path
        try JSONSerialization.data(withJSONObject: value).write(to: permissions, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: permissions.path)
    }
}
