// 发现的列表：从对话里找出的候选，按出现次数排序。

import { formatAgo, formatListTime } from '../logic/time';
import type { Advice, Candidate, ItemType, SourceRecord } from '../types';
import { RefreshIcon, TypeIcon } from './Icons';

export type KindFilter = 'all' | ItemType;

interface Props {
  candidates: Candidate[];
  kind: KindFilter;
  onKind: (kind: KindFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sources: SourceRecord[];
  scanning: { done: number; total: number } | null;
  /** 有记住授权的文件夹，可以直接扫描；没有时点刷新会打开设置重新选。 */
  canRescan: boolean;
  onRescan: () => void;
  /** 打开设置里的「记录来源」。 */
  onSources: () => void;
  /** AI 对各条本地候选的意见，列表里标一下。 */
  advice: Record<string, Advice>;
}

export function DiscoverList(props: Props) {
  const { candidates, kind, selectedId, onSelect, scanning } = props;
  const fresh = candidates.filter((candidate) => candidate.status === 'new');
  const visible = fresh.filter((candidate) => kind === 'all' || candidate.kind === kind);
  const count = (target: ItemType) => fresh.filter((candidate) => candidate.kind === target).length;

  const scanned = props.sources.reduce((sum, source) => sum + source.conversations, 0);
  const lastScan = Math.max(0, ...props.sources.map((source) => source.lastScanAt ?? 0));

  return (
    <section className="list" aria-label="发现">
      <div className="disc-head">
        <div className="disc-top">
          <b>发现</b>
          {props.sources.length > 0 && (
            <button
              type="button"
              className={`icon-btn${scanning ? ' spin' : ''}`}
              title={
                props.canRescan
                  ? `扫描新对话 · 已扫描 ${scanned} 个对话${lastScan ? ` · 上次 ${formatAgo(lastScan)} ${formatListTime(lastScan)}` : ''}`
                  : `已扫描 ${scanned} 个对话 · 这个浏览器记不住文件夹授权，点这里重新选择`
              }
              aria-label="扫描新对话"
              disabled={!!scanning}
              onClick={props.onRescan}
            >
              <RefreshIcon />
            </button>
          )}
        </div>
        {scanning && (
          <div className="scan-line">
            <span>
              正在读取 {scanning.done}/{scanning.total} 个文件
            </span>
            <div className="progress" aria-hidden="true">
              <i style={{ width: `${scanning.total ? (scanning.done / scanning.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="chips-row" role="group" aria-label="按类型筛选">
        <button type="button" className="chip" aria-pressed={kind === 'all'} onClick={() => props.onKind('all')}>
          全部 {fresh.length}
        </button>
        <button type="button" className="chip" aria-pressed={kind === 'prompt'} onClick={() => props.onKind('prompt')}>
          <TypeIcon type="prompt" />
          提示词 {count('prompt')}
        </button>
        <button type="button" className="chip" aria-pressed={kind === 'rule'} onClick={() => props.onKind('rule')}>
          <TypeIcon type="rule" />
          规则 {count('rule')}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          {candidates.length === 0 ? (
            <>
              <b>还没有候选</b>
              <span>PromptBox 会从你和 AI 的对话里，找出反复用到的提示词和规则。</span>
              <button type="button" className="btn sm" onClick={props.onSources}>
                添加记录来源
              </button>
            </>
          ) : (
            <>
              <b>没有新的候选了</b>
              <span>继续和 AI 聊天，过几天再来扫描。</span>
            </>
          )}
        </div>
      ) : (
        <div className="items" role="listbox" aria-label="候选列表">
          {visible.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              className="item"
              aria-selected={candidate.id === selectedId}
              onClick={() => onSelect(candidate.id)}
            >
              <div className="item-title">
                <TypeIcon type={candidate.kind} />
                <span>{candidate.title}</span>
                {candidate.origin === 'agent' && <i className="origin">Agent</i>}
                {candidate.origin === 'ai' && <i className="origin">AI</i>}
                <AdviceTag advice={props.advice[candidate.id]} />
                <small className="time">{formatAgo(candidate.lastAt)}</small>
              </div>
              {/* 提示词和规则都显示一行正文，每张卡片一样高 */}
              <div className="item-snip">{candidate.template.replace(/\s+/g, ' ') || '\u00a0'}</div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** 列表里一眼看出 AI 怎么说的；已经处理过 AI 意见的不再标。 */
function AdviceTag({ advice }: { advice?: Advice }) {
  if (!advice || advice.status) return null;
  const text = advice.verdict === 'keep' ? 'AI 建议保留' : advice.verdict === 'skip' ? 'AI：一次性的' : `AI：和「${advice.ofTitle}」重复`;
  return <i className={`ai-tag ${advice.verdict}`}>{text}</i>;
}
