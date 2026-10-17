import { useId } from 'react';
import { readScope } from '../logic/scope';
import type { CandidateScope, ScopeFields } from '../types';

export function ScopeEditor({ value, onChange, allowUnconfirmed = true }: {
  value: ScopeFields & { note?: string };
  onChange: (scope: ScopeFields) => void;
  allowUnconfirmed?: boolean;
}) {
  const id = useId();
  const scope = readScope(value);
  return (
    <div className="fields">
      <label htmlFor={`${id}-scope`}>适用范围</label>
      <select id={`${id}-scope`} className="input" value={scope.scope} onChange={(event) => onChange({
        scope: event.target.value as CandidateScope,
        project: undefined,
        taskType: undefined,
      })}>
        {allowUnconfirmed && <option value="unconfirmed">待确认</option>}
        <option value="global">所有任务</option>
        <option value="project">指定项目</option>
        <option value="task">某类任务</option>
      </select>
      {scope.scope === 'project' && <>
        <label htmlFor={`${id}-project`}>项目</label>
        <input id={`${id}-project`} className="input" value={value.project ?? scope.project ?? ''} placeholder="项目名或完整路径，避免同名混淆"
          onChange={(event) => onChange({ ...scope, project: event.target.value })} />
      </>}
      {scope.scope === 'task' && <>
        <label htmlFor={`${id}-task`}>任务类型</label>
        <input id={`${id}-task`} className="input" value={value.taskType ?? scope.taskType ?? ''} placeholder="例如：写作、代码审查"
          onChange={(event) => onChange({ ...scope, taskType: event.target.value })} />
      </>}
    </div>
  );
}
