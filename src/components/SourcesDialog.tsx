// 记录来源：网页不能自己去翻硬盘，所以由用户授权一次。来源有变化后自动扫描。
// 也可以让本地 Agent 来提炼：下载 Skill，Agent 写出候选文件，再拖进来。

import type { FolderSourceId } from '../scan/protocol';
import { SKILL_NAME } from '../config';
import type { SourceId, SourceRecord } from '../types';
import { Dialog } from './Dialog';

interface Props {
  sources: SourceRecord[];
  /** 上次扫描时各来源匹配到的文件数，0 说明可能选错了文件夹。 */
  matched: Partial<Record<SourceId, number>>;
  /** 上次扫描时跳过的压缩旧会话。 */
  compressed: Partial<Record<SourceId, number>>;
  scanning: { done: number; total: number } | null;
  folderPicker: boolean;
  onPickFolder: (id: FolderSourceId) => void;
  onPickExport: () => void;
  onDownloadSkill: () => void;
  onCopyAgentPrompt: (text: string) => void;
  onClose: () => void;
}

const FOLDERS: { id: FolderSourceId; badge: string; name: string; path: string; files: string }[] = [
  { id: 'codex', badge: 'Cx', name: 'Codex', path: '~/.codex/sessions', files: 'rollout-*.jsonl' },
  { id: 'claude-code', badge: 'Cl', name: 'Claude Code', path: '~/.claude/projects', files: '*.jsonl' },
  { id: 'workbuddy', badge: 'W', name: 'WorkBuddy', path: '~/.workbuddy/projects', files: '*.jsonl' },
];

const AGENT_PROMPT = `用 ${SKILL_NAME} 技能，帮我从聊天记录里提炼值得长期保存的提示词和规则，一次性的不要。`;

export function SourcesDialog(props: Props) {
  const { sources, matched, compressed, scanning, folderPicker, onPickFolder, onPickExport, onClose } = props;
  const find = (id: SourceId) => sources.find((source) => source.id === id);
  const web = find('web-export');

  return (
    <Dialog title="记录来源" sub="PromptBox 从这些地方读取你说过的话" onClose={onClose}>
      <div className="stack">
        {FOLDERS.map((folder) => {
          const source = find(folder.id);
          const empty = matched[folder.id] === 0;
          const skipped = compressed[folder.id] ?? 0;
          return (
            <div key={folder.id} className={`src-card${source ? '' : ' off'}`}>
              <span className={`tool${source ? '' : ' off'}`}>{folder.badge}</span>
              <div className="src-main">
                <b>{folder.name}</b>
                <span className="hint">
                  {empty
                    ? `这个文件夹里没找到 ${folder.files}，请确认选的是 ${folder.path}`
                    : source
                      ? `${source.label} · ${source.conversations} 个对话`
                      : `选择 ${folder.path} 文件夹`}
                </span>
                {skipped > 0 && <span className="hint">另有 {skipped} 个压缩的旧会话（.jsonl.zst），浏览器读不了，已跳过；用本地 Agent 提炼可以读到</span>}
              </div>
              <span className={`state ${empty ? 'warn' : source ? 'ok' : 'no'}`}>{empty ? '没找到记录' : source ? '已连接' : '未添加'}</span>
              <button type="button" className="btn sm" disabled={!!scanning} onClick={() => onPickFolder(folder.id)}>
                {source ? '更换文件夹' : '选择文件夹'}
              </button>
            </div>
          );
        })}
        <div className={`src-card${web ? '' : ' off'}`}>
          <span className={`tool${web ? '' : ' off'}`}>G</span>
          <div className="src-main">
            <b>ChatGPT、Claude 网页版</b>
            <span className="hint">
              {web ? `${web.label} · ${web.conversations} 个对话` : '在网页版的设置里导出数据，解压后选择里面的 conversations.json'}
            </span>
          </div>
          <span className={`state ${web ? 'ok' : 'no'}`}>{web ? '已添加' : '未添加'}</span>
          <button type="button" className="btn sm" disabled={!!scanning} onClick={onPickExport}>
            {web ? '换一个文件' : '选择文件'}
          </button>
        </div>

        {scanning && <p className="note-line">正在读取 {scanning.done}/{scanning.total} 个文件……</p>}
        <p className="hint">
          {folderPicker
            ? '选择窗口里按 ⌘⇧.（Windows 在地址栏输入路径）可以显示以点开头的隐藏文件夹。浏览器会记住授权，之后点「发现」里的刷新按钮只扫描新增的对话。'
            : '这个浏览器不能记住文件夹授权，每次扫描都要重新选择。用 Chrome 或 Edge 可以只选一次。'}
        </p>
        <p className="note-line">本地扫描只在这个浏览器里读取和计算，不会上传记录。</p>

        <div className="agent-box">
          <b>让本地 Agent 提炼，更准</b>
          <span className="hint">网页里的本地规则只认得字面相近的话；Codex、Claude Code、WorkBuddy 这类 Agent 能看懂意思、分清哪些是一次性的，还能读更多工具的记录。</span>
          <ol>
            <li>下载提炼 Skill，解压后把 {SKILL_NAME} 文件夹放进 Agent 的技能目录：Claude Code 是 ~/.claude/skills/，Codex 是 ~/.codex/skills/，WorkBuddy 是 ~/.workbuddy/skills/。</li>
            <li>对 Agent 说：「{AGENT_PROMPT}」</li>
            <li>它会在「下载」文件夹里生成 promptbox-candidates-日期.json，把这个文件拖进 PromptBox，候选会出现在「发现」里，照常逐条确认。</li>
          </ol>
          <div className="row">
            <button type="button" className="btn sm" onClick={props.onDownloadSkill}>
              下载 Skill（.zip）
            </button>
            <button type="button" className="btn sm ghost" onClick={() => props.onCopyAgentPrompt(AGENT_PROMPT)}>
              复制这句话
            </button>
          </div>
          <span className="hint">Agent 提炼时，会把记录交给它背后的模型。</span>
        </div>
      </div>
    </Dialog>
  );
}
