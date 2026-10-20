import AppKit
import WebKit

final class PromptBoxApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var assets: LocalAssets!
    private var bridge: NativeBridge!
    private var store: DesktopStore!
    private var migrationAssets: LocalAssets?
    private var ready = false
    private var pendingFiles: [URL] = []
    private let smoke = CommandLine.arguments.contains("--test-profile")

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard let root = Bundle.main.resourceURL?.appendingPathComponent("site") else { throw BridgeError.message("缺少应用资源，请重新打包") }
            let dataRoot = DesktopStore.defaultRoot(bundle: Bundle.main.bundleURL)
            store = try DesktopStore(root: smoke ? dataRoot.appendingPathComponent(".test") : dataRoot)
            assets = try LocalAssets(root: root, port: smoke ? 53918 : 53917)
            buildMenu()
            assets.start { [self] error in
                if let error { fail("无法启动应用内资源：\(error.localizedDescription)。请确认没有重复运行 PromptBox，或端口 \(assets.port) 未被其他程序占用。"); return }
                makeWindow()
            }
        } catch { fail(error.localizedDescription) }
    }

    private func makeWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = smoke ? "PromptBox · 测试数据" : "PromptBox"
        window.minSize = NSSize(width: 960, height: 640)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        let configuration = WKWebViewConfiguration()
        // Persistent WebKit data belongs to this app's bundle identity, never to Chrome or Safari.
        configuration.websiteDataStore = .nonPersistent()
        bridge = NativeBridge(assets: assets, store: store)
        bridge.window = window
        bridge.didBecomeReady = { [weak self] in self?.ready = true; self?.deliverFiles() }
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "promptbox")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.isInspectable = smoke
        window.contentView = web
        web.load(URLRequest(url: assets.baseURL))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildMenu() {
        let menu = NSMenu()
        let app = NSMenuItem(); menu.addItem(app)
        app.submenu = NSMenu()
        app.submenu?.addItem(withTitle: "关于 PromptBox", action: #selector(about), keyEquivalent: "")
        app.submenu?.addItem(withTitle: "设置…", action: #selector(settings), keyEquivalent: ",")
        app.submenu?.addItem(.separator())
        app.submenu?.addItem(withTitle: "隐藏 PromptBox", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.submenu?.addItem(.separator())
        app.submenu?.addItem(withTitle: "退出 PromptBox", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = NSMenuItem(); menu.addItem(file); file.submenu = NSMenu(title: "文件")
        file.submenu?.addItem(withTitle: "新建提示词", action: #selector(newItem), keyEquivalent: "n")
        file.submenu?.addItem(withTitle: "导入文件…", action: #selector(importFiles), keyEquivalent: "o")
        file.submenu?.addItem(withTitle: "导出备份…", action: #selector(backup), keyEquivalent: "s")
        file.submenu?.addItem(.separator())
        file.submenu?.addItem(withTitle: "打开旧版浏览器数据…", action: #selector(migrate), keyEquivalent: "")
        file.submenu?.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let edit = NSMenuItem(); menu.addItem(edit); edit.submenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.submenu?.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let windowMenu = NSMenuItem(); menu.addItem(windowMenu); windowMenu.submenu = NSMenu(title: "窗口")
        windowMenu.submenu?.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.submenu?.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        NSApp.mainMenu = menu
        NSApp.windowsMenu = windowMenu.submenu
        for item in [app, file].flatMap({ $0.submenu?.items ?? [] }) where item.action != #selector(NSApplication.terminate(_:)) && item.action != #selector(NSApplication.hide(_:)) && item.action != #selector(NSWindow.performClose(_:)) {
            item.target = self
        }
    }

    @objc private func about() { command("about") }
    @objc private func settings() { command("settings") }
    @objc private func newItem() { command("new") }
    @objc private func importFiles() { command("import") }
    @objc private func backup() { command("backup") }

    private func command(_ action: String) {
        guard ready else { return }
        window.makeKeyAndOrderFront(nil)
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('promptbox-command', {detail: '\(action)'}))", completionHandler: nil)
    }

    func application(_ application: NSApplication, openFiles filenames: [String]) {
        pendingFiles.append(contentsOf: filenames.map { URL(fileURLWithPath: $0) })
        deliverFiles()
        application.reply(toOpenOrPrint: .success)
    }

    private func deliverFiles() {
        guard ready, !pendingFiles.isEmpty else { return }
        let urls = pendingFiles; pendingFiles = []
        do {
            let files = try NativeBridge.readFiles(urls)
            let json = String(data: try JSONSerialization.data(withJSONObject: files), encoding: .utf8)!
            web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('promptbox-files', {detail: \(json)}))", completionHandler: nil)
        } catch { showMessage("无法导入", error.localizedDescription) }
    }

    @objc private func migrate() {
        showMessage("导入旧版数据", "新版有自己的存储，不会自动读取 Chrome 数据。接下来打开旧版来源页面：请在其中选择「设置 → 数据 → 导出全部备份」，再将备份拖入新版窗口。模型 Key 需要重新填写。")
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("site"), let server = try? LocalAssets(root: root, port: 5190) else { return }
        migrationAssets = server
        server.start { _ in
            // An already running legacy launcher can continue serving its original URL.
            let url = URL(string: "http://localhost:5190/#library")!
            let chrome = URL(fileURLWithPath: "/Applications/Google Chrome.app")
            if FileManager.default.fileExists(atPath: chrome.path) {
                NSWorkspace.shared.open([url], withApplicationAt: chrome, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
            } else { NSWorkspace.shared.open(url) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if assets.owns(url) { decisionHandler(.allow) }
        else {
            if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showMessage("页面加载失败", error.localizedDescription) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil); return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard ready else { return .terminateNow }
        web.callAsyncJavaScript("if (window.promptboxBeforeQuit) await window.promptboxBeforeQuit(); return true;", arguments: [:], in: nil, in: .page, completionHandler: { [self] result in
            if case .failure = result {
                let alert = NSAlert()
                alert.messageText = "未能确认最近编辑已保存"
                alert.informativeText = "可以返回应用检查内容，或仍然退出。"
                alert.addButton(withTitle: "返回检查"); alert.addButton(withTitle: "仍然退出")
                NSApp.reply(toApplicationShouldTerminate: alert.runModal() == .alertSecondButtonReturn)
            } else { assets.stop(); migrationAssets?.stop(); NSApp.reply(toApplicationShouldTerminate: true) }
        })
        return .terminateLater
    }

    private func showMessage(_ title: String, _ text: String) { let alert = NSAlert(); alert.messageText = title; alert.informativeText = text; alert.runModal() }
    private func fail(_ text: String) { showMessage("PromptBox 无法启动", text); NSApp.terminate(nil) }
}

@main
struct PromptBoxMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = PromptBoxApp()
        application.setActivationPolicy(.regular)
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
