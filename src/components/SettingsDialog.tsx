// 设置：AI 模型（可选）和备份。改了就保存，没有保存按钮。

import { useEffect, useId, useState } from 'react';
import { updateSettings } from '../db/db';
import { complete, isConfigured, listModels, PROVIDERS, providerOf } from '../logic/llm';
import { formatAgo } from '../logic/time';
import type { LlmProvider, LlmSettings, Settings } from '../types';
import { Dialog } from './Dialog';

interface Props {
  settings: Settings;
  onBackup: () => void;
  onClose: () => void;
}

const EMPTY: LlmSettings = { provider: 'deepseek', apiKey: '', model: '', baseUrl: '' };

export function SettingsDialog({ settings, onBackup, onClose }: Props) {
  const [llm, setLlm] = useState<LlmSettings>(settings.llm ?? EMPTY);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; message?: string }>({ state: 'idle' });
  const listId = useId();
  const preset = providerOf(llm.provider);

  const change = (patch: Partial<LlmSettings>) => {
    const next = { ...llm, ...patch };
    setLlm(next);
    setTest({ state: 'idle' });
    void updateSettings({ llm: next.apiKey.trim() ? next : undefined });
  };

  // 填好 Key 后读取可用的模型，读不到就手动填
  useEffect(() => {
    setModels([]);
    if (!llm.apiKey.trim() || (llm.provider === 'custom' && !/^https:\/\//.test(llm.baseUrl ?? ''))) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void listModels(llm, controller.signal).then(setModels), 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [llm.provider, llm.apiKey, llm.baseUrl]);

  const runTest = async () => {
    setTest({ state: 'running' });
    try {
      await complete(llm, '只回复一个字：好');
      setTest({ state: 'ok' });
    } catch (error) {
      setTest({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const backupText = settings.lastBackupAt
    ? `上次备份：${formatAgo(settings.lastBackupAt)}${settings.changedSinceBackup ? '，之后有改动' : '，之后没有改动'}。`
    : '还没有备份过。';

  return (
    <Dialog title="设置" size="narrow" onClose={onClose}>
      <div className="stack">
        <div>
          <div className="sec-label">AI 模型 · 可选</div>
          <div className="fields">
            <label htmlFor="llm-provider">服务商</label>
            <select
              id="llm-provider"
              className="input"
              value={llm.provider}
              onChange={(event) => change({ provider: event.target.value as LlmProvider, model: '' })}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            {llm.provider === 'custom' && (
              <>
                <label htmlFor="llm-base">接口地址</label>
                <div>
                  <input
                    id="llm-base"
                    className="input"
                    value={llm.baseUrl ?? ''}
                    placeholder="https://…/v1"
                    onChange={(event) => change({ baseUrl: event.target.value.trim() })}
                  />
                  <span className="hint">兼容 OpenAI 接口的地址，后面不用加 /chat/completions</span>
                </div>
              </>
            )}
            <label htmlFor="llm-key">API Key</label>
            <input
              id="llm-key"
              className="input"
              type="password"
              autoComplete="off"
              value={llm.apiKey}
              placeholder="sk-…"
              onChange={(event) => change({ apiKey: event.target.value })}
            />
            <label htmlFor="llm-model">模型</label>
            <div>
              <input
                id="llm-model"
                className="input"
                list={listId}
                value={llm.model}
                placeholder={preset.modelHint}
                onChange={(event) => change({ model: event.target.value })}
              />
              <datalist id={listId}>
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <span className="hint">{models.length ? `读到 ${models.length} 个可用模型，点输入框可以选` : '填好 Key 后会自动读取可用的模型'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn sm" disabled={!isConfigured(llm) || test.state === 'running'} onClick={runTest}>
              {test.state === 'running' ? '正在测试…' : '测试一下'}
            </button>
            {llm.apiKey && (
              <button type="button" className="btn sm ghost" onClick={() => change({ apiKey: '', model: '' })}>
                清除 Key
              </button>
            )}
            {test.state === 'ok' && <span className="hint" style={{ margin: 0 }}>可以用了</span>}
          </div>
          {test.state === 'error' && <p className="error-line" style={{ marginTop: 8 }}>{test.message}</p>}
          <p className="note-line" style={{ marginTop: 10 }}>
            用于「按我的风格生成」：只发送你的需求和勾选的几条参考内容，不发送聊天记录。Key 只存在这个浏览器里。不填也能用，生成时复制指令到你常用的 AI。
          </p>
        </div>

        <div className="box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13 }}>备份</b>
              <span className="hint">库里的内容和处理记录（比如忽略过哪些候选），不含扫描时读到的聊天记录</span>
            </div>
            <button type="button" className="btn primary" onClick={onBackup}>
              导出备份文件
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {backupText}恢复备份用侧栏「导入」。
          </p>
        </div>

        <p style={{ fontSize: 13 }}>
          <b>数据存在哪：</b>库和扫描记录保存在当前浏览器；使用模型生成时会发送需求和所选参考内容。清除浏览器数据、换浏览器或换电脑时，数据不会跟着走，记得定期备份。
        </p>
      </div>
    </Dialog>
  );
}
