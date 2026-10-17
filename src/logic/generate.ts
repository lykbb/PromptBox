// 按我的风格生成：从库里挑出相关的旧提示词和规则，拼成一段生成指令。
// 填了模型 Key 时直接发给模型；没填时复制给用户，贴到自己常用的 AI 里。

import type { Item, ScopeFields } from '../types';
import { contentWithScope, matchesScope, readScope, scopeKey, scopeLabel } from './scope';
import { searchItems } from './search';
import { clip } from './text';

const MAX_EXAMPLES = 3;
const MAX_RULES = 6;
const MAX_EXAMPLE_CHARS = 600;

export interface Reference {
  item: Item;
  /** 显示在勾选框下面的说明。 */
  reason: string;
}

/**
 * 这次需求涉及哪些任务类型：参考的提示词带的标签，加上需求里直接提到的。
 * 比如参考了带「写作」标签的提示词，「写作」任务的规则也适用。
 */
function taskTypesFor(need: string, examples: Item[], rules: Item[]): Set<string> {
  const types = new Set(examples.flatMap((item) => item.tags));
  for (const rule of rules) {
    const scope = readScope(rule);
    if (scope.scope === 'task' && scope.taskType && need.includes(scope.taskType)) types.add(scope.taskType);
  }
  return types;
}

/** 规则在这次生成里适不适用：所有任务的、和选定范围一致的、属于这次涉及的任务类型的。 */
function ruleApplies(rule: Item, context: ScopeFields, taskTypes: Set<string>): boolean {
  if (matchesScope(rule, context)) return true;
  const scope = readScope(rule);
  return scope.scope === 'task' && !!scope.taskType && taskTypes.has(scope.taskType);
}

/**
 * 先按明确的适用范围筛选，再挑最多 3 条相关提示词和 6 条规则。
 * 指定范围的规则直接参与；全局规则按需求、示例标签或无标签的通用规则挑选；
 * 参考的提示词带着某个任务类型的标签时，这类任务的规则也带上。
 */
export function pickReferences(need: string, items: Item[], context: ScopeFields = { scope: 'global' }): Reference[] {
  const alive = items.filter((item) => !item.deletedAt);
  const live = alive.filter((item) => matchesScope(item, context));
  const hits = searchItems(live, need);
  const examples = hits
    .filter((hit) => hit.item.type === 'prompt')
    .slice(0, MAX_EXAMPLES)
    .map((hit) => ({ item: hit.item, reason: `提示词 · ${hit.level === 'high' ? '高度相关' : '相关'}` }));
  const relatedRules = new Set(hits.filter((hit) => hit.item.type === 'rule').map((hit) => hit.item.id));
  const exampleTags = new Set(examples.flatMap((example) => example.item.tags));
  const allRules = alive.filter((item) => item.type === 'rule');
  const taskTypes = taskTypesFor(need, examples.map((example) => example.item), allRules);

  const reasonFor = (rule: Item): string | null => {
    if (readScope(rule).scope !== 'global') return `规则 · ${scopeLabel(rule)}`;
    if (relatedRules.has(rule.id)) return '规则 · 相关';
    const shared = rule.tags.find((tag) => exampleTags.has(tag));
    if (shared) return `规则 · 同属「${shared}」`;
    if (rule.tags.length === 0) return '规则 · 通用，每次都会带上';
    return null;
  };
  const rank = (reason: string) => (reason.endsWith('相关') ? 0 : reason.includes('同属') ? 1 : 2);
  const rules = allRules
    .filter((item) => ruleApplies(item, context, taskTypes))
    .map((item) => ({ item, reason: reasonFor(item) }))
    .filter((entry): entry is Reference => entry.reason !== null)
    .sort((a, b) => {
      const priority = (entry: Reference) => readScope(entry.item).scope !== 'global' ? -1 : rank(entry.reason);
      return priority(a) - priority(b) || b.item.updatedAt - a.item.updatedAt;
    })
    .slice(0, MAX_RULES);
  return [...examples, ...rules];
}

/** 生成指令：任务、参考写法、固定习惯、输出要求。 */
export function buildGenerationPrompt(need: string, references: Item[], context: ScopeFields = { scope: 'global' }): string {
  const examples = references.filter((item) => item.type === 'prompt' && matchesScope(item, context));
  const taskTypes = taskTypesFor(need, examples, references);
  const rules = references.filter((item) => item.type === 'rule' && scopeKey(item) && ruleApplies(item, context, taskTypes));
  const parts = [`请帮我写一条提示词。\n任务：${need.trim()}`];
  parts.push(`本次适用范围：${scopeLabel(context)}`);
  if (examples.length) {
    const blocks = examples.map((item, index) => `【示例 ${index + 1}：${item.title}】\n${contentWithScope({ ...item, content: clip(item.content.trim(), MAX_EXAMPLE_CHARS) })}`);
    parts.push(`参考我以前写过的提示词，延续它们的结构和措辞习惯：\n\n${blocks.join('\n\n')}`);
  }
  if (rules.length) {
    // 多行规则合成一行，去掉原来的列表符号
    // 限定范围的规则在末尾注明范围，模型就不会把它推广到别的场景
    const lines = rules.map((item) => {
      const pieces = item.content.split('\n').map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, '').trim());
      const scope = readScope(item).scope === 'global' ? '' : `（适用范围：${scopeLabel(item)}，其他场景不适用）`;
      return `- ${pieces.filter(Boolean).join('；')}${scope}`;
    });
    parts.push(`已确认的规则：保留每条的适用范围，只在对应场景使用，不要推广到其他项目或任务。\n${lines.join('\n')}`);
  }
  parts.push(
    '输出要求：\n1. 只输出提示词本身，不要解释，不要加代码块标记。\n2. 每次使用时会变的部分用 {{变量名}} 标出，变量名用简短的中文。\n3. 先交代角色和任务，再分条列出要求。',
  );
  return parts.join('\n\n');
}

/** 模型偶尔会包一层代码块，去掉它。 */
export function cleanGenerated(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** 生成结果的默认标题：需求的前 16 个字。 */
export function titleFromNeed(need: string): string {
  const first = need.trim().split(/[，,。；;\n]/)[0] || need.trim();
  const chars = Array.from(first);
  return chars.length > 16 ? chars.slice(0, 16).join('') : first;
}
