// 按行对比两个版本：最长公共子序列，标出新增和删除的行。

export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

const MAX_LINES = 2000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n').slice(0, MAX_LINES);
  const b = after.split('\n').slice(0, MAX_LINES);
  // lengths[i][j]：a 从 i 开始、b 从 j 开始的最长公共子序列长度
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      lines.push({ kind: 'del', text: a[i++] });
    } else {
      lines.push({ kind: 'add', text: b[j++] });
    }
  }
  while (i < a.length) lines.push({ kind: 'del', text: a[i++] });
  while (j < b.length) lines.push({ kind: 'add', text: b[j++] });
  return lines;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'del').length,
  };
}
