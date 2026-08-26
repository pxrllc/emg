import { useMemo } from 'react';
import { useEmgPacker } from './hooks/useEmgPacker';
import { MainLayout } from './components/MainLayout';
import { LayerTree } from './components/LayerTree';
import { PreviewPanel } from './components/PreviewPanel';
import { InspectorPanel } from './components/InspectorPanel';
import { Toast } from './components/Toast';
import { findMappingControlledParts } from './services/MappingGenerator';

function App() {
    const {
        psdRoot, packedTextureUrl, selectedLayer, layerMeta,
        compositionItems, emgData,
        parts, selectedPartId, previewFrame, previewOff, partAnimations,
        handlePsdLoad, handlePsdUpdate, handleLayerVisibilityChange,
        handleExport, handleSaveProject, handleLoadProject,
        handleVisibilityAll, handleTypeAll,
        handlePartTypeChange, handlePartDefaultFrameChange,
        handlePartDefaultVisibleChange, handlePartExportChange,
        handlePreviewFrame, handlePreviewNone, handlePreviewToggle, handlePreviewReset,
        handleAnimationToggle, handleAnimationChange, handleAnimationAddFrame,
        handleAnimationRemoveFrame, handleAnimationDurationChange,
        handleGroupSelected, handleRenamePart,
        setSelectedPartId, setSelectedLayer, setLayerMeta,
        toast, setToast,
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

    const openFilePicker = () => document.getElementById('psd-upload-input')?.click();

    return (
        <>
            <input
                type="file"
                accept=".psd,.kra,.clip"
                style={{ display: 'none' }}
                id="psd-upload-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePsdLoad(file);
                    e.target.value = '';
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
                        onGroupSelected={handleGroupSelected}
                    />
                }
                centerPanel={
                    <PreviewPanel
                        textureUrl={packedTextureUrl}
                        compositionItems={compositionItems}
                        width={psdRoot?.width || 0}
                        height={psdRoot?.height || 0}
                    />
                }
                rightPanel={
                    <InspectorPanel
                        hasFile={!!psdRoot}
                        exportableCount={exportableCount}
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
            />
            <Toast message={toast} onClose={() => setToast(null)} />
        </>
    );
}

export default App;
