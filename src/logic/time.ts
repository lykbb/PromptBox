// 时间显示。列表里今天显示时刻，更早的显示"昨天"或日期；发现里显示"几天前"。

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function daysBetween(time: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(time)) / DAY);
}

function clock(time: number): string {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function monthDay(time: number): string {
  const date = new Date(time);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 列表和"已自动保存"用：14:32、昨天、10月14日。 */
export function formatListTime(time: number, now = Date.now()): string {
  const days = daysBetween(time, now);
  if (days <= 0) return clock(time);
  if (days === 1) return '昨天';
  return monthDay(time);
}

/** 发现里用：今天、昨天、3 天前、1 周前、10月2日。 */
export function formatAgo(time: number, now = Date.now()): string {
  const days = daysBetween(time, now);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 14) return '1 周前';
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return monthDay(time);
}

/** 原话的时间：今天、昨天，或 10月14日。 */
export function formatQuoteTime(time: number, now = Date.now()): string {
  const days = daysBetween(time, now);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return monthDay(time);
}

/** 版本历史用：今天 14:32、昨天 21:05、10月14日 09:12。 */
export function formatDateTime(time: number, now = Date.now()): string {
  return `${formatQuoteTime(time, now)} ${clock(time)}`;
}

/** 备份文件名里的日期：2026-10-16。 */
export function isoDate(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const DAY_MS = DAY;
