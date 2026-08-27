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

function App() {
    const {
        psdRoot, atlasUrls, selectedLayer, layerMeta,
        compositionItems, emgData,
        parts, selectedPartId, previewFrame, previewOff, partAnimations,
        partTransforms, transformTarget, setTransformTarget, transformTime, playScope,
        handleTransformChange, handlePlayToggle, handleTransformReset, setTransformTime,
        anyPlayable, partPlayable,
        mapping, setMapping,
        presets, expressions, handleExpressionAdd, handleExpressionChange,
        handleExpressionRename, handleExpressionDelete,
        previewDelta, handlePresetSave, handlePresetApply,
        handlePresetUpdate, handlePresetRename, handlePresetDelete,
        handlePsdLoad, handleSourceAdd, handleSheetImport, handlePsdUpdate, handleLayerVisibilityChange,
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
                onAddSource={openAddPicker}
                onAddSheet={openSheetPicker}
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
            {templateReport && (
                <TemplateReportDialog report={templateReport} onClose={() => setTemplateReport(null)} />
            )}
            <FileDropOverlay onFiles={files => void addFiles(files)} />
            <Toast message={toast} onClose={() => setToast(null)} />
        </>
    );
}

export default App;
