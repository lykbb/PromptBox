// 设置里的「记录来源」和「本地 Agent」两页。
// 记录来源：最上面是导入文件（网页版导出、提示词文件、备份、候选文件都从这里进）；
// 下面是本地 AI 工具，网页不能自己去翻硬盘，所以由用户授权一次文件夹，之后点刷新就能更新。
// 其他工具交给本地 Agent：下载 Skill，Agent 写出候选文件，再拖进来。

import { useState, type DragEvent } from 'react';
import { chooseFiles } from '../browser';
import { SKILL_NAME } from '../config';
import { CHAT_EXPORT_HELP } from '../logic/chatExport';
import type { FolderSourceId } from '../scan/protocol';
import type { SourceId, SourceRecord } from '../types';
import { ImportIcon } from './Icons';

export interface SourcesPanelProps {
  sources: SourceRecord[];
  /** 上次扫描时各来源匹配到的文件数，0 说明可能选错了文件夹。 */
  matched: Partial<Record<SourceId, number>>;
  /** 上次扫描时跳过的压缩旧会话。 */
  compressed: Partial<Record<SourceId, number>>;
  scanning: { done: number; total: number } | null;
  folderPicker: boolean;
  onPickFolder: (id: FolderSourceId) => void;
  /** 导入文件：聊天记录导出去扫描，其他的走导入确认。 */
  onImportFiles: (files: File[]) => void;
  onDownloadSkill: () => void;
  onCopy: (text: string, message: string) => void;
}

const IMPORT_ACCEPT = '.zip,.json,.md,.markdown,.txt';

const FOLDERS: { id: FolderSourceId; badge: string; name: string; path: string }[] = [
  { id: 'codex', badge: 'Cx', name: 'Codex', path: '.codex/sessions' },
  { id: 'claude-code', badge: 'Cl', name: 'Claude Code', path: '.claude/projects' },
  { id: 'workbuddy', badge: 'W', name: 'WorkBuddy', path: '.workbuddy/projects' },
];

type Platform = 'mac' | 'windows' | 'other';

function platform(): Platform {
  const name = navigator.platform || navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(name)) return 'mac';
  if (/Win/i.test(name)) return 'windows';
  return 'other';
}

/** 选择窗口里能直接粘贴的路径：macOS、Linux 用 ~，Windows 用 %USERPROFILE%。 */
function fullPath(path: string, os: Platform): string {
  return os === 'windows' ? `%USERPROFILE%\\${path.replace(/\//g, '\\')}` : `~/${path}`;
}

const PASTE_HINT: Record<Platform, string> = {
  mac: '点「连接」后按 ⌘⇧G，粘贴路径，回车',
  windows: '点「连接」后在地址栏粘贴路径，回车',
  other: '点「连接」后按 Ctrl+L，粘贴路径，回车',
};

const AGENT_PROMPT = `用 ${SKILL_NAME} 技能，帮我从聊天记录里提炼值得长期保存的提示词和规则，一次性的不要。`;

export function SourcesPanel(props: SourcesPanelProps & { onOpenAgent: () => void }) {
  const { sources, matched, compressed, scanning, folderPicker, onPickFolder, onImportFiles, onCopy } = props;
  const [over, setOver] = useState(false);
  const os = platform();
  const find = (id: SourceId) => sources.find((source) => source.id === id);
  const web = find('web-export');

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    // 不让窗口自己的拖放导入再处理一遍
    event.stopPropagation();
    setOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onImportFiles(files);
  };

  return (
    <div className="stack">
      <div
        className={`drop-zone${over ? ' over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <ImportIcon />
        <div>
          <b>
            把文件拖到这里，或者
            <button
              type="button"
              className="link-btn"
              onClick={() => void chooseFiles({ accept: IMPORT_ACCEPT, multiple: true }).then((files) => files.length && onImportFiles(files))}
            >
              选择文件
            </button>
          </b>
          <span className="hint">ChatGPT、Claude 的聊天记录导出（.zip 直接拖进来）· .md、SKILL.md、AGENTS.md · PromptBox 备份 · Agent 候选文件</span>
        </div>
      </div>
      <p className="hint">
        还没导出过聊天记录？{' '}
        <a href={CHAT_EXPORT_HELP.chatgpt} target="_blank" rel="noreferrer">
          ChatGPT 怎么导出 ↗
        </a>
        {' · '}
        <a href={CHAT_EXPORT_HELP.claude} target="_blank" rel="noreferrer">
          Claude 怎么导出 ↗
        </a>
        {web && <> · 已导入 {web.label || '网页版记录'} 的 {web.conversations} 个对话</>}
      </p>

      <div className="sec-label src-label">本地 AI 工具 · 连接一次，之后点「发现」里的刷新就能更新</div>
      {FOLDERS.map((folder) => {
        const source = find(folder.id);
        const empty = matched[folder.id] === 0;
        const skipped = compressed[folder.id] ?? 0;
        const path = fullPath(folder.path, os);
        return (
          <div key={folder.id} className={`src-card${source ? '' : ' off'}`}>
            <span className={`tool${source ? '' : ' off'}`}>{folder.badge}</span>
            <div className="src-main">
              <b>
                {folder.name}
                {source && !empty && <span className="src-count"> · {source.conversations} 个对话</span>}
              </b>
              <span className={`hint${empty ? ' error' : ''}`}>{empty ? `这个文件夹里没找到 ${folder.name} 的记录，请确认选的是 ${path}` : <code>{path}</code>}</span>
              {skipped > 0 && <span className="hint">另有 {skipped} 个压缩的旧会话，浏览器读不了，已跳过；用本地 Agent 提炼可以读到</span>}
            </div>
            {!source && (
              <button type="button" className="btn sm ghost" onClick={() => onCopy(path, `已复制路径。${PASTE_HINT[os]}`)}>
                复制路径
              </button>
            )}
            <button type="button" className="btn sm" disabled={!!scanning} onClick={() => onPickFolder(folder.id)}>
              {source ? '更换' : '连接'}
            </button>
          </div>
        );
      })}
      {scanning && (
        <p className="note-line">
          正在读取 {scanning.done}/{scanning.total} 个文件……
        </p>
      )}
      <p className="hint">
        {folderPicker
          ? `这些文件夹以点开头，选择窗口里默认看不到：先复制路径，${PASTE_HINT[os]}。`
          : '这个浏览器记不住文件夹授权，每次扫描都要重新选择。用 Chrome 或 Edge 可以只选一次。'}
      </p>

      <button type="button" className="row-btn src-agent" onClick={props.onOpenAgent}>
        <span>
          用的是别的工具？
          <small>交给本地 Agent 提炼，它能读各种工具的记录</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

export function AgentPanel({ onDownloadSkill, onCopy }: Pick<SourcesPanelProps, 'onDownloadSkill' | 'onCopy'>) {
  return (
    <div className="stack">
      <ol className="steps">
        <li>
          <b>下载提炼 Skill</b>
          <span>
            解压后把 {SKILL_NAME} 文件夹放进 Agent 的技能目录：Claude Code 是 <code>~/.claude/skills/</code>，Codex 是 <code>~/.codex/skills/</code>，WorkBuddy 是{' '}
            <code>~/.workbuddy/skills/</code>。
          </span>
          <button type="button" className="btn sm" onClick={onDownloadSkill}>
            下载 Skill（.zip）
          </button>
        </li>
        <li>
          <b>对 Agent 说</b>
          <span>「{AGENT_PROMPT}」</span>
          <button type="button" className="btn sm" onClick={() => onCopy(AGENT_PROMPT, '已复制，发给你的 Agent 就行')}>
            复制这句话
          </button>
        </li>
        <li>
          <b>把结果拖进来</b>
          <span>它会在「下载」文件夹里生成 promptbox-candidates-日期.json，拖进 PromptBox，候选会出现在「发现」里，照常逐条确认。</span>
        </li>
      </ol>
      <p className="hint">Agent 提炼时，会把记录交给它背后的模型。</p>
    </div>
  );
}
