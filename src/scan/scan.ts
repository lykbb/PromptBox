// 页面这边的扫描入口：选文件夹、申请读取权限、把活交给后台线程。

import type { ScanJob, ScanMessage, ScanResult } from './protocol';

export function supportsFolderPicker(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

/** 让用户选一个文件夹；取消时返回 null。 */
export async function pickFolder(id: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await window.showDirectoryPicker?.({ id: `promptbox-${id}`, mode: 'read' })) ?? null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

/** 浏览器记住了文件夹，但每次打开页面后第一次读取前要再确认一下权限。必须在点击里调用。 */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const descriptor = { mode: 'read' as const };
  if ((await handle.queryPermission?.(descriptor)) === 'granted') return true;
  return (await handle.requestPermission?.(descriptor)) === 'granted';
}

export function runScan(
  jobs: ScanJob[],
  known: Record<string, { size: number; modified: number }>,
  onProgress: (done: number, total: number) => void,
): Promise<ScanResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ScanMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.done, message.total);
        return;
      }
      worker.terminate();
      if (message.type === 'done') resolve(message.results);
      else reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || '扫描线程出错了'));
    };
    worker.postMessage({ jobs, known });
  });
}
