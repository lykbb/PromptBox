// AI 提炼：把本地找到的候选交给模型，按 Skill 里同一份提炼标准（rubric.md）再筛一遍。
// 可以一条一条问，也可以一次问完；模型的判断变成挂在各条候选下面的「意见」，用不用由用户一条条决定，不会凭空多出候选。
// 只发送每条候选的几句原话（每句最多 200 字），不发送完整聊天记录。

import RUBRIC from '../../skills/promptbox-extract/references/rubric.md?raw';
import type { Advice, Candidate, Quote, Tool } from '../types';
import { toCandidate } from './discover/external';
import { clip } from './text';

export interface RefineGroup {
  /** 就是本地候选的 id。 */
  id: string;
  /** 本地候选的名称，只在界面上显示，不发给模型。 */
  title?: string;
  kind: 'task' | 'correction';
  count: number;
  conversations: number;
  days: number;
  tools: Tool[];
  localTemplate?: string;
  quotes: Quote[];
}

export const MAX_GROUPS = 60;
export const BATCH_SIZE = 15;
const QUOTE_CHARS = 200;

function dayCount(times: number[]): number {
  return new Set(times.map((time) => new Date(time).toDateString())).size;
}

/** 交给模型的组：每条本地候选一组。次数多的优先，最多 60 组。 */
export function buildRefineGroups(candidates: Candidate[]): RefineGroup[] {
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      kind: candidate.kind === 'prompt' ? ('task' as const) : ('correction' as const),
      count: candidate.count,
      conversations: candidate.sessions,
      days: candidate.days ?? dayCount(candidate.quotes.map((quote) => quote.at)),
      tools: candidate.tools,
      localTemplate: candidate.template,
      quotes: candidate.quotes.slice(0, 6),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_GROUPS);
}

/** 要发出去的原话句数，确认时告诉用户。 */
export function quoteCount(groups: RefineGroup[]): number {
  return groups.reduce((sum, group) => sum + group.quotes.length, 0);
}

export const REFINE_SYSTEM = `你在帮用户从他和 AI 工具的聊天记录里，挑出值得长期保存的提示词和规则。严格按下面的提炼标准判断：大多数是一次性的，宁缺毋滥。

<提炼标准>
${RUBRIC}
</提炼标准>

输入是本地程序预先分好的组，JSON 数组。每组字段：
- id：组的编号
- kind：task 反复交代的任务 / correction 反复做的纠正
- count、conversations、days：出现次数、对话数、天数
- tools：来自哪些工具
- localTemplate：本地程序拟的模板或规则，可能不准，只作参考
- quotes：几句原话；after 是紧跟着的纠正

只输出一个 JSON 对象，不要任何其他文字，不要代码块标记：
{"candidates": [候选], "skipped": [{"id": "组的 id", "why": "一句话说明为什么不收"}]}

每条候选的字段：
- type：prompt 或 rule
- title：6–12 个字的名称
- content：提示词模板（变量写成 {{名称}}）或一句规则
- reason：为什么值得存，带关键数字
- confidence：high 或 medium（达不到的不要输出）
- tags：1–2 个主题标签
- scope：规则必须写 global、project 或 task；project 要同时写 project 字段，task 要同时写 taskType 字段。提示词不用写
- ruleCategory：规则才写
- fixes：合并进模板的、用户常在之后补充的要求
- export：{"format": "md" | "skill" | "agents" | "claude"}，skill 还要 skillName 和 skillDescription
- basedOn：这条候选来自哪几组的 id，必填

每一组要么出现在某条候选的 basedOn 里，要么出现在 skipped 里。同一个意思的几组合并成一条候选。不要编造原话里没有的要求。`;

/** 发给模型的组：原话截到 200 字，时间只留日期。 */
export function groupsPayload(groups: RefineGroup[]): string {
  return JSON.stringify(
    groups.map((group) => ({
      id: group.id,
      kind: group.kind,
      count: group.count,
      conversations: group.conversations,
      days: group.days,
      tools: group.tools,
      ...(group.localTemplate ? { localTemplate: group.localTemplate } : {}),
      quotes: group.quotes.map((quote) => ({
        text: clip(quote.text, QUOTE_CHARS),
        ...(quote.after ? { after: clip(quote.after, QUOTE_CHARS) } : {}),
        tool: quote.tool,
        date: new Date(quote.at).toISOString().slice(0, 10),
      })),
    })),
  );
}

export interface RefineOutcome {
  candidates: Candidate[];
  /** 模型判断为一次性的本地候选：编号 → 理由。 */
  skipped: Record<string, string>;
}

/** 模型偶尔会包代码块或加几句话，取出第一个完整的 JSON 对象。 */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('模型没有按要求返回 JSON，换个模型或再试一次');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('模型返回的 JSON 不完整，换个模型或再试一次');
  }
}

/** 把模型的回答转成候选：次数、原话、工具从组里补，不信模型自己写的数字。 */
export function parseRefineResponse(text: string, groups: RefineGroup[], now = Date.now()): RefineOutcome {
  const data = extractJson(text) as { candidates?: unknown; skipped?: unknown };
  const byId = new Map(groups.map((group) => [group.id, group]));
  const candidates: Candidate[] = [];
  const used = new Set<string>();

  for (const raw of Array.isArray(data.candidates) ? data.candidates : []) {
    if (!raw || typeof raw !== 'object') continue;
    const fields = raw as Record<string, unknown>;
    const based = (Array.isArray(fields.basedOn) ? fields.basedOn : []).filter((id): id is string => typeof id === 'string' && byId.has(id));
    if (!based.length) continue;
    const members = based.map((id) => byId.get(id)!);
    const quotes = members
      .flatMap((member) => member.quotes)
      .sort((a, b) => b.at - a.at)
      .slice(0, 5);
    const candidate = toCandidate(
      {
        ...fields,
        count: members.reduce((sum, member) => sum + member.count, 0),
        conversations: Math.max(...members.map((member) => member.conversations)),
        days: Math.max(...members.map((member) => member.days)),
        tools: [...new Set(members.flatMap((member) => member.tools))],
        quotes,
        lastSeen: Math.max(...quotes.map((quote) => quote.at)),
        basedOn: based,
      },
      'ai',
      now,
    );
    if (!candidate) continue;
    based.forEach((id) => used.add(id));
    candidates.push(candidate);
  }

  const skipped: Record<string, string> = {};
  for (const raw of Array.isArray(data.skipped) ? data.skipped : []) {
    const entry = raw as { id?: unknown; why?: unknown };
    if (typeof entry?.id !== 'string' || !byId.has(entry.id) || used.has(entry.id)) continue;
    skipped[entry.id] = typeof entry.why === 'string' && entry.why.trim() ? entry.why.trim() : '模型判断为一次性的';
  }
  return { candidates, skipped };
}

/** 把模型的回答变成每条候选的意见。几组合成一条时，意见挂在第一组上，其余几组标成和它是同一件事。模型没提到的组不给意见。 */
export function adviceFromOutcome(outcome: RefineOutcome, groups: RefineGroup[], now = Date.now()): Record<string, Advice> {
  const titleOf = new Map(groups.map((group) => [group.id, group.title ?? '']));
  const advice: Record<string, Advice> = {};
  for (const candidate of outcome.candidates) {
    const [first, ...rest] = (candidate.basedOn ?? []).filter((id) => !advice[id]);
    if (!first) continue;
    advice[first] = {
      verdict: 'keep',
      title: candidate.title,
      content: candidate.template,
      kind: candidate.kind,
      tags: candidate.tags ?? [],
      reason: candidate.reason ?? '',
      confidence: candidate.confidence ?? 'medium',
      scope: candidate.scope,
      project: candidate.project,
      taskType: candidate.taskType,
      at: now,
    };
    for (const id of rest) advice[id] = { verdict: 'duplicate', of: first, ofTitle: titleOf.get(first) || candidate.title, at: now };
  }
  for (const [id, reason] of Object.entries(outcome.skipped)) if (!advice[id]) advice[id] = { verdict: 'skip', reason, at: now };
  return advice;
}
