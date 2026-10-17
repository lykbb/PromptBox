// 新建条目、列表筛选、标签统计。

import type { Candidate, Item, ItemType, ScopeFields } from '../types';
import { itemScopeFields, scopeKey } from './scope';

type NewItemFields = Partial<Item> & Pick<Item, 'type' | 'title' | 'content' | 'origin'>;

export function newItem(fields: NewItemFields, now = Date.now()): Item {
  const item: Item = {
    id: crypto.randomUUID(),
    tags: [],
    note: '',
    isSample: false,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
  return { ...item, ...itemScopeFields(item) };
}

/** 确认候选时把范围作为条目数据保存，不依赖备注或正文。 */
export function itemFromCandidate(candidate: Candidate, edits: ScopeFields & {
  title: string; kind: ItemType; tags: string[]; content: string;
}, now = Date.now()): Item {
  if (edits.kind === 'rule' && !scopeKey(edits)) throw new Error('请先确认适用范围，并填写项目或任务类型');
  const origins = { local: '', ai: 'AI 提炼 · ', agent: 'Agent 提炼 · ' };
  return newItem({
    type: edits.kind,
    title: edits.title.trim() || candidate.title,
    content: edits.content.trim() || candidate.template,
    tags: edits.tags,
    ...(edits.kind === 'rule' ? itemScopeFields({ ...edits, type: 'rule' }) : { scope: 'global' as const }),
    origin: 'discover',
    originDetail: `${origins[candidate.origin ?? 'local']}来自 ${candidate.sessions} 个对话`,
    evidence: { count: candidate.count, tools: candidate.tools, quotes: candidate.quotes.slice(0, 20) },
    ...(candidate.exportHint?.skillName ? {
      skillName: candidate.exportHint.skillName,
      skillDescription: candidate.exportHint.skillDescription,
    } : {}),
  }, now);
}

export type LibraryFilter = { kind: 'all' } | { kind: 'type'; type: ItemType } | { kind: 'tag'; tag: string };

export function applyFilter(items: Item[], filter: LibraryFilter): Item[] {
  if (filter.kind === 'type') return items.filter((item) => item.type === filter.type);
  if (filter.kind === 'tag') return items.filter((item) => item.tags.includes(filter.tag));
  return items;
}

/** 标签和使用次数，次数多的在前；次数相同时，最近用过的在前。 */
export function tagCounts(items: Item[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of sortByRecent(items)) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export function sortByRecent(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const TYPE_LABELS: Record<ItemType, string> = { prompt: '提示词', rule: '规则' };

export const ORIGIN_LABELS: Record<Item['origin'], string> = {
  manual: '手动新建',
  discover: '发现',
  import: '导入',
  generate: '按风格生成',
  sample: '示例',
};
