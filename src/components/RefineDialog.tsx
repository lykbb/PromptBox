// AI 提炼：先说清楚会发送什么，确认后分批发给模型，结果进「发现」，每批完成就保存，中途出错也不白跑。

import { useEffect, useRef, useState } from 'react';
import { chat } from '../logic/llm';
import { BATCH_SIZE, REFINE_SYSTEM, groupsPayload, parseRefineResponse, quoteCount, type RefineGroup, type RefineOutcome } from '../logic/refine';
import type { LlmSettings } from '../types';
import { Dialog } from './Dialog';

interface Props {
  groups: RefineGroup[];
  llm: LlmSettings;
  providerName: string;
  /** 保存一批结果，返回新进「发现」的候选条数。 */
  onBatch: (outcome: RefineOutcome) => Promise<number>;
  onClose: () => void;
}

type Phase =
  | { name: 'confirm' }
  | { name: 'running'; done: number; total: number }
  | { name: 'done'; fresh: number; skipped: number }
  | { name: 'error'; message: string; fresh: number; done: number; total: number };

export function RefineDialog({ groups, llm, providerName, onBatch, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'confirm' });
  const controller = useRef<AbortController | null>(null);
  const batches = Array.from({ length: Math.ceil(groups.length / BATCH_SIZE) }, (_, index) => groups.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE));

  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    const current = new AbortController();
    controller.current = current;
    let fresh = 0;
    let skipped = 0;
    for (let index = 0; index < batches.length; index++) {
      setPhase({ name: 'running', done: index, total: batches.length });
      try {
        const answer = await chat(
          llm,
          [
            { role: 'system', content: REFINE_SYSTEM },
            { role: 'user', content: groupsPayload(batches[index]) },
          ],
          current.signal,
        );
        const outcome = parseRefineResponse(answer, batches[index]);
        fresh += await onBatch(outcome);
        skipped += Object.keys(outcome.skipped).length;
      } catch (error) {
        if (current.signal.aborted) return;
        setPhase({ name: 'error', message: error instanceof Error ? error.message : String(error), fresh, done: index, total: batches.length });
        return;
      }
    }
    setPhase({ name: 'done', fresh, skipped });
  };

  const footer =
    phase.name === 'confirm' ? (
      <button type="button" className="btn primary" disabled={!groups.length} onClick={() => void start()}>
        开始提炼
      </button>
    ) : phase.name === 'running' ? (
      <span className="hint muted">关闭窗口会停止提炼，已完成的批次会保留</span>
    ) : (
      <button type="button" className="btn primary" onClick={onClose}>
        去看结果
      </button>
    );

  return (
    <Dialog title="AI 提炼" sub="让模型按提炼标准再筛一遍" size="narrow" onClose={onClose} footer={footer}>
      {phase.name === 'confirm' &&
        (groups.length ? (
          <div className="stack">
            <p>
              会把 <b>{groups.length} 组</b>、共 <b>{quoteCount(groups)} 句原话</b>（每句最多 200 字）分 {batches.length} 批发给 {providerName}（{llm.model}），请它判断哪些值得长期保存，起好名字，写成模板或规则。
            </p>
            <p className="note-line">只发送这些分好组的原话，不发送完整的聊天记录。判断标准和本地 Agent 用的提炼 Skill 是同一份：大多数对话是一次性的，宁缺毋滥。</p>
            <p className="hint">模型判断为一次性的组会收起来，在「发现」底部可以展开再看。</p>
          </div>
        ) : (
          <p className="note-line">没有需要提炼的内容：本地候选都已经处理或提炼过了。</p>
        ))}
      {phase.name === 'running' && (
        <div className="stack">
          <p>
            正在提炼第 {phase.done + 1}/{phase.total} 批……
          </p>
          <div className="progress" aria-hidden="true">
            <i style={{ width: `${(phase.done / phase.total) * 100}%` }} />
          </div>
        </div>
      )}
      {phase.name === 'done' && (
        <p>
          提炼完了：{phase.fresh} 条新候选进了「发现」，{phase.skipped} 组判断为一次性的，已收起。
        </p>
      )}
      {phase.name === 'error' && (
        <div className="stack">
          <p className="error-line">{phase.message}</p>
          <p className="hint">
            已完成 {phase.done}/{phase.total} 批，{phase.fresh} 条新候选已经进了「发现」。可以稍后再点「AI 提炼」继续，已提炼过的不会重复发送。
          </p>
        </div>
      )}
    </Dialog>
  );
}
