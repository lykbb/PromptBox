// 找重复、生成候选。全部在本地计算：
// 1. 任务按"指令部分"的相似度归类，出现 3 次以上、来自 2 个以上对话的，变成提示词候选；
//    每次不一样的部分变成 {{变量}}，常在之后补的要求合并进模板。
// 2. 纠正先按常见说法归到固定的规则（用中文、先给结论……），其余按相似度归类，同样 3 次以上成为规则候选。
// 3. 和库里已有内容相似的标出来，处理过（保存、忽略）的不再出现。

import type { Candidate, Decision, Item, ItemType, Quote, Tool, Utterance } from '../../types';
import { bigrams, dice, hash, normalize } from '../text';
import { itemScope, sameScope, scopeKey } from '../scope';

export const MIN_COUNT = 3;
export const MIN_SESSIONS = 2;
const MAX_QUOTES = 50;

interface RulePattern {
  id: string;
  test: RegExp;
  title: string;
  text: string;
}

/** 常见纠正的固定说法。字面不同、意思相同的会归到一起。 */
export const RULE_PATTERNS: RulePattern[] = [
  {
    id: 'chinese',
    test: /(用|说|讲|改用|换成|回复|回答|输出).{0,3}中文|中文(回答|回复|输出|说|讲)/,
    title: '回答用中文',
    text: '回答使用中文。',
  },
  {
    id: 'conclusion-first',
    test: /(先|直接)(说|给|讲|写)?(结论|结果)|结论(放|写)?(在)?(前|先|最前)|别铺垫/,
    title: '先给结论，再给理由',
    text: '回答时先给结论，再给理由。',
  },
  { id: 'concise', test: /太长|太啰嗦|啰嗦|简洁|简短|精简|短一?点|废话/, title: '回答简洁', text: '回答保持简洁，不说废话。' },
  { id: 'no-fluff', test: /套话|客套|空话/, title: '不用套话', text: '不用套话和客套话。' },
  { id: 'table', test: /(用|做成|列成|整理成|改成).{0,2}表格/, title: '对比内容用表格', text: '对比和清单类内容用表格呈现。' },
  { id: 'no-emoji', test: /(不要|别|不用|去掉).{0,3}(emoji|表情)/i, title: '不用 emoji', text: '不要使用 emoji。' },
  { id: 'english', test: /(用|说|讲|回答).{0,3}英文|in english/i, title: '回答用英文', text: '回答使用英文。' },
];

// ---------- 任务的指令部分 ----------

/** 冒号或换行前面是指令，后面是这次要处理的内容。 */
export function splitInstruction(text: string): { head: string; payload: string } {
  const match = /^([\s\S]{2,100}?)(?:[：:]\s*|\n+)([\s\S]{8,})$/.exec(text.trim());
  if (match) return { head: match[1].trim(), payload: match[2].trim() };
  return { head: text.trim(), payload: '' };
}

const FILLER = /(帮我|帮忙|麻烦你?|请你?|给我|你|我|把|将|下面|以下|这段|这篇|这个|这些|一下|的|了|吧|呢)/g;

/** 去掉客气话和虚词后的核心说法，用来比较相似度。 */
export function core(text: string): string {
  return normalize(text).replace(FILLER, '');
}

const PAYLOAD_NAMES: [RegExp, string][] = [
  [/竞品|产品/, '竞品列表'],
  [/周报|本周|这周/, '本周工作'],
  [/会议/, '会议记录'],
  [/代码|函数|脚本/, '代码'],
  [/报错|错误|日志/, '报错信息'],
  [/翻译|译成/, '原文'],
];

function payloadName(heads: string[]): string {
  const all = heads.join('\n');
  return PAYLOAD_NAMES.find(([pattern]) => pattern.test(all))?.[1] ?? '内容';
}

const CLAUSE_END = '[^，,。；;：:\\s]';
const TITLE_RULES: [RegExp, (match: RegExpExecArray) => string][] = [
  [new RegExp(`(?:改成|写成|改写成|转成|换成)(${CLAUSE_END}{1,8}?)的?风格`), (match) => `${match[1]}风格改写`],
  [new RegExp(`(${CLAUSE_END}{1,8}?)的?风格改写`), (match) => `${match[1]}风格改写`],
  [new RegExp(`整理成(?:一份)?(${CLAUSE_END}{1,8})`), (match) => `${match[1]}整理`],
  [/(竞品|产品).{0,12}(对比|分析)|(对比|分析).{0,16}(竞品|产品)/, () => '竞品对比'],
];

function fallbackTitle(head: string): string {
  const trimmed = head.replace(/^(帮我|帮忙|麻烦你?|请你?|给我|你|把|将)+/, '');
  const first = trimmed.split(/[，,。；;：:\n]/)[0] || trimmed;
  const chars = Array.from(first.trim());
  return chars.length > 12 ? chars.slice(0, 12).join('') : chars.join('');
}

/** 每句话按规则起名，取出现最多的；都起不出来时用中心那句的开头。 */
function taskTitle(heads: string[], centerHead: string): string {
  const votes = new Map<string, number>();
  for (const head of heads) {
    for (const [pattern, name] of TITLE_RULES) {
      const match = pattern.exec(head);
      if (match) {
        const title = name(match);
        votes.set(title, (votes.get(title) ?? 0) + 1);
        break;
      }
    }
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : fallbackTitle(centerHead) || '未命名';
}

const BRACKETED = /「([^」]{1,30})」|“([^”]{1,30})”|《([^》]{1,30})》|"([^"]{1,30})"/;

/** 括号里每次都不一样时，换成 {{主题}}。 */
function bracketVariable(centerHead: string, heads: string[]): string | null {
  const match = BRACKETED.exec(centerHead);
  if (!match) return null;
  const inner = (head: string) => {
    const found = BRACKETED.exec(head);
    return found ? found.slice(1).find(Boolean) : undefined;
  };
  const values = new Set(heads.map(inner).filter(Boolean));
  if (values.size < 2) return null;
  const value = match.slice(1).find(Boolean) ?? '';
  return centerHead.replace(match[0], match[0].replace(value, '{{主题}}'));
}

// ---------- 纠正里的具体要求 ----------

const INSTRUCTION_CUE = /(控制在|不超过|以内|多用|少用|不要|别|加上|加个|分成|分为|改成|换成|先|用)/;

/** "太长了，控制在 200 字" → ["控制在 200 字"]：只留下能写进模板的那半句。 */
export function instructionClauses(text: string): string[] {
  return text
    .split(/[，,。；;！!？?\n]/)
    .map((part) => part.trim())
    .filter((part) => part && INSTRUCTION_CUE.test(part));
}

// ---------- 归类 ----------

interface Entry<T> {
  value: T;
  grams: Set<string>;
}

/** 依次放进最像的一类：和这一类的平均相似度够高，或者和其中某句非常像。 */
function cluster<T>(entries: Entry<T>[], averageThreshold: number, maxThreshold: number): Entry<T>[][] {
  const groups: Entry<T>[][] = [];
  const index = new Map<string, Set<number>>();
  for (const entry of entries) {
    if (entry.grams.size === 0) continue;
    const touched = new Set<number>();
    for (const gram of entry.grams) index.get(gram)?.forEach((group) => touched.add(group));
    let best = -1;
    let bestScore = 0;
    for (const group of touched) {
      const members = groups[group];
      const sample = members.length > 12 ? members.slice(-12) : members;
      let sum = 0;
      let max = 0;
      for (const member of sample) {
        const score = dice(entry.grams, member.grams);
        sum += score;
        if (score > max) max = score;
      }
      const average = sum / sample.length;
      if ((average >= averageThreshold || max >= maxThreshold) && average + max > bestScore) {
        best = group;
        bestScore = average + max;
      }
    }
    if (best === -1) {
      groups.push([entry]);
      best = groups.length - 1;
    } else {
      groups[best].push(entry);
    }
    for (const gram of entry.grams) {
      let set = index.get(gram);
      if (!set) index.set(gram, (set = new Set()));
      set.add(best);
    }
  }
  return groups;
}

/** 和同类其他句子最像的那一句。 */
function medoid<T>(members: Entry<T>[]): Entry<T> {
  const sample = members.length > 40 ? members.slice(-40) : members;
  let best = sample[0];
  let bestSum = -1;
  for (const candidate of sample) {
    let sum = 0;
    for (const other of sample) if (other !== candidate) sum += dice(candidate.grams, other.grams);
    if (sum > bestSum) {
      best = candidate;
      bestSum = sum;
    }
  }
  return best;
}

// ---------- 生成候选 ----------

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** 出现多的在前。 */
function byFrequency(tools: Tool[]): Tool[] {
  const counts = new Map<Tool, number>();
  for (const tool of tools) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([tool]) => tool);
}

function quotesOf(members: Utterance[]): Quote[] {
  return [...members]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_QUOTES)
    .map((member) => ({ tool: member.tool, at: member.at, text: member.text, ...(member.after ? { after: member.after } : {}) }));
}

function summary(kind: ItemType, members: Utterance[]) {
  return {
    kind,
    count: members.length,
    sessions: distinct(members.map((member) => member.session)).length,
    tools: byFrequency(members.map((member) => member.tool)),
    quotes: quotesOf(members),
    lastAt: Math.max(...members.map((member) => member.at)),
    status: 'new' as const,
    origin: 'local' as const,
    // 提示词不分范围；规则要用户确认是所有任务、某个项目还是某类任务
    scope: kind === 'prompt' ? ('global' as const) : ('unconfirmed' as const),
    days: new Set(members.map((member) => new Date(member.at).toDateString())).size,
    isSample: members.every((member) => member.isSample),
  };
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s，,。.；;：:！!？?]+$/u, '');
}

function buildTaskCandidate(members: Utterance[], consumed: Set<string>): Candidate {
  const heads = members.map((member) => splitInstruction(member.text));
  const entries = heads.map((head, i) => ({ value: i, grams: bigrams(core(head.head)) }));
  const centerHead = stripTrailingPunctuation(heads[medoid(entries).value].head);
  const headTexts = heads.map((head) => head.head);

  // 之后常补的要求：至少 2 次、并且占三分之一以上，才合并进模板。
  // "用中文""不要用 emoji"这类通用习惯不算这个任务的要求，留给规则。
  const clauseEntries: Entry<{ clause: string; member: Utterance }>[] = [];
  for (const member of members) {
    if (!member.after) continue;
    for (const clause of instructionClauses(member.after)) {
      if (RULE_PATTERNS.some((pattern) => pattern.test.test(clause))) continue;
      clauseEntries.push({ value: { clause, member }, grams: bigrams(clause) });
    }
  }
  const fixes: string[] = [];
  const fixMembers = new Set<Utterance>();
  for (const group of cluster(clauseEntries, 0.5, 0.5)) {
    const groupMembers = new Set(group.map((entry) => entry.value.member));
    if (groupMembers.size < 2 || groupMembers.size * 3 < members.length) continue;
    const counts = new Map<string, number>();
    for (const entry of group) counts.set(entry.value.clause, (counts.get(entry.value.clause) ?? 0) + 1);
    fixes.push([...counts].sort((a, b) => b[1] - a[1])[0][0]);
    groupMembers.forEach((member) => fixMembers.add(member));
  }
  for (const member of fixMembers) if (member.afterId) consumed.add(member.afterId);

  const withPayload = heads.filter((head) => head.payload).length;
  const instruction = fixes.length ? `${centerHead}，${fixes.join('，')}` : centerHead;
  const template =
    withPayload * 2 >= members.length
      ? `${instruction}：\n{{${payloadName(headTexts)}}}`
      : (bracketVariable(instruction, headTexts) ?? instruction);

  return {
    id: `prompt-${hash(core(centerHead))}`,
    title: taskTitle(headTexts, centerHead),
    template,
    fixes,
    fixCount: fixMembers.size,
    ...summary('prompt', members),
  };
}

function buildRuleCandidates(corrections: Utterance[]): Candidate[] {
  const byPattern = new Map<string, Utterance[]>();
  const leftovers: Utterance[] = [];
  for (const correction of corrections) {
    const matched = RULE_PATTERNS.filter((pattern) => pattern.test.test(correction.text));
    if (!matched.length) leftovers.push(correction);
    for (const pattern of matched) {
      const list = byPattern.get(pattern.id) ?? [];
      list.push(correction);
      byPattern.set(pattern.id, list);
    }
  }

  const candidates: Candidate[] = [];
  for (const pattern of RULE_PATTERNS) {
    const members = byPattern.get(pattern.id);
    if (!members) continue;
    candidates.push({ id: `rule-${pattern.id}`, title: pattern.title, template: pattern.text, fixes: [], fixCount: 0, ...summary('rule', members) });
  }

  const groups = cluster(
    leftovers.map((value) => ({ value, grams: bigrams(value.text) })),
    0.55,
    0.7,
  );
  for (const group of groups) {
    const members = group.map((entry) => entry.value);
    const representative = stripTrailingPunctuation(medoid(group).value.text);
    const title = Array.from(representative).length > 16 ? Array.from(representative).slice(0, 16).join('') : representative;
    candidates.push({
      id: `rule-${hash(normalize(representative))}`,
      title,
      template: `${representative}。`,
      fixes: [],
      fixCount: 0,
      ...summary('rule', members),
    });
  }
  return candidates;
}

// ---------- 和库、处理记录对照 ----------

function withoutVariables(text: string): string {
  return text.replace(/\{\{[^{}\n]{1,20}\}\}/g, '');
}

function shared(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const gram of a) if (b.has(gram)) count++;
  return count;
}

/** 库里同类型、意思相近的一条。 */
export function findSimilarItem(candidate: Pick<Candidate, 'kind' | 'title' | 'template' | 'scope' | 'project' | 'taskType'>, items: Item[]): Item | undefined {
  const grams = bigrams(withoutVariables(candidate.template));
  const titleGrams = bigrams(candidate.title);
  let best: Item | undefined;
  let bestScore = 0;
  for (const item of items) {
    // 范围已确认的只和同范围的比；待确认的规则先找出相似的，保存时选了同一范围才合并
    if (item.type !== candidate.kind || item.deletedAt || (scopeKey(candidate) && !sameScope(candidate, item))) continue;
    const content = bigrams(withoutVariables(item.content));
    const overlap = grams.size && content.size ? shared(grams, content) / Math.min(grams.size, content.size) : 0;
    const score = Math.max(dice(grams, content), overlap, dice(titleGrams, bigrams(item.title)));
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

/** 标出和库里相似的那一条，并按处理记录带上状态（保存过、忽略过）。 */
export function annotateCandidate(candidate: Candidate, items: Item[], decisions: Decision[]): void {
  const similar = findSimilarItem(candidate, items);
  candidate.similarItemId = similar?.id;
  candidate.similarItemTitle = similar?.title;
  candidate.similarItemScope = similar ? itemScope(similar) : undefined;
  const decision = findDecision(candidate, decisions);
  if (decision) candidate.status = decision.status;
}

/**
 * 处理过的候选按签名认，签名变了再按文字相似认。
 * 提示词不分范围；规则只在同一范围里认（都是待确认的也算同一范围），忽略了项目 A 的规则不会藏起项目 B 的。
 */
function findDecision(candidate: Candidate, decisions: Decision[]): Decision | undefined {
  const sameBucket = (decision: Decision) =>
    candidate.kind === 'prompt' || sameScope(candidate, decision) || (!scopeKey(candidate) && !scopeKey(decision));
  const exact = decisions.find((decision) => decision.signature === candidate.id && sameBucket(decision));
  if (exact) return exact;
  const grams = bigrams(candidate.template);
  return decisions.find((decision) => decision.kind === candidate.kind && sameBucket(decision) && dice(grams, bigrams(decision.text)) >= 0.6);
}

export function buildCandidates(utterances: Utterance[], items: Item[], decisions: Decision[]): Candidate[] {
  const byTime = [...utterances].sort((a, b) => a.at - b.at);
  const tasks = byTime.filter((utterance) => utterance.role === 'task');
  const corrections = byTime.filter((utterance) => utterance.role === 'correction');

  const consumed = new Set<string>();
  const taskGroups = cluster(
    tasks.map((value) => ({ value, grams: bigrams(core(splitInstruction(value.text).head)) })),
    0.5,
    0.62,
  );
  const candidates: Candidate[] = [];
  for (const group of taskGroups) {
    const members = group.map((entry) => entry.value);
    if (members.length < MIN_COUNT) continue;
    if (distinct(members.map((member) => member.session)).length < MIN_SESSIONS) continue;
    candidates.push(buildTaskCandidate(members, consumed));
  }
  const rules = buildRuleCandidates(corrections.filter((correction) => !consumed.has(correction.id)));
  candidates.push(...rules.filter((rule) => rule.count >= MIN_COUNT && rule.sessions >= MIN_SESSIONS));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    // 极少数情况下两类得到同一个签名，加后缀区分
    let id = candidate.id;
    for (let n = 2; seen.has(id); n++) id = `${candidate.id}-${n}`;
    candidate.id = id;
    seen.add(id);
    annotateCandidate(candidate, items, decisions);
  }
  return candidates.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
