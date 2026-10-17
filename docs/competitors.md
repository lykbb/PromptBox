# 竞品调研与核心功能 v0.1

- 日期：2026-10-16
- 范围：用户指定的 3 个竞品（promptmanager.pro、PromptHub、PromptPilot），加上调研中发现的相关替代方案
- 说明：下文写"未见"的地方，表示在官网和公开资料里没有找到，不代表一定没有

---

## 0. 结论

1. 三个竞品做的都是"**管理或优化你已经写好的提示词**"，提示词要么靠用户手动存，要么靠用户描述需求再由 AI 生成。
2. "**自动记录**"已经有人做了：Promptory、PromptCase 这类浏览器插件，会在你聊天时自动保存你发出的每条提示词。但它们只是流水账。
3. "**自动提炼**"没有找到：从真实对话里找出重复的任务、抽成带变量的模板，从反复的纠正里提炼个人规则。
4. PromptBox 的位置：**从你的对话里提炼提示词和规则，再按你的风格生成新提示词**。本地优先，并且覆盖 Codex、Claude Code 这类本地 Agent 工具。

## 1. 三个竞品概览

| | promptmanager.pro | PromptHub | PromptPilot（火山引擎） |
|---|---|---|---|
| 定位 | 个人提示词库 | 团队的提示词全流程平台 | 企业级提示词生成与调优 |
| 目标用户 | 内容创作者、团队负责人、研究者、企业 | 做大模型应用的个人和团队 | 在火山方舟上做应用的开发者和企业 |
| 核心功能 | 集中存储、变体、分享链接、快速搜索、收藏、一键复制、合集、标签 | 社区库、Git 式版本管理、提示词生成和增强、评测、对话测试、批量测试、提示词链、自动检查流水线、API、表单、Zapier 集成 | 一键生成、一键改写、基于反馈优化、AI 批量生成变量、评测（评分模式 / 好中差对比模式）、批量评测、知识库、模型工具调用、API |
| 提示词从哪来 | 用户手动保存 | 用户自己写，AI 帮忙生成和增强 | 用户描述需求，AI 生成，再用评测数据迭代 |
| 收费 | 首页没有写价格，需要注册 | 免费版；Pro 每月 12 美元；Team 每人每月 20 美元；企业版另谈 | 没有找到官方最新价格 |
| 数据存放 | 云端账号 | 云端 | 云端 |

## 2. 相关替代方案

| 类型 | 代表 | 做了什么 | 没做什么 |
|---|---|---|---|
| 自动记录插件 | Promptory、PromptCase | 在 ChatGPT、Claude 等网页聊天时自动保存你发出的提示词，可以搜索、导出 | 只是流水账：不找重复、不抽模板、不提炼规则；不覆盖 Codex 等本地工具 |
| 手动保存插件 | AI PromptBox、PromptDock 等 | 在聊天页面旁边放一个提示词库，点一下保存或插入 | 依赖手动保存 |
| Skill 同步工具 | skillshare、Nacos Skill Sync | 把已经写好的 Skill 同步到各个 Agent 工具 | 不负责产生 Skill |
| 厂商记忆功能 | ChatGPT、Claude 的记忆 | 自动记住你的偏好 | 只记偏好、不记做法；锁在一家，带不走 |
| 聊天记录分析 | Prompt Scope | 统计 ChatGPT 导出记录里的用词和趋势 | 不产出模板 |

## 3. 功能对比

| 功能 | promptmanager.pro | PromptHub | PromptPilot | PromptBox |
|---|---|---|---|---|
| 手动存储、标签、合集 | 有 | 有 | 有 | P0 |
| 搜索 | 有 | 有 | 未见 | P0 |
| 一键复制 | 有 | 有 | 未见 | P0 |
| 变量 | 未见 | 有 | 有 | P0 |
| 版本管理 | 部分（变体） | 有 | 有 | P1 |
| 分享、团队协作 | 有 | 有 | 未见 | 不做 |
| 社区 | 未见 | 有 | 未见 | 不做 |
| AI 生成提示词 | 未见 | 有（通用） | 有（通用） | P0（按个人风格） |
| AI 优化、改写 | 未见 | 有 | 有（核心） | 不做 |
| 多模型测试、评测 | 未见 | 有 | 有 | 不做 |
| API、部署 | 未见 | 有 | 有 | 不做 |
| **从对话记录里提炼模板** | 未见 | 未见 | 未见 | **P0 核心** |
| **从反复的纠正里提炼规则** | 未见 | 未见 | 未见 | **P0 核心** |
| **读取本地 Agent 记录（Codex、Claude Code）** | 未见 | 未见 | 未见 | **P0** |
| 导出 SKILL.md、AGENTS.md | 未见 | 未见 | 未见 | P0 |
| 本地优先、记录不上传 | 未见 | 未见 | 未见 | P0 |

## 4. PromptBox 要做的核心功能

判断方法：

- **只有我们做的**，全力做，这是存在的理由。
- **用户默认就该有的基本功**，做到够用，不追求比竞品强。
- **竞品已经做得很好、且不是目标用户需要的**，不做。

### P0（一周内）

**A. 发现：从对话里提炼（差异化核心）**

1. 添加记录来源：Codex、Claude Code 的记录文件夹；ChatGPT、Claude 网页版的导出文件
2. 本地扫描：读取 → 清洗 → 分类（任务开场 / 纠正 / 忽略）→ 跨对话找重复
3. 生成候选：重复的任务 → 模板，自动抽出变量；重复的纠正 → 规则
4. 确认入库：每条候选附证据（次数、原话、来源），由你决定存还是忽略；和库里已有内容相似时，提示合并
5. AI 精修（可选）：给候选起名、合并不同说法、判断值不值得存。只发送候选里的几句原话

**B. 生成：按你的风格写新提示词（差异化核心）**

6. 用一句话说需求 → 从库里找出相关的提示词和你的规则
7. 生成：把需求、相关旧提示词、你的规则拼成生成指令。填了 Key 直接生成；没填就复制到你常用的 AI 里

**C. 库：基本功，做到够用**

8. 存储、类型（提示词 / Skill / 规则）、标签、搜索
9. 一键复制，复制时填变量
10. 导出：单条导出 SKILL.md 或 .md；把全部规则合成 AGENTS.md 或 CLAUDE.md；全量备份

### P1（之后）

版本历史与对比、语义检索、新对话自动提醒扫描、更多来源（Cursor、国内 AI 工具粘贴导入）、手机端。

### 不做（及原因）

| 不做 | 原因 |
|---|---|
| 团队协作、社区 | PromptHub 已经做得很完整，目标用户是个人 |
| 多模型评测、API 部署 | 这是做大模型应用的开发者的需求，PromptPilot、PromptHub 更专业 |
| 通用的提示词优化 | 模型厂商和 PromptPilot 都在免费或低价提供 |
| 云同步、账号 | 和"记录不上传"冲突；一周也做不完 |

## 5. 大模型在哪里用

原则：**本地代码负责粗筛，大模型只负责精修和生成。**

| 步骤 | 用什么 | 原因 |
|---|---|---|
| 读取、解析 | 代码 | 格式固定 |
| 清洗、分类 | 规则（第一句、长短、"太…""不要""改成"这类词） | 透明、免费；判断不了的句子可以交给精修 |
| 找重复 | 文本相似度（把句子切成两三个字的小片段做比较） | 记录量大，本地算得快、免费，也不用上传 |
| 抽模板、规则 | 文本比对；精修时用大模型起名、合并说法 | 只发送几十条候选 |
| 检索 | 浏览器自带的中文分词 + 关键词打分 | 不需要模型 |
| 生成 | 大模型（必需） | 有 Key 直接调用；没 Key 时复制生成指令到你自己的 AI |

- Key 由用户自己填，只存在本浏览器里。支持哪几家服务，开发前逐个验证能不能在浏览器里直接调用。
- 发送前展示"将要发送的内容"，不发送完整聊天记录。

## 6. 风险

| 风险 | 应对 |
|---|---|
| "PromptBox"这个名字已经被一个浏览器插件（AI PromptBox）用了 | 上线前考虑改名，或者加一个中文名 |
| 自动记录插件将来也做"提炼" | 我们的优势在本地 Agent 记录、规则提炼、导出成 Agent 能直接用的文件 |
| 规则版分类的质量不确定 | 写代码前先用真实记录验证（本机有 425 个 Codex 会话） |
| 一周工期紧 | 版本历史、手机端放到 P1 |

## 资料来源

- [promptmanager.pro 官网](https://promptmanager.pro/)
- [PromptHub 官网](https://www.prompthub.us/)、[PromptHub 价格](https://www.prompthub.us/pricing)
- [PromptPilot 官网](https://promptpilot.volcengine.com/)、[PromptPilot 概述（火山引擎文档）](https://www.volcengine.com/docs/82379/1399495?lang=zh)
- [PromptPilot 介绍（ai-bot.cn）](https://ai-bot.cn/promptpilot/)、[PromptPilot 全面开放（ITBear）](https://www.itbear.com.cn/html/2025-08/917476.html)
- [Promptory（Firefox 插件）](https://addons.mozilla.org/firefox/addon/promptory/)、[PromptCase（Firefox 插件）](https://addons.mozilla.org/firefox/addon/promptcase/)、[PromptDock（Firefox 插件）](https://addons.mozilla.org/firefox/addon/promptdock/)
- [AI PromptBox（Chrome 插件）](https://extscope.org/extension/eadnknnjeefjgcnpoadelddgjnjkekaa)
- [skillshare](https://skillshare.runkids.cc/)、[Nacos Skill Sync（阿里云博客）](https://www.alibabacloud.com/blog/stop-manually-copying-skills-a-management-solution-for-the-multi-agent-era_603342)
- [Prompt Scope](https://gitblind.noratr.app/monapdx/Prompt-Scope)
