// 按我的风格写提示词："你的风格"来自相关的旧提示词，加上你的规则。

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGenerationPrompt, cleanGenerated, pickReferences } from '../logic/generate';
import { complete, isConfigured } from '../logic/llm';
import { segmentVariables } from '../logic/variables';
import type { Item, LlmSettings, ScopeFields } from '../types';
import { Dialog } from './Dialog';
import { ScopeEditor } from './ScopeEditor';
import { scopeKey } from '../logic/scope';

interface Props {
  need: string;
  items: Item[];
  llm?: LlmSettings;
  onCopy: (text: string, message?: string) => void;
  onSave: (fields: ScopeFields & { need: string; content: string; refs: Item[] }) => void;
  onClose: () => void;
}

type Run = { state: 'idle' } | { state: 'loading' } | { state: 'done'; text: string; prompt: string } | { state: 'error'; message: string };

export function GenerateDialog({ need: initialNeed, items, llm, onCopy, onSave, onClose }: Props) {
  const [need, setNeed] = useState(initialNeed);
  const [refNeed, setRefNeed] = useState(initialNeed);
  const [scope, setScope] = useState<ScopeFields>({ scope: 'global' });
  const references = useMemo(() => pickReferences(refNeed, items, scope), [refNeed, items, scope]);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const [pasted, setPasted] = useState({ text: '', prompt: '' });
  const controller = useRef<AbortController | null>(null);
  const configured = isConfigured(llm);

  // 需求改了以后，过一会儿重新挑参考
  useEffect(() => {
    const timer = window.setTimeout(() => setRefNeed(need), 500);
    return () => window.clearTimeout(timer);
  }, [need]);

  const chosen = references.filter((reference) => !unchecked.has(reference.item.id)).map((reference) => reference.item);
  const prompt = buildGenerationPrompt(need, chosen, scope);
  const ready = !!need.trim() && !!scopeKey(scope) && need === refNeed;

  const generate = async () => {
    if (!configured || !ready) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRun({ state: 'loading' });
    try {
      const text = cleanGenerated(await complete(llm, prompt, current.signal));
      if (!current.signal.aborted) setRun({ state: 'done', text, prompt });
    } catch (error) {
      if (current.signal.aborted) return;
      setRun({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  // 先确认适用范围和参考内容，再由用户点击生成；关弹窗时取消请求。
  useEffect(() => () => controller.current?.abort(), []);

  const stale = configured ? run.state === 'done' && run.prompt !== prompt : !!pasted.text && pasted.prompt !== prompt;
  const result = !ready || stale ? '' : configured ? (run.state === 'done' ? run.text : '') : cleanGenerated(pasted.text);
  const save = () => onSave({ need, content: result, refs: chosen, ...scope });

  const footer = configured ? (
    <>
      <span className="hint muted">用设置里的模型生成</span>
      <button type="button" className="btn" disabled={run.state === 'loading' || !ready} onClick={() => void generate()}>
        {run.state === 'idle' ? '生成' : '重新生成'}
      </button>
      <button type="button" className="btn" disabled={!result} onClick={() => onCopy(result)}>
        复制
      </button>
      <button type="button" className="btn primary" disabled={!result} onClick={save}>
        存进库
      </button>
    </>
  ) : (
    <>
      <span className="hint muted">还没有设置模型 Key，可以在「设置」里填</span>
      <button type="button" className="btn" disabled={!ready} onClick={() => onCopy(prompt, '已复制生成指令，贴到你常用的 AI 里')}>
        复制生成指令
      </button>
      <button type="button" className="btn primary" disabled={!result} onClick={save}>
        存进库
      </button>
    </>
  );

  return (
    <Dialog
      title="按我的风格写提示词"
      size="wide"
      onClose={onClose}
      footer={footer}
      dismissable={run.state !== 'loading' && run.state !== 'done' && !pasted.text.trim()}
    >
      <input className="ask" value={need} aria-label="需求" placeholder="一句话说清你想让 AI 做什么" onChange={(event) => setNeed(event.target.value)} />
      <ScopeEditor value={scope} onChange={setScope} allowUnconfirmed={false} />
      <p className="hint">所有任务都适用的规则每次都会参考；选了项目或任务，会再带上这个范围的规则，名称要和库里写的一致。</p>
      {stale && <p className="note-line">需求、范围或参考内容已改变，请重新生成结果后再保存。</p>}
      <div className="cols gen">
        <div>
          <div className="sec-label">参考了这些 · 可以取消勾选</div>
          {references.length === 0 && <p className="hint">库里还没有相关内容和规则，会按通用写法生成。</p>}
          {references.map(({ item, reason }) => (
            <label key={item.id} className="ref">
              <input
                type="checkbox"
                checked={!unchecked.has(item.id)}
                onChange={() => {
                  const next = new Set(unchecked);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  setUnchecked(next);
                }}
              />
              <span>
                {item.title || '未命名'}
                <small>{reason}</small>
              </span>
            </label>
          ))}
        </div>

        {configured ? (
          <div>
            <div className="sec-label">生成结果</div>
            {run.state === 'idle' && <p className="hint">确认左侧参考内容后，点击「生成」。</p>}
            {run.state === 'loading' && <div className="box loading">正在生成……</div>}
            {run.state === 'error' && <p className="error-line">{run.message} 也可以点「复制生成指令」，贴到常用的 AI 里生成。</p>}
            {run.state === 'done' && (
              <div className="box preview">
                <pre>
                  {segmentVariables(run.text).map((segment, index) =>
                    segment.variable ? (
                      <span key={index} className="var">
                        {segment.text}
                      </span>
                    ) : (
                      segment.text
                    ),
                  )}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="sec-label">第 1 步：复制生成指令，贴到你常用的 AI 里</div>
            <pre className="box preview" style={{ maxHeight: '28vh' }}>
              {prompt}
            </pre>
            <div className="sec-label" style={{ marginTop: 12 }}>
              第 2 步：把 AI 写好的提示词粘贴到这里
            </div>
            <textarea className="input" rows={6} value={pasted.text} placeholder="粘贴到这里" aria-label="粘贴生成结果" onChange={(event) => setPasted({ text: event.target.value, prompt })} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
