// 首次打开时的 8 条示例。面试官不用自己的数据，也能看懂库能做什么。

import type { Item, Version } from '../types';
import { newItem } from '../logic/items';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 「周报生成」带 3 个历史版本，用来演示对比和恢复。 */
export function sampleVersions(items: Item[], now = Date.now()): Version[] {
  const weekly = items.find((item) => item.title === '周报生成');
  if (!weekly) return [];
  const v1 = '请根据我本周的工作记录，写一份周报。\n\n本周工作记录：\n{{本周工作}}';
  const v2 =
    '你是一位擅长职场写作的助手。请根据我本周的工作记录，写一份周报。\n\n要求：\n1. 分为「本周完成」「遇到的问题」「下周计划」三部分\n2. 每条不超过 50 字\n\n本周工作记录：\n{{本周工作}}';
  return [
    { id: crypto.randomUUID(), itemId: weekly.id, number: 1, content: v1, source: 'create', createdAt: now - 3 * DAY },
    { id: crypto.randomUUID(), itemId: weekly.id, number: 2, content: v2, source: 'edit', createdAt: now - DAY - 5 * HOUR },
    { id: crypto.randomUUID(), itemId: weekly.id, number: 3, content: weekly.content, source: 'edit', createdAt: weekly.updatedAt },
  ];
}

export function sampleItems(now = Date.now()): Item[] {
  const at = (ago: number) => ({ createdAt: now - ago - 3 * DAY, updatedAt: now - ago });
  return [
    newItem({
      type: 'prompt',
      title: '周报生成',
      content:
        '你是一位擅长职场写作的助手。请根据我本周的工作记录，写一份周报。\n\n要求：\n1. 分为「本周完成」「遇到的问题」「下周计划」三部分\n2. 每条不超过 30 字，突出结果和数据\n3. 语气：{{语气}}\n\n本周工作记录：\n{{本周工作}}',
      tags: ['写作', '工作'],
      note: 'Claude 和 GPT 都试过，工作记录写得越具体效果越好',
      origin: 'sample',
      isSample: true,
      ...at(HOUR),
    }),
    newItem({
      type: 'prompt',
      title: '需求文档评审',
      content:
        '# 需求文档评审\n\n按以下顺序评审用户提供的需求文档：\n\n1. 目标：是否写清楚要解决谁的什么问题\n2. 范围：做什么、不做什么是否明确\n3. 流程：主流程和异常流程是否完整\n4. 验收：每条需求能否被测试验证\n\n输出：先给总体结论，再按「问题 / 位置 / 建议」逐条列出。',
      tags: ['产品'],
      skillName: 'prd-review',
      skillDescription: '按目标、范围、流程、验收四个维度评审需求文档。在用户要求评审 PRD 或需求文档时使用。',
      origin: 'sample',
      originDetail: 'SKILL.md（prd-review）',
      isSample: true,
      ...at(4 * HOUR),
    }),
    newItem({
      type: 'rule',
      title: '前端项目规则',
      content: '- 使用 TypeScript，不写 any\n- 组件放在 src/components，一个组件一个文件\n- 提交前先跑测试',
      tags: ['编程'],
      origin: 'sample',
      isSample: true,
      ...at(DAY + 2 * HOUR),
    }),
    newItem({
      type: 'prompt',
      title: '小红书标题 10 连',
      content:
        '围绕「{{主题}}」写 10 个小红书标题。\n\n要求：\n1. 每个不超过 20 字\n2. 风格各不相同：提问、数字、反差、情绪各占几个\n3. 不用"绝绝子""yyds"这类过时的词',
      tags: ['写作'],
      origin: 'sample',
      isSample: true,
      ...at(DAY + 5 * HOUR),
    }),
    newItem({
      type: 'prompt',
      title: '代码审查清单',
      content: '请从正确性、可读性、性能、安全四个方面审查下面的代码，按严重程度排序，每条给出修改建议。\n\n{{代码}}',
      tags: ['编程'],
      origin: 'sample',
      isSample: true,
      ...at(2 * DAY),
    }),
    newItem({
      type: 'prompt',
      title: '中英翻译润色',
      content: '把下面的中文翻译成自然的英文，保留专业术语，不逐字直译。\n\n{{原文}}',
      tags: ['写作'],
      origin: 'sample',
      isSample: true,
      ...at(3 * DAY),
    }),
    newItem({
      type: 'prompt',
      title: '会议纪要整理',
      content: '把会议记录整理成「结论 / 待办 / 负责人 / 截止时间」四栏，记录里没提到的写"未定"。\n\n{{会议记录}}',
      tags: ['工作'],
      origin: 'sample',
      isSample: true,
      ...at(4 * DAY),
    }),
    newItem({
      type: 'rule',
      title: '我的写作偏好',
      content: '不用套话和空话；每段不超过 4 行；能用列表就不用长段落。',
      tags: ['写作'],
      origin: 'sample',
      isSample: true,
      ...at(6 * DAY),
    }),
  ].map((item) => ({
    ...item,
    ...(item.type === 'prompt' ? { scope: 'global' as const }
      : item.title === '前端项目规则' ? { scope: 'project' as const, project: '示例前端项目' }
        : { scope: 'task' as const, taskType: '写作' }),
  }));
}
