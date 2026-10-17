// 从一段对话里挑出两种话：任务（让 AI 做一件事）和纠正（对 AI 的回答提要求）。
// 其余的寒暄、"继续"、命令都丢掉。只保留每句的前一段文字，够做比较和展示就行。

import type { Conversation, Utterance } from '../../types';

const MAX_STORED = 400;

const ACKNOWLEDGEMENT =
  /^(好的?|好滴|好呀|ok|okay|嗯+|是的?|对的?|行|可以|继续|接着|go on|continue|谢谢|多谢|thanks?|thx|收到|明白|懂了|不错|很好|完美|yes|no|不用了|没问题)[!！。.~～\s]*$/i;

const CORRECTION_CUE =
  /(太长|太短|太多|太少|啰嗦|简洁|简短|精简|短一?点|长一?点|详细一?点|具体一?点|不要|不用|别再|别用|别|少用|多用|中文|英文|先说|先给|结论|直接|不对|错了|不是这样|重新|再改|改成|换成|换个|控制在|不超过|以内|格式|表格|分点|列表|口语|正式|语气|记住|以后|每次|总是|一直|记得|注意|套话|废话|emoji|表情)|\b(too long|shorter|concise|don't|do not|stop|instead|in chinese|in english|always|never|remember)\b/i;

const TASK_START =
  /^(帮我|帮忙|麻烦|请|给我|把|将|写|生成|总结|翻译|分析|整理|改写|改成|设计|列出|列一|做一个|做个|创建|新建|优化|检查|评估|比较|对比|解释|梳理|review|write|create|generate|summari[sz]e|translate|explain|fix|refactor)/i;

function cleanText(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function length(text: string): number {
  return Array.from(text).length;
}

function clipStored(text: string): string {
  const chars = Array.from(text);
  return chars.length > MAX_STORED ? chars.slice(0, MAX_STORED).join('') : text;
}

export function isNoise(text: string): boolean {
  if (length(text) < 2) return true;
  if (ACKNOWLEDGEMENT.test(text)) return true;
  if (/^\/[a-z]/i.test(text)) return true;
  return /^[\d\s\p{P}\p{S}]+$/u.test(text);
}

export function looksLikeCorrection(text: string): boolean {
  return length(text) <= 80 && CORRECTION_CUE.test(text);
}

export function looksLikeTask(text: string): boolean {
  return length(text) >= 6 && TASK_START.test(text);
}

/** 第一句通常就是任务；之后的话紧跟在 AI 回答后面、又像在提要求的，算纠正。 */
export function extractUtterances(conversation: Conversation, isSample = false): Utterance[] {
  const utterances: Utterance[] = [];
  let firstHandled = false;
  let afterAssistant = false;
  let previous: Utterance | null = null;

  conversation.messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      afterAssistant = true;
      return;
    }
    const text = cleanText(message.text);
    if (isNoise(text)) {
      afterAssistant = false;
      previous = null;
      return;
    }
    const isFirst = !firstHandled;
    firstHandled = true;
    const base = { id: `${conversation.key}#${index}`, tool: conversation.tool, session: conversation.key, at: message.at, isSample };

    if (!isFirst && afterAssistant && looksLikeCorrection(text)) {
      const correction: Utterance = { ...base, role: 'correction', text: clipStored(text) };
      utterances.push(correction);
      // 紧跟在任务后面的纠正，记到任务上，之后可能合并进模板
      if (previous?.role === 'task' && !previous.after) {
        previous.after = correction.text;
        previous.afterId = correction.id;
      }
      previous = correction;
    } else if (isFirst || looksLikeTask(text)) {
      const task: Utterance = { ...base, role: 'task', text: clipStored(text) };
      utterances.push(task);
      previous = task;
    } else {
      previous = null;
    }
    afterAssistant = false;
  });
  return utterances;
}
