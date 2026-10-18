// 弹窗外壳：右上角一个关闭按钮，Esc 和点空白处也能关。底部只放前进操作。

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  title: string;
  sub?: string;
  size?: 'narrow' | 'mid' | 'wide';
  /** 个别弹窗自己的版式，比如设置的左右两栏。 */
  className?: string;
  onClose: () => void;
  footer?: ReactNode;
  /** 点空白处能不能关。正在请求或有没保存的结果时传 false，点空白处只晃一下，免得手滑丢掉。 */
  dismissable?: boolean;
  children: ReactNode;
}

export function Dialog({ title, sub, size, className, onClose, footer, dismissable = true, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // 按下和松开都在空白处才算点空白处，从弹窗里拖选文字拖到外面不算
  const pressedOutside = useRef(false);
  const [nudge, setNudge] = useState(false);

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
    <div
      className="scrim"
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (!pressedOutside.current || event.target !== event.currentTarget) return;
        pressedOutside.current = false;
        if (dismissable) onClose();
        else setNudge(true);
      }}
    >
      <div
        ref={ref}
        className={['dialog', size, className, nudge && 'nudge'].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onAnimationEnd={(event) => event.target === event.currentTarget && setNudge(false)}
      >
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
