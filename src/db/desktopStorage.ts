import Dexie, { type Transaction } from 'dexie';
import { desktopCall, isDesktop } from '../desktop';
import { db } from './db';

let timer: ReturnType<typeof setTimeout> | undefined;
let queue = Promise.resolve();
let initialized = false;
const observed = new WeakSet<Transaction>();

/** Load before mounting React so the empty working database never overwrites the disk store. */
export async function initializeDesktopStorage(): Promise<void> {
  if (!isDesktop()) return;
  const text = await desktopCall<string | null>('loadStore');
  if (text) {
    const snapshot = JSON.parse(text) as { app: string; formatVersion: number; tables: Record<string, unknown[]> };
    if (snapshot.app !== 'promptbox' || snapshot.formatVersion !== 1 || !snapshot.tables) throw new Error('本地库格式无效，已停止加载');
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        const rows = snapshot.tables[table.name];
        if (rows !== undefined && !Array.isArray(rows)) throw new Error(`本地库的 ${table.name} 内容无效`);
        if (rows?.length) await table.bulkPut(rows);
      }
    });
  }
  initialized = true;
  const changed = () => {
    const transaction = Dexie.currentTransaction;
    if (!transaction || observed.has(transaction)) return;
    observed.add(transaction);
    transaction.on('complete', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void flushDesktopStorage().catch(reportStorageError), 100);
    });
  };
  for (const table of db.tables) {
    table.hook('creating', changed);
    table.hook('updating', changed);
    table.hook('deleting', changed);
  }
}

function reportStorageError(error: unknown) {
  window.dispatchEvent(new CustomEvent('promptbox-storage-error', { detail: error instanceof Error ? error.message : String(error) }));
}

/** Serialize saves; after an error a later retry still works, while quit can detect a failed final save. */
export function flushDesktopStorage(): Promise<void> {
  if (!isDesktop() || !initialized) return Promise.resolve();
  clearTimeout(timer);
  queue = queue.catch(() => {}).then(async () => {
    const tables = await db.transaction('r', db.tables, async () => Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()]))));
    await desktopCall('saveStore', { snapshot: JSON.stringify({ app: 'promptbox', formatVersion: 1, tables }) });
  });
  return queue;
}
