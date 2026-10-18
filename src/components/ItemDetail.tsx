// 详情：复制、导出、⋯（删除）在顶部，内容自动保存，没有保存按钮。

import { useEffect, useRef, useState } from 'react';
import { ensureBaseline, snapshotVersion, updateItem } from '../db/actions';
import { db } from '../db/db';
import { useLive } from '../db/live';
import { ORIGIN_LABELS } from '../logic/items';
import { clip } from '../logic/text';
import { formatListTime, formatQuoteTime } from '../logic/time';
import { extractVariables } from '../logic/variables';
import type { Item, ItemType, ScopeFields } from '../types';
import { itemScope } from '../logic/scope';
import { ScopeEditor } from './ScopeEditor';
import { Editor } from './Editor';
import { PromptIcon, RuleIcon, TOOL_NAMES } from './Icons';
import { TagEditor } from './TagEditor';

interface Props {
  item: Item;
  tagSuggestions: string[];
  focusTitle: boolean;
  onCopy: (item: Item) => void;
  onExport: (item: Item) => void;
  onDelete: (item: Item) => void;
  onHistory: (item: Item) => void;
}

type Draft = Pick<Item, 'title' | 'content' | 'note'> & ScopeFields;
const SAVE_DELAY = 500;

function originText(item: Item): string {
  const label = ORIGIN_LABELS[item.origin];
  switch (item.origin) {
    case 'import':
      return `来源：导入 ${item.originDetail ?? ''}`;
    case 'discover':
      return `来源：发现${item.originDetail ? ` · ${item.originDetail}` : ''}`;
    case 'generate':
      return `来源：按风格生成${item.refs?.length ? ` · 参考了 ${item.refs.map((ref) => ref.title).join('、')}` : ''}`;
    default:
      return `来源：${label}`;
  }
}

export function ItemDetail({ item, tagSuggestions, focusTitle, onCopy, onExport, onDelete, onHistory }: Props) {
  const [draft, setDraft] = useState<Draft>({ title: item.title, content: item.content, note: item.note, ...itemScope(item) });
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showQuotes, setShowQuotes] = useState(false);
  // 备注平时收成一个「+ 备注」，写过备注或点开了才显示输入框
  const [noteOpen, setNoteOpen] = useState(false);
  const showNote = noteOpen || !!draft.note;
  const latest = useRef(draft);
  const timer = useRef<number | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const itemId = item.id;
  const versionCount = useLive(() => db.versions.where('itemId').equals(itemId).count(), [itemId], 0);

  const flush = (): Promise<void> => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      saving.current = updateItem(itemId, latest.current).then(() => setPending(false));
    }
    return saving.current;
  };

  /** 离开这一条（换一条、新建、打开历史、关页面）：先保存，正文改过就存一个新版本。 */
  const leave = () => flush().then(() => snapshotVersion(itemId));

  const edit = (patch: Partial<Draft>) => {
    latest.current = { ...latest.current, ...patch };
    setDraft(latest.current);
    setPending(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  // 打开时给还没有版本的内容记一个起点；切走（换一条、关页面、切到后台）时立刻保存并存版本
  useEffect(() => {
    void ensureBaseline(itemId);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void leave();
    };
    const onPageHide = () => void leave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void leave();
    };
    // 只在挂载和卸载时执行；flush 读的是 ref 里的最新内容
  }, []);

  // 别处改了这一条（恢复旧版本、合并进来的原话）时，编辑区跟着更新；正在输入的内容优先
  useEffect(() => {
    if (timer.current !== undefined) return;
    const fresh = { title: item.title, content: item.content, note: item.note };
    const mine = latest.current;
    if (fresh.title === mine.title && fresh.content === mine.content && fresh.note === mine.note) return;
    latest.current = { ...mine, ...fresh };
    setDraft(latest.current);
  }, [item.updatedAt]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const current = { ...item, ...draft };
  const variables = extractVariables(draft.content);
  // 改成提示词时范围回到所有任务：提示词不分范围
  const setType = (type: ItemType) => {
    if (type === item.type) return;
    if (type === 'prompt') {
      latest.current = { ...latest.current, scope: 'global', project: undefined, taskType: undefined };
      setDraft(latest.current);
    }
    void updateItem(itemId, type === 'prompt' ? { type, scope: 'global', project: undefined, taskType: undefined } : { type });
  };

  return (
    <section className="detail" aria-label="详情">
      <div className="detail-head">
        <input
          className="title-input"
          value={draft.title}
          placeholder="未命名"
          aria-label="标题"
          autoFocus={focusTitle}
          onChange={(event) => edit({ title: event.target.value })}
        />
        <div className="actions" ref={menuRef}>
          <button type="button" className="btn primary" onClick={() => onCopy(current)}>
            复制
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              flush();
              onExport(current);
            }}
          >
            导出
          </button>
          <button type="button" className="btn" onClick={() => void leave().then(() => onHistory(current))}>
            历史{versionCount > 0 ? ` ${versionCount}` : ''}
          </button>
          <button type="button" className="btn icon" aria-label="更多" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            ⋯
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(current);
                }}
              >
                删除
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="meta">
        <div className="seg" role="group" aria-label="类型">
          <button type="button" aria-pressed={item.type === 'prompt'} onClick={() => setType('prompt')}>
            <PromptIcon />
            提示词
          </button>
          <button type="button" aria-pressed={item.type === 'rule'} onClick={() => setType('rule')}>
            <RuleIcon />
            规则
          </button>
        </div>
        <TagEditor tags={item.tags} suggestions={tagSuggestions} onChange={(tags) => void updateItem(itemId, { tags })} />
        {!showNote && (
          <button type="button" className="tag-add" onClick={() => setNoteOpen(true)}>
            + 备注
          </button>
        )}
      </div>

      {item.type === 'rule' && (
        <>
          <ScopeEditor value={draft} onChange={edit} allowUnconfirmed={false} />
        </>
      )}

      {showNote && (
        <div className="fields">
          <label htmlFor={`note-${itemId}`}>备注</label>
          <input
            id={`note-${itemId}`}
            className="input"
            value={draft.note}
            placeholder="比如适用的模型、来源"
            autoFocus={noteOpen && !draft.note}
            onChange={(event) => edit({ note: event.target.value })}
          />
        </div>
      )}

      <Editor
        label="正文"
        value={draft.content}
        placeholder={item.type === 'rule' ? '写下你希望 AI 在指定范围内遵守的习惯' : '写下提示词，每次会变的部分用 {{变量}} 标出'}
        onChange={(content) => edit({ content })}
      />

      <div className="editor-foot">
        <span>{originText(item)}</span>
        {variables.length > 0 && <span>· 变量</span>}
        {variables.map((name) => (
          <code key={name}>{`{{${name}}}`}</code>
        ))}
        <span className="saved" title={`已自动保存 · ${formatListTime(item.updatedAt)}`}>{pending ? '正在保存…' : '已保存'}</span>
      </div>

      {item.evidence && (
        <>
          <button type="button" className="link-btn" onClick={() => setShowQuotes(!showQuotes)}>
            {showQuotes ? '收起原话' : `查看原话 · ${item.evidence.count} 次`}
          </button>
          {showQuotes && (
            <div className="quotes">
              {item.evidence.quotes.map((quote, index) => (
                <div key={index} className="q">
                  <span className="from">
                    {TOOL_NAMES[quote.tool]} · {formatQuoteTime(quote.at)}
                  </span>
                  {clip(quote.text, 160)}
                  {quote.after && <span className="after">之后你说：{quote.after}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
