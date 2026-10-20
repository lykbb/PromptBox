/** Narrow native bridge; web builds continue to use browser APIs. */
import type { NativeScanFiles } from './scan/protocol';

interface NativeFile { name: string; base64: string; modified: number }
declare global {
  interface Window {
    webkit?: { messageHandlers?: { promptbox?: { postMessage(message: unknown): Promise<unknown> } } };
    promptboxBeforeQuit?: () => Promise<void>;
  }
}

export const isDesktop = () => typeof window !== 'undefined' && !!window.webkit?.messageHandlers?.promptbox;

export function desktopCall<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const bridge = window.webkit?.messageHandlers?.promptbox;
  if (!bridge) return Promise.reject(new Error('当前环境不支持本机操作'));
  return bridge.postMessage({ action, args }) as Promise<T>;
}

export function nativeFiles(files: NativeFile[]): File[] {
  return files.map((file) => new File([Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0))], file.name, { lastModified: file.modified }));
}

export async function saveNativeBlob(name: string, blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16384) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  return desktopCall<boolean>('saveFile', { name, base64: btoa(chunks.join('')) });
}

export async function pickNativeFolder(sourceId: string): Promise<{ name: string } | null> {
  return desktopCall('pickFolder', { sourceId });
}

export async function readNativeFolder(sourceId: string, known: Record<string, { size: number; modified: number }>): Promise<NativeScanFiles> {
  return desktopCall('scanFolder', { sourceId, known });
}

export async function desktopFetch(url: string, init: RequestInit): Promise<Response> {
  const id = crypto.randomUUID();
  const signal = init.signal;
  signal?.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    const abort = () => {
      void desktopCall('cancelRequest', { id }).catch(() => {});
      reject(signal?.reason ?? new DOMException('已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    desktopCall<{ status: number; body: string }>('request', {
      id, url, method: init.method ?? 'GET', body: init.body,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    }).then((response) => {
      signal?.removeEventListener('abort', abort);
      try {
        resolve(new Response([204, 205, 304].includes(response.status) ? null : response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } }));
      } catch (error) { reject(error); }
    }, (error: unknown) => {
      signal?.removeEventListener('abort', abort);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
