// 关键词检索。输入关键词或一句需求都行。
// 中文按两个字一组切片来匹配，不依赖分词词典，各浏览器结果一致；英文和数字按整词匹配。
// 打分：标题命中权重最高，其次标签，再次正文和备注。

import type { Item } from '../types';

const FILLER_WORDS = /(帮我|帮忙|请你?|麻烦你?|我想|想要|需要|一下|一个|一篇|一份|一条|一些|这个|那个|怎么|什么|可以|能不能)/g;
const FILLER_CHARS = /[的了吗呢吧啊呀哦嗯]/g;

/** 查询切成的片段：中文两个字一组，英文和数字整词。 */
export function queryTerms(query: string): string[] {
  const text = query.normalize('NFKC').toLowerCase().replace(FILLER_WORDS, ' ').replace(FILLER_CHARS, ' ');
  const terms = new Set<string>();
  for (const run of text.match(/\p{Script=Han}+|[a-z0-9][a-z0-9.+#-]*/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(run)) {
      for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
    } else if (run.length > 1) {
      terms.add(run);
    }
  }
  return [...terms];
}

export interface SearchHit {
  item: Item;
  score: number;
  /** 高度相关 / 相关。 */
  level: 'high' | 'normal';
}

function scoreItem(item: Item, query: string, terms: string[]): number {
  const title = item.title.normalize('NFKC').toLowerCase();
  const content = item.content.normalize('NFKC').toLowerCase();
  const note = item.note.normalize('NFKC').toLowerCase();
  const tags = item.tags.map((tag) => tag.normalize('NFKC').toLowerCase());

  let score = 0;
  let wholeMatch = false;
  if (title.includes(query)) {
    score += 6;
    wholeMatch = true;
  } else if (tags.includes(query) || content.includes(query) || note.includes(query)) {
    score += 3;
    wholeMatch = true;
  }
  for (const term of terms) {
    let best = 0;
    if (title.includes(term)) best = 3;
    else if (tags.some((tag) => tag.includes(term))) best = 2.5;
    else if (content.includes(term)) best = 1;
    else if (note.includes(term)) best = 0.8;
    score += best;
  }
  // 只零星命中一两个字时不算相关，避免一句话里的常用字把不相干的内容带出来
  return wholeMatch || score >= 2 ? score : 0;
}

/** 按相关度排序；分数相同按最近修改。 */
export function searchItems(items: Item[], rawQuery: string): SearchHit[] {
  const query = rawQuery.trim().normalize('NFKC').toLowerCase();
  if (!query) return [];
  const terms = queryTerms(query);
  return items
    .map((item) => ({ item, score: scoreItem(item, query, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .map((hit) => ({ ...hit, level: hit.score >= 5 ? 'high' : 'normal' }));
}
