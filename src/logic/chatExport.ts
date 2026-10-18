// 网页版聊天记录导出：ChatGPT 和 Claude 都只能在设置里申请导出，邮件里下载一个 zip，里面有 conversations.json。
// 两家都没有让第三方直接读取聊天记录的接口，所以这里认导出文件：拖进来的文件是聊天记录就去扫描，不是就交给普通导入。

import { filesInZip } from './unzip';

export type ChatExportKind = 'chatgpt' | 'claude';

export const CHAT_EXPORT_NAMES: Record<ChatExportKind, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };

/** 官方的导出说明。 */
export const CHAT_EXPORT_HELP: Record<ChatExportKind, string> = {
  chatgpt: 'https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data',
  claude: 'https://support.claude.com/en/articles/9450526-export-your-claude-data',
};

const EXPORT_FILE = /^conversations(-\d+)?\.json$/i;

/** 看文件开头认出是哪家的导出：ChatGPT 的每段对话有 mapping，Claude 的有 chat_messages。 */
export async function sniffChatExport(blob: Blob): Promise<ChatExportKind | null> {
  const head = await blob.slice(0, 256 * 1024).text();
  if (!/^\s*\[/.test(head)) return null;
  if (/"mapping"\s*:/.test(head)) return 'chatgpt';
  if (/"chat_messages"\s*:/.test(head)) return 'claude';
  return null;
}

export interface ChatExport {
  kinds: ChatExportKind[];
  /** 要扫描的文件，名字前面加上是哪家的，ChatGPT 和 Claude 的导出就不会互相覆盖。 */
  files: File[];
}

/** 文件是网页版聊天记录导出（zip 或 conversations.json）时取出要扫描的文件，不是就返回 null。 */
export async function readChatExport(file: File): Promise<ChatExport | null> {
  let candidates: File[];
  if (/\.zip$/i.test(file.name)) {
    try {
      candidates = await filesInZip(file, (name) => EXPORT_FILE.test(name));
    } catch {
      return null;
    }
  } else if (/\.json$/i.test(file.name)) {
    candidates = [file];
  } else {
    return null;
  }
  const kinds = new Set<ChatExportKind>();
  const files: File[] = [];
  for (const candidate of candidates) {
    const kind = await sniffChatExport(candidate);
    if (!kind) continue;
    kinds.add(kind);
    // 沿用原文件的修改时间：同一份导出再拖一次，扫描时会认出没变，直接跳过
    files.push(new File([candidate], `${CHAT_EXPORT_NAMES[kind]} · ${candidate.name}`, { type: 'application/json', lastModified: file.lastModified }));
  }
  return files.length ? { kinds: [...kinds], files } : null;
}
