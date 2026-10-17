// 标签：点「+ 标签」输入，回车添加，可以从已有标签里选。

import { useId, useState } from 'react';

interface Props {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}

export function TagEditor({ tags, suggestions, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const listId = useId();

  const commit = () => {
    const tag = draft.trim().replace(/^#/, '');
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft('');
    setEditing(false);
  };

  return (
    <div className="tags">
      {tags.map((tag) => (
        <span key={tag} className="tag">
          {tag}
          <button type="button" aria-label={`去掉标签 ${tag}`} onClick={() => onChange(tags.filter((other) => other !== tag))}>
            ×
          </button>
        </span>
      ))}
      {editing ? (
        <>
          <input
            className="tag-input"
            autoFocus
            value={draft}
            list={listId}
            aria-label="新标签"
            placeholder="标签名"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                setDraft('');
                setEditing(false);
              }
            }}
          />
          <datalist id={listId}>
            {suggestions
              .filter((tag) => !tags.includes(tag))
              .map((tag) => (
                <option key={tag} value={tag} />
              ))}
          </datalist>
        </>
      ) : (
        <button type="button" className="tag-add" onClick={() => setEditing(true)}>
          + 标签
        </button>
      )}
    </div>
  );
}
