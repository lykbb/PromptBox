// 模型输入框：读到模型列表时可以下拉选、输入搜索，读不到时就是普通输入框。

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  value: string;
  models: string[];
  placeholder: string;
  onChange: (model: string) => void;
  /** 定下来了：从列表里选中、按回车、或者输完离开输入框。 */
  onCommit?: (model: string) => void;
}

export function ModelPicker({ id, value, models, placeholder, onChange, onCommit }: Props) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  // 打开时先列出全部；用户开始输入后才按输入筛选
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const needle = query?.trim().toLowerCase() ?? '';
  const shown = needle ? models.filter((model) => model.toLowerCase().includes(needle)) : models;
  const expanded = open && models.length > 0;

  const show = () => {
    setQuery(null);
    setActive(Math.max(0, models.indexOf(value)));
    setOpen(true);
  };

  const pick = (model: string) => {
    onChange(model);
    onCommit?.(model);
    setOpen(false);
  };

  useEffect(() => {
    if (expanded) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [expanded, active]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !(open && models.length && shown[active]) && value.trim()) onCommit?.(value.trim());
    if (!models.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return show();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (shown.length ? (index + step + shown.length) % shown.length : 0));
    } else if (event.key === 'Enter' && expanded && shown[active]) {
      event.preventDefault();
      pick(shown[active]);
    } else if (event.key === 'Escape' && expanded) {
      // 只收起列表，不关掉整个弹窗
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="combo">
      <input
        id={id}
        className="input"
        role={models.length ? 'combobox' : undefined}
        aria-expanded={models.length ? expanded : undefined}
        aria-controls={models.length ? listId : undefined}
        aria-autocomplete={models.length ? 'list' : undefined}
        aria-activedescendant={expanded && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onClick={() => !open && show()}
        onBlur={() => {
          setOpen(false);
          if (value.trim()) onCommit?.(value.trim());
        }}
        onKeyDown={onKeyDown}
      />
      {models.length > 0 && (
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          aria-label={expanded ? '收起模型列表' : '展开模型列表'}
          onMouseDown={(event) => {
            // 不让输入框失焦，点了以后还能直接打字搜索
            event.preventDefault();
            if (expanded) setOpen(false);
            else {
              document.getElementById(id)?.focus();
              show();
            }
          }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      )}
      {expanded && (
        <ul ref={listRef} id={listId} className="combo-list" role="listbox" aria-label="可用的模型">
          {shown.map((model, index) => (
            <li
              key={model}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={model === value}
              className={index === active ? 'active' : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(model);
              }}
              onMouseMove={() => setActive(index)}
            >
              {model}
            </li>
          ))}
          {!shown.length && <li className="empty">列表里没有「{query?.trim()}」，会直接用你填的名字</li>}
        </ul>
      )}
    </div>
  );
}
