import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopFetch, isDesktop, nativeFiles, saveNativeBlob } from './desktop';

afterEach(() => vi.unstubAllGlobals());
function bridge(handler: (message: { action: string; args: Record<string, unknown> }) => Promise<unknown>) {
  const postMessage = vi.fn(handler);
  vi.stubGlobal('window', { webkit: { messageHandlers: { promptbox: { postMessage } } } });
  return postMessage;
}

describe('独立桌面版连接', () => {
  it('网页和非浏览器环境不会误走原生功能', () => {
    expect(isDesktop()).toBe(false);
    vi.stubGlobal('window', {});
    expect(isDesktop()).toBe(false);
    bridge(async () => true);
    expect(isDesktop()).toBe(true);
  });

  it('二进制文件和中文文件名往返不损坏', async () => {
    const bytes = Uint8Array.from([0, 127, 128, 255, 10]);
    const post = bridge(async () => false);
    expect(await saveNativeBlob('中文备份.zip', new Blob([bytes]))).toBe(false);
    const args = post.mock.calls[0][0].args;
    expect(args.name).toBe('中文备份.zip');
    const files = nativeFiles([{ name: String(args.name), base64: String(args.base64), modified: 1000 }]);
    expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(bytes);
    expect(files[0].name).toBe('中文备份.zip');
    expect(files[0].lastModified).toBe(1000);
  });

  it('模型请求保留错误状态和鉴权头，不经过网页 fetch', async () => {
    const post = bridge(async () => ({ status: 401, body: '{"error":"invalid key"}' }));
    const response = await desktopFetch('https://example.invalid/v1/models', { headers: { Authorization: 'Bearer synthetic-test-key' } });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid key' });
    expect(post.mock.calls[0][0].args.headers).toEqual({ authorization: 'Bearer synthetic-test-key' });
  });

  it('用户取消会同时取消原生请求，并保留 AbortError', async () => {
    const post = bridge(async ({ action }) => action === 'request' ? new Promise(() => {}) : true);
    const controller = new AbortController();
    const result = desktopFetch('https://example.invalid', { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(post.mock.calls.map(([message]) => message.action)).toEqual(['request', 'cancelRequest']);
    expect(post.mock.calls[0][0].args.id).toBe(post.mock.calls[1][0].args.id);
  });

  it('已取消的请求不发给原生层，超时原因也不会被改写', async () => {
    const post = bridge(async () => true);
    const signal = AbortSignal.abort(new DOMException('test timeout', 'TimeoutError'));
    await expect(desktopFetch('https://example.invalid', { signal })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(post).not.toHaveBeenCalled();
  });

  it('空响应不会导致未处理错误或一直等待', async () => {
    bridge(async () => ({ status: 204, body: '' }));
    const response = await desktopFetch('https://example.invalid', {});
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});
