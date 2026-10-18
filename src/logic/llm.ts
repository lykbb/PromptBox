// 调用兼容 OpenAI 接口的模型服务。Key 只存在浏览器里，请求从浏览器直接发给服务商。
// 2026-10-16 在 Chrome 里用无效 Key 实测过：下面这些服务商都允许网页直接调用。
// 腾讯混元不允许网页直接调用，零一万物已停止服务，所以没有预设。
// xAI、硅基流动、百度千帆的跨域设置用的是通配符，Chrome、Edge 能用，Firefox、Safari 可能被拦。

import type { LlmProvider, LlmSettings } from '../types';

export interface ProviderPreset {
  id: LlmProvider;
  name: string;
  baseUrl: string;
  /** 拿 Key 的页面。 */
  keyUrl?: string;
  /** 没有模型列表接口时，告诉用户模型名去哪找。 */
  modelHint?: string;
  /** 这家要求的额外请求头。 */
  headers?: (apiKey: string) => Record<string, string>;
}

export const PROVIDERS: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'dashscope', name: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys' },
  { id: 'moonshot', name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', keyUrl: 'https://platform.kimi.com/console/api-keys' },
  {
    id: 'volcengine',
    name: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    keyUrl: 'https://console.volcengine.com/ark',
    modelHint: '方舟不提供模型列表，填控制台里的 Model ID 或接入点 ID（ep- 开头）',
  },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', keyUrl: 'https://platform.minimaxi.com/' },
  { id: 'qianfan', name: '百度千帆', baseUrl: 'https://qianfan.baidubce.com/v2', keyUrl: 'https://console.bce.baidu.com/qianfan/' },
  { id: 'stepfun', name: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1', keyUrl: 'https://platform.stepfun.com/' },
  { id: 'modelscope', name: '魔搭 ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1', keyUrl: 'https://modelscope.cn/my/myaccesstoken' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://platform.claude.com/settings/keys',
    // 网页直接调用要带这个头；模型列表接口认 x-api-key
    headers: (apiKey) => ({ 'anthropic-dangerous-direct-browser-access': 'true', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
  },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'xai', name: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai/' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'custom', name: '其他兼容 OpenAI 接口的服务', baseUrl: '' },
];

export function providerOf(id: LlmProvider): ProviderPreset {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

/** 自己添加的接口用地址里的域名和端口当名字。 */
export function hostOf(baseUrl: string | undefined): string {
  try {
    return new URL(baseUrl ?? '').host || baseUrl || '';
  } catch {
    return baseUrl ?? '';
  }
}

/** 界面上怎么称呼当前的服务：预设的用名字，自己添加的用域名。 */
export function serviceName(settings: LlmSettings): string {
  return settings.provider === 'custom' ? hostOf(settings.baseUrl) || '自己添加的接口' : providerOf(settings.provider).name;
}

function endpoint(settings: LlmSettings, path: string): string {
  const base = (settings.provider === 'custom' ? settings.baseUrl ?? '' : providerOf(settings.provider).baseUrl).replace(/\/+$/, '');
  return `${base}${path}`;
}

export function isConfigured(settings: LlmSettings | undefined): settings is LlmSettings {
  if (!settings?.apiKey.trim() || !settings.model.trim()) return false;
  return settings.provider !== 'custom' || /^https:\/\//.test(settings.baseUrl ?? '');
}

export class LlmError extends Error {}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    const message = data?.error?.message ?? data?.message;
    if (typeof message === 'string' && message) return message;
  } catch {
    // 不是 JSON 就只报状态码
  }
  return `HTTP ${response.status}`;
}

function explain(status: number, detail: string): string {
  if (status === 401 || status === 403) return `Key 无效或没有权限（${detail}）`;
  if (status === 404) return `找不到这个模型或接口地址（${detail}）`;
  if (status === 429) return `请求太频繁或额度用完了（${detail}）`;
  if (status >= 500) return `服务商暂时出错了，稍后再试（${detail}）`;
  return detail;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

const TIMEOUT_MESSAGE = '等了太久没有回应：服务商可能正忙，或者网络不稳，稍后重试。';

/** 给请求加上超时。到时间报"等了太久"，用户自己取消时照常中断。 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** 发请求并读出 JSON。连不上、超时、出错都换成能看懂的说明。 */
async function request(settings: LlmSettings, path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const preset = providerOf(settings.provider);
  const apiKey = settings.apiKey.trim();
  let response: Response;
  try {
    response = await fetch(endpoint(settings, path), {
      ...init,
      signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...preset.headers?.(apiKey), ...init.headers },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    if (isTimeout(error)) throw new LlmError(TIMEOUT_MESSAGE);
    throw new LlmError(
      settings.provider === 'custom'
        ? '连不上这个地址：网络不通，或者服务端没有允许网页直接调用（要开启跨域 CORS，而且预检请求不能要求 Key）。'
        : `连不上 ${preset.name}：检查一下网络和 Key。Key 不对时，有的服务商不会告诉浏览器具体原因。`,
    );
  }
  if (!response.ok) throw new LlmError(explain(response.status, await readError(response)));
  try {
    return await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    if (isTimeout(error)) throw new LlmError(TIMEOUT_MESSAGE);
    throw new LlmError('服务商返回的不是 JSON，检查一下接口地址。');
  }
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** 发一段指令，取回模型的回答。 */
export async function complete(settings: LlmSettings, prompt: string, signal?: AbortSignal): Promise<string> {
  return chat(settings, [{ role: 'user', content: prompt }], signal);
}

/** 带系统提示的调用，AI 提炼用。 */
export async function chat(settings: LlmSettings, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const data = (await request(
    settings,
    '/chat/completions',
    {
      method: 'POST',
      body: JSON.stringify({ model: settings.model.trim(), messages }),
    },
    signal,
  )) as { choices?: { message?: { content?: unknown } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new LlmError('模型没有返回内容，换个模型或稍后再试。');
  return content;
}

// 模型列表里混着向量、语音、画图这类不能对话的模型，选的时候用不上
const NOT_CHAT = /embed|rerank|tts|whisper|transcri|speech|audio|realtime|moderation|dall-e|image|imagen|sora|veo|cogview|cogvideo|wanx|flux|stable-diffusion|sdxl|kolors|bge-|m3e|ocr/i;

/** 去重、去掉不能对话的模型并排序。全被去掉时保留原列表。 */
export function chatModels(ids: string[]): string[] {
  const unique = [...new Set(ids.map((id) => id.replace(/^models\//, '')))];
  const chat = unique.filter((id) => !NOT_CHAT.test(id));
  return (chat.length ? chat : unique).sort((a, b) => a.localeCompare(b));
}

export interface ModelList {
  models: string[];
  /** 读不到时的原因，界面上显示给用户。 */
  error?: string;
}

/** 读取这个 Key 能用的模型，最多等 15 秒。读不到时带上原因，让用户自己填。 */
export async function listModels(settings: LlmSettings, signal?: AbortSignal): Promise<ModelList> {
  try {
    const data = (await request(settings, '/models', { method: 'GET' }, withTimeout(signal, 15_000))) as { data?: unknown; models?: unknown };
    const list: unknown[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const ids = list
      .map((model) => (typeof model === 'string' ? model : (model as { id?: unknown }).id))
      .filter((id): id is string => typeof id === 'string' && !!id);
    return ids.length ? { models: chatModels(ids) } : { models: [], error: '服务商返回的模型列表是空的。' };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  }
}
