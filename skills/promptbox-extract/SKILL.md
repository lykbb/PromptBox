---
name: promptbox-extract
description: 从 Codex、Claude Code、WorkBuddy、ChatGPT 等 AI 工具的聊天记录里，提炼出用户反复使用、值得长期保存的提示词和规则（一次性的不要），生成 PromptBox 能导入的候选文件。在用户说"提炼/整理/总结我的提示词""找出我反复交代的事""把我的习惯整理成规则""extract reusable prompts from my chat history"时使用。
---

# 从聊天记录里提炼提示词和规则

把用户的聊天记录变成一份候选文件，用户拖进 PromptBox 后逐条确认。

**最重要的一条：大多数对话是一次性的。只收用户以后还会用的；宁可少收，不要错收。** 判断标准全在 `references/rubric.md`，开始判断前必须完整读一遍。

下面命令里的 `SKILL_DIR` 指本 Skill 所在的文件夹（SKILL.md 所在目录）。需要 Python 3.8 或以上，只用标准库，全部在本机运行。

## 1. 摸底（不读内容）

```bash
python3 "$SKILL_DIR/scripts/collect.py" scan
```

只列出找到了哪些工具的记录、各有多少文件，不读对话内容。

- 用户用 ChatGPT 或 Claude 网页版：请用户提供导出的 `conversations.json` 路径（怎么导出见 `references/sources.md`）。
- 用户用的工具不在结果里：按 `references/sources.md` 的「不认识的格式」处理。
- 一条记录都没找到：告诉用户找过哪些位置，问他用的是什么工具、记录在哪。

## 2. 跟用户确认（一次问完）

用一段话说清楚下面几点，等用户确认后再往下走：

- 会读哪些记录：工具和对话数量；读不了的压缩文件有几个。
- 读到的内容会交给你现在用的模型来判断。
- 还会读已有的规则文件（AGENTS.md、CLAUDE.md、记忆文件）和 Skill 列表，用来去重。
- 结果写到哪：默认 `~/Downloads/promptbox-candidates-日期.json`。没有 Downloads 文件夹时问用户放哪；不要写在家目录根下。
- 可以调整：只看最近一段时间、排除某个工具、提供 PromptBox 备份文件（`promptbox-backup-*.json`）一起去重。

输出目录里已经有以前的 `promptbox-candidates-*.json` 时，问用户要不要只看上次之后的新对话。

示例：

> 我会读这些记录：Codex 387 个对话、Claude Code 5 个、WorkBuddy 32 个（另有 40 个压缩的旧会话读不了，会跳过）。读到的内容会交给我现在用的模型判断，也会读你的 AGENTS.md 等规则文件来去重。结果写到 ~/Downloads/promptbox-candidates-2026-10-16.json，你再拖进 PromptBox 逐条确认。可以开始吗？想排除哪个工具、或者只看最近一段时间，也可以告诉我。

## 3. 抽取和分组

```bash
WORK="$(mktemp -d -t promptbox-extract)"
python3 "$SKILL_DIR/scripts/collect.py" extract --out "$WORK"
python3 "$SKILL_DIR/scripts/collect.py" existing --work "$WORK"
```

按用户的选择加参数：

| 参数 | 用途 |
|---|---|
| `--sources codex,workbuddy` | 只读这些工具 |
| `--since 2026-10-01` | 只看这一天之后的对话 |
| `--export 路径/conversations.json` | 网页版导出文件，可以给多个 |
| `--extra $WORK/extra.jsonl` | 不认识的工具转出来的统一格式 |
| `existing --promptbox-backup 路径` | 和 PromptBox 库里已有的内容去重 |
| `existing --project 项目目录` | 额外读这个项目里的 AGENTS.md、CLAUDE.md |

`collect.py` 只取用户说的话，去掉系统注入、工具输出、寒暄，把意思相近的话分组，并在写出任何文件前把密钥、手机号、邮箱换成 `[已隐藏]`。工作目录里会有：

- `summary.json`：扫描概况
- `groups.json`：四类分组——任务 `tasks`、纠正 `corrections`、明确要求 `standing`、单次长提示词 `singles`
- `existing.md`：已有的规则文件和 Skill 列表（以及 PromptBox 库里的内容）

## 4. 判断（核心）

先完整读 `references/rubric.md` 和 `$WORK/existing.md`，再分批看分组，每批 20 组：

```bash
python3 "$SKILL_DIR/scripts/collect.py" show --work "$WORK" --kind tasks --offset 0 --limit 20
```

依次看 `tasks`、`corrections`、`standing`、`singles`。分组已经按次数排好，越往后越零散。

对每一组按 rubric 判断：

1. 一次性的、太短的、只在一个对话里的、已经存在的：不收。
2. 剩下的按「提示词」或「规则」的标准判断，收下的写成候选。
3. 同一个意思出现在几个组里（比如 `tasks` 里一组、`corrections` 里一组）：合并成一条。
4. 任务组「之后常补」里标了「通用习惯」的要求，不写进这个任务的模板，作为规则单独判断。
5. 拿不准时不收。

分组只是线索，不是结论：

- 一组里可能混进了意思不同的话，以原话为准，可以拆开。
- 两组可能是一回事，可以合并。
- 出现次数、对话数、天数以你确认属于同一类的原话为准，不要直接照抄分组的数字。
- 一组的原话只显示了几句；要看这一组的全部原话，用 `show --work "$WORK" --id T3`（换成组的编号）。

收下的候选写进 `$WORK/draft.json`，格式见 `references/output-format.md`。

## 5. 定稿

```bash
python3 "$SKILL_DIR/scripts/finalize.py" "$WORK/draft.json" --work "$WORK" --out ~/Downloads/promptbox-candidates-2026-10-16.json
```

- 有「错误」：不会写文件。改好草稿再运行。
- 有「提醒」：逐条看。可能和已有规则重复的、模板里残留具体信息的、置信度标高了的，改好再运行；确实没问题的可以保留。

## 6. 汇报

简短告诉用户：

- 读了多少个对话、多少句话；收了几条提示词、几条规则。
- 一张表：名称、类型、出现次数、理由。
- 跳过了什么：一次性的大约多少组、已经存在的几条、读不了的压缩文件几个。
- 文件路径和下一步：打开 PromptBox，把文件拖进窗口，候选会出现在「发现」里，逐条确认、修改或忽略。

不要在汇报里复述原话中的隐私内容。

## 7. 清理

删掉工作目录 `$WORK`，里面有抽出来的原话。只删这个临时目录，不动别的文件。用户的规则要求用废纸篓时，按用户的规则来。

## 特殊情况

| 情况 | 怎么做 |
|---|---|
| 记录很少（不到 20 个对话） | 提前告诉用户结果可能很少；照常按标准判断，不要降低标准凑数 |
| 记录很多（分组超过 200 组） | 先判断次数最多的；每看完 100 组跟用户报一次进度；可以建议分时间段跑 |
| 用户只要某一类（只要规则、只要写作类） | 照常判断，只输出这一类 |
| 用户要求放宽 | 重复次数可以降到 2 次，但一次性的照样不收，理由里写清"只出现 2 次" |
| 用户要求更严 | 只收置信度 high 的 |
| 中英文混合 | 照常判断；名称和理由用用户常用的语言 |
| 第二次运行 | 用 `--since` 只看上次之后的对话；PromptBox 会自动认出以前处理过的候选 |
| 压缩的旧会话读不了 | 跳过并在汇报里说明数量。不要自己安装软件；可以告诉用户装了 `zstd`（macOS：`brew install zstd`）后再跑 |
| 用户中途想停 | 停下，把已经判断好的先定稿成候选文件 |

## 不要做的事

- 不要修改任何聊天记录和规则文件，也不要直接写进用户的 AGENTS.md、CLAUDE.md。只生成候选文件，由用户在 PromptBox 里确认。
- 不要把对话内容发到你正在用的模型以外的任何地方。
- 不要把 AI 的回答当成用户的提示词。
- 不要为了让结果"看起来丰富"而降低标准。
