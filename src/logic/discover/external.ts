// 外部提炼的候选：本地 Agent 写的候选文件、接入模型 API 的返回，统一转成「发现」里的候选。
// 字段和 skills/promptbox-extract/references/output-format.md 一致。

import type { Candidate, CandidateOrigin, CandidateScope, ExportHint, ItemType, Quote, Tool } from '../../types';
import { bigrams, dice, hash, normalize } from '../text';
import { readScope, sameScope, scopeKey } from '../scope';

const TOOLS: Tool[] = ['codex', 'claude-code', 'chatgpt', 'claude-web', 'workbuddy', 'codebuddy', 'gemini', 'cursor', 'copilot', 'cline', 'opencode', 'other'];
const SCOPES: CandidateScope[] = ['global', 'project', 'task'];
const EXPORTS: ExportHint['format'][] = ['md', 'skill', 'agents', 'claude'];
const VARIABLE = /\{\{([^{}\n]*)\}\}/g;

type Raw = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positive(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.round(value) : fallback;
}

function toTool(value: unknown): Tool {
  return TOOLS.includes(value as Tool) ? (value as Tool) : 'other';
}

function toTime(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const time = Date.parse(str(value));
  return Number.isNaN(time) ? fallback : time;
}

/** 变量名要 1–20 个字；不合规的变量说明模型或 Agent 写坏了，整条不要。 */
function validTemplate(content: string): boolean {
  return [...content.matchAll(VARIABLE)].every((match) => {
    const name = match[1].trim();
    return name.length >= 1 && name.length <= 20;
  });
}

/** 一条外部候选转成 Candidate；缺了必填项或置信度不够的返回 null。 */
export function toCandidate(value: unknown, origin: Exclude<CandidateOrigin, 'local'>, now = Date.now()): Candidate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Raw;
  const kind = raw.type === 'prompt' || raw.type === 'rule' ? (raw.type as ItemType) : null;
  const title = str(raw.title).slice(0, 24);
  const template = str(raw.content);
  const reason = str(raw.reason);
  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : null;
  if (!kind || !title || !template || !reason || !confidence || !validTemplate(template)) return null;

  const quotes: Quote[] = (Array.isArray(raw.quotes) ? raw.quotes : [])
    .filter((quote): quote is Raw => !!quote && typeof quote === 'object' && !!str((quote as Raw).text))
    .slice(0, 5)
    .map((quote) => ({
      tool: toTool(quote.tool),
      at: toTime(quote.at, now),
      text: str(quote.text).slice(0, 200),
      ...(str(quote.after) ? { after: str(quote.after).slice(0, 200) } : {}),
    }));
  const tools = (Array.isArray(raw.tools) ? raw.tools : []).map(toTool);
  // 提示词不分范围；规则没写清范围的保持待确认，不默认当成所有任务
  const scope = kind === 'prompt' ? 'global' : SCOPES.includes(raw.scope as CandidateScope) ? (raw.scope as CandidateScope) : 'unconfirmed';
  const range = readScope({ scope, project: str(raw.project), taskType: str(raw.taskType) });
  const exportRaw = raw.export && typeof raw.export === 'object' ? (raw.export as Raw) : {};
  const format = EXPORTS.includes(exportRaw.format as ExportHint['format']) ? (exportRaw.format as ExportHint['format']) : undefined;
  const fixes = (Array.isArray(raw.fixes) ? raw.fixes : []).map(str).filter(Boolean);
  const lastAt = toTime(raw.lastSeen, quotes.length ? Math.max(...quotes.map((quote) => quote.at)) : now);

  return {
    id: `${origin}-${hash(JSON.stringify([kind, normalize(title), normalize(template), scopeKey(range) || 'unconfirmed', scope, range.project, range.taskType]))}`,
    kind,
    title,
    template,
    fixes,
    fixCount: 0,
    count: positive(raw.count),
    sessions: positive(raw.conversations),
    days: positive(raw.days),
    tools: tools.length ? [...new Set(tools)] : [...new Set(quotes.map((quote) => quote.tool))],
    quotes,
    lastAt,
    status: 'new',
    origin,
    reason,
    confidence,
    tags: (Array.isArray(raw.tags) ? raw.tags : []).map(str).filter(Boolean).slice(0, 2),
    scope,
    ...(scope === 'project' && str(raw.project) ? { project: str(raw.project) } : {}),
    ...(scope === 'task' && str(raw.taskType) ? { taskType: str(raw.taskType) } : {}),
    ...(kind === 'rule' && str(raw.ruleCategory) ? { ruleCategory: str(raw.ruleCategory) } : {}),
    ...(format
      ? {
          exportHint: {
            format,
            ...(format === 'skill' && str(exportRaw.skillName) ? { skillName: str(exportRaw.skillName), skillDescription: str(exportRaw.skillDescription) } : {}),
          },
        }
      : {}),
    ...(Array.isArray(raw.basedOn) ? { basedOn: raw.basedOn.map(str).filter(Boolean) } : {}),
  };
}

export interface CandidateFile {
  candidates: Candidate[];
  /** 文件里有、但缺必填项或置信度不够而没收的条数。 */
  dropped: number;
  generatedAt?: number;
}

/** 认出 promptbox-extract 写的候选文件。不是这种文件时返回 null。 */
export function readCandidateFile(data: unknown, now = Date.now()): CandidateFile | null {
  if (!data || typeof data !== 'object') return null;
  const file = data as Raw;
  if (file.app !== 'promptbox' || file.kind !== 'candidates' || !Array.isArray(file.candidates)) return null;
  const candidates = file.candidates.map((raw) => toCandidate(raw, 'agent', now)).filter((candidate): candidate is Candidate => !!candidate);
  return {
    candidates,
    dropped: file.candidates.length - candidates.length,
    generatedAt: toTime(file.generatedAt, now),
  };
}

/**
 * 外部候选覆盖了哪些本地候选：同类型，名称相同或模板很像，而且范围一致。
 * 本地规则候选的范围还没确认，内容一样就算被覆盖；范围不同的（项目 A 和项目 B）互不覆盖。
 */
export function coveredLocals(candidate: Candidate, locals: Candidate[]): string[] {
  const grams = bigrams(candidate.template);
  return locals
    .filter((local) => (sameScope(candidate, local) || !scopeKey(local)) && local.kind === candidate.kind && (local.title === candidate.title || dice(grams, bigrams(local.template)) >= 0.6))
    .map((local) => local.id);
}
