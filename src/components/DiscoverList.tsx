// 发现的列表：从对话里找出的候选，按出现次数排序。

import { formatAgo, formatListTime } from '../logic/time';
import type { Candidate, ItemType, SourceRecord, Tool } from '../types';
import { RefreshIcon, SourcesIcon, TOOL_BADGES, TOOL_NAMES, TypeIcon, toolList } from './Icons';

export type KindFilter = 'all' | ItemType;

interface Props {
  candidates: Candidate[];
  kind: KindFilter;
  onKind: (kind: KindFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sources: SourceRecord[];
  /** 示例对话里各工具的对话数；有真实记录后为空。 */
  sampleTools: Partial<Record<Tool, number>> | null;
  scanning: { done: number; total: number } | null;
  canRescan: boolean;
  onRescan: () => void;
  onSources: () => void;
  /** AI 提炼：没填 Key 时为 null。 */
  refine: { pending: number } | null;
  onRefine: () => void;
  onSettings: () => void;
  /** AI 判断为一次性、收起来的本地候选数。 */
  hiddenCount: number;
  showHidden: boolean;
  onToggleHidden: () => void;
}

const SOURCE_TOOLS: { id: SourceRecord['id']; tool: Tool }[] = [
  { id: 'codex', tool: 'codex' },
  { id: 'claude-code', tool: 'claude-code' },
  { id: 'web-export', tool: 'chatgpt' },
];

export function DiscoverList(props: Props) {
  const { candidates, kind, selectedId, onSelect, scanning } = props;
  const fresh = candidates.filter((candidate) => candidate.status === 'new');
  const visible = fresh.filter((candidate) => kind === 'all' || candidate.kind === kind);
  const saved = candidates.filter((candidate) => candidate.status === 'saved').length;
  const ignored = candidates.filter((candidate) => candidate.status === 'ignored').length;
  const count = (target: ItemType) => fresh.filter((candidate) => candidate.kind === target).length;

  const scanned = props.sources.reduce((sum, source) => sum + source.conversations, 0);
  const lastScan = Math.max(0, ...props.sources.map((source) => source.lastScanAt ?? 0));
  const sampleTotal = props.sampleTools ? Object.values(props.sampleTools).reduce((sum, value) => sum + (value ?? 0), 0) : 0;

  return (
    <section className="list" aria-label="发现">
      <div className="disc-head">
        <div className="disc-top">
          <b>发现</b>
          <button
            type="button"
            className={`icon-btn${scanning ? ' spin' : ''}`}
            title={props.canRescan ? '扫描新对话' : '先添加记录来源'}
            aria-label="扫描新对话"
            disabled={!!scanning || !props.canRescan}
            onClick={props.onRescan}
          >
            <RefreshIcon />
          </button>
        </div>
        <div className="disc-sub">从你的对话里找出值得保存的提示词和规则</div>
        <div className="src-icons">
          {props.sampleTools
            ? (Object.keys(props.sampleTools) as Tool[]).map((tool) => (
                <span key={tool} className="tool" title={`示例 · ${TOOL_NAMES[tool]} · ${props.sampleTools?.[tool]} 个对话`}>
                  {TOOL_BADGES[tool]}
                </span>
              ))
            : SOURCE_TOOLS.map(({ id, tool }) => {
                const source = props.sources.find((record) => record.id === id);
                const name = id === 'web-export' ? 'ChatGPT、Claude 网页版' : TOOL_NAMES[tool];
                return (
                  <span key={id} className={`tool${source ? '' : ' off'}`} title={source ? `${name} · ${source.conversations} 个对话` : `${name} · 未添加`}>
                    {TOOL_BADGES[tool]}
                  </span>
                );
              })}
          <span className="meta" title={lastScan ? `上次扫描：${formatAgo(lastScan)} ${formatListTime(lastScan)}` : undefined}>
            {scanning
              ? `正在读取 ${scanning.done}/${scanning.total}`
              : props.sampleTools
                ? `示例对话 · ${sampleTotal} 个`
                : scanned
                  ? `已扫描 ${scanned} 个对话`
                  : '还没有记录来源'}
          </span>
          <button type="button" className="icon-btn" title="管理记录来源" aria-label="管理记录来源" onClick={props.onSources}>
            <SourcesIcon />
          </button>
        </div>
        {scanning && (
          <div className="progress" aria-hidden="true">
            <i style={{ width: `${scanning.total ? (scanning.done / scanning.total) * 100 : 0}%` }} />
          </div>
        )}
        <div className="refine-row">
          {props.refine ? (
            <>
              <button type="button" className="btn sm" disabled={!!scanning || props.refine.pending === 0} onClick={props.onRefine}>
                AI 提炼
              </button>
              <span>{props.refine.pending ? `让模型再筛一遍 ${props.refine.pending} 条本地候选` : '本地候选都提炼过了'}</span>
            </>
          ) : (
            <button type="button" className="link-btn" onClick={props.onSettings}>
              在设置里填上模型 Key，可以让 AI 再筛一遍
            </button>
          )}
        </div>
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
              <span>
                点右上角的「管理记录来源」，添加 Codex、Claude Code 的记录，
                <br />
                或者网页版导出的 conversations.json。
              </span>
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
              </div>
              {candidate.kind === 'prompt' && <div className="item-snip">{candidate.template.replace(/\s+/g, ' ')}</div>}
              <div className="item-foot">
                <span>
                  {candidate.count} 次 · {toolList(candidate.tools)}
                </span>
                <span className="time">{formatAgo(candidate.lastAt)}</span>
              </div>
              {candidate.similarItemTitle && <span className="similar">和库里的「{candidate.similarItemTitle}」相似，保存时会合并</span>}
            </button>
          ))}
        </div>
      )}
      {(saved > 0 || ignored > 0) && (
        <p className="done-note">
          已处理：保存 {saved} 条{ignored ? `，忽略 ${ignored} 条` : ''}
        </p>
      )}
      {props.hiddenCount > 0 && (
        <p className="done-note">
          AI 判断 {props.hiddenCount} 条是一次性的，{props.showHidden ? '现在显示着' : '已收起'} ·{' '}
          <button type="button" className="link-btn" onClick={props.onToggleHidden}>
            {props.showHidden ? '收起' : '显示'}
          </button>
        </p>
      )}
    </section>
  );
}
