# PromptBox macOS 桌面运行层

Swift/AppKit 管理独立窗口、菜单、文件打开和保存、剪贴板、文件夹读取和模型请求；WKWebView 复用 React 界面。运行时只用 macOS 系统框架，不依赖 Chrome、Python、Node 或 Electron。

`npm run package:mac` 生成 `release/PromptBox-Desktop-v版本/PromptBox.app` 和 ZIP；输出目录存在时拒绝覆盖。`npm run desktop:run` 用时间戳目录构建并启动，接受 `-- --verify`、`-- --debug`、`-- --logs`。

原生程序内的只读资源服务监听 `127.0.0.1:53917`，用于兼容 WebKit 的模块和扫描 Worker；不承载用户数据或原生操作。退出应用时服务随进程结束。`--test-profile` 使用 53918 端口及 `data/.test/`，不接触正式库。

数据由 `DesktopStore` 写入项目根目录 `data/library.json`，原生侧自动保留上一版 `library.previous.json`；文件夹授权另存 `folders.json`。WebKit 使用非持久存储，只承载当前会话的 Dexie 工作副本；React 挂载前从磁盘恢复，写事务完成后按顺序存盘，退出前强制刷新。加载失败时不挂载界面、不覆盖已有文件。独立下载的应用在自身旁边建立 `PromptBox Data/`。数据目录应一并备份，不能随应用 ZIP 上传。

旧版可从文件菜单打开原来的 `localhost:5190` 页面导出备份，再导入新版，Key 需要重新设置。

本机操作只接受应用主页面发来的调用。记录目录只能经用户选择后读取，遍历不跟随软链接；模型请求不携带浏览器 Cookie，不将鉴权头跟随跳转到不同来源。编译目标为 Apple Silicon、macOS 14 及以上。签名为本机临时签名，不等同于 Developer ID 签名或 Apple 公证。
