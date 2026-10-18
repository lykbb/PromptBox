// 在浏览器里从 zip 里取出指定的文件，不用先解压。ChatGPT、Claude 的导出都是 zip。
// 只读需要的那几段：先读文件末尾的目录，再按目录去读要的文件，几百 MB 的导出也不用整个读进内存。
// 支持不压缩（store）和 deflate 两种方式，也支持超过 4 GB 的 zip64。

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX = 0xffffffff;

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

function u64(view: DataView, offset: number): number {
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

async function readDirectory(blob: Blob): Promise<Entry[]> {
  // 目录结尾记录在最后 22 字节到 64 KB 之间（后面可能跟一段注释）
  const tailStart = Math.max(0, blob.size - 22 - 0xffff);
  const tail = await bytes(blob, tailStart, blob.size);
  let at = -1;
  for (let index = tail.byteLength - 22; index >= 0; index--) {
    if (tail.getUint32(index, true) === EOCD) {
      at = index;
      break;
    }
  }
  if (at < 0) throw new Error('不是 zip 文件');
  let count = tail.getUint16(at + 10, true);
  let size = tail.getUint32(at + 12, true);
  let offset = tail.getUint32(at + 16, true);
  if (offset === MAX || size === MAX || count === 0xffff) {
    const locatorAt = at - 20;
    if (locatorAt < 0 || tail.getUint32(locatorAt, true) !== ZIP64_LOCATOR) throw new Error('zip 文件不完整');
    const recordOffset = u64(tail, locatorAt + 8);
    const record = await bytes(blob, recordOffset, recordOffset + 56);
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new Error('zip 文件不完整');
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  }

  const directory = await bytes(blob, offset, offset + size);
  const decoder = new TextDecoder();
  const entries: Entry[] = [];
  let pos = 0;
  for (let index = 0; index < count && pos + 46 <= directory.byteLength; index++) {
    if (directory.getUint32(pos, true) !== CENTRAL) break;
    const method = directory.getUint16(pos + 10, true);
    let compressedSize = directory.getUint32(pos + 20, true);
    const uncompressedSize = directory.getUint32(pos + 24, true);
    const nameLength = directory.getUint16(pos + 28, true);
    const extraLength = directory.getUint16(pos + 30, true);
    const commentLength = directory.getUint16(pos + 32, true);
    let localOffset = directory.getUint32(pos + 42, true);
    const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + pos + 46, nameLength));
    // zip64 的大小和位置放在附加字段里，只有原字段写满时才出现，顺序固定
    let extra = pos + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (uncompressedSize === MAX) field += 8;
        if (compressedSize === MAX) {
          compressedSize = u64(directory, field);
          field += 8;
        }
        if (localOffset === MAX) localOffset = u64(directory, field);
      }
      extra += 4 + length;
    }
    entries.push({ name, method, compressedSize, localOffset });
    pos = extraEnd + commentLength;
  }
  return entries;
}

async function extract(blob: Blob, entry: Entry): Promise<Blob> {
  const header = await bytes(blob, entry.localOffset, entry.localOffset + 30);
  if (header.getUint32(0, true) !== LOCAL) throw new Error('zip 文件不完整');
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = blob.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error(`不支持这种压缩方式（${entry.method}）`);
  return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
}

/** 取出名字符合条件的文件（按文件名判断，不看所在目录）。不是 zip 时抛错。 */
export async function filesInZip(blob: Blob, match: (name: string) => boolean): Promise<File[]> {
  const entries = (await readDirectory(blob)).filter((entry) => !entry.name.endsWith('/') && match(entry.name.split('/').pop() ?? ''));
  return Promise.all(entries.map(async (entry) => new File([await extract(blob, entry)], entry.name.split('/').pop() ?? entry.name)));
}
