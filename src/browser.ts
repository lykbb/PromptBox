// 复制、下载、读文件这些浏览器操作。
import { desktopCall, isDesktop, nativeFiles, saveNativeBlob } from './desktop';

export async function copyText(text: string): Promise<void> {
  if (isDesktop()) {
    await desktopCall('copy', { text });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 不支持剪贴板接口时退回到老办法
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('复制失败');
  }
}

export function downloadText(fileName: string, text: string, type = 'text/markdown'): Promise<boolean> {
  return downloadBlob(fileName, new Blob([text], { type: `${type};charset=utf-8` }));
}

export async function downloadBlob(fileName: string, blob: Blob): Promise<boolean> {
  if (isDesktop()) return saveNativeBlob(fileName, blob);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** 打开系统的选文件窗口。 */
export function chooseFiles(options: { accept?: string; multiple?: boolean; directory?: boolean }): Promise<File[]> {
  if (isDesktop() && !options.directory) {
    return desktopCall<Parameters<typeof nativeFiles>[0]>('openFiles', options).then(nativeFiles);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options.accept) input.accept = options.accept;
    input.multiple = !!options.multiple;
    if (options.directory) input.webkitdirectory = true;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
