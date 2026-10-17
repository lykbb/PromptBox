// 库的列表：搜索框也是说需求的地方；列表只负责选中，选中后按回车就是复制。

import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { SearchHit } from '../logic/search';
import { formatListTime } from '../logic/time';
import type { Item } from '../types';
import { TypeIcon } from './Icons';

interface Props {
  query: string;
  onQuery: (query: string) => void;
  items: Item[];
  /** 有搜索词时是搜索结果，没有时为空。 */
  hits: SearchHit[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCopy: (item: Item) => void;
  onNew: () => void;
  onGenerate: () => void;
  relatedCount: number;
  showBanner: boolean;
  sampleCount: number;
  onClearSamples: () => void;
  onDismissBanner: () => void;
  emptyLibrary: boolean;
  showRulesExport: boolean;
  onExportRules: () => void;
}

/** 列表里的摘要：开头和标题重复的那行标题去掉。 */
function snippet(item: Item): string {
  const lines = item.content.trim().split('\n');
  const heading = /^#+\s*(.+?)\s*$/.exec(lines[0] ?? '');
  if (heading && (heading[1] === item.title || heading[1].toUpperCase() === item.title.toUpperCase())) lines.shift();
  return lines.join(' ').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
}

export function LibraryList(props: Props) {
  const { items, hits, selectedId, onSelect } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const visible = hits ? hits.map((hit) => hit.item) : items;

  // 选中的一条滚动到可见范围
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (event: KeyboardEvent) => {
    const index = visible.findIndex((item) => item.id === selectedId);
    if (event.key === 'Enter' && index >= 0) {
      event.preventDefault();
      props.onCopy(visible[index]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = visible[Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) onSelect(next.id);
    }
  };

  const meta = hits ? (hits.length ? `找到 ${hits.length} 条相关` : '没有找到相关内容') : `${items.length} 条 · 按最近修改`;

  return (
    <section className="list" aria-label="库">
      <div className="list-head">
        <input
          className="search"
          type="search"
          value={props.query}
          placeholder="搜索，或描述你想写什么"
          aria-label="搜索，或描述你想写什么"
          onChange={(event) => props.onQuery(event.target.value)}
        />
        <button type="button" className="btn" onClick={props.onNew}>
          + 新建
        </button>
      </div>

      {props.query.trim() && (
        <button type="button" className="gen-row" onClick={props.onGenerate}>
          <span>
            <b>按我的风格生成一条</b>
            <small>{props.relatedCount ? `参考库里 ${props.relatedCount} 条相关内容和你的规则` : '参考你的规则'}</small>
          </span>
          <span className="go" aria-hidden="true">
            →
          </span>
        </button>
      )}

      {props.showBanner && (
        <div className="banner">
          内容保存在当前浏览器；使用模型生成时会发送所选参考内容。下面 {props.sampleCount} 条是示例。
          <div className="row">
            <button type="button" className="btn sm" onClick={props.onClearSamples}>
              清除示例
            </button>
            <button type="button" className="btn sm ghost" onClick={props.onDismissBanner}>
              知道了
            </button>
          </div>
        </div>
      )}

      <div className="list-meta">
        <span>{meta}</span>
        {props.showRulesExport && !hits && (
          <button type="button" className="btn sm" onClick={props.onExportRules}>
            合成规则文件
          </button>
        )}
      </div>

      {props.emptyLibrary ? (
        <div className="empty">
          <b>库里还没有内容</b>
          <span>
            去侧栏「发现」，从你的对话里找；
            <br />
            或者点上方「新建」写一条，
            <br />
            也可以把 .md 文件、备份文件拖进窗口。
          </span>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          {hits ? <span>没有找到相关内容，可以点「按我的风格生成」写一条新的。</span> : <span>这里还没有内容</span>}
        </div>
      ) : (
        <div ref={listRef} className="items" role="listbox" aria-label="内容列表" tabIndex={0} onKeyDown={onKeyDown}>
          {visible.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              className="item"
              aria-selected={item.id === selectedId}
              tabIndex={-1}
              onClick={() => onSelect(item.id)}
            >
              <div className="item-title">
                <TypeIcon type={item.type} />
                <span>{item.title || '未命名'}</span>
              </div>
              {snippet(item) && <div className="item-snip">{snippet(item)}</div>}
              <div className="item-foot">
                {item.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
                <span className="time">{hits ? (hits[index].level === 'high' ? '高度相关' : '相关') : formatListTime(item.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
