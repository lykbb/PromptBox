// 提炼 Skill 的文件，打包时直接取仓库里 skills/promptbox-extract 下的原文件，网页和仓库永远是同一份。

import { makeZip } from './logic/zip';

// 这个模块只在点「下载 Skill」时才加载，Skill 的文件不进首页的包

const files = import.meta.glob(
  ['/skills/promptbox-extract/SKILL.md', '/skills/promptbox-extract/references/*.md', '/skills/promptbox-extract/scripts/*.py'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** 解压后得到 promptbox-extract 文件夹，放进 Agent 的 skills 目录就能用。 */
export function skillZip(): Uint8Array {
  const entries = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => ({
      path: path.replace('/skills/', ''),
      content,
      executable: path.endsWith('.py'),
    }));
  return makeZip(entries);
}

export const SKILL_FILE_COUNT = Object.keys(files).length;
