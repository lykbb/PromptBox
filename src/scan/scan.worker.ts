// 后台线程：读记录文件、解析、挑出任务和纠正。界面线程不卡，文件内容也不离开这个浏览器。

import { extractUtterances } from '../logic/discover/classify';
import { parseClaudeCodeSession, parseCodexSession, parseWebExport, parseWorkBuddySession } from '../logic/discover/parsers';
import type { Conversation, ScannedFile, SourceId } from '../types';
import { isCompressedRecord, isRecordFile, type ScanMessage, type ScanRequest, type ScanResult } from './protocol';

interface Pending {
  sourceId: SourceId;
  path: string;
  file: () => Promise<File>;
}

const scope = self as unknown as { postMessage(message: ScanMessage): void; onmessage: ((event: MessageEvent<ScanRequest>) => void) | null };

async function* walk(directory: FileSystemDirectoryHandle, path = '', depth = 0): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  if (depth > 6) return;
  for await (const entry of directory.values()) {
    const childPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') yield* walk(entry as FileSystemDirectoryHandle, childPath, depth + 1);
    else yield { path: childPath, handle: entry as FileSystemFileHandle };
  }
}

function parseFile(sourceId: SourceId, key: string, text: string): Conversation[] {
  if (sourceId === 'codex') return [parseCodexSession(text, key)].filter((conversation): conversation is Conversation => !!conversation);
  if (sourceId === 'claude-code') return [parseClaudeCodeSession(text, key)].filter((conversation): conversation is Conversation => !!conversation);
  if (sourceId === 'workbuddy') return [parseWorkBuddySession(text, key)].filter((conversation): conversation is Conversation => !!conversation);
  try {
    return parseWebExport(JSON.parse(text));
  } catch {
    return [];
  }
}

async function scan({ jobs, known }: ScanRequest): Promise<ScanResult[]> {
  // 先列出所有要读的文件，这样能报进度
  const pending: Pending[] = [];
  const matched = new Map<SourceId, number>();
  const compressed = new Map<SourceId, number>();
  for (const job of jobs) {
    matched.set(job.sourceId, 0);
    compressed.set(job.sourceId, 0);
    if ('native' in job) throw new Error('本机文件尚未读取');
    if ('records' in job) {
      matched.set(job.sourceId, job.matched);
      compressed.set(job.sourceId, job.compressed);
      for (const record of job.records) {
        pending.push({ sourceId: job.sourceId, path: record.path, file: async () => new File([record.content], record.path.split('/').pop()!, { lastModified: record.modified }) });
      }
    } else if ('handle' in job) {
      for await (const { path, handle } of walk(job.handle)) {
        if (isCompressedRecord(job.sourceId, path)) compressed.set(job.sourceId, (compressed.get(job.sourceId) ?? 0) + 1);
        if (!isRecordFile(job.sourceId, path)) continue;
        matched.set(job.sourceId, (matched.get(job.sourceId) ?? 0) + 1);
        pending.push({ sourceId: job.sourceId, path, file: () => handle.getFile() });
      }
    } else {
      for (const file of job.files) {
        const path = file.webkitRelativePath || file.name;
        if (isCompressedRecord(job.sourceId, path)) compressed.set(job.sourceId, (compressed.get(job.sourceId) ?? 0) + 1);
        if (!isRecordFile(job.sourceId, path)) continue;
        matched.set(job.sourceId, (matched.get(job.sourceId) ?? 0) + 1);
        pending.push({ sourceId: job.sourceId, path, file: async () => file });
      }
    }
  }

  const results = new Map<SourceId, ScanResult>();
  for (const job of jobs) {
    results.set(job.sourceId, {
      sourceId: job.sourceId,
      utterances: [],
      files: [],
      sessions: [],
      matched: matched.get(job.sourceId) ?? 0,
      compressed: compressed.get(job.sourceId) ?? 0,
    });
  }

  let done = 0;
  scope.postMessage({ type: 'progress', done, total: pending.length });
  for (const entry of pending) {
    const result = results.get(entry.sourceId)!;
    const key = `${entry.sourceId}:${entry.path}`;
    try {
      const file = await entry.file();
      const seen = known[key];
      if (!seen || seen.size !== file.size || seen.modified !== file.lastModified) {
        const conversations = parseFile(entry.sourceId, key, await file.text());
        for (const conversation of conversations) {
          result.sessions.push(conversation.key);
          result.utterances.push(...extractUtterances(conversation));
        }
        const record: ScannedFile = { key, sourceId: entry.sourceId, size: file.size, modified: file.lastModified, conversations: conversations.length };
        result.files.push(record);
      }
    } catch {
      // 读不了的文件跳过，不影响其他文件
    }
    done++;
    if (done % 10 === 0 || done === pending.length) scope.postMessage({ type: 'progress', done, total: pending.length });
  }
  return [...results.values()];
}

scope.onmessage = (event) => {
  scan(event.data).then(
    (results) => scope.postMessage({ type: 'done', results }),
    (error: unknown) => scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
};
