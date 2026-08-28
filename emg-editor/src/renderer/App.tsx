import { useEffect, useMemo, useState } from 'react';
import { parseTransformKey } from './types';
import { useEmgPacker } from './hooks/useEmgPacker';
import { MainLayout } from './components/MainLayout';
import { LayerTree } from './components/LayerTree';
import { PreviewPanel } from './components/PreviewPanel';
import { InspectorPanel } from './components/InspectorPanel';
import { Toast } from './components/Toast';
import { FileDropOverlay } from './components/FileDropOverlay';
import { countUnassigned, findMappingControlledParts } from './services/MappingGenerator';
import { SourceLoader } from './services/SourceLoader';
import { SpriteSheetLoader } from './services/SpriteSheetLoader';
import { SpriteSheetDialog } from './components/SpriteSheetDialog';
import { TemplateReportDialog } from './components/TemplateReportDialog';
import { CanvasSizeDialog } from './components/CanvasSizeDialog';
import { PreviewExportDialog } from './components/PreviewExportDialog';
import { computeBounds, drawComposite } from './services/composite';
import { exportPreview, extensionOf } from './services/previewExport';
import { prepareSave } from './services/download';

function App() {
    const {
        psdRoot, atlasUrls, selectedLayer, layerMeta,
        compositionItems, composeAt, contentDuration, emgData,
        parts, selectedPartId, previewFrame, previewOff, partAnimations,
        partTransforms, transformTarget, setTransformTarget, transformTime, playScope,
        handleTransformChange, handlePlayToggle, handleTransformReset, setTransformTime,
        anyPlayable, partPlayable,
        mapping, setMapping,
        presets, expressions, handleExpressionAdd, handleExpressionChange,
        handleExpressionRename, handleExpressionDelete,
        previewDelta, handlePresetSave, handlePresetApply,
        handlePresetUpdate, handlePresetRename, handlePresetDelete,
        handlePsdLoad, handleNewProject, handleCanvasResize, projectName, handleSourceAdd, handleSheetImport, handlePsdUpdate, handleLayerVisibilityChange,
        handleExport, handleSaveProject, handleLoadProject,
        handleTemplateSave, handleTemplateLoad, templateReport, setTemplateReport,
        handleVisibilityAll, handleTypeAll,
        handlePartTypeChange, handlePartDefaultFrameChange,
        handlePartDefaultVisibleChange, handlePartExportChange,
        handlePreviewFrame, handlePreviewNone, handlePreviewToggle, handlePreviewReset,
        handleAnimationToggle, handleAnimationChange, handleAnimationAddFrame,
        handleAnimationRemoveFrame, handleAnimationDurationChange,
        handleGroupSelected, handleRenamePart,
        setSelectedPartId, setSelectedLayer, setLayerMeta,
        exportProgress, history, toast, setToast,
    } = useEmgPacker();

    const visibility = useMemo(
        () => Object.fromEntries(Object.values(layerMeta).map(m => [m.id, m.visible])),
        [layerMeta]
    );

    // layerMeta はグループにも作られるので、そのまま数えると
    // グループを 1 つ足しただけで「レイヤーが増えた」ように見える。
    // parts[] は canvas を持つ葉レイヤーだけを持っているので、そちらから数える。
    const exportableCount = useMemo(
        () => parts.reduce((n, p) => n + p.exportedCount, 0),
        [parts]
    );

    // mapping.json が blink/lipSync として掌握するパーツ（emg-json-spec.md 7.3）。
    // そのパーツの sprites[] は自律発火できないので、UI 側でもその旨を示す。
    // 判定は書き出し時と同じ関数を使う（食い違うと UI の表示が嘘になる）。
    const mappingControlled = useMemo(
        () => emgData ? findMappingControlledParts(emgData.parts) : new Set<string>(),
        [emgData]
    );

    /**
     * プレビューに渡すトランスフォーム。
     *
     * **単体再生のときは、そのパーツ以外を時刻 0 に固定します。** 全部が同時に
     * 動くと、今どのパーツの動きを見ているのか分からなくなるためです。
     * 止まっているときは選択中のパーツだけがスクラブに追従します（他は静止）。
     *
     * 時刻 0 に固定するのは `duration` を 0 にすることで行います。`foldTime` が
     * `duration <= 0` を 0 として扱うので、トラックは先頭の値に落ち着きます。
     */
    const scopedTransforms = useMemo(() => {
        if (playScope === 'all') return partTransforms;
        const out: typeof partTransforms = {};
        for (const [key, tf] of Object.entries(partTransforms)) {
            // 再生中はその対象だけ。止まっているときは、選択中パーツに属する対象
            // （パーツ全体でも中のフレームでも）がスクラブに追従する。
            const live = playScope
                ? key === playScope
                : parseTransformKey(key).partId === selectedPartId;
            out[key] = live ? tf : { ...tf, duration: 0 };
        }
        return out;
    }, [partTransforms, playScope, selectedPartId]);

    // スプライトシートは格子の指定が要るので、読み込んだ後に確認画面を挟む。
    const [sheetFile, setSheetFile] = useState<File | null>(null);

    // 新規作成 / キャンバスサイズ変更。同じ画面を使い分ける。
    const [sizeDialog, setSizeDialog] = useState<'new' | 'resize' | null>(null);

    // プレビューの書き出し（GIF / 動画）。
    const [previewExportOpen, setPreviewExportOpen] = useState(false);
    const [previewBusy, setPreviewBusy] = useState<{ phase: string; ratio: number } | null>(null);

    /**
     * プレビューをアニメーションとして書き出す。
     *
     * 描画は `composite.ts` を通すので、画面で見たものと同じ規則で出ます。
     * トランスフォームは範囲を絞る前の `partTransforms` を使う — 書き出しでは
     * 全部が動いてほしいため（単体再生の絞り込みは画面上の都合）。
     */
    const runPreviewExport = async (o: {
        format: 'gif' | 'webm'; duration: number; fps: number;
        scale: number; background: 'transparent' | string;
    }) => {
        if (!psdRoot) return;
        // **保存先は押された瞬間に押さえる。** 書き出しに数秒かかるので、
        // 終わってから保存しようとすると「操作から続いていない」と見なされて
        // ブロックされ、押しても何も起きないことがある。
        let target;
        try {
            target = await prepareSave(
                `${projectName}.${extensionOf(o.format)}`,
                o.format === 'gif' ? 'image/gif' : 'video/webm',
                [`.${extensionOf(o.format)}`]);
        } catch {
            return;   // 利用者が保存先の選択をやめた
        }
        setPreviewBusy({ phase: '準備しています', ratio: 0 });
        try {
            const blob = await exportPreview({
                ...o,
                width: psdRoot.width ?? 0,
                height: psdRoot.height ?? 0,
                frameAt: t => composeAt(t),
                draw: (ctx, items, t, base) => drawComposite(ctx, items, partTransforms, computeBounds(items), t, base),
                onProgress: (phase, ratio) => setPreviewBusy({ phase, ratio }),
            });
            const saved = await target.write(blob);
            setPreviewExportOpen(false);
            setToast({
                title: 'プレビューを書き出しました',
                body: `${saved} — ${o.duration}s / ${o.fps}fps / ${Math.round(blob.size / 1024)} KB`,
            });
        } catch (e) {
            console.error(e);
            setToast({ title: '書き出せませんでした', body: String(e instanceof Error ? e.message : e), tone: 'error' });
        } finally {
            setPreviewBusy(null);
        }
    };

    /**
     * 今の中身が占めている範囲（キャンバス座標）。
     * 寸法を縮めたときに何がはみ出すかを、決める前に見せるために要る。
     */
    const contentBounds = useMemo(() => {
        if (compositionItems.length === 0) return null;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const it of compositionItems) {
            left = Math.min(left, it.left);
            top = Math.min(top, it.top);
            right = Math.max(right, it.left + it.image.width);
            bottom = Math.max(bottom, it.top + it.image.height);
        }
        return { left, top, right, bottom };
    }, [compositionItems]);

    /**
     * 複数ファイルは 1 つずつ順に取り込む。まとめて並行に走らせると、
     * 合流処理が同じ木を同時に書き換えて取りこぼす。
     */
    const addFiles = async (files: File[]) => {
        for (const f of files) await handleSourceAdd(f);
    };

    const unassigned = useMemo(() => countUnassigned(mapping), [mapping]);

    /**
     * Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y も受ける）。
     *
     * 文字を打っている最中は横取りしない。パーツ名や表情名の入力欄で
     * Ctrl+Z を押したとき、期待されるのは入力欄自身の取り消しなので。
     */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const el = e.target as HTMLElement | null;
            if (el && (el.isContentEditable
                || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;

            const k = e.key.toLowerCase();
            if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
            else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); history.redo(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [history]);

    const openFilePicker = () => document.getElementById('psd-upload-input')?.click();
    const openAddPicker = () => document.getElementById('source-add-input')?.click();
    const openSheetPicker = () => document.getElementById('sheet-add-input')?.click();

    return (
        <>
            {/* 開く: 今の内容を捨てて読み直す */}
            <input
                type="file"
                accept={SourceLoader.ACCEPT}
                style={{ display: 'none' }}
                id="psd-upload-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePsdLoad(file);
                    e.target.value = '';
                }}
            />
            {/* 追加: 今の内容に合流させる。複数選択すると順に取り込む */}
            <input
                type="file"
                accept={SourceLoader.ACCEPT}
                multiple
                style={{ display: 'none' }}
                id="source-add-input"
                onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    void addFiles(files);
                }}
            />
            {/* スプライトシート: 画像なので拡張子からは判別できない。専用の入口にする */}
            <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                id="sheet-add-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) setSheetFile(file);
                }}
            />
            <MainLayout
                hasFile={!!psdRoot}
                leftPanel={
                    <LayerTree
                        psd={psdRoot}
                        visibility={visibility}
                        layerMeta={layerMeta}
                        selectedLayer={selectedLayer}
                        onSelectionChange={setSelectedLayer}
                        onLayerVisibilityChange={handleLayerVisibilityChange}
                        onPsdUpdate={handlePsdUpdate}
                        onVisibilityAll={handleVisibilityAll}
                        onLoadPsd={openFilePicker}
                        onAddSource={openAddPicker}
                        onAddSheet={openSheetPicker}
                        onGroupSelected={handleGroupSelected}
                        onNewProject={() => setSizeDialog('new')}
                    />
                }
                centerPanel={
                    <PreviewPanel
                        atlasUrls={atlasUrls}
                        compositionItems={compositionItems}
                        width={psdRoot?.width || 0}
                        height={psdRoot?.height || 0}
                        transforms={scopedTransforms}
                        selectedPartId={selectedPartId}
                        transformTarget={transformTarget}
                        onSelectPart={setSelectedPartId}
                        onTransformChange={handleTransformChange}
                        time={transformTime}
                        playing={!!playScope}
                        onPlayAll={() => handlePlayToggle('all')}
                        onRewind={handleTransformReset}
                        playingAll={playScope === 'all'}
                        canPlay={anyPlayable}
                        onResizeCanvas={() => setSizeDialog('resize')}
                        onExportPreview={() => setPreviewExportOpen(true)}
                    />
                }
                rightPanel={
                    <InspectorPanel
                        hasFile={!!psdRoot}
                        exportableCount={exportableCount}
                        exportProgress={exportProgress}
                        mapping={mapping}
                        onMappingChange={patch => setMapping(prev => ({ ...prev, ...patch }))}
                        unassigned={unassigned}
                        presets={presets}
                        previewDelta={previewDelta}
                        onPresetSave={handlePresetSave}
                        onPresetApply={handlePresetApply}
                        onPresetUpdate={handlePresetUpdate}
                        onPresetRename={handlePresetRename}
                        onPresetDelete={handlePresetDelete}
                        expressions={expressions}
                        onExpressionAdd={handleExpressionAdd}
                        onExpressionChange={handleExpressionChange}
                        onExpressionRename={handleExpressionRename}
                        onExpressionDelete={handleExpressionDelete}
                        parts={parts}
                        selectedPartId={selectedPartId}
                        previewFrame={previewFrame}
                        previewOff={previewOff}
                        onSelectPart={setSelectedPartId}
                        onTypeChange={handlePartTypeChange}
                        onExportChange={handlePartExportChange}
                        onDefaultFrameChange={handlePartDefaultFrameChange}
                        onDefaultVisibleChange={handlePartDefaultVisibleChange}
                        onPreviewFrame={handlePreviewFrame}
                        onPreviewNone={handlePreviewNone}
                        onPreviewToggle={handlePreviewToggle}
                        onPreviewReset={handlePreviewReset}
                        onRenamePart={handleRenamePart}
                        onTypeAll={handleTypeAll}
                        partAnimations={partAnimations}
                        partTransforms={partTransforms}
                        transformTime={transformTime}
                        playScope={playScope}
                        onTransformChange={handleTransformChange}
                        onPlayToggle={handlePlayToggle}
                        onTransformReset={handleTransformReset}
                        onSeek={setTransformTime}
                        anyPlayable={anyPlayable}
                        partPlayable={partPlayable}
                        transformTarget={transformTarget}
                        onTransformTargetChange={(partId, frame) =>
                            setTransformTarget(prev => ({ ...prev, [partId]: frame }))}
                        mappingControlled={mappingControlled}
                        onAnimationToggle={handleAnimationToggle}
                        onAnimationChange={handleAnimationChange}
                        onAnimationAddFrame={handleAnimationAddFrame}
                        onAnimationRemoveFrame={handleAnimationRemoveFrame}
                        onAnimationDurationChange={handleAnimationDurationChange}
                        layerName={selectedLayer?.name}
                        layerId={selectedLayer?.id ?? null}
                        meta={selectedLayer?.id !== undefined ? layerMeta[selectedLayer.id] : undefined}
                        onMetaChange={(newMeta) =>
                            selectedLayer?.id !== undefined &&
                            setLayerMeta(prev => ({ ...prev, [selectedLayer.id!]: newMeta }))
                        }
                        emgData={emgData}
                        onExport={handleExport}
                        onSaveProject={handleSaveProject}
                        onLoadProject={handleLoadProject}
                        onTemplateSave={handleTemplateSave}
                        onTemplateLoad={handleTemplateLoad}
                    />
                }
                onLoadPsd={openFilePicker}
                onNewProject={() => setSizeDialog('new')}
                onUndo={history.undo}
                onRedo={history.redo}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
            />
            {sheetFile && (
                <SpriteSheetDialog
                    file={sheetFile}
                    onCancel={() => setSheetFile(null)}
                    onImport={(source, grid, fps) => {
                        const name = sheetFile.name.replace(/\.[^.]+$/, '') || 'sheet';
                        handleSheetImport(name, SpriteSheetLoader.slice(source, grid, fps, name));
                        setSheetFile(null);
                    }}
                />
            )}
            {previewExportOpen && psdRoot && (
                <PreviewExportDialog
                    contentDuration={contentDuration}
                    canvas={{ width: psdRoot.width ?? 0, height: psdRoot.height ?? 0 }}
                    busy={previewBusy}
                    onCancel={() => setPreviewExportOpen(false)}
                    onExport={runPreviewExport}
                />
            )}
            {sizeDialog && (
                <CanvasSizeDialog
                    current={sizeDialog === 'resize' && psdRoot
                        ? { width: psdRoot.width ?? 0, height: psdRoot.height ?? 0 } : undefined}
                    contentBounds={sizeDialog === 'resize' ? contentBounds : null}
                    onCancel={() => setSizeDialog(null)}
                    onApply={(w, h, align) => {
                        if (sizeDialog === 'new') handleNewProject(w, h);
                        else handleCanvasResize(w, h, align);
                        setSizeDialog(null);
                    }}
                />
            )}
            {templateReport && (
                <TemplateReportDialog report={templateReport} onClose={() => setTemplateReport(null)} />
            )}
            <FileDropOverlay onFiles={files => void addFiles(files)} />
            <Toast message={toast} onClose={() => setToast(null)} />
        </>
    );
}

export default App;
