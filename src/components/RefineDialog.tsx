// 一次让 AI 看完全部候选：先列出要发哪几条，确认后分批发给模型；每批的意见挂到各自的候选下面，
// 做完逐条交代结果。每批完成就保存，中途出错也不白跑。用不用 AI 的意见，还是在「发现」里一条条决定。

import { useEffect, useRef, useState } from 'react';
import { chat, withTimeout } from '../logic/llm';
import { BATCH_SIZE, REFINE_SYSTEM, groupsPayload, parseRefineResponse, quoteCount, type RefineGroup, type RefineOutcome } from '../logic/refine';
import type { Advice, LlmSettings } from '../types';
import { Dialog } from './Dialog';

interface Props {
  groups: RefineGroup[];
  /** 还没填好模型时为空，弹窗只说明要先去设置里填 Key。 */
  llm?: LlmSettings;
  providerName: string;
  onSettings: () => void;
  /** 保存一批的意见，返回这一批每条候选得到的意见。 */
  onBatch: (outcome: RefineOutcome, batch: RefineGroup[]) => Promise<Record<string, Advice>>;
  onClose: () => void;
}

type Phase =
  | { name: 'confirm' }
  | { name: 'running'; done: number; total: number }
  | { name: 'done' }
  | { name: 'error'; message: string; done: number; total: number };

/** 结果列表里每条的一句话。 */
export function adviceSummary(advice: Advice | undefined): string {
  if (!advice) return 'AI 没给结论，可以在这条候选里单独再问';
  if (advice.verdict === 'keep') return `建议保留，名称「${advice.title}」`;
  if (advice.verdict === 'skip') return `一次性：${advice.reason}`;
  return `和「${advice.ofTitle}」是同一件事`;
}

export function RefineDialog({ groups, llm, providerName, onBatch, onSettings, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'confirm' });
  const [results, setResults] = useState<Record<string, Advice>>({});
  const controller = useRef<AbortController | null>(null);
  const batches = Array.from({ length: Math.ceil(groups.length / BATCH_SIZE) }, (_, index) => groups.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE));

  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    if (!llm) return;
    const current = new AbortController();
    controller.current = current;
    for (let index = 0; index < batches.length; index++) {
      setPhase({ name: 'running', done: index, total: batches.length });
      try {
        const answer = await chat(
          llm,
          [
            { role: 'system', content: REFINE_SYSTEM },
            { role: 'user', content: groupsPayload(batches[index]) },
          ],
          withTimeout(current.signal, 180_000),
        );
        const advice = await onBatch(parseRefineResponse(answer, batches[index]), batches[index]);
        if (current.signal.aborted) return;
        setResults((before) => ({ ...before, ...advice }));
      } catch (error) {
        if (current.signal.aborted) return;
        setPhase({ name: 'error', message: error instanceof Error ? error.message : String(error), done: index, total: batches.length });
        return;
      }
    }
    setPhase({ name: 'done' });
  };

  const answered = groups.filter((group) => results[group.id]);
  const footer = !llm ? (
    <button type="button" className="btn primary" onClick={onSettings}>
      去设置
    </button>
  ) : phase.name === 'confirm' ? (
    <button type="button" className="btn primary" disabled={!groups.length} onClick={() => void start()}>
      开始
    </button>
  ) : phase.name === 'running' ? (
    <span className="hint muted">关闭窗口会停下，已经问完的批次会保留</span>
  ) : (
    <button type="button" className="btn primary" onClick={onClose}>
      去「发现」逐条看
    </button>
  );

  return (
    <Dialog title="让 AI 看完全部候选" size="narrow" onClose={onClose} footer={footer} dismissable={phase.name !== 'running'}>
      {!llm && <p className="note-line">要先在「设置 → AI 模型」里选一个模型服务、填好 Key。</p>}
      {llm && phase.name === 'confirm' && !groups.length && <p className="note-line">「发现」里的候选都问过 AI 了。</p>}
      {llm && phase.name === 'confirm' && groups.length > 0 && (
        <div className="stack">
          <p>
            会把下面 <b>{groups.length} 条</b>候选的 <b>{quoteCount(groups)} 句原话</b>发给 {providerName}（{llm.model}）。AI 的意见会挂在每条候选下面，用不用由你一条条决定。
          </p>
          <ul className="refine-list">
            {groups.map((group) => (
              <li key={group.id}>
                <span>{group.title}</span>
                <small>{group.quotes.length} 句</small>
              </li>
            ))}
          </ul>
          <p className="hint">只发这些原话，每句最多 200 字，不发完整的聊天记录。</p>
        </div>
      )}
      {phase.name === 'running' && (
        <div className="stack">
          <p>
            正在问第 {phase.done + 1}/{phase.total} 批……
          </p>
          <div className="progress" aria-hidden="true">
            <i style={{ width: `${(phase.done / phase.total) * 100}%` }} />
          </div>
        </div>
      )}
      {phase.name === 'error' && (
        <p className="error-line">
          {phase.message} 已问完 {phase.done}/{phase.total} 批，问完的意见已经保存；没问到的，之后可以再来一次，或者在候选里单独问。
        </p>
      )}
      {(phase.name === 'done' || (phase.name === 'error' && answered.length > 0)) && (
        <ul className="refine-list results">
          {(phase.name === 'done' ? groups : answered).map((group) => (
            <li key={group.id} className={results[group.id]?.verdict ?? 'none'}>
              <span>{group.title}</span>
              <small>{adviceSummary(results[group.id])}</small>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
