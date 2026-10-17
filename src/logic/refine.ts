// AI 提炼：把本地分好的组交给模型，按 Skill 里同一份提炼标准（rubric.md）再筛一遍。
// 只发送每组的几句原话（每句最多 200 字），不发送完整聊天记录。

import RUBRIC from '../../skills/promptbox-extract/references/rubric.md?raw';
import type { Candidate, Quote, Tool, Utterance } from '../types';
import { toCandidate } from './discover/external';
import { bigrams, clip, dice } from './text';

export interface RefineGroup {
  id: string;
  kind: 'task' | 'correction' | 'standing';
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

const STANDING = /(以后|今后|往后|每次|一直|始终|永远|默认|记住|记得|都这样|不要再|别再|from now on|always|never|remember)/i;
const INSTRUCTION = /(用|说|写|回答|回复|不要|别|先|保持|统一|控制|加上|分成|改成|换成|格式|中文|英文|简洁|结论)/;
const TROUBLE = /(报错|错误|失败|出错|崩溃|卡住|不行|没反应|bug|error|fail)/i;

/** 明确要求长期遵守的话：有"以后""每次""记住"这类词，又像在提要求，而且不是在报问题。 */
export function isStanding(text: string): boolean {
  return Array.from(text).length <= 200 && STANDING.test(text) && INSTRUCTION.test(text) && !TROUBLE.test(text);
}

function dayCount(times: number[]): number {
  return new Set(times.map((time) => new Date(time).toDateString())).size;
}

/** 交给模型的组：还没处理的本地候选，加上明确说过"以后都这样"的话（出现一次也算）。次数多的优先，最多 60 组。 */
export function buildRefineGroups(candidates: Candidate[], utterances: Utterance[]): RefineGroup[] {
  const groups: RefineGroup[] = candidates.map((candidate) => ({
    id: candidate.id,
    kind: candidate.kind === 'prompt' ? 'task' : 'correction',
    count: candidate.count,
    conversations: candidate.sessions,
    days: candidate.days ?? dayCount(candidate.quotes.map((quote) => quote.at)),
    tools: candidate.tools,
    localTemplate: candidate.template,
    quotes: candidate.quotes.slice(0, 6),
  }));

  const standing: { grams: Set<string>; members: Utterance[] }[] = [];
  for (const utterance of utterances) {
    if (!isStanding(utterance.text)) continue;
    const grams = bigrams(utterance.text);
    const twin = standing.find((entry) => dice(entry.grams, grams) >= 0.7);
    if (twin) twin.members.push(utterance);
    else standing.push({ grams, members: [utterance] });
  }
  standing.forEach((entry, index) => {
    const members = [...entry.members].sort((a, b) => b.at - a.at);
    groups.push({
      id: `standing-${index + 1}`,
      kind: 'standing',
      count: members.length,
      conversations: new Set(members.map((member) => member.session)).size,
      days: dayCount(members.map((member) => member.at)),
      tools: [...new Set(members.map((member) => member.tool))],
      quotes: members.slice(0, 4).map((member) => ({ tool: member.tool, at: member.at, text: member.text })),
    });
  });
  return groups.sort((a, b) => b.count - a.count).slice(0, MAX_GROUPS);
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
- kind：task 反复交代的任务 / correction 反复做的纠正 / standing 明确说了要长期遵守的话
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
        basedOn: based.filter((id) => !id.startsWith('standing-')),
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
    if (typeof entry?.id !== 'string' || !byId.has(entry.id) || used.has(entry.id) || entry.id.startsWith('standing-')) continue;
    skipped[entry.id] = typeof entry.why === 'string' && entry.why.trim() ? entry.why.trim() : '模型判断为一次性的';
  }
  return { candidates, skipped };
}
