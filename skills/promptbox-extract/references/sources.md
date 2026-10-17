# 记录在哪、什么格式

`scripts/collect.py` 已经能读下表里标「已支持」的来源。其他工具按文末的「不认识的格式」处理。

路径以 macOS 为例；Linux 一般把 `~/Library/Application Support` 换成 `~/.config`，Windows 换成 `%APPDATA%`。

| 工具 | 位置 | 状态 |
|---|---|---|
| Codex（命令行和桌面版） | `~/.codex/sessions/年/月/日/rollout-*.jsonl`；归档在 `~/.codex/archived_sessions/` | 已支持 |
| Claude Code | `~/.claude/projects/<项目路径>/<会话>.jsonl` | 已支持 |
| WorkBuddy | `~/.workbuddy/projects/<项目路径>/<会话>.jsonl` | 已支持 |
| CodeBuddy | `~/.codebuddy/projects/<项目路径>/<会话>.jsonl`；输入历史 `~/.codebuddy/history.jsonl` | 已支持 |
| ChatGPT 网页版 | 设置 → 数据管理 → 导出数据，邮件里的压缩包解压后的 `conversations.json` | 已支持（用户提供文件） |
| Claude 网页版 | 设置 → 隐私 → 导出数据，解压后的 `conversations.json` | 已支持（用户提供文件） |
| Gemini CLI | `~/.gemini/tmp/<项目哈希>/chats/`；旧版本是 `~/.gemini/tmp/<项目哈希>/logs.json` | 按文末方法处理 |
| Cursor | SQLite：`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | 按文末方法处理 |
| VS Code Copilot Chat | `~/Library/Application Support/Code/User/workspaceStorage/<哈希>/chatSessions/` | 按文末方法处理 |
| Cline、Roo Code | VS Code 的 `globalStorage/saoudrizwan.claude-dev/tasks/<任务>/` 或 `globalStorage/rooveterinaryinc.roo-cline/tasks/<任务>/` | 按文末方法处理 |
| OpenCode | 先运行 `opencode db path` 看存在哪；或用 `opencode export <会话>` 导出 | 按文末方法处理 |

## 已支持的格式要点

这些规则已经写在 `collect.py` 里。列出来是为了出问题时能对照排查。

### Codex

- 每行 `{timestamp, type, payload}`。
- 用户原话优先取 `type: "event_msg"` 且 `payload.type: "user_message"` 的 `payload.message`；AI 回复取 `payload.type: "agent_message"`。
- 没有这类事件的旧文件，取 `payload.type: "message"`、`role: "user"` 里 `input_text` 的文字。
- 去掉自动注入的内容：`<environment_context>`、`<user_instructions>`、`# AGENTS.md instructions`、`<INSTRUCTIONS>`、`<permissions instructions>`、`<turn_aborted>` 开头的消息。
- 项目目录在 `session_meta` 的 `payload.cwd`。
- `.jsonl.zst` 是压缩过的旧会话。本机装了 `zstd` 命令才能读；没装就跳过，并在汇报时告诉用户跳过了几个。不要自己去装。

### Claude Code

- 每行 `{type, message: {role, content}, cwd, timestamp, isMeta, isSidechain}`。
- 跳过：`isMeta: true`、`isSidechain: true`（子任务）、内容是 `tool_result` 的、`<command-name>` 等命令输出、`[Request interrupted` 开头的。
- 去掉 `<system-reminder>…</system-reminder>` 片段。
- Claude Code 默认只保留最近 30 天的会话。

### WorkBuddy、CodeBuddy

- 每行 `{type: "message", role, content: [{type: "input_text" | "output_text", text}], timestamp, sessionId, cwd}`。
- **用户原话包在 `<user_query>…</user_query>` 里**，外面还有 `<system-reminder>`、`<additional_data>`、`<current_time>` 等系统内容。有 `<user_query>` 时只取里面的文字；没有时去掉所有已知的系统标签段落后再判断。
- `agent-*.jsonl` 是子任务记录，跳过。
- `~/.codebuddy/history.jsonl` 每行 `{display, timestamp, project}`，只有用户输入、没有 AI 回复，能找重复，但判断不出哪句是纠正。

### 网页版导出

- ChatGPT：每个对话有 `mapping`（节点表）和 `current_node`。从 `current_node` 沿 `parent` 往回走，得到最后看到的那条对话线；只取 `author.role` 是 `user` / `assistant`、`content_type` 是 `text` 的消息。
- Claude：每个对话有 `chat_messages`，`sender` 是 `human` / `assistant`。

## 不认识的格式

用户用的工具不在已支持列表里时：

1. **先问用户**：用的是什么工具，大概在哪个文件夹，愿不愿意让你读。路径和上表不一致时，以用户说的为准。
2. **只看结构，不看内容**：写一小段脚本，只打印字段名、类型、条数、文字长度，不打印文字本身。从结构里找出：哪个字段是用户说的话、哪个字段区分用户和 AI、时间和会话编号在哪、有没有像 `<user_query>` 这样包着原话的标签。
3. **数据库只读**：SQLite 先复制一份到临时目录再读，或者用 `sqlite3 'file:路径?mode=ro'`，不要改原文件。Cursor 的消息一般在 `cursorDiskKV` 表里，键形如 `bubbleId:<会话>:<消息>`，值是 JSON。不同版本差别很大，以实际结构为准。
4. **转成统一格式**：每条消息一行 JSON，写到临时目录里的 `extra.jsonl`：

   ```json
   {"tool": "cursor", "session": "cursor:<会话编号>", "at": "2026-10-16T09:00:00+08:00", "role": "user", "text": "原话", "cwd": "项目目录（没有就省略）"}
   ```

   `role` 只有 `user` 和 `assistant` 两种；AI 回复的文字可以留空，但这一行要有，用来判断下一句是不是纠正。

5. 运行 `collect.py` 时用 `--extra 临时目录/extra.jsonl` 把它并进来，后面的步骤完全一样。
