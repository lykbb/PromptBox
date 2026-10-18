// 图标全站通用：气泡是提示词，图钉是规则。

import type { ItemType, Tool } from '../types';

export function PromptIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5V11H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function RuleIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2h4M7 2v4L4.5 8.5h7L9 6V2M8 8.5V14" />
    </svg>
  );
}

export function TypeIcon({ type }: { type: ItemType }) {
  return type === 'rule' ? <RuleIcon /> : <PromptIcon />;
}

export function RefreshIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function SidebarIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h11v9h-11zM6 3.5v9" />
    </svg>
  );
}

export function DiscoverIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM10.2 5.8L9 9 5.8 10.2 7 7z" />
    </svg>
  );
}

export function AllIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5L8 2.5 13.5 5 8 7.5zM2.5 8L8 10.5 13.5 8M2.5 11L8 13.5 13.5 11" />
    </svg>
  );
}

export function ImportIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v7M5 6.5l3 3 3-3M2.5 10v3h11v-3" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5h1.9M7.6 5h5.9M2.5 11h6.4M12.1 11h1.4" />
      <circle cx="6" cy="5" r="1.6" />
      <circle cx="10.5" cy="11" r="1.6" />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3zM12.5 11v3M11 12.5h3" />
    </svg>
  );
}

export function TerminalIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10h2.5" />
    </svg>
  );
}

export function ThemeIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" />
    </svg>
  );
}

export function DataIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 4.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 7.5v3.5M8 5.2v.1" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M3 13.5h10" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 5.5h7v8h-7zM3.5 10.5v-8h7" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10" />
    </svg>
  );
}

export const TOOL_NAMES: Record<Tool, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
  'claude-web': 'Claude 网页版',
  workbuddy: 'WorkBuddy',
  codebuddy: 'CodeBuddy',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  copilot: 'Copilot',
  cline: 'Cline',
  opencode: 'OpenCode',
  other: '其他工具',
};

export function toolList(tools: Tool[]): string {
  return tools.map((tool) => TOOL_NAMES[tool]).join('、');
}
