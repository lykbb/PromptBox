import { describe, expect, it } from 'vitest';
import type { Candidate, Decision, ScopeFields } from '../types';
import { annotateCandidate, findSimilarItem } from './discover/candidates';
import { coveredLocals, toCandidate } from './discover/external';
import { toRulesFile } from './exporters';
import { buildGenerationPrompt, pickReferences } from './generate';
import { makeBackup, readImportFile } from './importers';
import { itemFromCandidate, newItem } from './items';
import { contentWithScope, readScope, sameScope, scopeKey } from './scope';

const projectA = { scope: 'project', project: '/work/项目 A' } as const;
const projectB = { scope: 'project', project: '/work/项目 B' } as const;
const writing = { scope: 'task', taskType: '写作' } as const;
const raw = {
  type: 'rule', title: '回答规范', content: '回答先给结论，再说明理由。', reason: '在三段对话中明确要求',
  confidence: 'high', count: 4, conversations: 3, tools: ['codex'],
  quotes: [{ tool: 'codex', at: '2026-10-16', text: '这个项目先给结论，再说明理由' }],
};
const candidate = (scope: ScopeFields = projectA): Candidate => toCandidate({ ...raw, ...scope }, 'agent', 1000)!;
const item = (scope: ScopeFields, content = raw.content) => newItem({
  type: 'rule', title: raw.title, content, origin: 'manual', ...scope,
}, 1000);

describe('范围确认与旧数据兼容', () => {
  it('缺失或不合法的范围不会变成全局', () => {
    for (const scope of [undefined, 'other', null, []]) {
      const imported = toCandidate({ ...raw, scope }, 'agent')!;
      expect(imported.scope).toBe('unconfirmed');
      expect(scopeKey(imported)).toBe('');
    }
    expect(sameScope({}, {})).toBe(false);
    expect(scopeKey({ scope: 'project', project: '  ' })).toBe('');
    expect(scopeKey({ scope: 'task' })).toBe('');
  });

  it('只识别旧版本的准确范围备注，保留普通备注', () => {
    expect(readScope({ note: '只适用于项目：/work/项目 A' })).toEqual(projectA);
    expect(readScope({ note: '只在写作时适用' })).toEqual(writing);
    expect(readScope({ note: '朋友建议只在写作时适用' })).toEqual({ scope: 'unconfirmed' });
    expect(readScope({ note: '只在写作时适用', scope: 'global' })).toEqual({ scope: 'global' });
  });

  it('项目标识保留路径、标点和大小写，只忽略两端空格', () => {
    expect(sameScope(projectA, { ...projectA, project: ' /work/项目 A ' })).toBe(true);
    expect(sameScope({ scope: 'project', project: '/work/A' }, { scope: 'project', project: '/work/a' })).toBe(false);
    expect(sameScope({ scope: 'project', project: 'a-b' }, { scope: 'project', project: 'ab' })).toBe(false);
  });

  it('不完整的候选可以预览，但不能保存到库', () => {
    const imported = candidate({ scope: 'project' });
    expect(imported).not.toBeNull();
    expect(() => itemFromCandidate(imported, {
      title: raw.title, content: raw.content, kind: 'rule', tags: [], scope: 'project',
    })).toThrow('请先确认适用范围');
  });
});

describe('同名内容的范围隔离', () => {
  it('不同项目和任务有不同候选签名，同范围重复导入保持签名', () => {
    const ranges: ScopeFields[] = [projectA, projectB, writing, { scope: 'global' }, { scope: 'task', taskType: '编程' }];
    expect(new Set(ranges.map((range) => candidate(range).id)).size).toBe(5);
    expect(candidate(projectA).id).toBe(candidate(projectA).id);
  });

  it('范围确认了只和同范围比；待确认的规则先找出相似的，保存时再按范围决定合并', () => {
    const a = item(projectA);
    const b = item(projectB);
    expect(findSimilarItem(candidate(projectA), [b, a])?.id).toBe(a.id);
    const pending = candidate({});
    annotateCandidate(pending, [b, a], []);
    expect(pending.similarItemId).toBe(b.id);
    expect(pending.similarItemScope).toEqual(projectB);
    const pendingLocal = { ...candidate({}), id: 'local-pending' };
    const locals = [candidate(projectB), { ...candidate(projectA), id: 'local-a' }, pendingLocal];
    // 范围还没确认的本地候选，内容一样就算被覆盖；项目 B 的不算
    expect(coveredLocals(candidate(projectA), locals)).toEqual(['local-a', 'local-pending']);
  });

  it('忽略项目 A 不会隐藏项目 B，即使历史签名碰巧相同', () => {
    const source = candidate(projectA);
    const decision: Decision = { ...projectA, signature: source.id, kind: 'rule', status: 'ignored', title: source.title, text: source.template, at: 1000 };
    const other = { ...candidate(projectB), id: source.id };
    annotateCandidate(other, [], [decision]);
    expect(other.status).toBe('new');
    const same = { ...source, id: 'another-id' };
    annotateCandidate(same, [], [decision]);
    expect(same.status).toBe('ignored');
  });
});

describe('保存、备份、导出和复用', () => {
  it.each([projectA, writing])('范围经过候选保存和备份往返后仍然保留：%j', (range) => {
    const source = candidate(range);
    const saved = itemFromCandidate(source, { title: source.title, content: source.template, kind: source.kind, tags: [], ...range }, 1000);
    expect(readScope(saved)).toEqual(range);
    expect(saved.originDetail).toContain('来自 3 个对话');
    const backup = makeBackup([saved], [], [], 1000);
    const restored = readImportFile(backup.fileName, backup.text);
    expect(restored.kind).toBe('backup');
    if (restored.kind !== 'backup') throw new Error('备份识别失败');
    expect(readScope(restored.items[0])).toEqual(range);
    const exported = toRulesFile(restored.items);
    expect(exported).toContain('其他场景不适用');
    expect(exported).toContain('project' in range ? range.project : range.taskType);
    expect(buildGenerationPrompt('解释问题', restored.items, range)).toContain('其他场景不适用');
  });

  it('旧备份里没写范围的规则按所有任务处理，不丢正文和备注', () => {
    const { scope: _unused, ...old } = { ...item({}), note: '人工备注', content: '旧规则原文' };
    const restored = readImportFile('old.json', JSON.stringify({ app: 'promptbox', items: [old] }));
    if (restored.kind !== 'backup') throw new Error('旧备份识别失败');
    expect(restored.items[0]).toMatchObject({ note: '人工备注', content: '旧规则原文', scope: 'global' });
    expect(toRulesFile(restored.items)).toBe('# 我的规则\n\n## 回答规范\n\n旧规则原文\n');
  });

  it('提示词不分范围，复制和导出用的都是正文本身', () => {
    const prompt = newItem({ type: 'prompt', title: '翻译', content: '翻译成英文：{{原文}}', origin: 'manual', ...projectA });
    expect(prompt.scope).toBe('global');
    expect(prompt.project).toBeUndefined();
  });

  it('规则文件按范围分组，每组写明只在这个范围里适用', () => {
    const file = toRulesFile([item({ scope: 'global' }, '回答使用中文。'), item(writing, '每段不超过 4 行。')]);
    expect(file).toBe(
      '# 我的规则\n\n## 所有任务\n\n### 回答规范\n\n回答使用中文。\n\n## 仅「写作」任务\n\n以下规则只在这个范围里适用，其他场景不适用。\n\n### 回答规范\n\n每段不超过 4 行。\n',
    );
  });

  it('生成只带当前范围和所有任务的规则；没写范围的旧规则算所有任务', () => {
    const entries = [item(projectA, '项目 A 的规则'), item(projectB, '项目 B 的规则'),
      item(writing, '写作专属规则'), item({ scope: 'global' }, '全局中文规则'), item({}, '没写范围的旧规则')];
    const contents = (context?: ScopeFields) => pickReferences('回答规范', entries, context).map((ref) => ref.item.content).sort();
    expect(contents()).toEqual(['全局中文规则', '没写范围的旧规则'].sort());
    expect(contents(projectA)).toEqual(['全局中文规则', '没写范围的旧规则', '项目 A 的规则'].sort());
    expect(contents(writing)).toEqual(['全局中文规则', '没写范围的旧规则', '写作专属规则'].sort());
    const prompt = buildGenerationPrompt('解释问题', entries, projectA);
    expect(prompt).toContain('项目 A 的规则');
    expect(prompt).toContain('没写范围的旧规则');
    expect(prompt).not.toContain('项目 B 的规则');
    expect(prompt).not.toContain('写作专属规则');
  });

  it('独立复制生成结果也带上限制，长示例不会截掉范围', () => {
    expect(contentWithScope({ ...projectA, content: '模型只返回这段正文' })).toContain('适用范围：仅项目「/work/项目 A」。其他场景不适用。');
    const long = { ...item(projectA, '长'.repeat(900)), type: 'prompt' as const };
    const prompt = buildGenerationPrompt('测试', [long], projectA);
    expect(prompt).toContain('仅项目「/work/项目 A」');
    expect(prompt).not.toContain('长'.repeat(601));
  });

  it('选中项目时，其专属规则优先于较新的通用规则', () => {
    const specific = item(projectA, '用 pnpm 管理依赖');
    const globals = Array.from({ length: 6 }, (_, i) => ({ ...item({ scope: 'global' }), updatedAt: 2000 + i }));
    const references = pickReferences('编程', [specific, ...globals], projectA);
    expect(references).toHaveLength(6);
    expect(references[0].item.id).toBe(specific.id);
  });
});
