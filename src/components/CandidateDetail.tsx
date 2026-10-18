// 候选详情：保存前可以改名、改类型、打标签、改正文。原话是证据。
// 本地找到的候选可以单独问 AI：AI 的意见和本地版本放在一起，用 AI 的版本还是保持原样由用户决定。

import { useEffect, useRef, useState } from 'react';
import type { CandidateEdits } from '../db/actions';
import { clip } from '../logic/text';
import { formatQuoteTime } from '../logic/time';
import type { Advice, Candidate, ItemType } from '../types';
import { Editor } from './Editor';
import { PromptIcon, RuleIcon, SparkIcon, TOOL_NAMES } from './Icons';
import { TagEditor } from './TagEditor';
import { ScopeEditor } from './ScopeEditor';
import { readScope, sameScope, scopeKey, scopeLabel } from '../logic/scope';

interface Props {
  candidate: Candidate;
  tagSuggestions: string[];
  busy: boolean;
  onSave: (edits: CandidateEdits) => void;
  onIgnore: () => void;
  onCopy: (text: string) => void;
  /** 本地找到的候选才有：问 AI、AI 的意见、怎么处理。 */
  ai?: AiProps;
}

interface AiProps {
  /** 设置里填好模型了没有。 */
  ready: boolean;
  advice?: Advice;
  onAsk: (signal: AbortSignal) => Promise<void>;
  /** 用了 AI 的版本、保持原样；传空表示撤回。 */
  onStatus: (status?: Advice['status']) => void;
  onSettings: () => void;
}

const QUOTES_SHOWN = 3;

const ORIGIN_TEXT = { ai: 'AI 提炼', agent: '本地 Agent 提炼' } as const;
const EXPORT_TEXT = { md: '.md', skill: 'SKILL.md', agents: 'AGENTS.md', claude: 'CLAUDE.md' } as const;

/** Agent 和 AI 提炼的候选：写明为什么值得存、把握多大、适用范围、建议怎么导出。 */
function ExternalInfo({ candidate }: { candidate: Candidate }) {
  if (!candidate.origin || candidate.origin === 'local') return null;
  const exportHint = candidate.exportHint;
  return (
    <div className="why">
      <p>
        <b>为什么值得存：</b>
        {candidate.reason}
      </p>
      <p className="hint-line">
        {ORIGIN_TEXT[candidate.origin]} · 把握{candidate.confidence === 'high' ? '高' : '中'} · {scopeLabel(candidate)}
        {candidate.ruleCategory ? ` · ${candidate.ruleCategory}` : ''}
        {exportHint ? ` · 建议导出成 ${EXPORT_TEXT[exportHint.format]}${exportHint.skillName ? `（${exportHint.skillName}）` : ''}` : ''}
      </p>
    </div>
  );
}

export function CandidateDetail({ candidate, tagSuggestions, busy, onSave, onIgnore, onCopy, ai }: Props) {
  // 用了 AI 的版本时，编辑区从 AI 写的开始；撤回后回到本地版本（换版本时整个详情会重新挂载）
  const applied = ai?.advice?.verdict === 'keep' && ai.advice.status === 'applied' ? ai.advice : undefined;
  const [title, setTitle] = useState(applied?.title ?? candidate.title);
  const [kind, setKind] = useState<ItemType>(applied?.kind ?? candidate.kind);
  const [tags, setTags] = useState<string[]>(applied?.tags.length ? applied.tags : (candidate.tags ?? []));
  const [content, setContent] = useState(applied?.content ?? candidate.template);
  const [allQuotes, setAllQuotes] = useState(false);
  const [scope, setScope] = useState(() => readScope(applied?.kind === 'rule' && applied.scope ? applied : candidate));
  // 提示词不分范围；规则要确认范围，而且选的范围和相似那一条一样才合并
  const ready = kind === 'prompt' || !!scopeKey(scope);
  const willMerge =
    !!candidate.similarItemTitle && kind === candidate.kind && (kind === 'prompt' || sameScope(scope, candidate.similarItemScope ?? { scope: 'global' }));

  // 问 AI：入口是标题右边的小图标，问过之后意见显示在正文下面
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const askController = useRef<AbortController | null>(null);
  useEffect(() => () => askController.current?.abort(), []);
  const askAi = async () => {
    if (!ai) return;
    if (!ai.ready) return ai.onSettings();
    askController.current?.abort();
    const current = new AbortController();
    askController.current = current;
    setAsking(true);
    setAskError('');
    try {
      await ai.onAsk(current.signal);
    } catch (error) {
      if (!current.signal.aborted) setAskError(error instanceof Error ? error.message : String(error));
    } finally {
      if (askController.current === current) setAsking(false);
    }
  };
  const cancelAsk = () => {
    askController.current?.abort();
    setAsking(false);
  };

  const quotes = allQuotes ? candidate.quotes : candidate.quotes.slice(0, QUOTES_SHOWN);
  const save = () => onSave({ title, kind, tags, content, ...(kind === 'prompt' ? { scope: 'global' as const } : scope) });

  return (
    <section className="detail" aria-label="候选详情">
      <div className="detail-head">
        <input className="title-input" value={title} aria-label="名称" onChange={(event) => setTitle(event.target.value)} />
        <div className="actions">
          {ai && (
            <button
              type="button"
              className="btn icon"
              aria-label="让 AI 看看这条"
              title={
                !ai.ready
                  ? '让 AI 看看这条（要先在设置里填好模型）'
                  : ai.advice
                    ? '重新问 AI：只发这一条的原话'
                    : '让 AI 看看这条：只发这一条的原话，判断值不值得留、帮你改写'
              }
              disabled={asking}
              onClick={() => void askAi()}
            >
              <SparkIcon />
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={onIgnore}>
            忽略
          </button>
          <button
            type="button"
            className="btn primary"
            title={ready ? undefined : '先选好适用范围'}
            disabled={busy || !content.trim() || !ready}
            onClick={save}
          >
            {willMerge ? `合并到「${clip(candidate.similarItemTitle!, 8)}」` : kind === 'rule' ? '存为规则' : '存为提示词'}
          </button>
        </div>
      </div>

      <div className="meta">
        <div className="seg" role="group" aria-label="类型">
          <button type="button" aria-pressed={kind === 'prompt'} onClick={() => setKind('prompt')}>
            <PromptIcon />
            提示词
          </button>
          <button type="button" aria-pressed={kind === 'rule'} onClick={() => setKind('rule')}>
            <RuleIcon />
            规则
          </button>
        </div>
        <TagEditor tags={tags} suggestions={tagSuggestions} onChange={setTags} />
      </div>

      {kind === 'rule' && (
        <>
          <ScopeEditor value={scope} onChange={setScope} />
        </>
      )}

      <div>
        <div className="sec-label">{kind === 'rule' ? '规则' : '提示词'}</div>
        <Editor label={kind === 'rule' ? '规则' : '提示词'} value={content} underline={candidate.fixes} short onChange={setContent} onCopy={() => onCopy(content)} />
      </div>

      <ExternalInfo candidate={{ ...candidate, ...scope }} />
      {ai && <AdviceBox ai={ai} asking={asking} error={askError} onCancel={cancelAsk} onIgnore={onIgnore} />}
      {candidate.kind === 'prompt' && candidate.fixes.length > 0 && (
        <p className="hint-line">
          下划线是你做完之后常补的要求{candidate.fixCount ? `（${candidate.count} 次里补了 ${candidate.fixCount} 次）` : ''}
        </p>
      )}
      {willMerge && <p className="note-line">和库里的「{candidate.similarItemTitle}」相似，保存时会合并进那一条，正文不变。</p>}

      <div>
        <div className="sec-label">
          原话 · {candidate.count} 次
        </div>
        <div className="quotes">
          {quotes.map((quote, index) => (
            <div key={index} className="q">
              <span className="from">
                {TOOL_NAMES[quote.tool]} · {formatQuoteTime(quote.at)}
              </span>
              {clip(quote.text, 160)}
              {quote.after && <span className="after">之后你说：{quote.after}</span>}
            </div>
          ))}
        </div>
      </div>
      {candidate.quotes.length > QUOTES_SHOWN && (
        <button type="button" className="link-btn" onClick={() => setAllQuotes(!allQuotes)}>
          {allQuotes ? '收起' : `查看全部 ${candidate.quotes.length} 条`}
        </button>
      )}
    </section>
  );
}

/** AI 的意见：正在问时显示进度，问过之后列出 AI 的判断和建议的写法，用不用由用户决定。还没问时什么都不显示。 */
function AdviceBox({ ai, asking, error, onCancel, onIgnore }: { ai: AiProps; asking: boolean; error: string; onCancel: () => void; onIgnore: () => void }) {
  const { advice } = ai;

  if (asking) {
    return (
      <div className="ai-box">
        <div className="ai-head">
          <SparkIcon />
          AI 正在看这条……
          <button type="button" className="link-btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    );
  }

  if (!advice) return error ? <p className="error-line">没问成：{error}</p> : null;

  if (advice.status === 'applied') {
    return (
      <p className="hint-line">
        已换成 AI 的版本，保存前还可以改 ·{' '}
        <button type="button" className="link-btn" onClick={() => ai.onStatus(undefined)}>
          撤回
        </button>
      </p>
    );
  }
  if (advice.status === 'kept') {
    return (
      <p className="hint-line">
        已保持原样 ·{' '}
        <button type="button" className="link-btn" onClick={() => ai.onStatus(undefined)}>
          再看 AI 的意见
        </button>
      </p>
    );
  }

  const verdict = advice.verdict === 'keep' ? '值得留' : advice.verdict === 'skip' ? '一次性的' : '和另一条重复';
  return (
    <div className="ai-box">
      <div className="ai-head">
        <SparkIcon />
        AI 的意见
        <span className={`ai-verdict ${advice.verdict}`}>{verdict}</span>
      </div>
      {advice.verdict === 'keep' && (
        <>
          {advice.reason && <p>{advice.reason}</p>}
          <dl className="ai-diff">
            <dt>名称</dt>
            <dd>{advice.title}</dd>
            <dt>{advice.kind === 'rule' ? '规则' : '提示词'}</dt>
            <dd>
              <pre>{advice.content}</pre>
            </dd>
            {advice.kind === 'rule' && (
              <>
                <dt>范围</dt>
                <dd>{scopeLabel(advice)}</dd>
              </>
            )}
          </dl>
          <div className="ai-actions">
            <button type="button" className="btn sm primary" onClick={() => ai.onStatus('applied')}>
              用 AI 的版本
            </button>
            <button type="button" className="btn sm ghost" onClick={() => ai.onStatus('kept')}>
              保持原样
            </button>
          </div>
        </>
      )}
      {advice.verdict === 'skip' && <p>{advice.reason}</p>}
      {advice.verdict === 'duplicate' && <p>和「{advice.ofTitle}」说的是同一件事，留一条就够了。</p>}
      {advice.verdict !== 'keep' && (
        <div className="ai-actions">
          <button type="button" className="btn sm" onClick={onIgnore}>
            忽略这条
          </button>
          <button type="button" className="btn sm ghost" onClick={() => ai.onStatus('kept')}>
            保持原样
          </button>
        </div>
      )}
      {error && <p className="error-line">没问成：{error}</p>}
    </div>
  );
}
