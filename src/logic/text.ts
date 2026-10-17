// 文本相似度：两个字一组切片后比较重合度。全部在本地计算，不依赖模型。

/** 去掉标点和空白，英文转小写，全角字母数字转半角。 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 两个字一组的切片集合；只有一个字时就用这个字。 */
export function bigrams(text: string): Set<string> {
  const clean = normalize(text);
  const grams = new Set<string>();
  if (clean.length === 1) grams.add(clean);
  for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2));
  return grams;
}

/** 重合度，0 到 1。 */
export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const gram of small) if (large.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

export function similarity(a: string, b: string): number {
  return dice(bigrams(a), bigrams(b));
}

/** 稳定的短哈希，用来给候选做签名。 */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 截断到指定字数，超出时加省略号。 */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') + '……' : text;
}
