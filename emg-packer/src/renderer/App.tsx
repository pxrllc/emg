import { useEmgPacker } from './hooks/useEmgPacker';
import { MainLayout } from './components/MainLayout';
import { LayerTree } from './components/LayerTree';
import { PreviewPanel } from './components/PreviewPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toast } from './components/Toast';

function App() {
    const {
        psdRoot, packedTextureUrl, selectedLayer, layerMeta,
        compositionItems, emgData,
        handlePsdLoad, handlePsdUpdate, handleLayerVisibilityChange,
        handleExport, handleSaveProject, handleLoadProject,
        handleVisibilityAll, handleTypeAll,
        setSelectedLayer, setLayerMeta,
        toast, setToast,
    } = useEmgPacker();

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
                leftPanel={
                    <LayerTree
                        psd={psdRoot}
                        visibility={Object.fromEntries(Object.values(layerMeta).map(m => [m.id, m.visible]))}
                        selectedLayer={selectedLayer}
                        onSelectionChange={setSelectedLayer}
                        onLayerVisibilityChange={handleLayerVisibilityChange}
                        onPsdUpdate={handlePsdUpdate}
                        onVisibilityAll={handleVisibilityAll}
                        onLoadPsd={() => document.getElementById('psd-upload-input')?.click()}
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
                    <PropertiesPanel
                        layerId={selectedLayer?.id ?? null}
                        meta={selectedLayer?.id !== undefined ? layerMeta[selectedLayer.id] : undefined}
                        onChange={(newMeta) => selectedLayer?.id !== undefined && setLayerMeta(prev => ({ ...prev, [selectedLayer.id!]: newMeta }))}
                        onExport={handleExport}
                        onSaveProject={handleSaveProject}
                        onLoadProject={handleLoadProject}
                        emgData={emgData}
                        onTypeAll={handleTypeAll}
                    />
                }
                onLoadPsd={() => document.getElementById('psd-upload-input')?.click()}
            />
            <Toast message={toast} onClose={() => setToast(null)} />
            <div style={{
                position: 'fixed',
                bottom: '6px',
                right: '10px',
                fontSize: '10px',
                color: '#333',
                userSelect: 'none',
                pointerEvents: 'none',
                letterSpacing: '0.03em',
            }}>
                v0.1.5 · pxrllc
            </div>
        </>
    );
}

export default App;
