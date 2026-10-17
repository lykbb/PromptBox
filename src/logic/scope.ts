import type { ScopeFields } from '../types';

/** 兼容旧版本写入的范围备注；没有可靠范围时保留为待确认。 */
export function readScope(value: ScopeFields & { note?: string }): ScopeFields {
  if (value.scope === 'global') return { scope: 'global' };
  if (value.scope === 'project') return { scope: 'project', project: typeof value.project === 'string' ? value.project.trim() : '' };
  if (value.scope === 'task') return { scope: 'task', taskType: typeof value.taskType === 'string' ? value.taskType.trim() : '' };
  if (value.scope !== undefined) return { scope: 'unconfirmed' };
  const note = typeof value.note === 'string' ? value.note.trim() : '';
  const project = /^只适用于项目：([^\n]+)$/.exec(note);
  if (project) return { scope: 'project', project: project[1].trim() };
  const task = /^只在([^\n]+)时适用$/.exec(note);
  if (task) return { scope: 'task', taskType: task[1].trim() };
  return { scope: 'unconfirmed' };
}

/**
 * 库里条目的范围：提示词不分范围；没写范围、或者还是"待确认"的规则按所有任务处理。
 * 只有发现里的规则候选需要用户确认范围。
 */
export function itemScope(value: ScopeFields & { note?: string; type?: string }): ScopeFields {
  if (value.type === 'prompt') return { scope: 'global' };
  const scope = readScope(value);
  return scope.scope === 'unconfirmed' ? { scope: 'global' } : scope;
}

/** 写进条目时用：全局时把旧的项目名、任务类型清掉。 */
export function itemScopeFields(value: ScopeFields & { note?: string; type?: string }): Required<Pick<ScopeFields, 'scope'>> & ScopeFields {
  const scope = itemScope(value);
  return { scope: scope.scope ?? 'global', project: scope.project, taskType: scope.taskType };
}

export function scopeKey(value: ScopeFields & { note?: string }): string {
  const scope = readScope(value);
  if (scope.scope === 'global') return 'global';
  if (scope.scope === 'project' && scope.project) return `project:${scope.project.normalize('NFC')}`;
  if (scope.scope === 'task' && scope.taskType) return `task:${scope.taskType.normalize('NFC')}`;
  return '';
}

export function sameScope(a: ScopeFields & { note?: string }, b: ScopeFields & { note?: string }): boolean {
  const key = scopeKey(a);
  return !!key && key === scopeKey(b);
}

export function scopeLabel(value: ScopeFields & { note?: string }): string {
  const scope = readScope(value);
  if (scope.scope === 'global') return '所有任务';
  if (scope.scope === 'project') return scope.project ? `仅项目「${scope.project}」` : '项目待填写';
  if (scope.scope === 'task') return scope.taskType ? `仅「${scope.taskType}」任务` : '任务类型待填写';
  return '适用范围待确认';
}

export function contentWithScope(value: ScopeFields & { content: string; note?: string }): string {
  const content = value.content.trim();
  if (readScope(value).scope === 'global') return content;
  const condition = scopeKey(value)
    ? `适用范围：${scopeLabel(value)}。其他场景不适用。`
    : '适用范围尚未确认。请先确认适用场景，不要默认用于所有任务。';
  return `${condition}\n\n${content}`;
}

export function matchesScope(value: ScopeFields & { note?: string }, context: ScopeFields): boolean {
  return readScope(value).scope === 'global' || sameScope(value, context);
}
