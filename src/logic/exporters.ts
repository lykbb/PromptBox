// 导出格式：普通 .md、SKILL.md、AGENTS.md、CLAUDE.md。
// SKILL.md 字段规则按 Anthropic Agent Skills 文档核对（2026-10-16）：
// name 最长 64 个字符，只能有小写字母、数字、连字符，不能含 XML 标签和保留词 anthropic、claude；
// description 不能为空，最长 1024 个字符，不能含 XML 标签。

import type { Item, ScopeFields } from '../types';
import { itemScope, scopeKey, scopeLabel } from './scope';
import { extractVariables } from './variables';

export type ExportFormat = 'skill' | 'agents' | 'claude' | 'md';

export const FORMAT_LABELS: Record<ExportFormat, { file: string; title: string; hint: string }> = {
  skill: { file: 'SKILL.md', title: 'SKILL.md', hint: 'Claude Code 等 Agent 的技能文件' },
  agents: { file: 'AGENTS.md', title: 'AGENTS.md', hint: 'Codex 等工具读取的项目规则' },
  claude: { file: 'CLAUDE.md', title: 'CLAUDE.md', hint: 'Claude Code 读取的项目规则' },
  md: { file: '.md', title: '普通 .md', hint: '正文连同适用范围' },
};

const XML_TAG = /<\/?[a-zA-Z][^>]*>/;

/** 返回问题描述；没有问题时返回空字符串。 */
export function validateSkillName(name: string): string {
  if (!name) return '请填写英文短名';
  if (name.length > 64) return '最长 64 个字符';
  if (!/^[a-z0-9-]+$/.test(name)) return '只能用小写字母、数字和连字符';
  if (name.startsWith('-') || name.endsWith('-')) return '不能以连字符开头或结尾';
  if (/anthropic|claude/.test(name)) return '不能包含 anthropic 或 claude';
  return '';
}

export function validateSkillDescription(description: string): string {
  const text = description.trim();
  if (!text) return '请填写描述';
  if (Array.from(text).length > 1024) return '最长 1024 个字符';
  if (XML_TAG.test(text)) return '不能包含 XML 标签';
  return '';
}

/** 从标题里猜一个英文短名；中文标题猜不出来时返回空字符串，让用户自己填。 */
export function suggestSkillName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

// YAML 里有特殊字符时加引号，避免冒号把头信息拆坏。
function yamlValue(value: string): string {
  const single = value.replace(/\s*\n\s*/g, ' ').trim();
  return /^[\s'"&*!|>%@`{[#-]|: | #|^\?/.test(single) ? JSON.stringify(single) : single;
}

export function toSkillFile(content: string, name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${yamlValue(description)}\n---\n\n${content.trim()}\n`;
}

/** 规则文件：每条规则一个小标题，可以一次合成多条。 */
type RuleLike = Pick<Item, 'title' | 'content'> & ScopeFields & { note?: string };

/**
 * 规则文件。都适用于所有任务时，每条规则一个小标题；
 * 有限定项目或任务的，按范围分组，每组开头写明只在这个范围里适用。
 */
export function toRulesFile(rules: RuleLike[]): string {
  const section = (rule: RuleLike, level: string) => `${level} ${rule.title.trim() || '未命名规则'}\n\n${rule.content.trim()}`;
  const groups = new Map<string, RuleLike[]>();
  for (const rule of rules) {
    const key = scopeKey(itemScope(rule)) || 'global';
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  if (groups.size === 1 && groups.has('global')) return `# 我的规则\n\n${rules.map((rule) => section(rule, '##')).join('\n\n')}\n`;
  const order = [...groups.keys()].sort((a, b) => (a === 'global' ? -1 : b === 'global' ? 1 : a.localeCompare(b, 'zh-CN')));
  const blocks = order.map((key) => {
    const members = groups.get(key)!;
    const heading = key === 'global' ? '## 所有任务' : `## ${scopeLabel(itemScope(members[0]))}\n\n以下规则只在这个范围里适用，其他场景不适用。`;
    return `${heading}\n\n${members.map((rule) => section(rule, '###')).join('\n\n')}`;
  });
  return `# 我的规则\n\n${blocks.join('\n\n')}\n`;
}

export function toPlainMarkdown(content: string): string {
  return `${content.trim()}\n`;
}

/** 下载用的文件名。 */
export function exportFileName(format: ExportFormat, title: string): string {
  if (format !== 'md') return FORMAT_LABELS[format].file;
  const safe = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'prompt'}.md`;
}

/** 文件放在哪里才能生效。 */
export function placementHint(format: ExportFormat, skillName: string): string {
  switch (format) {
    case 'skill':
      return `放到 ~/.claude/skills/${skillName || '短名'}/SKILL.md，Claude Code 就能使用；放进项目的 .claude/skills/ 则只对这个项目生效`;
    case 'agents':
      return '放到项目根目录，Codex 等工具会读取；放到 ~/.codex/AGENTS.md 则对所有项目生效';
    case 'claude':
      return '放到项目根目录，Claude Code 会读取；放到 ~/.claude/CLAUDE.md 则对所有项目生效';
    default:
      return '';
  }
}

export function variablesHint(content: string): string {
  const count = extractVariables(content).length;
  return count ? `正文里有 ${count} 个变量，导出后原样保留` : '';
}
