import Foundation
import Network

@main
struct NativeChecks {
    static func main() async throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("promptbox-native-checks-\(UUID().uuidString)")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let site = root.appendingPathComponent("site")
        try fm.createDirectory(at: site, withIntermediateDirectories: true)
        try Data("<h1>synthetic-test</h1>".utf8).write(to: site.appendingPathComponent("index.html"))
        let privateFile = root.appendingPathComponent("private.txt")
        try Data("must-never-be-served".utf8).write(to: privateFile)
        try fm.createSymbolicLink(at: site.appendingPathComponent("escape.txt"), withDestinationURL: privateFile)
        let assets = try LocalAssets(root: site, port: 53919)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            assets.start { error in if let error { continuation.resume(throwing: error) } else { continuation.resume() } }
        }
        defer { assets.stop() }
        func status(_ path: String) async throws -> Int {
            let (_, response) = try await URLSession.shared.data(from: assets.baseURL.appendingPathComponent(path))
            return (response as! HTTPURLResponse).statusCode
        }
        let (html, response) = try await URLSession.shared.data(from: assets.baseURL)
        precondition((response as! HTTPURLResponse).statusCode == 200 && String(data: html, encoding: .utf8)!.contains("synthetic-test"))
        precondition((response as! HTTPURLResponse).value(forHTTPHeaderField: "Content-Security-Policy")!.contains("frame-ancestors 'none'"))
        let escapingStatus = try await status("escape.txt")
        precondition(escapingStatus == 404)
        precondition(!assets.owns(URL(string: "https://example.invalid")))
        precondition(!assets.owns(URL(string: "http://127.0.0.1:53917")))
        let records = root.appendingPathComponent("records")
        try fm.createDirectory(at: records.appendingPathComponent("subagents"), withIntermediateDirectories: true)
        let record = records.appendingPathComponent("rollout-fixture.jsonl")
        try Data("{\"synthetic\":true}\n".utf8).write(to: record)
        try Data("skip".utf8).write(to: records.appendingPathComponent("rollout-old.jsonl.zst"))
        try Data("skip".utf8).write(to: records.appendingPathComponent("subagents/rollout-private.jsonl"))
        try fm.createSymbolicLink(at: records.appendingPathComponent("rollout-link.jsonl"), withDestinationURL: privateFile)
        let first = try NativeBridge.scan(records, source: "codex", known: [:])
        precondition(first["matched"] as? Int == 1 && first["compressed"] as? Int == 1)
        let changed = first["records"] as! [[String: Any]]
        precondition(changed.count == 1)
        precondition(changed[0]["path"] as? String == "rollout-fixture.jsonl")
        let known = ["codex:rollout-fixture.jsonl": ["size": changed[0]["size"] as! Double, "modified": changed[0]["modified"] as! Double]]
        let second = try NativeBridge.scan(records, source: "codex", known: known)
        precondition((second["records"] as! [[String: Any]]).isEmpty && second["matched"] as? Int == 1)
        let imported = try NativeBridge.readFiles([record])
        let original = try Data(contentsOf: record)
        precondition(Data(base64Encoded: imported[0]["base64"] as! String) == original)
        let store = try DesktopStore(root: root.appendingPathComponent("data"))
        let emptyStore = try store.load()
        precondition(emptyStore == nil)
        let snapshot = "{\"app\":\"promptbox\",\"formatVersion\":1,\"tables\":{\"items\":[]}}"
        try store.save(snapshot)
        let reloaded = try DesktopStore(root: store.root).load()
        precondition(reloaded == snapshot)
        try store.setFolder(records.path, for: "codex")
        let granted = try DesktopStore(root: store.root).folder(for: "codex")
        precondition(granted == records.path)
        do { try store.save("{}"); preconditionFailure("Invalid state was accepted") } catch {}
        let preserved = try store.load()
        precondition(preserved == snapshot)
        print("Native checks passed: assets, CSP, file isolation, bridge origin, folder filtering, symlinks, incremental scan, binary import, data folder persistence, corrupt write prevention")
    }
}
