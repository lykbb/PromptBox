// 示例对话：模拟一个人两周里和 Codex、Claude Code、ChatGPT 的聊天。
// 里面藏着 5 类重复：两种反复的纠正（用中文、先给结论），三种反复的任务（小红书改写、竞品对比、周报整理），
// 其余是一次性的问题和寒暄，用来演示"只挑出值得保存的"。

import type { Conversation, Tool } from '../types';

type Spec = [tool: Tool, daysAgo: number, turns: string[]];

const SPECS: Spec[] = [
  ['codex', 0, ['给登录接口加上参数校验，手机号和验证码都要检查', '用中文回答']],
  ['claude-code', 0, ['把 utils 里的日期格式化函数补上单元测试', '说中文']],
  ['codex', 1, ['解释一下 useEffect 的依赖数组为什么会导致死循环', '先说结论']],
  ['chatgpt', 1, ['推荐几本讲产品设计的书', '好的', '谢谢']],
  ['codex', 1, ['为什么这个 SQL 查询很慢：SELECT * FROM orders WHERE created_at > now() - interval 7 day', '请用中文', '结论放前面，理由放后面']],
  ['codex', 2, ['把下面这段改成小红书风格：周末去了一家咖啡店，环境很好，咖啡也不错，就是人有点多，适合一个人看书。', '太长了，控制在 200 字']],
  ['claude-code', 2, ['重构一下购物车的状态管理，现在 props 传得太深了', '中文回复我']],
  ['codex', 3, ['评估一下把项目从 webpack 换成 vite 的风险', '别铺垫，直接说结果']],
  ['chatgpt', 3, ['帮我把这段写成小红书的风格：新买的跑鞋穿了一周，脚感很软，回弹也好，就是有点贵。', '太长了，200 字以内']],
  ['claude-code', 3, ['初始化一个 Vite + React 项目', '继续']],
  ['codex', 4, ['这个正则为什么匹配不到中文标点：/[\\p{P}]/', '用中文', '先给结论']],
  ['chatgpt', 5, ['按目标用户、核心功能、定价、优缺点四列对比这几个竞品：Notion、飞书文档、语雀']],
  ['codex', 5, ['改成小红书风格，多用短句：这次去杭州玩了三天，西湖边骑车最舒服，灵隐寺人很多，龙井虾仁一定要吃。', '再短点，控制在 200 字']],
  ['claude-code', 6, ['给首页的图片加上懒加载', '回答用中文']],
  ['codex', 6, ['分析一下这次线上故障的原因，日志在下面：\n[ERROR] connection pool exhausted after 30s', '直接说结论']],
  ['chatgpt', 7, ['把这周的工作记录整理成周报：周一对齐需求，周二写 PRD，周三评审，周四改稿，周五上线。']],
  ['codex', 7, ['写一个脚本，把 docs 目录下的图片批量压缩到 500KB 以内', '用中文讲']],
  ['chatgpt', 8, ['按目标用户、核心功能、定价、优缺点四列对比：Figma、Sketch、即时设计']],
  ['codex', 8, ['把下面这段改成小红书风格：第一次自己做蛋糕，烤箱温度没控制好，边缘有点焦，但味道还行。', '太长了，控制在200字']],
  ['chatgpt', 9, ['解释一下什么是向量数据库，用生活里的例子', '再举一个例子']],
  ['codex', 9, ['比较一下 zustand 和 redux toolkit 在中型项目里的优劣', '先说结论再解释', '换成中文说']],
  ['chatgpt', 10, ['帮我把本周的工作记录整理成周报：完成登录页改版，修了 3 个 bug，和设计对齐首页方案。']],
  ['claude-code', 10, ['把 README 里的安装步骤更新一下，加上 pnpm 的写法', '用中文回答']],
  ['codex', 11, ['小红书风格改写一下：公司楼下新开了一家面馆，牛肉面很香，汤头浓，二十块一碗。']],
  ['chatgpt', 12, ['按目标用户、核心功能、定价、优缺点四列对比：Cursor、Windsurf、Trae']],
  ['codex', 12, ['这个接口返回的时间为什么差了 8 小时', '说中文', '先给结论']],
  ['chatgpt', 13, ['帮我把这段写成小红书风格：周末带爸妈去了植物园，郁金香开得正好，人不算多。']],
  ['codex', 13, ['梳理一下支付模块的调用链路', '结论先说']],
  ['codex', 14, ['给这个表单组件写一下 Storybook 用例', '请用中文回答']],
  ['chatgpt', 15, ['按目标用户、核心功能、定价、优缺点对比下面几个产品：Notion AI、Copilot、Gemini']],
  ['codex', 15, ['看看这段代码有没有内存泄漏', '先说结论，再说原因']],
  ['claude-code', 16, ['把 eslint 的报错都修一下', '用中文说']],
  ['chatgpt', 16, ['把这周的工作记录整理成周报，分完成、问题、计划三部分：评审了两个需求，写完新手引导的方案。']],
];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** 每段对话里，用户的每句话后面都跟一句 AI 回答。 */
export function sampleConversations(now = Date.now()): Conversation[] {
  return SPECS.map(([tool, daysAgo, turns], index) => {
    const start = now - daysAgo * DAY - (index % 6) * 20 * MINUTE - 10 * MINUTE;
    const messages = turns.flatMap((text, turn) => [
      { role: 'user' as const, text, at: start + turn * 2 * MINUTE },
      { role: 'assistant' as const, text: '（AI 的回答）', at: start + turn * 2 * MINUTE + MINUTE },
    ]);
    return { key: `sample:${tool}:${index}`, tool, messages };
  });
}

