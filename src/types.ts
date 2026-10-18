// 全站共用的数据类型。界面、存储和逻辑层都从这里取。

import type { Palette, Theme } from './theme';

export type ItemType = 'prompt' | 'rule';

/** 记录来自哪个 AI 工具。后面几种只会出现在本地 Agent 提炼的候选里。 */
export type Tool =
  | 'codex'
  | 'claude-code'
  | 'chatgpt'
  | 'claude-web'
  | 'workbuddy'
  | 'codebuddy'
  | 'gemini'
  | 'cursor'
  | 'copilot'
  | 'cline'
  | 'opencode'
  | 'other';

/** 库里一条内容是怎么来的。 */
export type ItemOrigin = 'manual' | 'discover' | 'import' | 'generate' | 'sample';

/** 一句原话，作为候选和库内容的证据。 */
export interface Quote {
  tool: Tool;
  at: number;
  text: string;
  /** 紧接着的纠正，比如"太长了，控制在 200 字"。 */
  after?: string;
}

export interface Evidence {
  count: number;
  tools: Tool[];
  quotes: Quote[];
}

export interface ItemRef {
  id: string;
  title: string;
}

export interface ScopeFields {
  scope?: 'global' | 'project' | 'task' | 'unconfirmed';
  project?: string;
  taskType?: string;
}

export interface Item extends ScopeFields {
  id: string;
  type: ItemType;
  title: string;
  content: string;
  tags: string[];
  note: string;
  /** 导出 SKILL.md 用的英文短名和描述，任何提示词都可以有。 */
  skillName?: string;
  skillDescription?: string;
  origin: ItemOrigin;
  /** 来源的补充说明，比如导入的文件名。 */
  originDetail?: string;
  /** 从发现里保存时带过来的原话。 */
  evidence?: Evidence;
  /** 按风格生成时参考了哪几条。 */
  refs?: ItemRef[];
  isSample: boolean;
  createdAt: number;
  updatedAt: number;
  /** 删除后 6 秒内可以撤销，之后才真正删掉。 */
  deletedAt?: number;
}

/** 正文的一个版本。离开一条内容时，正文和最近一个版本不同就生成新版本。 */
export interface Version {
  id: string;
  itemId: string;
  /** 1、2、3…… */
  number: number;
  content: string;
  source: 'create' | 'edit' | 'restore';
  /** 从哪个版本恢复的。 */
  restoredFrom?: number;
  createdAt: number;
}

/** 解析后的一段对话，各工具的格式都先转成这个样子。 */
export interface Conversation {
  key: string;
  tool: Tool;
  title?: string;
  messages: Message[];
}

export interface Message {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

/** 从对话里挑出来的一句话：任务或纠正。只存在这个浏览器里。 */
export interface Utterance {
  id: string;
  tool: Tool;
  session: string;
  at: number;
  role: 'task' | 'correction';
  text: string;
  /** 任务之后紧跟的纠正。 */
  after?: string;
  afterId?: string;
  isSample?: boolean;
}

export type CandidateStatus = 'new' | 'saved' | 'ignored';

/** 候选是怎么提炼出来的：本地规则、接入模型 API、本地 Agent。 */
export type CandidateOrigin = 'local' | 'ai' | 'agent';

export type CandidateScope = NonNullable<ScopeFields['scope']>;

export interface ExportHint {
  format: 'md' | 'skill' | 'agents' | 'claude';
  skillName?: string;
  skillDescription?: string;
}

export interface Candidate {
  /** 签名：同一类重复内容每次扫描都得到同一个签名。 */
  id: string;
  kind: ItemType;
  title: string;
  template: string;
  /** 从纠正里合并进模板的要求。 */
  fixes: string[];
  /** 有几次在这类任务之后补了这些要求。 */
  fixCount: number;
  count: number;
  sessions: number;
  /** 出现在几个不同的日子。 */
  days?: number;
  tools: Tool[];
  quotes: Quote[];
  lastAt: number;
  similarItemId?: string;
  similarItemTitle?: string;
  /** 相似那一条的范围；保存时选的范围和它一样才合并。 */
  similarItemScope?: ScopeFields;
  status: CandidateStatus;
  isSample?: boolean;
  /** 没有时当作本地规则提炼。 */
  origin?: CandidateOrigin;
  /** 为什么值得存。 */
  reason?: string;
  confidence?: 'high' | 'medium';
  tags?: string[];
  scope?: CandidateScope;
  project?: string;
  taskType?: string;
  ruleCategory?: string;
  exportHint?: ExportHint;
  /** 模型或 Agent 提炼的候选覆盖了哪些本地候选，被覆盖的不再单独显示。 */
  basedOn?: string[];
}

/** 处理过的候选：保存或忽略后，下次扫描不再出现。 */
export interface Decision extends ScopeFields {
  signature: string;
  kind: ItemType;
  status: 'saved' | 'ignored';
  title: string;
  /** 用来和以后的候选比较是不是同一类。 */
  text: string;
  /** 保存或合并到了哪一条。 */
  itemId?: string;
  at: number;
}

export type SourceId = 'codex' | 'claude-code' | 'workbuddy' | 'web-export';

export interface SourceRecord {
  id: SourceId;
  /** Chrome、Edge 里记住的文件夹授权。 */
  handle?: FileSystemDirectoryHandle;
  /** 显示用：文件夹名或导出文件名。 */
  label: string;
  conversations: number;
  lastScanAt?: number;
}

/** 扫描过的文件，用来只扫描新增和改动过的。 */
export interface ScannedFile {
  key: string;
  sourceId: SourceId;
  size: number;
  modified: number;
  conversations: number;
}

/** 兼容 OpenAI 接口的服务商。 */
export type LlmProvider =
  | 'deepseek'
  | 'dashscope'
  | 'zhipu'
  | 'moonshot'
  | 'volcengine'
  | 'siliconflow'
  | 'minimax'
  | 'qianfan'
  | 'stepfun'
  | 'modelscope'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'openrouter'
  | 'custom';

export interface LlmSettings {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  /** 选"其他"时填的服务地址，比如 https://example.com/v1。 */
  baseUrl?: string;
  /** 自己添加的接口是哪一个，对应 Settings.llmCustom 里的 id。 */
  customId?: string;
}

/** AI 对一条本地候选的意见：值得留（附上建议的名称和写法）、一次性的、或者和另一条是同一件事。 */
export type Advice = (
  | ({ verdict: 'keep'; title: string; content: string; kind: ItemType; tags: string[]; reason: string; confidence: 'high' | 'medium' } & ScopeFields)
  | { verdict: 'skip'; reason: string }
  | { verdict: 'duplicate'; of: string; ofTitle: string }
) & {
  at: number;
  /** 用户怎么处理的：用了 AI 的版本，或者保持原样。没处理时为空。 */
  status?: 'applied' | 'kept';
};

/** 用过的一个模型：哪家服务加上模型名。Key 和地址存在服务那边，这里只记引用。 */
export interface SavedModel {
  provider: LlmProvider;
  /** 自己添加的接口是哪一个。 */
  customId?: string;
  model: string;
}

/** 自己添加过的兼容 OpenAI 接口，添加一次以后直接选。 */
export interface CustomService {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings {
  seeded: boolean;
  lastBackupAt?: number;
  /** 上次备份之后库里有没有改动。 */
  changedSinceBackup: boolean;
  llm?: LlmSettings;
  /** 每家预设服务商各自填过的 Key 和模型，切换服务商时恢复。 */
  llmSaved?: Partial<Record<LlmProvider, Omit<LlmSettings, 'provider'>>>;
  /** 自己添加过的接口。 */
  llmCustom?: CustomService[];
  /** 用过的模型，设置里列出来，点一下切换。 */
  llmModels?: SavedModel[];
  /** 主题色，没选过是黑白灰。 */
  palette?: Palette;
  /** 外观主题，没选过就跟着系统。 */
  theme?: Theme;
}
