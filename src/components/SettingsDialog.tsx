// 设置：左边分类，右边内容。弹窗大小固定，切换分类时不跳。改了就保存，没有保存按钮。

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { version } from '../../package.json';
import { REPO_URL } from '../config';
import { updateSettings } from '../db/db';
import { formatAgo } from '../logic/time';
import { PALETTES, type Palette, type Theme } from '../theme';
import type { Settings } from '../types';
import { Dialog } from './Dialog';
import { DataIcon, DownloadIcon, FolderIcon, InfoIcon, SparkIcon, TerminalIcon, ThemeIcon, TrashIcon } from './Icons';
import { ModelSettings } from './ModelSettings';
import { AgentPanel, SourcesPanel, type SourcesPanelProps } from './SourcesPanel';

export type SettingsTab = 'sources' | 'model' | 'agent' | 'appearance' | 'data' | 'about';

interface Props {
  settings: Settings;
  /** 打开时显示哪一页。 */
  tab: SettingsTab;
  sources: SourcesPanelProps;
  onBackup: () => void;
  /** 库里还剩几条示例，0 时不显示清除示例。 */
  sampleCount: number;
  onClearSamples: () => void;
  /** 还没问过 AI 的候选数，「一次让 AI 看完全部候选」用。 */
  refinePending: number;
  onRefineAll: () => void;
  onClose: () => void;
}

const TABS: { id: SettingsTab; label: string; icon: ReactNode; desc?: string }[] = [
  {
    id: 'sources',
    label: '记录来源',
    icon: <FolderIcon />,
    desc: 'PromptBox 从你和 AI 的对话里找出反复用到的提示词和规则。只在这个浏览器里读取和计算，不上传。',
  },
  { id: 'model', label: 'AI 模型', icon: <SparkIcon />, desc: '用于「按我的风格生成」和「AI 提炼」。不填也能用，生成时可以复制指令到你常用的 AI。' },
  {
    id: 'agent',
    label: '本地 Agent',
    icon: <TerminalIcon />,
    desc: '让 Codex、Claude Code、WorkBuddy 这类 Agent 读懂意思再提炼，比网页里按字面找更准，还能读更多工具的记录。',
  },
  { id: 'appearance', label: '外观', icon: <ThemeIcon /> },
  { id: 'data', label: '数据', icon: <DataIcon />, desc: '内容只存在这个浏览器里。换浏览器或清除浏览器数据前，先导出备份；恢复时把备份文件拖进「记录来源」。' },
  { id: 'about', label: '关于', icon: <InfoIcon /> },
];

export function SettingsDialog({ settings, tab: initialTab, sources, onBackup, sampleCount, onClearSamples, refinePending, onRefineAll, onClose }: Props) {
  const [tab, setTab] = useState(initialTab);
  const current = TABS.find((item) => item.id === tab) ?? TABS[0];

  // 上下方向键在分类之间移动
  const onNavKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.id === tab);
    const next = TABS[(index + (event.key === 'ArrowDown' ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  return (
    <Dialog title="设置" className="settings" onClose={onClose}>
      <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="设置分类" onKeyDown={onNavKey}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            className="settings-tab"
            aria-selected={tab === item.id}
            aria-controls="settings-pane"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <section id="settings-pane" className="settings-pane" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        <h3 className="pane-title">{current.label}</h3>
        {current.desc && <p className="pane-desc">{current.desc}</p>}
        {tab === 'sources' && <SourcesPanel {...sources} onOpenAgent={() => setTab('agent')} />}
        {tab === 'model' && <ModelSettings settings={settings} refinePending={refinePending} onRefineAll={onRefineAll} />}
        {tab === 'agent' && <AgentPanel {...sources} />}
        {tab === 'appearance' && <AppearancePanel theme={settings.theme ?? 'system'} palette={settings.palette ?? 'mono'} />}
        {tab === 'data' && (
          <DataPanel lastBackupAt={settings.lastBackupAt} sampleCount={sampleCount} onBackup={onBackup} onClearSamples={onClearSamples} />
        )}
        {tab === 'about' && <AboutPanel />}
      </section>
    </Dialog>
  );
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];

function AppearancePanel({ theme, palette }: { theme: Theme; palette: Palette }) {
  return (
    <div className="stack">
      <div className="sec-label">主题色</div>
      <div className="palette-opts" role="radiogroup" aria-label="主题色">
        {PALETTES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            className="theme-opt"
            aria-checked={palette === option.id}
            onClick={() => void updateSettings({ palette: option.id })}
          >
            {/* 预览带着自己的 data-palette，直接用这套主题色的变量，跟着当前的明暗变 */}
            <span className="palette-preview" data-palette={option.id} aria-hidden="true">
              <i />
              <i>
                <b />
                <b />
                <em />
              </i>
            </span>
            {option.label}
          </button>
        ))}
      </div>
      <div className="sec-label" style={{ marginTop: 10 }}>
        明暗
      </div>
      <div className="theme-opts" role="radiogroup" aria-label="明暗">
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            className="theme-opt"
            aria-checked={theme === option.id}
            onClick={() => void updateSettings({ theme: option.id })}
          >
            <span className={`theme-preview ${option.id}`} aria-hidden="true">
              <i />
              <i>
                <b />
                <b />
              </i>
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DataPanel(props: { lastBackupAt?: number; sampleCount: number; onBackup: () => void; onClearSamples: () => void }) {
  const { lastBackupAt, sampleCount, onBackup, onClearSamples } = props;
  return (
    <div className="rows">
      <button type="button" className="row-btn" onClick={onBackup}>
        <span>
          导出备份文件
          <small>{lastBackupAt ? `上次备份：${formatAgo(lastBackupAt)}` : '还没有备份过'}</small>
        </span>
        <DownloadIcon />
      </button>
      {sampleCount > 0 && (
        <button type="button" className="row-btn" onClick={onClearSamples}>
          <span>
            清除示例内容
            <small>库里还有 {sampleCount} 条示例，改过的不算示例，会留下</small>
          </span>
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

function AboutPanel() {
  return (
    <div className="stack about">
      <p>
        <b className="about-name">PromptBox</b> <span className="muted">v{version}</span>
      </p>
      <p>从你和 AI 的对话里提炼提示词和规则，再按你的风格写新的。</p>
      <ul className="about-list">
        <li>没有账号和服务器，内容只存在这个浏览器里。</li>
        <li>聊天记录在浏览器里扫描，不上传。</li>
        <li>只有用到模型时，才把需要的内容直接发给你选的服务商。</li>
      </ul>
      <p className="hint">
        开源许可 MIT
        {REPO_URL && (
          <>
            {' · '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
            {' · '}
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
              反馈问题 ↗
            </a>
          </>
        )}
      </p>
    </div>
  );
}
