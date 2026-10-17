// 弹窗外壳：只有右上角一个关闭按钮，Esc 也能关。底部只放前进操作。

import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  sub?: string;
  size?: 'narrow' | 'mid' | 'wide';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Dialog({ title, sub, size, onClose, footer, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // 打开时把焦点放进弹窗：优先第一个输入框，没有就放在弹窗本身
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], .dlg-body input:not([type=checkbox]), .dlg-body textarea');
    (first ?? ref.current)?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim">
      <div ref={ref} className={`dialog ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="dlg-head">
          <b>{title}</b>
          {sub && <span className="sub">{sub}</span>}
          <button type="button" className="x" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dlg-body">{children}</div>
        {footer && <div className="dlg-foot">{footer}</div>}
      </div>
    </div>
  );
}
