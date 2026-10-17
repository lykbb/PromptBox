// 复制·填变量：每个变量一个输入框，实时预览。没填的保留原样。

import { useState } from 'react';
import { extractVariables, fillVariables, segmentVariables } from '../logic/variables';
import type { Item } from '../types';
import { Dialog } from './Dialog';

interface Props {
  item: Item;
  onCopy: (text: string) => void;
  onClose: () => void;
}

export function CopyDialog({ item, onCopy, onClose }: Props) {
  const names = extractVariables(item.content);
  const [values, setValues] = useState<Record<string, string>>({});
  const copyResult = () => onCopy(fillVariables(item.content, values));

  return (
    <Dialog
      title="填写变量"
      sub={`${item.title || '未命名'} · ${names.length} 个变量`}
      size="mid"
      onClose={onClose}
      footer={
        <>
          <span className="hint muted">⌘↵ 复制结果</span>
          <button type="button" className="btn" onClick={() => onCopy(item.content)}>
            原样复制
          </button>
          <button type="button" className="btn primary" onClick={copyResult}>
            复制结果
          </button>
        </>
      }
    >
      <div
        className="cols"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            copyResult();
          }
        }}
      >
        <div>
          <div className="sec-label">变量</div>
          {names.map((name, index) => (
            <div key={name} className="var-field">
              <label htmlFor={`var-${index}`}>{name}</label>
              <textarea
                id={`var-${index}`}
                className="input"
                rows={name.length > 6 || /内容|记录|工作|原文|代码|列表/.test(name) ? 3 : 1}
                value={values[name] ?? ''}
                onChange={(event) => setValues({ ...values, [name]: event.target.value })}
              />
            </div>
          ))}
        </div>
        <div>
          <div className="sec-label">预览</div>
          <div className="box preview">
            <pre>
              {segmentVariables(item.content, values).map((segment, index) =>
                segment.filled ? <mark key={index}>{segment.text}</mark> : segment.variable ? <span key={index} className="var">{segment.text}</span> : segment.text,
              )}
            </pre>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
