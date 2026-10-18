// 设置里的「AI 模型」：上面列出用过的模型，点一下切换；下面是当前模型的服务商、Key、模型名和测试。改了就保存，没有保存按钮。

import { useEffect, useRef, useState } from 'react';
import { updateSettings } from '../db/db';
import { complete, hostOf, isConfigured, listModels, PROVIDERS, providerOf, withTimeout } from '../logic/llm';
import type { CustomService, LlmProvider, LlmSettings, SavedModel, Settings } from '../types';
import { CheckIcon, RefreshIcon } from './Icons';
import { ModelPicker } from './ModelPicker';

interface Props {
  settings: Settings;
  refinePending: number;
  onRefineAll: () => void;
}

type Saved = NonNullable<Settings['llmSaved']>;
type ModelState = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; models: string[] } | { state: 'error'; message: string };

const EMPTY: LlmSettings = {
  provider: 'deepseek',
  apiKey: '',
  model: '',
  baseUrl: '',
};
/** 下拉框里"添加新的接口地址"这一项。 */
const NEW_CUSTOM = 'custom:new';

function canList(llm: LlmSettings): boolean {
  if (!llm.apiKey.trim()) return false;
  if (llm.provider === 'custom') return /^https:\/\//.test(llm.baseUrl ?? '');
  return !providerOf(llm.provider).modelHint;
}

/** 下拉框里的名字：一般用域名，同一个域名加了好几个时用完整地址区分。 */
function customLabel(service: CustomService, all: CustomService[]): string {
  const host = hostOf(service.baseUrl);
  if (!host) return '还没填地址';
  const twins = all.filter((item) => hostOf(item.baseUrl) === host).length;
  return twins > 1 ? service.baseUrl.replace(/^https?:\/\//, '') : host;
}

function toSaved(llm: LlmSettings): SavedModel {
  const model = llm.model.trim();
  return llm.provider === 'custom' ? { provider: 'custom', customId: llm.customId, model } : { provider: llm.provider, model };
}

function sameModel(a: SavedModel, b: SavedModel): boolean {
  return a.provider === b.provider && (a.customId ?? '') === (b.customId ?? '') && a.model === b.model;
}

function draftCustom(): LlmSettings {
  return {
    provider: 'custom',
    customId: crypto.randomUUID(),
    apiKey: '',
    model: '',
    baseUrl: '',
  };
}

/** 整理旧数据：以前只记当前这一家，自己添加的接口也只记一个。 */
function initialState(settings: Settings): {
  llm: LlmSettings;
  saved: Saved;
  customs: CustomService[];
  recent: SavedModel[];
} {
  const saved: Saved = { ...settings.llmSaved };
  const customs = [...(settings.llmCustom ?? [])];
  let llm = settings.llm ?? EMPTY;
  if (!settings.llmSaved && llm.apiKey && llm.provider !== 'custom') saved[llm.provider] = { apiKey: llm.apiKey, model: llm.model };
  const legacy = saved.custom;
  delete saved.custom;
  if (legacy?.baseUrl && !customs.some((service) => service.baseUrl === legacy.baseUrl)) {
    customs.push({
      id: crypto.randomUUID(),
      baseUrl: legacy.baseUrl,
      apiKey: legacy.apiKey,
      model: legacy.model,
    });
  }
  if (llm.provider === 'custom' && !customs.some((service) => service.id === llm.customId)) {
    const match = customs.find((service) => service.baseUrl === llm.baseUrl);
    if (match) llm = { ...llm, customId: match.id };
    else if (llm.baseUrl || llm.apiKey) {
      const service = {
        id: crypto.randomUUID(),
        baseUrl: llm.baseUrl ?? '',
        apiKey: llm.apiKey,
        model: llm.model,
      };
      customs.push(service);
      llm = { ...llm, customId: service.id };
    } else llm = draftCustom();
  }
  // 第一次有模型列表时，把以前填过 Key 和模型的都放进来；正在用的那个一定在列表里
  let recent = [...(settings.llmModels ?? [])];
  if (!settings.llmModels) {
    for (const [provider, value] of Object.entries(saved)) if (value?.apiKey && value.model) recent.push({ provider: provider as LlmProvider, model: value.model });
    for (const service of customs) if (service.apiKey && service.model) recent.push({ provider: 'custom', customId: service.id, model: service.model });
  }
  if (isConfigured(llm) && !recent.some((item) => sameModel(item, toSaved(llm)))) recent = [toSaved(llm), ...recent];
  return { llm, saved, customs, recent };
}

export function ModelSettings({ settings, refinePending, onRefineAll }: Props) {
  const [initial] = useState(() => initialState(settings));
  const [llm, setLlm] = useState<LlmSettings>(initial.llm);
  const [saved, setSaved] = useState<Saved>(initial.saved);
  const [customs, setCustoms] = useState<CustomService[]>(initial.customs);
  const [recent, setRecent] = useState<SavedModel[]>(initial.recent);
  const [list, setList] = useState<ModelState>({ state: 'idle' });
  // 点刷新时加一，让下面重新读取模型列表
  const [reload, setReload] = useState(0);
  const reloadNow = useRef(false);
  const [test, setTest] = useState<{
    state: 'idle' | 'running' | 'ok' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const testRun = useRef<AbortController | null>(null);
  const preset = providerOf(llm.provider);
  const models = list.state === 'ok' ? list.models : [];
  const savedCustom = llm.provider === 'custom' && customs.some((service) => service.id === llm.customId);

  const commit = (next: LlmSettings, baseCustoms = customs) => {
    let nextSaved = saved;
    let nextCustoms = baseCustoms;
    if (next.provider === 'custom') {
      // 自己添加的接口：填了地址或 Key 就记下来，下次直接选
      const service: CustomService = {
        id: next.customId ?? crypto.randomUUID(),
        baseUrl: next.baseUrl ?? '',
        apiKey: next.apiKey,
        model: next.model,
      };
      next = { ...next, customId: service.id };
      const others = baseCustoms.filter((item) => item.id !== service.id);
      if (!service.baseUrl && !service.apiKey) nextCustoms = others;
      else if (others.length < baseCustoms.length) nextCustoms = baseCustoms.map((item) => (item.id === service.id ? service : item));
      else nextCustoms = [...baseCustoms, service];
    } else {
      nextSaved = {
        ...saved,
        [next.provider]: { apiKey: next.apiKey, model: next.model },
      };
      if (!next.apiKey.trim()) delete nextSaved[next.provider];
    }
    setLlm(next);
    setSaved(nextSaved);
    setCustoms(nextCustoms);
    // 设置变了，之前的测试结果不算数，正在跑的测试也停掉
    testRun.current?.abort();
    setTest({ state: 'idle' });
    void updateSettings({
      llm: next.apiKey.trim() ? next : undefined,
      llmSaved: nextSaved,
      llmCustom: nextCustoms,
    });
  };

  const change = (patch: Partial<LlmSettings>) => commit({ ...llm, ...patch });

  // 换服务商时，恢复以前填过的 Key、模型和地址，没填过就清空
  const choose = (value: string) => {
    if (value === NEW_CUSTOM) return commit(draftCustom());
    const service = customs.find((item) => `custom:${item.id}` === value);
    if (service)
      return commit({
        provider: 'custom',
        customId: service.id,
        baseUrl: service.baseUrl,
        apiKey: service.apiKey,
        model: service.model,
      });
    const provider = value as LlmProvider;
    commit({
      provider,
      apiKey: saved[provider]?.apiKey ?? '',
      model: saved[provider]?.model ?? '',
    });
  };

  const saveRecent = (next: SavedModel[]) => {
    setRecent(next);
    void updateSettings({ llmModels: next });
  };

  // 用过的模型记进列表：从下拉里选中、输完模型名、测试通过的时候
  const remember = (config: LlmSettings) => {
    if (!isConfigured(config)) return;
    const entry = toSaved(config);
    if (!recent.some((item) => sameModel(item, entry))) saveRecent([entry, ...recent]);
  };

  // 列表里只显示服务还在、Key 也还在的
  const serviceOf = (item: SavedModel) =>
    item.provider === 'custom' ? customs.find((service) => service.id === item.customId) : saved[item.provider] && { apiKey: saved[item.provider]!.apiKey };
  const rows = recent.filter((item) => !!serviceOf(item)?.apiKey);
  const current = isConfigured(llm) ? toSaved(llm) : null;
  const serviceName = (item: SavedModel) => {
    if (item.provider !== 'custom') return providerOf(item.provider).name;
    const service = customs.find((other) => other.id === item.customId);
    return service ? customLabel(service, customs) : '';
  };

  const switchTo = (item: SavedModel) => {
    if (item.provider === 'custom') {
      const service = customs.find((other) => other.id === item.customId);
      if (service) commit({ provider: 'custom', customId: service.id, baseUrl: service.baseUrl, apiKey: service.apiKey, model: item.model });
      return;
    }
    commit({ provider: item.provider, apiKey: saved[item.provider]?.apiKey ?? '', model: item.model });
  };

  // 删掉当前这个自己添加的接口，换到剩下的第一个，没有了就新建一个空的；它下面的模型也从列表里去掉
  const removeCustom = () => {
    saveRecent(recent.filter((item) => item.customId !== llm.customId));
    const rest = customs.filter((item) => item.id !== llm.customId);
    const first = rest[0];
    commit(
      first
        ? {
            provider: 'custom',
            customId: first.id,
            baseUrl: first.baseUrl,
            apiKey: first.apiKey,
            model: first.model,
          }
        : draftCustom(),
      rest,
    );
  };

  // 填好 Key 后读取可用的模型，读不到就说明原因，让用户手动填
  useEffect(() => {
    if (!canList(llm)) {
      setList({ state: 'idle' });
      return;
    }
    setList({ state: 'loading' });
    const controller = new AbortController();
    // 打字时等 0.6 秒再读，点刷新时马上读
    const delay = reloadNow.current ? 0 : 600;
    reloadNow.current = false;
    const timer = window.setTimeout(() => {
      void listModels(llm, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setList(result.models.length ? { state: 'ok', models: result.models } : { state: 'error', message: result.error ?? '没读到模型。' });
        })
        .catch(() => undefined);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // 服务商、Key、地址变化或点了刷新时重新读取，改模型名不用
  }, [llm.provider, llm.apiKey, llm.baseUrl, reload]);

  useEffect(() => () => testRun.current?.abort(), []);

  const refreshModels = () => {
    reloadNow.current = true;
    setReload((count) => count + 1);
  };

  const runTest = async () => {
    testRun.current?.abort();
    const controller = new AbortController();
    testRun.current = controller;
    setTest({ state: 'running' });
    try {
      await complete(llm, '只回复一个字：好', withTimeout(controller.signal, 30_000));
      if (controller.signal.aborted) return;
      setTest({ state: 'ok' });
      remember(llm);
    } catch (error) {
      if (controller.signal.aborted) return;
      setTest({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div>
      {rows.length > 0 && (
        <>
          <div className="sec-label">已添加的模型 · 点一下切换</div>
          <div className="model-list" role="radiogroup" aria-label="已添加的模型">
            {rows.map((item) => {
              const active = !!current && sameModel(item, current);
              return (
                <div key={`${item.provider}:${item.customId ?? ''}:${item.model}`} className="model-item">
                  <button type="button" role="radio" aria-checked={active} className="model-choice" onClick={() => !active && switchTo(item)}>
                    <span className="radio" aria-hidden="true" />
                    <b>{item.model}</b>
                    <span className="model-service">{serviceName(item)}</span>
                    {active && <span className="model-current">正在使用</span>}
                  </button>
                  <button
                    type="button"
                    className="model-forget"
                    title="从列表里去掉"
                    aria-label={`从列表里去掉 ${item.model}`}
                    onClick={() => saveRecent(recent.filter((other) => !sameModel(other, item)))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div className="sec-label" style={{ marginTop: 16 }}>
            当前模型 · 换服务商或模型名后，会加进上面的列表
          </div>
        </>
      )}
      <div className="fields">
        <label htmlFor="llm-provider">服务商</label>
        <select
          id="llm-provider"
          className="input"
          value={llm.provider !== 'custom' ? llm.provider : savedCustom ? `custom:${llm.customId}` : NEW_CUSTOM}
          onChange={(event) => choose(event.target.value)}
        >
          {PROVIDERS.filter((provider) => provider.id !== 'custom').map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
              {saved[provider.id]?.apiKey ? ' · 已填 Key' : ''}
            </option>
          ))}
          <optgroup label="自己添加的接口">
            {customs.map((service) => (
              <option key={service.id} value={`custom:${service.id}`}>
                {customLabel(service, customs)}
              </option>
            ))}
            <option value={NEW_CUSTOM}>＋ 添加兼容 OpenAI 的接口地址</option>
          </optgroup>
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
              <span className="hint">兼容 OpenAI 接口的地址，后面不用加 /chat/completions。服务端要允许网页直接调用（开启跨域 CORS）。</span>
            </div>
          </>
        )}
        <label htmlFor="llm-key">API Key</label>
        <div>
          <input
            id="llm-key"
            className="input"
            type="password"
            autoComplete="off"
            value={llm.apiKey}
            placeholder="粘贴 Key"
            onChange={(event) => change({ apiKey: event.target.value.trim() })}
          />
          {preset.keyUrl && (
            <span className="hint">
              还没有 Key？
              <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                去 {preset.name} 创建 ↗
              </a>
            </span>
          )}
        </div>
        <label htmlFor="llm-model">模型</label>
        <div>
          <div className="model-row">
            <ModelPicker
              id="llm-model"
              value={llm.model}
              models={models}
              placeholder={models.length ? '点这里选，或输入搜索' : '服务商提供的模型名'}
              onChange={(model) => change({ model })}
              onCommit={(model) => remember({ ...llm, model })}
            />
            {canList(llm) && (
              <button
                type="button"
                className={`icon-btn${list.state === 'loading' ? ' spin' : ''}`}
                title="重新读取模型列表"
                aria-label="重新读取模型列表"
                disabled={list.state === 'loading'}
                onClick={refreshModels}
              >
                <RefreshIcon />
              </button>
            )}
          </div>
          <ModelHint list={list} llm={llm} models={models} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn sm" disabled={!isConfigured(llm) || test.state === 'running'} onClick={runTest}>
          {test.state === 'running' ? '正在测试…' : test.state === 'idle' ? '测试一下' : '重新测试'}
        </button>
        {savedCustom ? (
          <button type="button" className="btn sm ghost" onClick={removeCustom}>
            删掉这个接口
          </button>
        ) : (
          llm.apiKey && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                saveRecent(recent.filter((item) => item.provider !== llm.provider));
                change({ apiKey: '', model: '' });
              }}
            >
              清除 Key
            </button>
          )
        )}
        {test.state === 'ok' && (
          <span className="test-ok" role="status">
            <CheckIcon />
            连接正常，可以用了
          </span>
        )}
      </div>
      {test.state === 'error' && (
        <p className="error-line" role="alert" style={{ marginTop: 8 }}>
          测试没通过：{test.message}
        </p>
      )}
      <p className="note-line" style={{ marginTop: 10 }}>
        生成只发送你的需求和勾选的参考内容；问 AI 只发送那几条候选的原话，每句最多 200 字。Key 只存在这个浏览器里。
      </p>
      <button type="button" className="row-btn refine-all" disabled={!isConfigured(llm) || !refinePending} onClick={onRefineAll}>
        <span>
          一次让 AI 看完全部候选
          <small>
            {!isConfigured(llm)
              ? '先在上面填好模型'
              : refinePending
                ? `「发现」里还有 ${refinePending} 条没问过 AI，意见会挂在每条候选下面`
                : '「发现」里的候选都问过 AI 了；平时也可以在每条候选里单独问'}
          </small>
        </span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function ModelHint({ list, llm, models }: { list: ModelState; llm: LlmSettings; models: string[] }) {
  if (list.state === 'loading') return <span className="hint">正在读取可用的模型……</span>;
  if (list.state === 'error')
    return (
      <span className="hint error">
        读不到模型列表。{list.message}
        改好后点右边的刷新按钮重试，也可以直接填模型名。
      </span>
    );
  if (list.state === 'ok') {
    const model = llm.model.trim();
    if (model && !models.includes(model))
      return (
        <span className="hint">
          读到 {models.length} 个模型，但里面没有「{model}」，确认一下名字。
        </span>
      );
    return <span className="hint">读到 {models.length} 个可用的模型，点输入框选，也可以输入搜索。</span>;
  }
  const hint = providerOf(llm.provider).modelHint;
  if (hint) return <span className="hint">{hint}</span>;
  return <span className="hint">填好 Key 后会自动读取可用的模型。</span>;
}
