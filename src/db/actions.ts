// 所有改数据的操作都在这里。界面只调这些函数，不直接写数据库。

import { db, getSettings, updateSettings } from './db';
import { annotateCandidate, buildCandidates } from '../logic/discover/candidates';
import { coveredLocals } from '../logic/discover/external';
import { extractUtterances } from '../logic/discover/classify';
import { makeBackup, type ImportEntry } from '../logic/importers';
import { itemFromCandidate, newItem } from '../logic/items';
import { itemScope, readScope, sameScope, scopeKey } from '../logic/scope';
import { sampleConversations } from '../samples/conversations';
import { sampleItems, sampleVersions } from '../samples/library';
import type { ScanResult } from '../scan/protocol';
import type { Advice, Candidate, Decision, Evidence, Item, ItemRef, ItemType, ScopeFields, SourceId, SourceRecord, Tool, Version } from '../types';

export const UNDO_MS = 6000;
const MAX_EVIDENCE_QUOTES = 20;

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function markChanged(): Promise<void> {
  await updateSettings({ changedSinceBackup: true });
}

// ---------- 首次打开 ----------

let seeding: Promise<void> | null = null;

/** 打包桌面版时关掉示例（VITE_SAMPLES=off），打开就是空的。 */
const WITH_SAMPLES = import.meta.env.VITE_SAMPLES !== 'off';

/** 首次打开写入示例库和示例对话；重复调用只执行一次。 */
export function seedIfNeeded(): Promise<void> {
  seeding ??= (async () => {
    const now = Date.now();
    const seededNow = await db.transaction('rw', [db.items, db.utterances, db.versions, db.kv], async () => {
      if ((await getSettings()).seeded) return false;
      if (WITH_SAMPLES) {
        const items = sampleItems(now);
        await db.items.bulkPut(items);
        await db.versions.bulkPut(sampleVersions(items, now));
        await db.utterances.bulkPut(sampleConversations(now).flatMap((conversation) => extractUtterances(conversation, true)));
      }
      await updateSettings({ seeded: true });
      return WITH_SAMPLES;
    });
    if (seededNow) await rebuildCandidates();
    await purgeDeleted();
  })();
  return seeding;
}

// ---------- 发现 ----------

export function isLocalCandidate(candidate: Candidate): boolean {
  return (candidate.origin ?? 'local') === 'local';
}

/** 外部候选重新对照库和处理记录；已经处理过的保留状态，并补上它覆盖的本地候选。 */
function refreshExternal(candidate: Candidate, items: Item[], decisions: Decision[], locals: Candidate[], prior?: Candidate): void {
  annotateCandidate(candidate, items, decisions);
  if (prior && prior.status !== 'new') candidate.status = prior.status;
  // 模型或 Agent 明确说过来自哪几组的保留，再补上按内容认出来的
  candidate.basedOn = distinct([...(candidate.basedOn ?? []), ...coveredLocals(candidate, locals)]);
}

/** 用全部记录重新计算本地候选。Agent 和 AI 提炼的候选保留下来，只重新对照一遍。 */
export async function rebuildCandidates(): Promise<void> {
  const [utterances, items, decisions, existing] = await Promise.all([
    db.utterances.toArray(),
    db.items.toArray(),
    db.decisions.toArray(),
    db.candidates.toArray(),
  ]);
  const live = items.filter((item) => !item.deletedAt);
  const locals = buildCandidates(utterances, live, decisions);
  const external = existing.filter((candidate) => !isLocalCandidate(candidate));
  for (const candidate of external) refreshExternal(candidate, live, decisions, locals, { ...candidate });
  await db.transaction('rw', db.candidates, async () => {
    await db.candidates.clear();
    await db.candidates.bulkPut([...locals, ...external]);
  });
}

/** 写入外部候选：本地 Agent 的候选文件、AI 提炼的结果。同一条再次导入时保留处理状态。返回新候选的条数。 */
export async function addExternalCandidates(incoming: Candidate[]): Promise<number> {
  const [items, decisions, existing] = await Promise.all([db.items.toArray(), db.decisions.toArray(), db.candidates.toArray()]);
  const live = items.filter((item) => !item.deletedAt);
  const locals = existing.filter(isLocalCandidate);
  const byId = new Map(existing.map((candidate) => [candidate.id, candidate]));
  for (const candidate of incoming) refreshExternal(candidate, live, decisions, locals, byId.get(candidate.id));
  await db.candidates.bulkPut(incoming);
  return incoming.filter((candidate) => candidate.status === 'new').length;
}

export interface CandidateEdits extends ScopeFields {
  title: string;
  kind: ItemType;
  tags: string[];
  content: string;
}

export interface SaveOutcome {
  itemId: string;
  merged: boolean;
  title: string;
}

/** 存进库。和库里某条相似时合并进那一条：原话和次数加上去，正文不动。 */
export async function saveCandidate(candidate: Candidate, edits: CandidateEdits): Promise<SaveOutcome> {
  if (edits.kind === 'rule' && !scopeKey(edits)) throw new Error('请先确认适用范围，并填写项目或任务类型');
  const now = Date.now();
  const evidence: Evidence = { count: candidate.count, tools: candidate.tools, quotes: candidate.quotes.slice(0, MAX_EVIDENCE_QUOTES) };
  return db.transaction('rw', [db.items, db.decisions, db.candidates, db.kv], async () => {
    // 选的范围和相似那一条一样才合并；提示词不分范围
    let target = candidate.similarItemId && edits.kind === candidate.kind ? await db.items.get(candidate.similarItemId) : undefined;
    if (target && (target.deletedAt || (edits.kind === 'rule' && !sameScope(itemScope(target), edits)))) target = undefined;

    let outcome: SaveOutcome;
    if (target) {
      const prior = target.evidence;
      const quotes = [...(prior?.quotes ?? []), ...evidence.quotes].sort((a, b) => b.at - a.at).slice(0, MAX_EVIDENCE_QUOTES);
      await db.items.update(target.id, {
        evidence: { count: (prior?.count ?? 0) + evidence.count, tools: distinct<Tool>([...(prior?.tools ?? []), ...evidence.tools]), quotes },
        tags: distinct([...target.tags, ...edits.tags]),
        isSample: false,
        updatedAt: now,
      });
      outcome = { itemId: target.id, merged: true, title: target.title };
    } else {
      const item = itemFromCandidate(candidate, edits, now);
      await db.items.add(item);
      outcome = { itemId: item.id, merged: false, title: item.title };
    }
    await decide(candidate, 'saved', outcome.title, now, outcome.itemId);
    await markChanged();
    return outcome;
  });
}

/** 记下处理结果。外部候选覆盖的本地候选一起记上，以后不会再单独冒出来。 */
async function decide(candidate: Candidate, status: 'saved' | 'ignored', title: string, at: number, itemId?: string): Promise<void> {
  const ids = [candidate.id, ...(candidate.basedOn ?? [])];
  const covered = (await db.candidates.bulkGet(ids)).filter((entry): entry is Candidate => !!entry && (entry.id === candidate.id || sameScope(entry, candidate)));
  for (const entry of covered.length ? covered : [candidate]) {
    await db.decisions.put({ signature: entry.id, kind: entry.kind, status, title, text: entry.template, at, ...readScope(entry), ...(itemId ? { itemId } : {}) });
    await db.candidates.update(entry.id, { status });
  }
}

export async function ignoreCandidate(candidate: Candidate): Promise<void> {
  await db.transaction('rw', [db.decisions, db.candidates], async () => {
    await decide(candidate, 'ignored', candidate.title, Date.now());
  });
}

/** 撤销忽略。 */
export async function restoreCandidate(candidate: Candidate): Promise<void> {
  await db.transaction('rw', [db.decisions, db.candidates], async () => {
    for (const id of [candidate.id, ...(candidate.basedOn ?? [])]) {
      await db.decisions.delete(id);
      await db.candidates.update(id, { status: 'new' });
    }
  });
}

/** AI 提炼判断为一次性的本地候选：编号 → 理由。 */
// ---------- AI 的意见 ----------

/** AI 对各条本地候选的意见。以前「判断为一次性的」单独存在 aiSkipped 里，读的时候一起算上。 */
export async function getAdvice(): Promise<Record<string, Advice>> {
  const [advice, skipped] = await Promise.all([db.kv.get('aiAdvice'), db.kv.get('aiSkipped')]);
  const legacy = Object.entries((skipped?.value ?? {}) as Record<string, string>).map(([id, reason]): [string, Advice] => [id, { verdict: 'skip', reason, at: 0 }]);
  return { ...Object.fromEntries(legacy), ...((advice?.value ?? {}) as Record<string, Advice>) };
}

export async function saveAdvice(patch: Record<string, Advice>): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const row = await db.kv.get('aiAdvice');
    await db.kv.put({ key: 'aiAdvice', value: { ...((row?.value ?? {}) as Record<string, Advice>), ...patch } });
  });
}

/** 记下怎么处理 AI 的意见：用了 AI 的版本、保持原样；传空表示撤回，意见重新摊开。 */
export async function setAdviceStatus(id: string, status?: Advice['status']): Promise<void> {
  const advice = (await getAdvice())[id];
  if (advice) await saveAdvice({ [id]: { ...advice, status } });
}

// ---------- 记录来源和扫描 ----------

export async function saveSource(source: SourceRecord): Promise<void> {
  await db.sources.put(source);
}

/** 换了文件夹或导出文件时，先清掉这个来源之前读到的内容。 */
export async function resetSource(id: SourceId): Promise<void> {
  await db.transaction('rw', [db.files, db.utterances, db.sources], async () => {
    await db.files.where('sourceId').equals(id).delete();
    const tools: Tool[] = id === 'web-export' ? ['chatgpt', 'claude-web'] : [id];
    await db.utterances.filter((utterance) => !utterance.isSample && tools.includes(utterance.tool)).delete();
    await db.sources.delete(id);
  });
}

export async function knownFiles(): Promise<Record<string, { size: number; modified: number }>> {
  const files = await db.files.toArray();
  return Object.fromEntries(files.map((file) => [file.key, { size: file.size, modified: file.modified }]));
}

export interface ScanSummary {
  /** 这次新读到的对话数。 */
  conversations: number;
  /** 每个来源里匹配的文件数，0 说明可能选错了文件夹。 */
  matched: Partial<Record<SourceRecord['id'], number>>;
  /** 压缩过的旧会话，浏览器读不了，跳过了。 */
  compressed: Partial<Record<SourceRecord['id'], number>>;
}

/** 写入扫描结果。第一次读到真实记录时，示例对话让位。 */
export async function applyScan(results: ScanResult[]): Promise<ScanSummary> {
  const now = Date.now();
  const conversations = results.reduce((sum, result) => sum + result.sessions.length, 0);
  await db.transaction('rw', [db.utterances, db.files, db.sources], async () => {
    if (conversations > 0) await db.utterances.filter((utterance) => !!utterance.isSample).delete();
    for (const result of results) {
      if (result.sessions.length) await db.utterances.where('session').anyOf(result.sessions).delete();
      await db.utterances.bulkPut(result.utterances);
      await db.files.bulkPut(result.files);
      const files = await db.files.where('sourceId').equals(result.sourceId).toArray();
      await db.sources.update(result.sourceId, {
        conversations: files.reduce((sum, file) => sum + file.conversations, 0),
        lastScanAt: now,
      });
    }
  });
  await rebuildCandidates();
  return {
    conversations,
    matched: Object.fromEntries(results.map((result) => [result.sourceId, result.matched])),
    compressed: Object.fromEntries(results.map((result) => [result.sourceId, result.compressed])),
  };
}

// ---------- 库 ----------

export async function createItem(type: ItemType = 'prompt', tags: string[] = []): Promise<string> {
  const item = newItem({ type, title: '', content: '', tags, origin: 'manual' });
  await db.items.add(item);
  await markChanged();
  return item.id;
}

/** 用户改过的示例就算用户自己的了，清除示例时不会删掉。 */
export async function updateItem(id: string, patch: Partial<Item>): Promise<void> {
  await db.items.update(id, { ...patch, isSample: false, updatedAt: Date.now() });
  await markChanged();
}

export async function deleteItem(id: string): Promise<void> {
  await db.items.update(id, { deletedAt: Date.now() });
  await markChanged();
  setTimeout(() => void purgeDeleted(), UNDO_MS + 200);
}

export async function restoreItem(id: string): Promise<void> {
  await db.items.update(id, { deletedAt: undefined });
}

/** 超过撤销时间的删除才真正删掉，连同版本历史。 */
export async function purgeDeleted(): Promise<void> {
  const cutoff = Date.now() - UNDO_MS;
  await removeItems((item) => !!item.deletedAt && item.deletedAt <= cutoff);
}

async function removeItems(match: (item: Item) => boolean): Promise<number> {
  return db.transaction('rw', [db.items, db.versions], async () => {
    const ids = (await db.items.filter(match).toArray()).map((item) => item.id);
    await db.items.bulkDelete(ids);
    await db.versions.where('itemId').anyOf(ids).delete();
    return ids.length;
  });
}

export async function clearSamples(): Promise<number> {
  return removeItems((item) => item.isSample);
}

// ---------- 版本历史 ----------

async function latestVersion(itemId: string): Promise<Version | undefined> {
  const versions = await db.versions.where('itemId').equals(itemId).toArray();
  return versions.sort((a, b) => b.number - a.number)[0];
}

/** 第一次打开一条还没有版本的内容时，把当前正文记成 v1，之后的修改才有得对比。 */
export async function ensureBaseline(itemId: string): Promise<void> {
  await db.transaction('rw', [db.items, db.versions], async () => {
    const item = await db.items.get(itemId);
    if (!item || !item.content.trim() || (await db.versions.where('itemId').equals(itemId).count())) return;
    await db.versions.add({ id: crypto.randomUUID(), itemId, number: 1, content: item.content, source: 'create', createdAt: item.createdAt });
  });
}

/** 离开一条内容时调用（换一条、新建、打开历史、关页面）：正文和最近一个版本不同就生成新版本。 */
export async function snapshotVersion(itemId: string): Promise<void> {
  await db.transaction('rw', [db.items, db.versions], async () => {
    const item = await db.items.get(itemId);
    if (!item || item.deletedAt || !item.content.trim()) return;
    const latest = await latestVersion(itemId);
    if (latest?.content === item.content) return;
    await db.versions.add({
      id: crypto.randomUUID(),
      itemId,
      number: (latest?.number ?? 0) + 1,
      content: item.content,
      source: latest ? 'edit' : 'create',
      createdAt: Date.now(),
    });
  });
}

/** 恢复：把所选版本的正文设为当前正文，同时生成一个新版本，原有历史不删。返回新版本号。 */
export async function restoreVersion(itemId: string, version: Version): Promise<number> {
  return db.transaction('rw', [db.items, db.versions, db.kv], async () => {
    const number = ((await latestVersion(itemId))?.number ?? 0) + 1;
    const now = Date.now();
    await db.items.update(itemId, { content: version.content, isSample: false, updatedAt: now });
    await db.versions.add({ id: crypto.randomUUID(), itemId, number, content: version.content, source: 'restore', restoredFrom: version.number, createdAt: now });
    await markChanged();
    return number;
  });
}

export async function saveGenerated(fields: ScopeFields & { title: string; content: string; need: string; refs: ItemRef[] }): Promise<string> {
  const item = newItem({
    type: 'prompt',
    title: fields.title.trim() || '未命名',
    content: fields.content.trim(),
    origin: 'generate',
    originDetail: fields.need.trim(),
    refs: fields.refs,
  });
  await db.items.add(item);
  await markChanged();
  return item.id;
}

// ---------- 导入、备份 ----------

/** 备份里已存在的条目数，导入前给用户看。 */
export async function countExisting(ids: string[]): Promise<number> {
  const found = await db.items.bulkGet(ids);
  return found.filter(Boolean).length;
}

export async function importEntries(entries: ImportEntry[]): Promise<{ added: number; skipped: number; candidates: number }> {
  let added = 0;
  let skipped = 0;
  let newDecisions = 0;
  let candidates = 0;
  await db.transaction('rw', [db.items, db.decisions, db.versions, db.kv], async () => {
    for (const entry of entries) {
      if (entry.kind === 'item') {
        await db.items.add(entry.item);
        added++;
      } else if (entry.kind === 'backup') {
        const existing = new Set((await db.items.bulkGet(entry.items.map((item) => item.id))).filter(Boolean).map((item) => item!.id));
        const fresh = entry.items.filter((item) => !existing.has(item.id));
        await db.items.bulkAdd(fresh);
        const freshIds = new Set(fresh.map((item) => item.id));
        await db.versions.bulkPut(entry.versions.filter((version) => freshIds.has(version.itemId)));
        added += fresh.length;
        skipped += entry.items.length - fresh.length;
        const knownDecisions = new Set((await db.decisions.bulkGet(entry.decisions.map((decision) => decision.signature))).filter(Boolean).map((decision) => decision!.signature));
        const freshDecisions = entry.decisions.filter((decision) => !knownDecisions.has(decision.signature));
        await db.decisions.bulkPut(freshDecisions);
        newDecisions += freshDecisions.length;
      }
    }
    if (added) await markChanged();
  });
  if (newDecisions) await rebuildCandidates();
  for (const entry of entries) {
    if (entry.kind === 'candidates') candidates += await addExternalCandidates(entry.candidates);
  }
  return { added, skipped, candidates };
}

/** 导出全部备份：库里的内容和处理记录，不含扫描时读到的聊天记录。 */
export async function exportBackup(): Promise<{ fileName: string; text: string }> {
  const [items, decisions, versions] = await Promise.all([db.items.toArray(), db.decisions.toArray(), db.versions.toArray()]);
  const backup = makeBackup(items, decisions, versions);
  return backup;
}
