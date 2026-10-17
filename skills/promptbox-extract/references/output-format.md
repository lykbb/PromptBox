# 候选文件格式

Agent 写 `draft.json`，`finalize.py` 检查后写出最终的候选文件。草稿只需要 `candidates` 列表，文件头由 `finalize.py` 补上。

## 草稿

```json
{
  "candidates": [
    {
      "type": "prompt",
      "title": "小红书风格改写",
      "content": "把下面这段改成小红书风格，多用短句，控制在 200 字：\n{{内容}}",
      "tags": ["写作"],
      "reason": "过去 3 周里 6 次让 AI 改写小红书文案，每次内容不同，其中 4 次补了字数要求",
      "confidence": "high",
      "count": 6,
      "conversations": 6,
      "days": 6,
      "tools": ["codex", "chatgpt"],
      "firstSeen": "2026-09-28",
      "lastSeen": "2026-10-14",
      "fixes": ["控制在 200 字"],
      "quotes": [
        { "tool": "codex", "at": "2026-10-14", "text": "把下面这段改成小红书风格：周末去了一家咖啡店……", "after": "太长了，控制在 200 字" },
        { "tool": "chatgpt", "at": "2026-10-09", "text": "帮我把这段写成小红书的风格：新买的跑鞋……" }
      ],
      "export": { "format": "md" }
    },
    {
      "type": "rule",
      "title": "回答用中文",
      "content": "回答使用中文。",
      "tags": ["其他"],
      "scope": "global",
      "ruleCategory": "语言",
      "reason": "在 Codex 和 Claude Code 的 10 个对话里纠正过 12 次，跟在各种任务后面",
      "confidence": "high",
      "count": 12,
      "conversations": 10,
      "days": 9,
      "tools": ["codex", "claude-code"],
      "lastSeen": "2026-10-16",
      "quotes": [
        { "tool": "codex", "at": "2026-10-16", "text": "用中文回答" },
        { "tool": "claude-code", "at": "2026-10-16", "text": "说中文" }
      ],
      "export": { "format": "agents" }
    }
  ]
}
```

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | `prompt` 提示词，`rule` 规则 |
| `title` | 是 | 6–12 个字的名称，最长 24 个字 |
| `content` | 是 | 提示词模板（变量写成 `{{名称}}`，名称 1–20 个字）或一句规则 |
| `reason` | 是 | 为什么值得存，带关键数字 |
| `confidence` | 是 | `high` 或 `medium`；达不到的不要写进来 |
| `quotes` | 是 | 1–5 句原话证据，每句 120 字以内；紧跟着的纠正写进 `after` |
| `tags` | 否 | 1–2 个主题标签 |
| `scope` | 规则必填 | 规则写 `global`（所有任务）、`project`（同时写 `project`）、`task`（同时写 `taskType`），不能省略。提示词不分范围，不用写，写了也按所有任务处理 |
| `project` / `taskType` | 条件必填 | 项目范围建议填完整路径或可唯一识别的名称；任务范围填稳定的任务类型。范围不同的规则不合并 |
| `ruleCategory` | 否 | 规则才有：语言、篇幅、格式和结构、语气和风格、工作流程、代码规范、工具和环境、安全和隐私 |
| `count` / `conversations` / `days` | 否 | 出现次数、对话数、天数；「明确要求」可以是 1 |
| `tools` | 否 | `codex`、`claude-code`、`workbuddy`、`codebuddy`、`chatgpt`、`claude-web`、`gemini`、`cursor`、`copilot`、`cline`、`opencode`、`other` |
| `firstSeen` / `lastSeen` | 否 | 第一次、最近一次出现的日期 |
| `fixes` | 否 | 合并进模板的、用户常在之后补充的要求 |
| `export` | 否 | `{"format": "md" \| "skill" \| "agents" \| "claude"}`；`skill` 还要 `skillName`（小写字母、数字、连字符，最长 64，不能含 anthropic、claude）和 `skillDescription`（写清做什么、什么时候用） |

## 最终文件

`finalize.py` 会拒绝规则缺失、不合法或不完整的适用范围。网页兼容旧候选文件：规则没有可靠范围时显示「待确认」，用户补全后才能保存，不会自动当成全局规则。

`finalize.py` 写出的文件多了文件头，PromptBox 靠 `app` 和 `kind` 认出这是候选文件：

```json
{
  "app": "promptbox",
  "kind": "candidates",
  "formatVersion": 1,
  "generatedAt": "2026-10-16T21:30:00+08:00",
  "generator": "promptbox-extract",
  "scanned": { "tools": ["codex", "workbuddy"], "conversations": 419, "userMessages": 2310, "from": "2026-04-26", "to": "2026-10-16", "skippedCompressed": 40 },
  "candidates": []
}
```
