// 订阅数据库查询：数据一变，界面跟着更新。

import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (error) => console.error('读取本地数据失败', error),
    });
    return () => subscription.unsubscribe();
    // 查询函数每次渲染都是新的，只按 deps 重新订阅
  }, deps);
  return value;
}
