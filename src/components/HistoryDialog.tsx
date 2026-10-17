// 版本历史：左边是版本列表，右边任选两版对比；恢复会生成一个新版本，原有历史不删。

import { useMemo, useState } from 'react';
import { db } from '../db/db';
import { useLive } from '../db/live';
import { diffLines, diffStats } from '../logic/diff';
import { formatDateTime } from '../logic/time';
import type { Item, Version } from '../types';
import { Dialog } from './Dialog';

interface Props {
  item: Item;
  onRestore: (version: Version) => void;
  onClose: () => void;
}

function versionName(version: Version, latest: Version | undefined): string {
  if (version.number === latest?.number) return `v${version.number} · 当前`;
  if (version.source === 'create') return `v${version.number} · 创建`;
  if (version.source === 'restore') return `v${version.number} · 从 v${version.restoredFrom} 恢复`;
  return `v${version.number}`;
}

export function HistoryDialog({ item, onRestore, onClose }: Props) {
  const versions = useLive(
    async () => (await db.versions.where('itemId').equals(item.id).toArray()).sort((a, b) => b.number - a.number),
    [item.id],
    [] as Version[],
  );
  const latest = versions[0];
  const [fromNumber, setFromNumber] = useState<number | null>(null);
  const [toNumber, setToNumber] = useState<number | null>(null);
  // 默认：上一版对比当前
  const from = versions.find((version) => version.number === (fromNumber ?? versions[1]?.number ?? latest?.number));
  const to = versions.find((version) => version.number === (toNumber ?? latest?.number));
  const lines = useMemo(() => (from && to ? diffLines(from.content, to.content) : []), [from, to]);
  const stats = diffStats(lines);
  // 每个版本相对它前一版改了多少
  const changes = useMemo(
    () => new Map(versions.map((version, index) => [version.number, versions[index + 1] ? diffStats(diffLines(versions[index + 1].content, version.content)) : null])),
    [versions],
  );
  const canRestore = !!from && !!latest && from.number !== latest.number && from.content !== latest.content;

  return (
    <Dialog
      title="版本历史"
      sub={`${item.title || '未命名'} · 共 ${versions.length} 个版本`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="hint muted">{latest ? `恢复后会生成 v${latest.number + 1}，历史不会丢` : ''}</span>
          <button type="button" className="btn primary" disabled={!canRestore} onClick={() => from && onRestore(from)}>
            {from && canRestore ? `恢复成 v${from.number}` : '恢复'}
          </button>
        </>
      }
    >
      {versions.length < 2 ? (
        <div className="stack">
          <p className="note-line">还没有其他版本。改动正文后离开这一条，会自动存一个新版本。</p>
          {latest && <pre className="box preview">{latest.content}</pre>}
        </div>
      ) : (
        <div className="cols ver">
          <div>
            <div className="sec-label">版本 · 点一个和当前对比</div>
            <div className="vers">
              {versions.map((version) => {
                const change = changes.get(version.number);
                return (
                  <button
                    key={version.id}
                    type="button"
                    className="ver"
                    aria-pressed={version.number === from?.number}
                    onClick={() => {
                      setFromNumber(version.number);
                      setToNumber(null);
                    }}
                  >
                    <b>{versionName(version, latest)}</b>
                    <small>
                      {formatDateTime(version.createdAt)}
                      {change && (
                        <>
                          {' · '}
                          <span className="plus">+{change.added}</span> <span className="minus">−{change.removed}</span>
                        </>
                      )}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="compare">
              对比
              <select className="input sm" aria-label="较早的版本" value={from?.number ?? ''} onChange={(event) => setFromNumber(Number(event.target.value))}>
                {versions.map((version) => (
                  <option key={version.id} value={version.number}>
                    v{version.number}
                  </option>
                ))}
              </select>
              →
              <select className="input sm" aria-label="较新的版本" value={to?.number ?? ''} onChange={(event) => setToNumber(Number(event.target.value))}>
                {versions.map((version) => (
                  <option key={version.id} value={version.number}>
                    v{version.number}
                    {version.number === latest?.number ? ' 当前' : ''}
                  </option>
                ))}
              </select>
              <span className="stat">
                <span className="plus">新增 {stats.added} 行</span> · <span className="minus">删除 {stats.removed} 行</span>
              </span>
            </div>
            <div className="diff" role="table" aria-label="两个版本的差异">
              {lines.map((line, index) => (
                <div key={index} className={line.kind === 'add' ? 'a' : line.kind === 'del' ? 'd' : undefined} role="row">
                  <span>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
                  <span>{line.text || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
