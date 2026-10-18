// 侧栏：发现在最上面；库按全部、类型、标签筛选；最下面是设置，右边一个切换深浅色的小按钮。
// 可以收起成一条只有图标的窄栏，标签在窄栏里不显示。

import type { ReactNode } from 'react';
import type { LibraryFilter } from '../logic/items';
import { AllIcon, DiscoverIcon, MoonIcon, PromptIcon, RuleIcon, SettingsIcon, SidebarIcon, SunIcon } from './Icons';

interface Props {
  view: 'discover' | 'library';
  filter: LibraryFilter;
  newCandidates: number;
  total: number;
  prompts: number;
  rules: number;
  tags: { tag: string; count: number }[];
  collapsed: boolean;
  onToggle: () => void;
  /** 现在是不是深色。 */
  dark: boolean;
  onToggleDark: () => void;
  onDiscover: () => void;
  onFilter: (filter: LibraryFilter) => void;
  onSettings: () => void;
}

function isCurrent(view: Props['view'], filter: LibraryFilter, target: LibraryFilter): boolean {
  if (view !== 'library' || filter.kind !== target.kind) return false;
  if (filter.kind === 'type' && target.kind === 'type') return filter.type === target.type;
  if (filter.kind === 'tag' && target.kind === 'tag') return filter.tag === target.tag;
  return true;
}

export function Sidebar(props: Props) {
  const { view, filter, onFilter, collapsed } = props;

  // 同一个入口在展开和收起时的样子：展开时图标加文字和数量，收起时只有图标，名字放进提示
  const entry = (opts: { label: string; icon?: ReactNode; count?: number; badge?: number; current: boolean; onClick: () => void; key?: string; big?: boolean }) => (
    <button
      key={opts.key}
      type="button"
      className={`nav-item${opts.big ? ' big' : ''}`}
      aria-current={opts.current}
      aria-label={collapsed ? opts.label : undefined}
      title={collapsed ? (opts.count !== undefined ? `${opts.label} ${opts.count}` : opts.label) : undefined}
      onClick={opts.onClick}
    >
      {opts.icon}
      {!collapsed && <span className="nav-text">{opts.label}</span>}
      {!collapsed && opts.count !== undefined && <em>{opts.count}</em>}
      {!!opts.badge && <i className="count">{opts.badge}</i>}
    </button>
  );

  const library = (target: LibraryFilter, label: string, icon: ReactNode, count: number) =>
    entry({ label, icon, count, current: isCurrent(view, filter, target), onClick: () => onFilter(target) });

  return (
    <aside className={`side${collapsed ? ' collapsed' : ''}`} aria-label="导航">
      <div className="brand">
        {!collapsed && <span className="logo">PromptBox</span>}
        <button
          type="button"
          className="side-toggle"
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={!collapsed}
          onClick={props.onToggle}
        >
          <SidebarIcon />
        </button>
      </div>

      {entry({ label: '发现', icon: <DiscoverIcon />, badge: props.newCandidates, current: view === 'discover', onClick: props.onDiscover, big: true })}
      <hr className="nav-sep" />
      {library({ kind: 'all' }, '全部', <AllIcon />, props.total)}
      {library({ kind: 'type', type: 'prompt' }, '提示词', <PromptIcon />, props.prompts)}
      {library({ kind: 'type', type: 'rule' }, '规则', <RuleIcon />, props.rules)}

      {!collapsed && props.tags.length > 0 && (
        <>
          <div className="nav-label">标签</div>
          {props.tags.map(({ tag, count }) =>
            entry({ key: tag, label: `# ${tag}`, count, current: isCurrent(view, filter, { kind: 'tag', tag }), onClick: () => onFilter({ kind: 'tag', tag }) }),
          )}
        </>
      )}

      <div className="side-foot">
        <button type="button" className="nav-item" title={collapsed ? '设置' : undefined} aria-label="设置" onClick={props.onSettings}>
          <SettingsIcon />
          {!collapsed && <span className="nav-text">设置</span>}
        </button>
        <button
          type="button"
          className="mode-toggle"
          aria-pressed={props.dark}
          aria-label="深色模式"
          title={props.dark ? '切换到浅色' : '切换到深色'}
          onClick={props.onToggleDark}
        >
          {props.dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </aside>
  );
}
