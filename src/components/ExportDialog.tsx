// 导出：提示词默认 .md，也可以导出成 SKILL.md；规则默认 AGENTS.md。多条规则在筛选「规则」后合成一个文件。

import { useState } from 'react';
import { updateItem } from '../db/actions';
import {
  FORMAT_LABELS,
  exportFileName,
  placementHint,
  suggestSkillName,
  toPlainMarkdown,
  toRulesFile,
  toSkillFile,
  validateSkillDescription,
  validateSkillName,
  variablesHint,
  type ExportFormat,
} from '../logic/exporters';
import type { Item } from '../types';
import { Dialog } from './Dialog';

interface Props {
  /** 单条导出时是这一条；合成规则文件时是全部规则。 */
  items: Item[];
  bundle: boolean;
  onCopy: (text: string) => void;
  onDownload: (fileName: string, text: string) => void;
  onClose: () => void;
}

export function ExportDialog({ items, bundle, onCopy, onDownload, onClose }: Props) {
  const single = items[0];
  const formats: ExportFormat[] = bundle ? ['agents', 'claude'] : ['skill', 'agents', 'claude', 'md'];
  const [format, setFormat] = useState<ExportFormat>(bundle || single.type === 'rule' ? 'agents' : 'md');
  const [skillName, setSkillName] = useState(single?.skillName ?? suggestSkillName(single?.title ?? ''));
  const [skillDescription, setSkillDescription] = useState(single?.skillDescription ?? '');
  const [touched, setTouched] = useState(false);

  const nameError = validateSkillName(skillName.trim());
  const descriptionError = validateSkillDescription(skillDescription);
  const invalid = format === 'skill' && (!!nameError || !!descriptionError);

  const text =
    format === 'skill'
      ? toSkillFile(single.content, skillName.trim() || '短名', skillDescription.trim() || '描述')
      : format === 'md'
        ? toPlainMarkdown(single.content)
        : toRulesFile(items);
  const fileName = exportFileName(format, single?.title ?? '');
  const content = bundle ? items.map((item) => item.content).join('\n') : single.content;
  const hint = placementHint(format, skillName.trim());
  const varHint = format === 'skill' || format === 'md' ? variablesHint(content) : '';

  // 填过的短名和描述存回这条内容，下次不用再填
  const remember = async () => {
    if (format !== 'skill') return;
    if (skillName.trim() !== single.skillName || skillDescription.trim() !== single.skillDescription) {
      await updateItem(single.id, { skillName: skillName.trim(), skillDescription: skillDescription.trim() });
    }
  };
  const run = async (action: () => void) => {
    setTouched(true);
    if (invalid) return;
    await remember();
    action();
  };

  const [frontmatter, body] = format === 'skill' ? splitFrontmatter(text) : ['', text];

  return (
    <Dialog
      title={bundle ? '合成规则文件' : '导出'}
      sub={bundle ? `全部规则 · ${items.length} 条` : single.title || '未命名'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => run(() => onCopy(text))}>
            复制文件内容
          </button>
          <button type="button" className="btn primary" onClick={() => run(() => onDownload(fileName, text))}>
            下载 {fileName}
          </button>
        </>
      }
    >
      <div className="cols exp">
        <div>
          <div className="sec-label">格式</div>
          <div className="opts" role="radiogroup" aria-label="格式">
            {formats.map((option) => (
              <button key={option} type="button" role="radio" className="opt" aria-checked={format === option} onClick={() => setFormat(option)}>
                <span className="radio" />
                <span>
                  {FORMAT_LABELS[option].title}
                  <small>{FORMAT_LABELS[option].hint}</small>
                </span>
              </button>
            ))}
          </div>
          {format === 'skill' && (
            <>
              <div className="sec-label">SKILL.md 必填</div>
              <div className="fields">
                <label htmlFor="skill-name">英文短名</label>
                <div>
                  <input
                    id="skill-name"
                    className={`input${touched && nameError ? ' invalid' : ''}`}
                    value={skillName}
                    placeholder="weekly-report"
                    onChange={(event) => setSkillName(event.target.value)}
                  />
                  <span className={`hint${touched && nameError ? ' error' : ''}`}>{touched && nameError ? nameError : '小写字母、数字、连字符'}</span>
                </div>
                <label htmlFor="skill-description">描述</label>
                <div>
                  <textarea
                    id="skill-description"
                    className={`input${touched && descriptionError ? ' invalid' : ''}`}
                    rows={3}
                    value={skillDescription}
                    placeholder="做什么，以及什么时候用。比如：根据一周的工作记录写周报。在用户要求写周报时使用。"
                    onChange={(event) => setSkillDescription(event.target.value)}
                  />
                  <span className={`hint${touched && descriptionError ? ' error' : ''}`}>
                    {touched && descriptionError ? descriptionError : 'Agent 靠描述判断什么时候用，写清"什么时候用"'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="stack">
          <div className="sec-label">预览</div>
          <div className="box preview">
            <pre>
              {frontmatter && <span className="fm">{frontmatter}</span>}
              {body}
            </pre>
          </div>
          {hint && <div className="note-line">{hint}</div>}
          {varHint && <div className="note-line">{varHint}</div>}
        </div>
      </div>
    </Dialog>
  );
}

function splitFrontmatter(text: string): [string, string] {
  const end = text.indexOf('\n---\n', 4);
  return end === -1 ? ['', text] : [text.slice(0, end + 5), text.slice(end + 5)];
}
