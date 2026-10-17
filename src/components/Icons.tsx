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

export function SourcesIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5h11M2.5 11h11" />
      <circle cx="6" cy="5" r="1.6" fill="#fff" />
      <circle cx="10.5" cy="11" r="1.6" fill="#fff" />
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

export const TOOL_BADGES: Record<Tool, string> = {
  codex: 'Cx',
  'claude-code': 'Cl',
  chatgpt: 'G',
  'claude-web': 'C',
  workbuddy: 'W',
  codebuddy: 'CB',
  gemini: 'Ge',
  cursor: 'Cu',
  copilot: 'Co',
  cline: 'Ci',
  opencode: 'Oc',
  other: '…',
};

export function toolList(tools: Tool[]): string {
  return tools.map((tool) => TOOL_NAMES[tool]).join('、');
}
