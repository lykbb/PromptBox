import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractVariables, fillVariables, segmentVariables } from './variables';
import { queryTerms, searchItems } from './search';
import {
  exportFileName,
  toRulesFile,
  toSkillFile,
  validateSkillDescription,
  validateSkillName,
  variablesHint,
} from './exporters';
import { makeBackup, parseFrontmatter, readImportFile } from './importers';
import { formatAgo, formatListTime } from './time';
import { applyFilter, tagCounts } from './items';
import { sampleItems } from '../samples/library';
import { chatModels, listModels, PROVIDERS } from './llm';
import { readChatExport, sniffChatExport } from './chatExport';
import { filesInZip } from './unzip';
import { crc32, makeZip } from './zip';

describe('变量', () => {
  const text = '语气：{{语气}}\n记录：{{本周工作}}\n再说一次 {{语气}}，{{ 空格 }}';

  it('按出现顺序，同名只算一次', () => {
    expect(extractVariables(text)).toEqual(['语气', '本周工作', '空格']);
  });

  it('没填的保留原样', () => {
    expect(fillVariables(text, { 语气: '正式' })).toBe('语气：正式\n记录：{{本周工作}}\n再说一次 正式，{{ 空格 }}');
  });

  it('名称超过 20 个字或带换行不算变量', () => {
    expect(extractVariables('{{' + '字'.repeat(21) + '}} {{a\nb}} {{}}')).toEqual([]);
  });

  it('切片用于高亮', () => {
    expect(segmentVariables('写{{主题}}的标题', { 主题: '咖啡' })).toEqual([
      { text: '写' },
      { text: '咖啡', variable: '主题', filled: true },
      { text: '的标题' },
    ]);
  });
});

describe('搜索', () => {
  const items = sampleItems(Date.now());

  it('一句需求也能找到相关内容', () => {
    const hits = searchItems(items, '想写一篇小红书，介绍周末去的咖啡店');
    expect(hits[0].item.title).toBe('小红书标题 10 连');
    expect(hits[0].level).toBe('high');
  });

  it('关键词命中标题排在前面', () => {
    expect(searchItems(items, '周报')[0].item.title).toBe('周报生成');
  });

  it('一句话里零星的常用字不会带出不相干的内容', () => {
    const titles = searchItems(items, '想写一篇小红书，介绍周末去的咖啡店').map((hit) => hit.item.title);
    expect(titles).toEqual(['小红书标题 10 连']);
  });

  it('单个字按原样查找', () => {
    expect(searchItems(items, '译').map((hit) => hit.item.title)).toEqual(['中英翻译润色']);
  });

  it('标签和规则也能搜到', () => {
    const titles = searchItems(items, '编程').map((hit) => hit.item.title);
    expect(titles).toContain('前端项目规则');
    expect(titles).toContain('代码审查清单');
  });

  it('切片去掉客气话和虚词', () => {
    expect(queryTerms('帮我写一份周报')).toEqual(['周报']);
    expect(queryTerms('React 组件')).toEqual(['react', '组件']);
  });
});

describe('导出', () => {
  it('SKILL.md 名称规则', () => {
    expect(validateSkillName('weekly-report')).toBe('');
    expect(validateSkillName('Weekly')).not.toBe('');
    expect(validateSkillName('-report')).not.toBe('');
    expect(validateSkillName('claude-helper')).not.toBe('');
    expect(validateSkillName('a'.repeat(65))).not.toBe('');
    expect(validateSkillDescription('  ')).not.toBe('');
    expect(validateSkillDescription('写周报。<b>加粗</b>')).not.toBe('');
  });

  it('SKILL.md 头信息，含冒号时加引号', () => {
    expect(toSkillFile('正文', 'weekly-report', '写周报。在用户要求写周报时使用。')).toBe(
      '---\nname: weekly-report\ndescription: 写周报。在用户要求写周报时使用。\n---\n\n正文\n',
    );
    expect(toSkillFile('正文', 'a', 'Use when: weekly')).toContain('description: "Use when: weekly"');
  });

  it('多条规则合成一个文件', () => {
    expect(toRulesFile([{ title: '回答用中文', content: '回答使用中文。', scope: 'global' }, { title: '先给结论', content: '先给结论。', scope: 'global' }])).toBe(
      '# 我的规则\n\n## 回答用中文\n\n回答使用中文。\n\n## 先给结论\n\n先给结论。\n',
    );
  });

  it('文件名和变量提醒', () => {
    expect(exportFileName('md', '周报 生成/v2')).toBe('周报-生成-v2.md');
    expect(exportFileName('skill', '周报')).toBe('SKILL.md');
    expect(variablesHint('{{a}}{{b}}')).toBe('正文里有 2 个变量，导出后原样保留');
    expect(variablesHint('没有变量')).toBe('');
  });
});

describe('导入', () => {
  it('读头信息', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: "x: y"\n---\n正文')).toEqual({ data: { name: 'a', description: 'x: y' }, body: '正文' });
    expect(parseFrontmatter('---\ndescription: >\n  第一行\n  第二行\n---\n正文').data.description).toBe('第一行 第二行');
  });

  it('SKILL.md 识别成提示词并记住名称', () => {
    const entry = readImportFile('SKILL.md', '---\nname: meeting-notes\ndescription: 整理会议纪要\n---\n\n# 会议纪要\n\n把记录整理成四栏');
    expect(entry.kind).toBe('item');
    if (entry.kind !== 'item') return;
    expect(entry.label).toBe('提示词（Skill 名称：meeting-notes）');
    expect(entry.item).toMatchObject({ type: 'prompt', title: '会议纪要', skillName: 'meeting-notes', origin: 'import' });
  });

  it('AGENTS.md 识别成规则', () => {
    const entry = readImportFile('AGENTS.md', '# AGENTS.md\n\n- 用中文');
    expect(entry.kind === 'item' && entry.item.type).toBe('rule');
    expect(entry.kind === 'item' && entry.item.title).toBe('AGENTS.md');
  });

  it('其他 .md 是提示词，图片不支持', () => {
    const entry = readImportFile('翻译.md', '把下面的中文翻译成英文');
    expect(entry.kind === 'item' && entry.item.title).toBe('翻译');
    expect(readImportFile('截图.png', '').kind).toBe('unsupported');
  });

  it('备份导出再导入，内容一致', () => {
    const items = sampleItems(Date.now());
    const versions = [{ id: 'v1', itemId: items[0].id, number: 1, content: '旧版', source: 'create' as const, createdAt: 1 }];
    const backup = makeBackup(items, [], versions, new Date('2026-10-16T10:00:00').getTime());
    expect(backup.fileName).toBe('promptbox-backup-2026-10-16.json');
    const entry = readImportFile(backup.fileName, backup.text);
    expect(entry.kind).toBe('backup');
    if (entry.kind === 'backup') {
      expect(entry.items).toEqual(items.map((item) => ({ ...item, deletedAt: undefined })));
      expect(entry.versions).toEqual(versions);
    }
  });

  it('不是 PromptBox 的 JSON', () => {
    expect(readImportFile('a.json', '{"hello":1}')).toMatchObject({ kind: 'unsupported', label: '不是 PromptBox 备份' });
  });
});

describe('时间和筛选', () => {
  const now = new Date('2026-10-16T15:00:00').getTime();

  it('列表时间', () => {
    expect(formatListTime(new Date('2026-10-16T14:32:00').getTime(), now)).toBe('14:32');
    expect(formatListTime(new Date('2026-10-15T09:00:00').getTime(), now)).toBe('昨天');
    expect(formatListTime(new Date('2026-10-13T09:00:00').getTime(), now)).toBe('10月13日');
  });

  it('发现里的时间', () => {
    expect(formatAgo(new Date('2026-10-14T09:00:00').getTime(), now)).toBe('2 天前');
    expect(formatAgo(new Date('2026-10-09T09:00:00').getTime(), now)).toBe('1 周前');
  });

  it('示例库的筛选和标签计数', () => {
    const items = sampleItems(now);
    expect(applyFilter(items, { kind: 'type', type: 'prompt' })).toHaveLength(6);
    expect(applyFilter(items, { kind: 'type', type: 'rule' })).toHaveLength(2);
    // 次数相同时，最近用过的标签在前
    expect(tagCounts(items)).toEqual([
      { tag: '写作', count: 4 },
      { tag: '工作', count: 2 },
      { tag: '编程', count: 2 },
      { tag: '产品', count: 1 },
    ]);
  });
});

describe('按风格生成', () => {
  const items = sampleItems(Date.now());

  it('挑出相关提示词，带上选定任务和通用的规则', async () => {
    const { pickReferences } = await import('./generate');
    const general = { ...items[2], id: 'general', title: '回答用中文', content: '回答使用中文。', tags: [], scope: 'global' as const };
    const references = pickReferences('想写一篇小红书，介绍周末去的咖啡店', [...items, general], { scope: 'task', taskType: '写作' });
    // 「前端项目规则」打的是「编程」标签，和写小红书无关，不带
    expect(references.map((reference) => [reference.item.title, reference.reason])).toEqual([
      ['小红书标题 10 连', '提示词 · 高度相关'],
      ['我的写作偏好', '规则 · 仅「写作」任务'],
      ['回答用中文', '规则 · 通用，每次都会带上'],
    ]);
  });

  it('没选范围时，参考的提示词带着「写作」标签，「写作」任务的规则也带上', async () => {
    const { buildGenerationPrompt, pickReferences } = await import('./generate');
    const references = pickReferences('想写一篇小红书，介绍周末去的咖啡店', items);
    expect(references.map((reference) => reference.item.title)).toEqual(['小红书标题 10 连', '我的写作偏好']);
    const prompt = buildGenerationPrompt('想写一篇小红书', references.map((reference) => reference.item));
    expect(prompt).toContain('- 不用套话和空话；每段不超过 4 行；能用列表就不用长段落。（适用范围：仅「写作」任务，其他场景不适用）');
    expect(prompt).not.toContain('使用 TypeScript');
  });

  it('生成指令里有任务、示例、习惯和输出要求', async () => {
    const { buildGenerationPrompt } = await import('./generate');
    const prompt = buildGenerationPrompt('写探店笔记', items.filter((item) => item.title === '小红书标题 10 连' || item.title === '前端项目规则'), { scope: 'project', project: '示例前端项目' });
    expect(prompt).toContain('任务：写探店笔记');
    expect(prompt).toContain('【示例 1：小红书标题 10 连】');
    expect(prompt).toContain('- 使用 TypeScript，不写 any；组件放在 src/components，一个组件一个文件；提交前先跑测试（适用范围：仅项目「示例前端项目」，其他场景不适用）');
    expect(prompt).toContain('{{变量名}}');
  });

  it('去掉模型包的代码块', async () => {
    const { cleanGenerated, titleFromNeed } = await import('./generate');
    expect(cleanGenerated('```markdown\n你是一位博主\n```')).toBe('你是一位博主');
    expect(titleFromNeed('想写一篇小红书，介绍周末去的咖啡店')).toBe('想写一篇小红书');
  });
});

describe('版本对比', () => {
  it('按行标出新增和删除', async () => {
    const { diffLines, diffStats } = await import('./diff');
    const before = '要求：\n1. 分三部分\n2. 每条不超过 50 字\n\n记录：';
    const after = '要求：\n1. 分三部分\n2. 每条不超过 30 字，突出结果\n3. 语气：{{语气}}\n\n记录：';
    const lines = diffLines(before, after);
    expect(lines.filter((line) => line.kind !== 'same')).toEqual([
      { kind: 'del', text: '2. 每条不超过 50 字' },
      { kind: 'add', text: '2. 每条不超过 30 字，突出结果' },
      { kind: 'add', text: '3. 语气：{{语气}}' },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it('完全相同时没有改动', async () => {
    const { diffLines, diffStats } = await import('./diff');
    expect(diffStats(diffLines('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0 });
  });
});

describe('打包 Skill', () => {
  it('CRC32 和标准值一致', async () => {
    const { crc32 } = await import('./zip');
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('zip 的文件头和目录数量正确', async () => {
    const { makeZip } = await import('./zip');
    const zip = makeZip([
      { path: 'a/SKILL.md', content: '技能' },
      { path: 'a/scripts/run.py', content: 'print(1)', executable: true },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });
});

describe('AI 提炼', () => {
  const now = new Date('2026-10-16T15:00:00+08:00').getTime();

  it('交给模型的组：每条本地候选一组，名称只留在界面上，原话截短', async () => {
    const { buildRefineGroups, groupsPayload } = await import('./refine');
    const { sampleConversations } = await import('../samples/conversations');
    const { extractUtterances } = await import('./discover/classify');
    const { buildCandidates } = await import('./discover/candidates');
    const utterances = sampleConversations(now).flatMap((conversation) => extractUtterances(conversation, true));
    const locals = buildCandidates(utterances, sampleItems(now), []);
    const groups = buildRefineGroups(locals);
    expect(groups).toHaveLength(5);
    expect(groups.every((group) => locals.some((local) => local.id === group.id && local.title === group.title))).toBe(true);
    const payload = JSON.parse(groupsPayload(groups));
    expect(payload[0]).toHaveProperty('localTemplate');
    expect(payload[0]).not.toHaveProperty('title');
    expect(payload[0].quotes[0]).toHaveProperty('date');
  });

  it('读模型的回答：数字从组里补，不认识的组和不合格的候选丢掉', async () => {
    const { parseRefineResponse } = await import('./refine');
    const groups = [
      { id: 'prompt-a', kind: 'task' as const, count: 6, conversations: 6, days: 5, tools: ['codex' as const], quotes: [{ tool: 'codex' as const, at: now, text: '改成小红书风格：……' }] },
      { id: 'rule-chinese', kind: 'correction' as const, count: 12, conversations: 10, days: 9, tools: ['codex' as const, 'claude-code' as const], quotes: [{ tool: 'codex' as const, at: now - 1000, text: '用中文回答' }] },
      { id: 'prompt-b', kind: 'task' as const, count: 3, conversations: 3, days: 3, tools: ['chatgpt' as const], quotes: [{ tool: 'chatgpt' as const, at: now, text: '看看这个报错' }] },
    ];
    const answer = '```json\n' + JSON.stringify({
      candidates: [
        { type: 'prompt', title: '小红书风格改写', content: '把下面这段改成小红书风格：\n{{内容}}', reason: '6 次', confidence: 'high', count: 999, basedOn: ['prompt-a'] },
        { type: 'rule', title: '回答用中文', content: '回答使用中文。', reason: '12 次纠正', confidence: 'high', scope: 'global', basedOn: ['rule-chinese', 'nope'] },
        { type: 'rule', title: '编出来的', content: '不存在', reason: '无', confidence: 'high', basedOn: ['nope'] },
        { type: 'prompt', title: '没把握', content: '随便', reason: '1 次', confidence: 'low', basedOn: ['prompt-b'] },
      ],
      skipped: [{ id: 'prompt-b', why: '针对具体报错，一次性的' }, { id: 'prompt-a', why: '矛盾的' }],
    }) + '\n```';
    const outcome = parseRefineResponse(answer, groups, now);
    expect(outcome.candidates.map((candidate) => [candidate.title, candidate.count, candidate.origin])).toEqual([
      ['小红书风格改写', 6, 'ai'],
      ['回答用中文', 12, 'ai'],
    ]);
    expect(outcome.candidates[1].basedOn).toEqual(['rule-chinese']);
    expect(outcome.candidates[1].scope).toBe('global');
    expect(outcome.skipped).toEqual({ 'prompt-b': '针对具体报错，一次性的' });
  });

  it('模型的回答变成每条候选的意见：几条合成一条时，其余标成重复；没提到的不给意见', async () => {
    const { adviceFromOutcome, parseRefineResponse } = await import('./refine');
    const group = (id: string, title: string) => ({ id, title, kind: 'task' as const, count: 3, conversations: 3, days: 3, tools: ['codex' as const], quotes: [{ tool: 'codex' as const, at: now, text: title }] });
    const groups = [group('a', '周报整理'), group('b', '整理周报'), group('c', '看报错'), group('d', '没提到')];
    const answer = JSON.stringify({
      candidates: [{ type: 'prompt', title: '周报生成', content: '把这周的工作整理成周报：{{本周工作}}', reason: '3 周里 6 次', confidence: 'high', tags: ['工作'], basedOn: ['a', 'b'] }],
      skipped: [{ id: 'c', why: '针对具体报错' }],
    });
    const advice = adviceFromOutcome(parseRefineResponse(answer, groups, now), groups, now);
    expect(advice.a).toMatchObject({ verdict: 'keep', title: '周报生成', content: '把这周的工作整理成周报：{{本周工作}}', kind: 'prompt', reason: '3 周里 6 次', tags: ['工作'] });
    expect(advice.b).toEqual({ verdict: 'duplicate', of: 'a', ofTitle: '周报整理', at: now });
    expect(advice.c).toEqual({ verdict: 'skip', reason: '针对具体报错', at: now });
    expect(advice.d).toBeUndefined();
  });

  it('不是 JSON 时给出能看懂的错误', async () => {
    const { parseRefineResponse } = await import('./refine');
    expect(() => parseRefineResponse('抱歉，我无法完成', [])).toThrow('没有按要求返回 JSON');
  });

  it('系统提示里带着 Skill 的同一份提炼标准', async () => {
    const { REFINE_SYSTEM } = await import('./refine');
    expect(REFINE_SYSTEM).toContain('大多数对话是一次性的');
    expect(REFINE_SYSTEM).toContain('basedOn');
  });
});

describe('模型列表', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('去掉向量、语音这类不能对话的模型，去重排序', () => {
    expect(chatModels(['text-embedding-3-small', 'gpt-b', 'models/gemini-x', 'whisper-1', 'gpt-a', 'gpt-a', 'tts-1'])).toEqual(['gemini-x', 'gpt-a', 'gpt-b']);
  });

  it('全被去掉时保留原列表', () => {
    expect(chatModels(['bge-m3', 'text-embedding-v3'])).toEqual(['bge-m3', 'text-embedding-v3']);
  });

  it('读到列表', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })));
    expect(await listModels({ provider: 'deepseek', apiKey: 'k', model: '' })).toEqual({ models: ['deepseek-chat', 'deepseek-reasoner'] });
  });

  it('Key 不对时说出原因', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
    const result = await listModels({ provider: 'deepseek', apiKey: 'k', model: '' });
    expect(result.models).toEqual([]);
    expect(result.error).toContain('Key 无效');
  });

  it('自建地址连不上时提示开启跨域', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await listModels({ provider: 'custom', apiKey: 'k', model: '', baseUrl: 'https://example.com/v1' });
    expect(result.error).toContain('CORS');
  });

  it('超时时说明是等太久，不说连不上', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('signal timed out', 'TimeoutError');
    });
    const result = await listModels({ provider: 'deepseek', apiKey: 'k', model: '' });
    expect(result.error).toContain('等了太久');
  });

  it('自己取消的请求照常中断，不当成错误', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(listModels({ provider: 'deepseek', apiKey: 'k', model: '' })).rejects.toThrow('aborted');
  });

  it('Anthropic 带上网页直接调用需要的请求头', async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [{ id: 'claude-x' }] }));
    });
    await listModels({ provider: 'anthropic', apiKey: 'sk-ant', model: '' });
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['x-api-key']).toBe('sk-ant');
  });

  it('每家服务商只出现一次，地址都是 https', () => {
    expect(new Set(PROVIDERS.map((provider) => provider.id)).size).toBe(PROVIDERS.length);
    for (const provider of PROVIDERS.filter((item) => item.id !== 'custom')) expect(provider.baseUrl).toMatch(/^https:\/\//);
  });
});

/** 测试用：做一个用 deflate 压缩的单文件 zip，和真实的导出一样。 */
async function deflateZip(path: string, content: string): Promise<Blob> {
  const encoder = new TextEncoder();
  const name = encoder.encode(path);
  const raw = encoder.encode(content);
  const packed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, 8, true);
  local.setUint32(14, crc32(raw), true);
  local.setUint32(18, packed.length, true);
  local.setUint32(22, raw.length, true);
  local.setUint16(26, name.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(10, 8, true);
  central.setUint32(16, crc32(raw), true);
  central.setUint32(20, packed.length, true);
  central.setUint32(24, raw.length, true);
  central.setUint16(28, name.length, true);
  const localSize = 30 + name.length + packed.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + name.length, true);
  end.setUint32(16, localSize, true);
  return new Blob([local, name, packed, central, name, end]);
}

describe('网页版聊天记录导出', () => {
  const chatgpt = JSON.stringify([{ title: '周报', create_time: 1, mapping: { a: { message: null } } }]);
  const claude = JSON.stringify([{ uuid: 'c1', name: '周报', account: { uuid: 'u' }, chat_messages: [] }]);

  it('从不压缩的 zip 里取出文件，不管在哪个目录', async () => {
    const zip = new Blob([makeZip([{ path: 'readme.txt', content: 'x' }, { path: 'export/conversations.json', content: chatgpt }]) as BlobPart]);
    const files = await filesInZip(zip, (name) => name === 'conversations.json');
    expect(files.map((file) => file.name)).toEqual(['conversations.json']);
    expect(await files[0].text()).toBe(chatgpt);
  });

  it('从 deflate 压缩的 zip 里取出文件', async () => {
    const zip = await deflateZip('conversations.json', claude.repeat(1));
    const files = await filesInZip(zip, (name) => name === 'conversations.json');
    expect(await files[0].text()).toBe(claude);
  });

  it('认出是哪家的导出', async () => {
    expect(await sniffChatExport(new Blob([chatgpt]))).toBe('chatgpt');
    expect(await sniffChatExport(new Blob([claude]))).toBe('claude');
    expect(await sniffChatExport(new Blob([JSON.stringify({ app: 'promptbox', items: [] })]))).toBeNull();
  });

  it('zip 和 conversations.json 都能认，改名后两家不会互相覆盖', async () => {
    const fromZip = await readChatExport(new File([makeZip([{ path: 'conversations.json', content: chatgpt }]) as BlobPart], 'chatgpt-export.zip'));
    expect(fromZip?.kinds).toEqual(['chatgpt']);
    expect(fromZip?.files[0].name).toBe('ChatGPT · conversations.json');
    const fromJson = await readChatExport(new File([claude], 'conversations.json'));
    expect(fromJson?.kinds).toEqual(['claude']);
    expect(fromJson?.files[0].name).toBe('Claude · conversations.json');
  });

  it('不是聊天记录时交给普通导入', async () => {
    expect(await readChatExport(new File([JSON.stringify({ app: 'promptbox', items: [] })], 'backup.json'))).toBeNull();
    expect(await readChatExport(new File([makeZip([{ path: 'notes.md', content: '# x' }]) as BlobPart], 'notes.zip'))).toBeNull();
    expect(await readChatExport(new File(['not a zip'], 'broken.zip'))).toBeNull();
    expect(await readChatExport(new File(['# 标题'], 'prompt.md'))).toBeNull();
  });
});
