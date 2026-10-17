// 底部提示条：操作结果，必要时带一个撤销或跳转。

import { useEffect } from 'react';

export interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  duration?: number;
}

export function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, toast.duration ?? (toast.action ? 6000 : 2600));
    return () => window.clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            onDone();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
