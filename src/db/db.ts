// 浏览器本地数据库。所有数据只存在这个浏览器里。

import Dexie, { type EntityTable } from 'dexie';
import type { Candidate, Decision, Item, ScannedFile, Settings, SourceRecord, Utterance, Version } from '../types';
import { itemScopeFields } from '../logic/scope';

interface KeyValue {
  key: string;
  value: unknown;
}

export const db = new Dexie('promptbox') as Dexie & {
  items: EntityTable<Item, 'id'>;
  utterances: EntityTable<Utterance, 'id'>;
  candidates: EntityTable<Candidate, 'id'>;
  decisions: EntityTable<Decision, 'signature'>;
  sources: EntityTable<SourceRecord, 'id'>;
  files: EntityTable<ScannedFile, 'key'>;
  kv: EntityTable<KeyValue, 'key'>;
  versions: EntityTable<Version, 'id'>;
};

db.version(1).stores({
  items: 'id, type, updatedAt',
  utterances: 'id, session, role',
  candidates: 'id, kind, status',
  decisions: 'signature',
  sources: 'id',
  files: 'key, sourceId',
  kv: 'key',
});

// 第 2 版：加上版本历史
db.version(2).stores({
  versions: 'id, itemId',
});

// 第 3 版：给旧条目补上适用范围。提示词和没写范围的规则都按所有任务处理
db.version(3)
  .stores({})
  .upgrade((tx) =>
    tx
      .table<Item, string>('items')
      .toCollection()
      .modify((item) => {
        Object.assign(item, itemScopeFields(item));
        if (item.scope === 'global') {
          delete item.project;
          delete item.taskType;
        }
      }),
  );

const DEFAULT_SETTINGS: Settings = { seeded: false, bannerDismissed: false, changedSinceBackup: false };

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...(row?.value as Partial<Settings> | undefined) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const current = await getSettings();
    await db.kv.put({ key: 'settings', value: { ...current, ...patch } });
  });
}
