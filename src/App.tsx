// 整个应用：侧栏 + 列表 + 详情三栏，弹窗和提示条叠在上面。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chooseFiles, copyText, downloadBlob, downloadText } from './browser';
import { CandidateDetail } from './components/CandidateDetail';
import { CopyDialog } from './components/CopyDialog';
import { DiscoverList, type KindFilter } from './components/DiscoverList';
import { ExportDialog } from './components/ExportDialog';
import { GenerateDialog } from './components/GenerateDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { RefineDialog } from './components/RefineDialog';
import { isConfigured, providerOf } from './logic/llm';
import { buildRefineGroups, type RefineGroup } from './logic/refine';
import { ImportDialog } from './components/ImportDialog';
import { ItemDetail } from './components/ItemDetail';
import { LibraryList } from './components/LibraryList';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { SourcesDialog } from './components/SourcesDialog';
import { Toast, type ToastState } from './components/Toast';
import * as actions from './db/actions';
import { db, getSettings } from './db/db';
import { useLive } from './db/live';
import { titleFromNeed } from './logic/generate';
import { readImportFile, type ImportEntry } from './logic/importers';
import { applyFilter, sortByRecent, tagCounts, type LibraryFilter } from './logic/items';
import { searchItems } from './logic/search';
import { DAY_MS } from './logic/time';
import { extractVariables } from './logic/variables';
import { SAMPLE_TOOL_COUNTS } from './samples/conversations';
import type { FolderSourceId, ScanJob } from './scan/protocol';
import { SKILL_NAME } from './config';
import { ensureReadPermission, pickFolder, runScan, supportsFolderPicker } from './scan/scan';
import type { Candidate, Item, ScopeFields, Settings, SourceId, SourceRecord } from './types';

type View = 'discover' | 'library';

type DialogState =
  | { kind: 'copy'; item: Item }
  | { kind: 'export'; item: Item }
  | { kind: 'export-rules' }
  | { kind: 'import'; entries: ImportEntry[] }
  | { kind: 'settings' }
  | { kind: 'sources' }
  | { kind: 'generate'; need: string }
  | { kind: 'history'; item: Item }
  | { kind: 'refine'; groups: RefineGroup[] }
  | null;

const BACKUP_REMIND_AFTER = 7 * DAY_MS;

function readView(): View {
  return window.location.hash === '#library' ? 'library' : 'discover';
}

/** 处理完一条后，选中它后面的一条；已经是最后一条时选前一条。 */
function neighbor<T extends { id: string }>(list: T[], id: string): string | null {
  const index = list.findIndex((entry) => entry.id === id);
  return (list[index + 1] ?? list[index - 1])?.id ?? null;
}

export function App() {
  const [view, setViewState] = useState<View>(readView);
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusTitleId, setFocusTitleId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [matched, setMatched] = useState<Partial<Record<SourceId, number>>>({});
  const [compressed, setCompressed] = useState<Partial<Record<SourceId, number>>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    void actions.seedIfNeeded();
  }, []);

  const allItems = useLive(() => db.items.toArray(), [], [] as Item[]);
  const candidates = useLive(() => db.candidates.toArray(), [], [] as Candidate[]);
  const settings = useLive(getSettings, [], null as Settings | null);
  const sources = useLive(() => db.sources.toArray(), [], [] as SourceRecord[]);
  const samplesInDiscover = useLive(async () => (await db.utterances.filter((utterance) => !!utterance.isSample).count()) > 0, [], false);

  // ---------- 库 ----------
  const items = useMemo(() => sortByRecent(allItems.filter((item) => !item.deletedAt)), [allItems]);
  const tags = useMemo(() => tagCounts(items), [items]);
  const filtered = useMemo(() => applyFilter(items, filter), [items, filter]);
  const hits = useMemo(() => (query.trim() ? searchItems(filtered, query) : null), [filtered, query]);
  const visible = useMemo(() => (hits ? hits.map((hit) => hit.item) : filtered), [hits, filtered]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const sampleCount = items.filter((item) => item.isSample).length;

  useEffect(() => {
    if (view !== 'library') return;
    if (selectedId && visible.some((item) => item.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [view, visible, selectedId]);

  // ---------- 发现 ----------
  // Agent 和 AI 提炼的候选覆盖了的本地候选不再单独显示；AI 判断为一次性的收起来；外部候选排在前面
  const aiSkipped = useLive(actions.getAiSkipped, [], {} as Record<string, string>);
  const covered = useMemo(
    () => new Set(candidates.filter((candidate) => !actions.isLocalCandidate(candidate)).flatMap((candidate) => candidate.basedOn ?? [])),
    [candidates],
  );
  const hiddenCount = candidates.filter(
    (candidate) => actions.isLocalCandidate(candidate) && candidate.status === 'new' && !covered.has(candidate.id) && aiSkipped[candidate.id],
  ).length;
  const sortedCandidates = useMemo(() => {
    const rank = (candidate: Candidate) => (actions.isLocalCandidate(candidate) ? 1 : 0);
    return candidates
      .filter((candidate) => !(actions.isLocalCandidate(candidate) && (covered.has(candidate.id) || (!showHidden && aiSkipped[candidate.id]))))
      .sort((a, b) => rank(a) - rank(b) || b.count - a.count || b.lastAt - a.lastAt);
  }, [candidates, covered, aiSkipped, showHidden]);
  // 还没让 AI 筛过的本地候选
  const refinePending = sortedCandidates.filter(
    (candidate) => actions.isLocalCandidate(candidate) && candidate.status === 'new' && !aiSkipped[candidate.id],
  );
  const openCandidates = useMemo(
    () => sortedCandidates.filter((candidate) => candidate.status === 'new' && (kind === 'all' || candidate.kind === kind)),
    [sortedCandidates, kind],
  );
  const currentCandidate = openCandidates.find((candidate) => candidate.id === candidateId) ?? null;
  const newCount = sortedCandidates.filter((candidate) => candidate.status === 'new').length;

  useEffect(() => {
    if (view !== 'discover') return;
    if (candidateId && openCandidates.some((candidate) => candidate.id === candidateId)) return;
    setCandidateId(openCandidates[0]?.id ?? null);
  }, [view, openCandidates, candidateId]);

  // ---------- 通用 ----------
  const setView = (next: View) => {
    setViewState(next);
    window.history.replaceState(null, '', `#${next}`);
  };
  const notify = useCallback((message: string, action?: ToastState['action']) => setToast({ id: Date.now(), message, action }), []);
  const clearToast = useCallback(() => setToast(null), []);

  const copy = async (text: string, message = '已复制') => {
    try {
      await copyText(text);
      notify(message);
    } catch {
      notify('复制失败，请手动选中复制');
    }
  };

  const showItem = (id: string) => {
    setQuery('');
    setFilter({ kind: 'all' });
    setView('library');
    setSelectedId(id);
  };

  // ---------- 库的操作 ----------
  // 复制的就是正文本身；范围只是条目的属性，不写进复制出去的内容
  const handleCopy = (item: Item) => {
    if (extractVariables(item.content).length) setDialog({ kind: 'copy', item });
    else void copy(item.content);
  };

  const handleNew = async () => {
    const type = filter.kind === 'type' ? filter.type : 'prompt';
    const newTags = filter.kind === 'tag' ? [filter.tag] : [];
    setQuery('');
    const id = await actions.createItem(type, newTags);
    setFocusTitleId(id);
    setSelectedId(id);
    setView('library');
  };

  const handleDelete = async (item: Item) => {
    setSelectedId(neighbor(visible, item.id));
    await actions.deleteItem(item.id);
    notify(`已删除「${item.title || '未命名'}」`, {
      label: '撤销',
      run: () => void actions.restoreItem(item.id).then(() => setSelectedId(item.id)),
    });
  };

  // ---------- 发现的操作 ----------
  const handleSave = async (candidate: Candidate, edits: actions.CandidateEdits) => {
    setBusy(true);
    const next = neighbor(openCandidates, candidate.id);
    try {
      const outcome = await actions.saveCandidate(candidate, edits);
      setCandidateId(next);
      notify(outcome.merged ? `已合并到「${outcome.title}」` : `已存进库「${outcome.title}」`, { label: '去看看', run: () => showItem(outcome.itemId) });
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const handleIgnore = async (candidate: Candidate) => {
    const next = neighbor(openCandidates, candidate.id);
    await actions.ignoreCandidate(candidate);
    setCandidateId(next);
    notify('已忽略，以后不再出现', {
      label: '撤销',
      run: () => void actions.restoreCandidate(candidate).then(() => setCandidateId(candidate.id)),
    });
  };

  const scanWith = async (jobs: ScanJob[]) => {
    setScanning({ done: 0, total: 0 });
    try {
      const results = await runScan(jobs, await actions.knownFiles(), (done, total) => setScanning({ done, total }));
      const summary = await actions.applyScan(results);
      setMatched((current) => ({ ...current, ...summary.matched }));
      setCompressed((current) => ({ ...current, ...summary.compressed }));
      const fresh = await db.candidates.where('status').equals('new').count();
      notify(summary.conversations ? `读到 ${summary.conversations} 个新对话，现在有 ${fresh} 条候选` : '没有新的对话');
      setView('discover');
    } catch (error) {
      notify(`扫描失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanning(null);
    }
  };

  const pickFolderSource = async (id: FolderSourceId) => {
    if (supportsFolderPicker()) {
      const handle = await pickFolder(id);
      if (!handle) return;
      await actions.resetSource(id);
      await actions.saveSource({ id, handle, label: handle.name, conversations: 0 });
      await scanWith([{ sourceId: id, handle }]);
      return;
    }
    const files = await chooseFiles({ directory: true });
    if (!files.length) return;
    await actions.resetSource(id);
    await actions.saveSource({ id, label: files[0].webkitRelativePath.split('/')[0] || '已选文件夹', conversations: 0 });
    await scanWith([{ sourceId: id, files }]);
  };

  const pickExportSource = async () => {
    const files = await chooseFiles({ accept: '.json,application/json' });
    if (!files.length) return;
    await actions.resetSource('web-export');
    await actions.saveSource({ id: 'web-export', label: files[0].name, conversations: 0 });
    await scanWith([{ sourceId: 'web-export', files }]);
  };

  const rescan = async () => {
    const jobs: ScanJob[] = [];
    for (const source of sources) {
      if (source.id === 'web-export' || !source.handle) continue;
      if (await ensureReadPermission(source.handle)) jobs.push({ sourceId: source.id, handle: source.handle });
    }
    if (jobs.length) await scanWith(jobs);
    else setDialog({ kind: 'sources' });
  };

  // ---------- 导入、备份、生成 ----------
  const openImport = async (files: File[]) => {
    const entries = await Promise.all(files.map(async (file) => readImportFile(file.name, await file.text())));
    setDialog({ kind: 'import', entries });
  };

  const runImport = async (entries: ImportEntry[]) => {
    const { added, skipped, candidates: fresh } = await actions.importEntries(entries);
    setDialog(null);
    setQuery('');
    setFilter({ kind: 'all' });
    const parts = [
      added ? `${added} 条进了库` : '',
      skipped ? `跳过 ${skipped} 条已存在的` : '',
      entries.some((entry) => entry.kind === 'candidates') ? `${fresh} 条新候选进了「发现」` : '',
    ].filter(Boolean);
    // 只导入了候选文件时去「发现」逐条确认
    setView(added === 0 && fresh > 0 ? 'discover' : 'library');
    notify(`导入完成：${parts.join('，') || '没有新内容'}`);
  };

  const backup = async () => {
    const { fileName, text } = await actions.exportBackup();
    downloadText(fileName, text, 'application/json');
    notify('备份文件已下载');
  };

  const saveGenerated = async (fields: ScopeFields & { need: string; content: string; refs: Item[] }) => {
    const id = await actions.saveGenerated({
      title: titleFromNeed(fields.need),
      content: fields.content,
      need: fields.need,
      refs: fields.refs.map((item) => ({ id: item.id, title: item.title })),
    });
    setDialog(null);
    showItem(id);
    notify('已存进库，可以在这里改名和修改');
  };

  // ---------- 把文件拖进窗口 ----------
  const dialogOpen = useRef(false);
  dialogOpen.current = dialog !== null;
  const openImportRef = useRef(openImport);
  openImportRef.current = openImport;

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFiles(event) || dialogOpen.current) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length && !dialogOpen.current) void openImportRef.current(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const backupDue = !!settings?.changedSinceBackup && (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > BACKUP_REMIND_AFTER);
  const rules = items.filter((item) => item.type === 'rule');
  const tagNames = tags.map((entry) => entry.tag);
  const relatedPrompts = hits ? Math.min(3, hits.filter((hit) => hit.item.type === 'prompt').length) : 0;
  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <div className="app">
      <Sidebar
        view={view}
        filter={filter}
        newCandidates={newCount}
        total={items.length}
        prompts={items.length - rules.length}
        rules={rules.length}
        tags={tags}
        backupDue={backupDue}
        onDiscover={() => setView('discover')}
        onFilter={(next) => {
          setFilter(next);
          setView('library');
        }}
        onImport={() =>
          void chooseFiles({ accept: '.md,.markdown,.txt,.json', multiple: true }).then((files) => {
            if (files.length) void openImport(files);
          })
        }
        onSettings={() => setDialog({ kind: 'settings' })}
      />

      {view === 'discover' ? (
        <>
          <DiscoverList
            candidates={sortedCandidates}
            kind={kind}
            onKind={setKind}
            selectedId={currentCandidate?.id ?? null}
            onSelect={setCandidateId}
            sources={sources}
            sampleTools={samplesInDiscover ? SAMPLE_TOOL_COUNTS : null}
            scanning={scanning}
            canRescan={sources.some((source) => !!source.handle)}
            onRescan={() => void rescan()}
            onSources={() => setDialog({ kind: 'sources' })}
            refine={isConfigured(settings?.llm) ? { pending: refinePending.length } : null}
            onRefine={() =>
              void db.utterances.toArray().then((utterances) => setDialog({ kind: 'refine', groups: buildRefineGroups(refinePending, utterances) }))
            }
            onSettings={() => setDialog({ kind: 'settings' })}
            hiddenCount={hiddenCount}
            showHidden={showHidden}
            onToggleHidden={() => setShowHidden(!showHidden)}
          />
          {currentCandidate ? (
            <CandidateDetail
              key={currentCandidate.id}
              candidate={currentCandidate}
              tagSuggestions={tagNames}
              busy={busy}
              onSave={(edits) => void handleSave(currentCandidate, edits)}
              onIgnore={() => void handleIgnore(currentCandidate)}
              aiNote={actions.isLocalCandidate(currentCandidate) ? aiSkipped[currentCandidate.id] : undefined}
            />
          ) : (
            <section className="detail">
              <div className="placeholder">新的候选会出现在这里。保存过的在侧栏「库」里。</div>
            </section>
          )}
        </>
      ) : (
        <>
          <LibraryList
            query={query}
            onQuery={setQuery}
            items={filtered}
            hits={hits}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onCopy={handleCopy}
            onNew={() => void handleNew()}
            onGenerate={() => setDialog({ kind: 'generate', need: query.trim() })}
            relatedCount={relatedPrompts}
            showBanner={!!settings && !settings.bannerDismissed && sampleCount > 0}
            sampleCount={sampleCount}
            onClearSamples={() => void actions.clearSamples().then((count) => notify(`已清除 ${count} 条示例`))}
            onDismissBanner={() => void actions.dismissBanner()}
            emptyLibrary={items.length === 0}
            showRulesExport={filter.kind === 'type' && filter.type === 'rule' && rules.length > 0}
            onExportRules={() => setDialog({ kind: 'export-rules' })}
          />
          {selected ? (
            <ItemDetail
              key={selected.id}
              item={selected}
              tagSuggestions={tagNames}
              focusTitle={focusTitleId === selected.id}
              onCopy={handleCopy}
              onExport={(item) => setDialog({ kind: 'export', item })}
              onDelete={(item) => void handleDelete(item)}
              onHistory={(item) => setDialog({ kind: 'history', item })}
            />
          ) : (
            <section className="detail">
              <div className="placeholder">选中左侧一条内容，在这里查看和编辑</div>
            </section>
          )}
        </>
      )}

      {dialog?.kind === 'copy' && (
        <CopyDialog
          item={dialog.item}
          onClose={closeDialog}
          onCopy={(text) => {
            setDialog(null);
            void copy(text);
          }}
        />
      )}
      {dialog?.kind === 'export' && (
        <ExportDialog
          items={[dialog.item]}
          bundle={false}
          onClose={closeDialog}
          onCopy={(text) => {
            setDialog(null);
            void copy(text, '已复制文件内容');
          }}
          onDownload={(fileName, text) => {
            setDialog(null);
            downloadText(fileName, text);
            notify(`已下载 ${fileName}`);
          }}
        />
      )}
      {dialog?.kind === 'export-rules' && (
        <ExportDialog
          items={rules}
          bundle
          onClose={closeDialog}
          onCopy={(text) => {
            setDialog(null);
            void copy(text, '已复制文件内容');
          }}
          onDownload={(fileName, text) => {
            setDialog(null);
            downloadText(fileName, text);
            notify(`已下载 ${fileName}`);
          }}
        />
      )}
      {dialog?.kind === 'import' && <ImportDialog entries={dialog.entries} onClose={closeDialog} onImport={() => void runImport(dialog.entries)} />}
      {dialog?.kind === 'settings' && settings && <SettingsDialog settings={settings} onClose={closeDialog} onBackup={() => void backup()} />}
      {dialog?.kind === 'sources' && (
        <SourcesDialog
          sources={sources}
          matched={matched}
          compressed={compressed}
          scanning={scanning}
          folderPicker={supportsFolderPicker()}
          onPickFolder={(id) => void pickFolderSource(id)}
          onPickExport={() => void pickExportSource()}
          onDownloadSkill={() =>
            void import('./skillPackage').then(({ skillZip }) => {
              downloadBlob(`${SKILL_NAME}.zip`, new Blob([skillZip() as BlobPart], { type: 'application/zip' }));
              notify(`已下载 ${SKILL_NAME}.zip，解压后放进 Agent 的技能文件夹`);
            })
          }
          onCopyAgentPrompt={(text) => void copy(text, '已复制，发给你的 Agent 就行')}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'refine' && settings?.llm && (
        <RefineDialog
          groups={dialog.groups}
          llm={settings.llm}
          providerName={providerOf(settings.llm.provider).name}
          onBatch={actions.applyRefine}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'history' && (
        <HistoryDialog
          item={dialog.item}
          onClose={closeDialog}
          onRestore={(version) =>
            void actions.restoreVersion(dialog.item.id, version).then((number) => {
              setDialog(null);
              notify(`已恢复成 v${version.number} 的内容，现在是 v${number}`);
            })
          }
        />
      )}
      {dialog?.kind === 'generate' && (
        <GenerateDialog
          need={dialog.need}
          items={items}
          llm={settings?.llm}
          onClose={closeDialog}
          onCopy={(text, message) => void copy(text, message)}
          onSave={(fields) => void saveGenerated(fields)}
        />
      )}

      {dragging && (
        <div className="drop">
          <b>松开即可导入</b>
          <span>支持 .md 文件和备份 .json，可以一次拖多个</span>
        </div>
      )}
      {toast && <Toast key={toast.id} toast={toast} onDone={clearToast} />}
    </div>
  );
}
