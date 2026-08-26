import { useMemo, useState } from 'react';
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

function App() {
    const {
        psdRoot, atlasUrls, selectedLayer, layerMeta,
        compositionItems, emgData,
        parts, selectedPartId, previewFrame, previewOff, partAnimations,
        mapping, setMapping,
        presets, expressions, handleExpressionAdd, handleExpressionChange,
        handleExpressionRename, handleExpressionDelete,
        previewDelta, handlePresetSave, handlePresetApply,
        handlePresetUpdate, handlePresetRename, handlePresetDelete,
        handlePsdLoad, handleSourceAdd, handleSheetImport, handlePsdUpdate, handleLayerVisibilityChange,
        handleExport, handleSaveProject, handleLoadProject,
        handleVisibilityAll, handleTypeAll,
        handlePartTypeChange, handlePartDefaultFrameChange,
        handlePartDefaultVisibleChange, handlePartExportChange,
        handlePreviewFrame, handlePreviewNone, handlePreviewToggle, handlePreviewReset,
        handleAnimationToggle, handleAnimationChange, handleAnimationAddFrame,
        handleAnimationRemoveFrame, handleAnimationDurationChange,
        handleGroupSelected, handleRenamePart,
        setSelectedPartId, setSelectedLayer, setLayerMeta,
        exportProgress, toast, setToast,
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
                    />
                }
                onLoadPsd={openFilePicker}
                onAddSource={openAddPicker}
                onAddSheet={openSheetPicker}
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
            <FileDropOverlay onFiles={files => void addFiles(files)} />
            <Toast message={toast} onClose={() => setToast(null)} />
        </>
    );
}

export default App;
