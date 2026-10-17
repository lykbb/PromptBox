// 候选详情：保存前可以改名、改类型、打标签、改模板。原话是证据。

import { useState } from 'react';
import type { CandidateEdits } from '../db/actions';
import { clip } from '../logic/text';
import { formatQuoteTime } from '../logic/time';
import type { Candidate, ItemType } from '../types';
import { Editor } from './Editor';
import { PromptIcon, RuleIcon, TOOL_NAMES, toolList } from './Icons';
import { TagEditor } from './TagEditor';
import { ScopeEditor } from './ScopeEditor';
import { readScope, sameScope, scopeKey, scopeLabel } from '../logic/scope';

interface Props {
  candidate: Candidate;
  tagSuggestions: string[];
  busy: boolean;
  onSave: (edits: CandidateEdits) => void;
  onIgnore: () => void;
  /** AI 提炼判断这条是一次性的理由。 */
  aiNote?: string;
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

export function CandidateDetail({ candidate, tagSuggestions, busy, onSave, onIgnore, aiNote }: Props) {
  const [title, setTitle] = useState(candidate.title);
  const [kind, setKind] = useState<ItemType>(candidate.kind);
  const [tags, setTags] = useState<string[]>(candidate.tags ?? []);
  const [content, setContent] = useState(candidate.template);
  const [allQuotes, setAllQuotes] = useState(false);
  const [scope, setScope] = useState(() => readScope(candidate));
  // 提示词不分范围；规则要确认范围，而且选的范围和相似那一条一样才合并
  const ready = kind === 'prompt' || !!scopeKey(scope);
  const willMerge =
    !!candidate.similarItemTitle && kind === candidate.kind && (kind === 'prompt' || sameScope(scope, candidate.similarItemScope ?? { scope: 'global' }));

  const quotes = allQuotes ? candidate.quotes : candidate.quotes.slice(0, QUOTES_SHOWN);
  const save = () => onSave({ title, kind, tags, content, ...(kind === 'prompt' ? { scope: 'global' as const } : scope) });

  return (
    <section className="detail" aria-label="候选详情">
      <div className="detail-head">
        <input className="title-input" value={title} aria-label="名称" onChange={(event) => setTitle(event.target.value)} />
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={onIgnore}>
            忽略
          </button>
          <button type="button" className="btn primary" disabled={busy || !content.trim() || !ready} onClick={save}>
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
          {!scopeKey(scope) && <p className="hint-line">保存前请确认这条规则的适用范围；限定项目或任务时，还要填上名称。</p>}
        </>
      )}

      <div>
        <div className="sec-label">{kind === 'rule' ? '规则' : '模板'} · 保存前可以直接改</div>
        <Editor label={kind === 'rule' ? '规则' : '模板'} value={content} underline={candidate.fixes} short onChange={setContent} />
      </div>

      <ExternalInfo candidate={{ ...candidate, ...scope }} />
      {aiNote && <p className="note-line">AI 判断这条是一次性的：{aiNote}</p>}
      {candidate.kind === 'prompt' ? (
        <>
          {candidate.fixes.length > 0 && (
            <p className="hint-line">
              {candidate.fixCount
                ? `下划线部分来自你的纠正：${candidate.count} 次里有 ${candidate.fixCount} 次你都补了这句`
                : '下划线部分来自你在之后常补的要求'}
            </p>
          )}
          {/\{\{[^{}\n]{1,20}\}\}/.test(candidate.template) && <p className="hint-line">{'{{变量}}'} 是每次不一样的部分，复制时再填</p>}
        </>
      ) : (
        <>
          {(!candidate.origin || candidate.origin === 'local') && (
            <p className="hint-line">
              来自 {candidate.count} 次纠正，分布在 {candidate.sessions} 个对话里
              {candidate.tools.length > 1 ? `，跨 ${toolList(candidate.tools)} ${candidate.tools.length} 个工具` : ''}
            </p>
          )}
          <p className="hint-line">存进库后，可以和其他规则一起合成 AGENTS.md 或 CLAUDE.md</p>
        </>
      )}
      {willMerge && (
        <p className="note-line">
          和库里的「{candidate.similarItemTitle}」相似。保存时合并进那一条：原话和次数加上去，正文不变。改成另一种类型则单独保存。
        </p>
      )}

      <div>
        <div className="sec-label">
          原话 · 出现 {candidate.count} 次{candidate.quotes.length < candidate.count ? `，这里列出 ${candidate.quotes.length} 句` : ''}
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
