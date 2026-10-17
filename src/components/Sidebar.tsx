// 侧栏：发现在最上面；库按全部、类型、标签筛选；底部是导入、设置、反馈。

import type { ReactNode } from 'react';
import { REPO_URL } from '../config';
import type { LibraryFilter } from '../logic/items';
import { PromptIcon, RuleIcon } from './Icons';

interface Props {
  view: 'discover' | 'library';
  filter: LibraryFilter;
  newCandidates: number;
  total: number;
  prompts: number;
  rules: number;
  tags: { tag: string; count: number }[];
  backupDue: boolean;
  onDiscover: () => void;
  onFilter: (filter: LibraryFilter) => void;
  onImport: () => void;
  onSettings: () => void;
}

function isCurrent(view: Props['view'], filter: LibraryFilter, target: LibraryFilter): boolean {
  if (view !== 'library' || filter.kind !== target.kind) return false;
  if (filter.kind === 'type' && target.kind === 'type') return filter.type === target.type;
  if (filter.kind === 'tag' && target.kind === 'tag') return filter.tag === target.tag;
  return true;
}

export function Sidebar(props: Props) {
  const { view, filter, onFilter } = props;
  const navItem = (target: LibraryFilter, label: ReactNode, count: number, key?: string) => (
    <button key={key} type="button" className="nav-item" aria-current={isCurrent(view, filter, target)} onClick={() => onFilter(target)}>
      {label}
      <em>{count}</em>
    </button>
  );

  return (
    <aside className="side" aria-label="导航">
      <div className="brand">
        <span className="logo">PromptBox</span>
        {REPO_URL && (
          <a className="gh" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        )}
      </div>
      <button type="button" className="nav-item big" aria-current={view === 'discover'} onClick={props.onDiscover}>
        发现
        {props.newCandidates > 0 && <i className="count">{props.newCandidates}</i>}
      </button>

      <div className="nav-label">库</div>
      {navItem({ kind: 'all' }, '全部', props.total)}
      <div className="nav-label">类型</div>
      {navItem(
        { kind: 'type', type: 'prompt' },
        <>
          <PromptIcon />
          提示词
        </>,
        props.prompts,
      )}
      {navItem(
        { kind: 'type', type: 'rule' },
        <>
          <RuleIcon />
          规则
        </>,
        props.rules,
      )}
      <div className="nav-label">标签</div>
      {props.tags.length === 0 && <div className="nav-empty">还没有标签</div>}
      {props.tags.map(({ tag, count }) => navItem({ kind: 'tag', tag }, `# ${tag}`, count, tag))}

      <div className="side-foot">
        <button type="button" onClick={props.onImport}>
          导入
        </button>
        <button type="button" onClick={props.onSettings} aria-label={props.backupDue ? '设置（有改动还没备份）' : '设置'}>
          设置
          {props.backupDue && <i className="dot" aria-hidden="true" />}
        </button>
        {REPO_URL && (
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
            反馈
          </a>
        )}
      </div>
    </aside>
  );
}
