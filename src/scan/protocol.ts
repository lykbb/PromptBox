// 扫描线程和页面之间传的消息。

import type { ScannedFile, SourceId, Utterance } from '../types';

export type ScanJob =
  | { sourceId: FolderSourceId; handle: FileSystemDirectoryHandle }
  | { sourceId: FolderSourceId; native: true }
  | ({ sourceId: FolderSourceId } & NativeScanFiles)
  | { sourceId: SourceId; files: File[] };

export interface NativeScanFiles {
  records: { path: string; content: string; size: number; modified: number }[];
  matched: number;
  compressed: number;
}

/** 选文件夹的来源；网页版导出是选文件。 */
export type FolderSourceId = 'codex' | 'claude-code' | 'workbuddy';

export interface ScanRequest {
  jobs: ScanJob[];
  /** 上次扫描过的文件，大小和修改时间都没变的跳过。 */
  known: Record<string, { size: number; modified: number }>;
}

export interface ScanResult {
  sourceId: SourceId;
  utterances: Utterance[];
  files: ScannedFile[];
  /** 这次重新读过的对话，旧的话要先删掉再写入。 */
  sessions: string[];
  /** 这个来源里一共找到多少个匹配的文件，用来判断是不是选错了文件夹。 */
  matched: number;
  /** 压缩过的旧会话（.jsonl.zst），浏览器读不了。 */
  compressed: number;
}

export type ScanMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; results: ScanResult[] }
  | { type: 'error'; message: string };

/** 哪些文件算记录：Codex 是 rollout-*.jsonl，Claude Code、WorkBuddy 是 *.jsonl（子任务的 agent-*.jsonl 不算）。 */
export function isRecordFile(sourceId: SourceId, path: string): boolean {
  const name = path.split('/').pop() ?? '';
  if (sourceId === 'codex') return /^rollout-.*\.jsonl$/.test(name);
  if (sourceId === 'claude-code' || sourceId === 'workbuddy') return name.endsWith('.jsonl') && !name.startsWith('agent-') && !path.includes('/subagents/');
  return name.endsWith('.json');
}

/** Codex 压缩过的旧会话，浏览器解不了 zstd，只统计数量。 */
export function isCompressedRecord(sourceId: SourceId, path: string): boolean {
  return sourceId === 'codex' && /^rollout-.*\.jsonl\.zst$/.test(path.split('/').pop() ?? '');
}
