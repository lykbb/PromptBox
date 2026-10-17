// 调用兼容 OpenAI 接口的模型服务。Key 只存在浏览器里，请求从浏览器直接发给服务商。
// 2026-10-16 用跨域预检核对过：OpenAI、DeepSeek、通义千问、智谱允许网页直接调用；Kimi 不允许，暂不支持。

import type { LlmProvider, LlmSettings } from '../types';

export interface ProviderPreset {
  id: LlmProvider;
  name: string;
  baseUrl: string;
  /** 模型名的例子，显示在输入框里。 */
  modelHint: string;
}

export const PROVIDERS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelHint: '例如 gpt-4o-mini' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', modelHint: '例如 deepseek-chat' },
  { id: 'dashscope', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelHint: '例如 qwen-plus' },
  { id: 'zhipu', name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelHint: '例如 glm-4-flash' },
  { id: 'custom', name: '其他兼容 OpenAI 接口的服务', baseUrl: '', modelHint: '服务商提供的模型名' },
];

export function providerOf(id: LlmProvider): ProviderPreset {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
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

async function request(settings: LlmSettings, path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(endpoint(settings, path), {
      ...init,
      signal,
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, 'Content-Type': 'application/json', ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new LlmError('连不上服务商：网络不通，或者这个服务不允许网页直接调用。可以改用「复制生成指令」。');
  }
  if (!response.ok) throw new LlmError(explain(response.status, await readError(response)));
  return response;
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
  const response = await request(
    settings,
    '/chat/completions',
    {
      method: 'POST',
      body: JSON.stringify({ model: settings.model.trim(), messages }),
    },
    signal,
  );
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new LlmError('模型没有返回内容，换个模型或稍后再试。');
  return content;
}

/** 读取这个 Key 能用的模型，读不到时返回空列表，让用户自己填。 */
export async function listModels(settings: LlmSettings, signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await request(settings, '/models', { method: 'GET' }, signal);
    const data = await response.json();
    const list: unknown[] = Array.isArray(data?.data) ? data.data : [];
    return list
      .map((model) => (model as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string')
      .sort();
  } catch {
    return [];
  }
}
