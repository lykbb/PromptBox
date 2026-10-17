// 导入文件：逐个识别，确认后才写入。备份里已存在的条目跳过，不覆盖。

import { useEffect, useState } from 'react';
import { countExisting } from '../db/actions';
import type { ImportEntry } from '../logic/importers';
import { Dialog } from './Dialog';

interface Props {
  entries: ImportEntry[];
  onImport: () => void;
  onClose: () => void;
}

export function ImportDialog({ entries, onImport, onClose }: Props) {
  const [existing, setExisting] = useState<number[] | null>(null);

  useEffect(() => {
    void Promise.all(entries.map((entry) => (entry.kind === 'backup' ? countExisting(entry.items.map((item) => item.id)) : 0))).then(setExisting);
  }, [entries]);

  const adds = entries.map((entry, index) => {
    if (entry.kind === 'item') return 1;
    if (entry.kind === 'backup') return entry.items.length - (existing?.[index] ?? 0);
    if (entry.kind === 'candidates') return entry.candidates.length;
    return 0;
  });
  const total = adds.reduce((sum, value) => sum + value, 0);

  return (
    <Dialog
      title={`导入 ${entries.length} 个文件`}
      onClose={onClose}
      footer={
        <button type="button" className="btn primary" disabled={!existing || total === 0} onClick={onImport}>
          {total ? `导入 ${total} 条` : '没有可以导入的内容'}
        </button>
      }
    >
      <table className="tbl">
        <thead>
          <tr>
            <th>文件</th>
            <th>识别为</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={index}>
              <td>
                <code>{entry.fileName}</code>
              </td>
              <td className={entry.kind === 'unsupported' ? 'muted' : undefined}>{entry.label}</td>
              <td className={entry.kind === 'unsupported' ? 'muted' : undefined}>
                {entry.kind === 'unsupported' ? (
                  '跳过'
                ) : entry.kind === 'item' ? (
                  '新增 1 条'
                ) : entry.kind === 'candidates' ? (
                  <>
                    进入「发现」{entry.candidates.length} 条
                    <br />
                    <span className="muted">逐条确认后才进库</span>
                  </>
                ) : existing ? (
                  <>
                    新增 {adds[index]} 条
                    {existing[index] > 0 && (
                      <>
                        <br />
                        <span className="muted">跳过 {existing[index]} 条（已存在）</span>
                      </>
                    )}
                  </>
                ) : (
                  '正在核对…'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note-line" style={{ marginTop: 12 }}>
        已存在的条目不会被覆盖。聊天记录不从这里进，请用「发现」里的「管理记录来源」。
      </p>
    </Dialog>
  );
}
