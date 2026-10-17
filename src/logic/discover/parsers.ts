// 把各工具的聊天记录统一成 Conversation。只保留用户和 AI 的文字，工具调用、自动注入的内容都去掉。
// 支持：Codex（~/.codex/sessions/**/rollout-*.jsonl）、Claude Code（~/.claude/projects/**/*.jsonl）、
// ChatGPT 和 Claude 网页版导出的 conversations.json。

import type { Conversation, Message } from '../../types';

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
}

function toTime(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const time = Date.parse(value);
    if (!Number.isNaN(time)) return time;
  }
  return fallback;
}

/** 取出文字：字符串，或者 [{type:'text'|'input_text'|'output_text', text}] 这样的块。 */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const part = asObject(block);
      if (!part) return typeof block === 'string' ? block : '';
      const kind = part.type;
      if ((kind === 'text' || kind === 'input_text' || kind === 'output_text') && typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

const INJECTED_PREFIX =
  /^\s*(<(environment_context|user_instructions|user_shell_command|turn_aborted|permissions instructions|instructions|system-reminder)\b|# AGENTS\.md instructions|<INSTRUCTIONS>)/i;
const WHOLE_TAG = /^\s*<([a-z][a-z0-9_-]*)>[\s\S]*<\/\1>\s*$/i;

/** 工具自动塞进对话的内容，比如环境信息、规则文件。 */
export function isInjected(text: string): boolean {
  return INJECTED_PREFIX.test(text) || WHOLE_TAG.test(text);
}

function readLines(text: string): Json[] {
  const rows: Json[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = asObject(JSON.parse(line));
      if (row) rows.push(row);
    } catch {
      // 半行或损坏的行直接跳过
    }
  }
  return rows;
}

export function parseCodexSession(text: string, key: string): Conversation | null {
  const fromEvents: Message[] = [];
  const fromItems: Message[] = [];
  let lastTime = 0;
  for (const row of readLines(text)) {
    const at = toTime(row.timestamp, lastTime);
    lastTime = at;
    // 新格式包在 payload 里，早期格式直接是消息本身
    const payload = asObject(row.payload) ?? row;
    if (row.type === 'event_msg') {
      if (payload.type === 'user_message' && typeof payload.message === 'string') {
        fromEvents.push({ role: 'user', text: payload.message, at });
      } else if (payload.type === 'agent_message' && typeof payload.message === 'string') {
        fromEvents.push({ role: 'assistant', text: payload.message, at });
      }
      continue;
    }
    if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
      const body = textOf(payload.content);
      if (body && !(payload.role === 'user' && isInjected(body))) fromItems.push({ role: payload.role, text: body, at });
    }
  }

  let messages: Message[];
  if (fromEvents.some((message) => message.role === 'user')) {
    messages = fromEvents.filter((message) => !(message.role === 'user' && isInjected(message.text)));
    // 有的版本事件里没有 AI 回复，从消息记录里补上，用来判断哪句是纠正
    if (!messages.some((message) => message.role === 'assistant')) {
      messages = [...messages, ...fromItems.filter((message) => message.role === 'assistant')].sort((a, b) => a.at - b.at);
    }
  } else {
    messages = fromItems;
  }
  return messages.some((message) => message.role === 'user') ? { key, tool: 'codex', messages } : null;
}

const USER_QUERY = /<user_query>([\s\S]*?)<\/user_query>/g;
const WORKBUDDY_BLOCK =
  /<(system-reminder|additional_data|current_time|memory_and_skills_reminder|connector-status|user_info|identity_context|product_identity|project_context|project_layout|tone_and_style|previous_tool_call|previous_assistant_message|result|image_local_path|cb_summary|conversation_history_summary|task-notification)\b[^>]*>[\s\S]*?<\/\1>/g;

/** WorkBuddy 把用户的话包在 <user_query> 里，外面还有一堆系统内容。 */
export function unwrapWorkBuddy(text: string): string {
  const queries = [...text.matchAll(USER_QUERY)].map((match) => match[1].trim());
  if (queries.length) return queries.join('\n').trim();
  return text.replace(WORKBUDDY_BLOCK, '').trim();
}

export function parseWorkBuddySession(text: string, key: string): Conversation | null {
  const messages: Message[] = [];
  let title: string | undefined;
  let lastTime = 0;
  for (const row of readLines(text)) {
    if (row.type === 'ai-title' && typeof row.aiTitle === 'string') title = row.aiTitle;
    const at = toTime(row.timestamp, lastTime);
    lastTime = at;
    if (row.type !== 'message' || (row.role !== 'user' && row.role !== 'assistant')) continue;
    let body = textOf(row.content);
    if (row.role === 'user') {
      body = unwrapWorkBuddy(body);
      if (!body || isInjected(body)) continue;
    }
    messages.push({ role: row.role, text: body, at });
  }
  return messages.some((message) => message.role === 'user') ? { key, tool: 'workbuddy', title, messages } : null;
}

const CLAUDE_CODE_NOISE =
  /<command-name>|<command-message>|<command-args>|<local-command-stdout>|<local-command-stderr>|^\s*\[Request interrupted|^\s*Caveat: The messages below/;

function stripReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

export function parseClaudeCodeSession(text: string, key: string): Conversation | null {
  const messages: Message[] = [];
  let title: string | undefined;
  let lastTime = 0;
  for (const row of readLines(text)) {
    if (row.type === 'summary' && typeof row.summary === 'string') title = row.summary;
    if (row.isSidechain === true) continue;
    const at = toTime(row.timestamp, lastTime);
    lastTime = at;
    const message = asObject(row.message);
    if (!message) continue;
    if (row.type === 'user' && message.role === 'user') {
      if (row.isMeta === true) continue;
      const content = message.content;
      if (Array.isArray(content) && content.some((block) => asObject(block)?.type === 'tool_result')) continue;
      const body = stripReminders(textOf(content));
      if (!body || CLAUDE_CODE_NOISE.test(body) || isInjected(body)) continue;
      messages.push({ role: 'user', text: body, at });
    } else if (row.type === 'assistant' && message.role === 'assistant') {
      // 只有工具调用的回复也记一笔，用来判断下一句是不是纠正
      messages.push({ role: 'assistant', text: textOf(message.content), at });
    }
  }
  return messages.some((message) => message.role === 'user') ? { key, tool: 'claude-code', title, messages } : null;
}

function parseChatGptConversation(conversation: Json, index: number): Conversation | null {
  const mapping = asObject(conversation.mapping);
  if (!mapping) return null;
  const fallback = toTime(conversation.create_time, 0);
  // 从当前节点往回走，得到最后一次看到的那条对话线，编辑过的分支不算
  let nodeId = typeof conversation.current_node === 'string' ? conversation.current_node : undefined;
  if (!nodeId) {
    const ids = Object.keys(mapping);
    nodeId = ids[ids.length - 1];
  }
  const chain: Message[] = [];
  const seen = new Set<string>();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = asObject(mapping[nodeId]);
    if (!node) break;
    const message = asObject(node.message);
    const author = asObject(message?.author);
    const content = asObject(message?.content);
    const metadata = asObject(message?.metadata);
    const role = author?.role;
    if (message && content && (role === 'user' || role === 'assistant') && !metadata?.is_visually_hidden_from_conversation) {
      const kind = content.content_type;
      if (kind === 'text' || kind === 'multimodal_text') {
        const parts = Array.isArray(content.parts) ? content.parts.filter((part): part is string => typeof part === 'string') : [];
        const body = parts.join('\n').trim();
        if (body || role === 'assistant') chain.push({ role, text: body, at: toTime(message.create_time, fallback) });
      }
    }
    nodeId = typeof node.parent === 'string' ? node.parent : undefined;
  }
  chain.reverse();
  if (!chain.some((message) => message.role === 'user')) return null;
  const id = conversation.id ?? conversation.conversation_id ?? index;
  return {
    key: `chatgpt:${String(id)}`,
    tool: 'chatgpt',
    title: typeof conversation.title === 'string' ? conversation.title : undefined,
    messages: chain,
  };
}

function parseClaudeWebConversation(conversation: Json, index: number): Conversation | null {
  const list = Array.isArray(conversation.chat_messages) ? conversation.chat_messages : [];
  const fallback = toTime(conversation.created_at, 0);
  const messages: Message[] = [];
  for (const raw of list) {
    const message = asObject(raw);
    if (!message) continue;
    const role = message.sender === 'human' ? 'user' : message.sender === 'assistant' ? 'assistant' : undefined;
    if (!role) continue;
    const body = (typeof message.text === 'string' && message.text) || textOf(message.content);
    messages.push({ role, text: body.trim(), at: toTime(message.created_at, fallback) });
  }
  if (!messages.some((message) => message.role === 'user' && message.text)) return null;
  const id = conversation.uuid ?? index;
  return {
    key: `claude-web:${String(id)}`,
    tool: 'claude-web',
    title: typeof conversation.name === 'string' ? conversation.name : undefined,
    messages,
  };
}

/** ChatGPT 和 Claude 网页版导出的 conversations.json，两种格式自动识别。 */
export function parseWebExport(data: unknown): Conversation[] {
  const list = Array.isArray(data) ? data : asObject(data)?.conversations;
  if (!Array.isArray(list)) return [];
  const conversations: Conversation[] = [];
  list.forEach((raw, index) => {
    const conversation = asObject(raw);
    if (!conversation) return;
    const parsed = conversation.mapping
      ? parseChatGptConversation(conversation, index)
      : Array.isArray(conversation.chat_messages)
        ? parseClaudeWebConversation(conversation, index)
        : null;
    if (parsed) conversations.push(parsed);
  });
  return conversations;
}
