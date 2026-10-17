// 变量写法：{{名称}}。名称 1–20 个字，不能包含花括号和换行。

const VAR_PATTERN = /\{\{([^{}\n]{1,20})\}\}/g;

export interface Segment {
  text: string;
  /** 变量名；普通文字时为空。 */
  variable?: string;
  /** 已经填入的值。 */
  filled?: boolean;
}

/** 按出现顺序列出变量，同名只算一次。 */
export function extractVariables(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(VAR_PATTERN)) {
    const name = match[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** 把填好的值代入正文，没填的变量保留原样。 */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_PATTERN, (whole, raw: string) => {
    const value = values[raw.trim()];
    return value ? value : whole;
  });
}

/** 切成普通文字和变量两种片段，用来高亮显示。传入 values 时变量换成填好的值。 */
export function segmentVariables(text: string, values?: Record<string, string>): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(VAR_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start) });
    const name = match[1].trim();
    const value = values?.[name];
    segments.push(value ? { text: value, variable: name, filled: true } : { text: match[0], variable: name });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
