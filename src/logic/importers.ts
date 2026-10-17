// 导入识别：SKILL.md → 提示词（记住 Skill 名称和描述）；CLAUDE.md、AGENTS.md → 规则；
// 其他 .md → 提示词；.json → PromptBox 备份；其余文件不支持。确认之前不写入。

import type { Candidate, Decision, Item, Version } from '../types';
import { readCandidateFile } from './discover/external';
import { isoDate } from './time';
import { newItem } from './items';
import { itemScopeFields } from './scope';

export interface BackupFile {
  app: 'promptbox';
  formatVersion: 1;
  exportedAt: string;
  items: Item[];
  decisions: Decision[];
  /** 版本历史；早期的备份文件没有这一项。 */
  versions?: Version[];
}

export type ImportEntry =
  | { kind: 'item'; fileName: string; label: string; item: Item }
  | { kind: 'candidates'; fileName: string; label: string; candidates: Candidate[] }
  | { kind: 'backup'; fileName: string; label: string; items: Item[]; decisions: Decision[]; versions: Version[] }
  | { kind: 'unsupported'; fileName: string; label: string };

interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

/** 只认最常见的 YAML 写法：key: value，以及 > 或 | 开头的多行值。 */
export function parseFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!pair) continue;
    let value = pair[2].trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith('>') ? ' ' : '\n');
    } else if (/^".*"$/.test(value)) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    data[pair[1]] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

function firstHeading(body: string): string {
  const match = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  return match ? match[1].trim() : '';
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function readBackup(fileName: string, text: string, now: number): ImportEntry {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: 'unsupported', fileName, label: '不是有效的 JSON 文件' };
  }
  const candidateFile = readCandidateFile(data, now);
  if (candidateFile) {
    const dropped = candidateFile.dropped ? `，${candidateFile.dropped} 条不完整已跳过` : '';
    return candidateFile.candidates.length
      ? { kind: 'candidates', fileName, label: `Agent 提炼的候选（${candidateFile.candidates.length} 条${dropped}）`, candidates: candidateFile.candidates }
      : { kind: 'unsupported', fileName, label: `候选文件里没有完整的候选${dropped}` };
  }
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (first && (first.mapping || Array.isArray(first.chat_messages))) {
    return { kind: 'unsupported', fileName, label: '这是聊天记录导出，请在「发现」的「管理记录来源」里添加' };
  }
  const backup = data as Partial<BackupFile>;
  if (!backup || backup.app !== 'promptbox' || !Array.isArray(backup.items)) {
    return { kind: 'unsupported', fileName, label: '不是 PromptBox 备份' };
  }
  const items = backup.items.filter(isItemLike).map((item) => ({ ...item, ...itemScopeFields(item), deletedAt: undefined }));
  const decisions = Array.isArray(backup.decisions) ? backup.decisions.filter(isDecisionLike) : [];
  const versions = Array.isArray(backup.versions) ? backup.versions.filter(isVersionLike) : [];
  return { kind: 'backup', fileName, label: `备份（${items.length} 条）`, items, decisions, versions };
}

function isItemLike(value: unknown): value is Item {
  const item = value as Item;
  return (
    !!item &&
    typeof item.id === 'string' &&
    (item.type === 'prompt' || item.type === 'rule') &&
    typeof item.title === 'string' &&
    typeof item.content === 'string' &&
    Array.isArray(item.tags) &&
    typeof item.createdAt === 'number' &&
    typeof item.updatedAt === 'number'
  );
}

function isVersionLike(value: unknown): value is Version {
  const version = value as Version;
  return !!version && typeof version.id === 'string' && typeof version.itemId === 'string' && typeof version.number === 'number' && typeof version.content === 'string';
}

function isDecisionLike(value: unknown): value is Decision {
  const decision = value as Decision;
  return !!decision && typeof decision.signature === 'string' && (decision.status === 'saved' || decision.status === 'ignored');
}

/** 识别一个文件，返回预览表格里的一行。 */
export function readImportFile(fileName: string, text: string, now = Date.now()): ImportEntry {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return readBackup(fileName, text, now);
  if (!/\.(md|markdown|txt)$/.test(lower)) return { kind: 'unsupported', fileName, label: '不支持' };

  const { data, body } = parseFrontmatter(text);
  const content = body.trim();
  if (!content) return { kind: 'unsupported', fileName, label: '文件是空的' };
  const upper = fileName.toUpperCase();

  if (upper === 'AGENTS.MD' || upper === 'CLAUDE.MD') {
    const heading = firstHeading(content);
    const title = heading && heading.toUpperCase() !== upper ? heading : fileName;
    const item = newItem({ type: 'rule', title, content, origin: 'import', originDetail: fileName }, now);
    return { kind: 'item', fileName, label: '规则', item };
  }

  if (data.name && data.description) {
    const title = firstHeading(content) || data.name;
    const item = newItem(
      {
        type: 'prompt',
        title,
        content,
        origin: 'import',
        originDetail: `SKILL.md（${data.name}）`,
        skillName: data.name,
        skillDescription: data.description,
      },
      now,
    );
    return { kind: 'item', fileName, label: `提示词（Skill 名称：${data.name}）`, item };
  }

  const title = firstHeading(content) || baseName(fileName);
  const item = newItem({ type: 'prompt', title, content, origin: 'import', originDetail: fileName }, now);
  return { kind: 'item', fileName, label: '提示词', item };
}

export function makeBackup(items: Item[], decisions: Decision[], versions: Version[] = [], now = Date.now()): { fileName: string; text: string } {
  const kept = items.filter((item) => !item.deletedAt).map((item) => ({ ...item, ...itemScopeFields(item) }));
  const ids = new Set(kept.map((item) => item.id));
  const backup: BackupFile = {
    app: 'promptbox',
    formatVersion: 1,
    exportedAt: new Date(now).toISOString(),
    items: kept,
    decisions,
    versions: versions.filter((version) => ids.has(version.itemId)),
  };
  return { fileName: `promptbox-backup-${isoDate(now)}.json`, text: JSON.stringify(backup, null, 2) };
}
