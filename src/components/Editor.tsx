// 编辑区：透明文本框叠在高亮层上。变量 {{…}} 用浅灰底，从纠正里合并进来的要求加下划线。

import { useRef, type ReactNode } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 需要加下划线的句子。 */
  underline?: string[];
  placeholder?: string;
  short?: boolean;
  label: string;
}

const VARIABLE = /\{\{[^{}\n]{1,20}\}\}/g;

function highlight(text: string, underline: string[]): ReactNode[] {
  const marks: { start: number; end: number; kind: 'var' | 'fix' }[] = [];
  for (const match of text.matchAll(VARIABLE)) marks.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, kind: 'var' });
  for (const phrase of underline) {
    if (!phrase) continue;
    let from = 0;
    for (let at = text.indexOf(phrase, from); at !== -1; at = text.indexOf(phrase, from)) {
      if (!marks.some((mark) => at < mark.end && at + phrase.length > mark.start)) marks.push({ start: at, end: at + phrase.length, kind: 'fix' });
      from = at + phrase.length;
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let last = 0;
  marks.forEach((mark, index) => {
    if (mark.start > last) nodes.push(text.slice(last, mark.start));
    const piece = text.slice(mark.start, mark.end);
    nodes.push(mark.kind === 'var' ? <mark key={index}>{piece}</mark> : <u key={index}>{piece}</u>);
    last = mark.end;
  });
  nodes.push(text.slice(last));
  // 末尾换行时补一个字符，让高亮层和文本框的高度一致
  nodes.push(text.endsWith('\n') ? ' ' : '');
  return nodes;
}

export function Editor({ value, onChange, underline = [], placeholder, short, label }: Props) {
  const backdrop = useRef<HTMLDivElement>(null);
  return (
    <div className={`editor${short ? ' short' : ''}`}>
      <div ref={backdrop} className="backdrop" aria-hidden="true">
        {highlight(value, underline)}
      </div>
      <textarea
        aria-label={label}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}
