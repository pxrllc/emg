
import { useState, useEffect, useMemo } from 'react';
import { MainLayout } from './components/MainLayout';
import { LayerTree } from './components/LayerTree';
import { PreviewPanel, PreviewItem } from './components/PreviewPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { PsdLoader, PsdLayer } from './services/PsdLoader';
import { Psd } from 'ag-psd';
import { TexturePacker, PackItem, PackResult } from './services/TexturePacker';
import { EmgGenerator, ExportItem, EmgData } from './services/EmgGenerator';

import type { LayerMeta } from './types';

// Define types locally if missing or import

// PreviewItem is imported from components/PreviewPanel

function App() {
    const [psdRoot, setPsdRoot] = useState<Psd | null>(null);
    const [packedTextureUrl, setPackedTextureUrl] = useState<string | null>(null);
    const [selectedLayer, setSelectedLayer] = useState<PsdLayer | null>(null);
    // We need to maintain metadata state separate from PSD structure if we want to edit it
    // For MVP, maybe we just modify the PSD layer objects directly or look them up?
    // Let's use a map for metadata for now.
    const [layerMeta, setLayerMeta] = useState<Record<number, LayerMeta>>({});
    const [compositionItems, setCompositionItems] = useState<PreviewItem[]>([]);
    const [packResult, setPackResult] = useState<PackResult | null>(null);

    const handlePsdLoad = async (file: File) => {
        try {
            const root = await PsdLoader.load(file);
            setPsdRoot(root);
            console.log('PSD Loaded:', root);

            // Initialize metadata
            const initialMeta: Record<number, LayerMeta> = {};
            const packItems: PackItem[] = [];
            const previewItems: PreviewItem[] = [];
            const layerMap = new Map<number, PsdLayer>();

            const traverse = (layer: PsdLayer) => {
                if (layer.id !== undefined) {
                    layerMap.set(layer.id, layer);
                }
                // Ensure layer has an ID, PsdLoader should ensure this but strictly speaking Layer id is optional in ag-psd until read?
                // Actually PsdLoader just calls readPsd.
                // If it doesn't have an ID, we might have issues. ag-psd usually adds it.
                if (layer.id === undefined) {
                    // Should act differently? For now lets assume it exists or ignore
                } else {
                    initialMeta[layer.id] = {
                        id: layer.id,
                        partId: layer.name || '',
                        type: 'normal',
                        visible: !layer.hidden
                    };
                }

                if (layer.canvas && !layer.hidden && layer.id !== undefined) {
                    packItems.push({
                        id: layer.id.toString(),
                        width: layer.canvas.width,
                        height: layer.canvas.height,
                        image: layer.canvas
                    });

                    previewItems.push({
                        id: layer.id,
                        image: layer.canvas,
                        left: layer.left || 0,
                        top: layer.top || 0
                    });
                }

                layer.children?.forEach(traverse);
            };
            traverse(root);
            setLayerMeta(initialMeta);
            setCompositionItems(previewItems);

            console.log(`Found ${packItems.length} items to pack`);

            // Pack texture
            if (packItems.length > 0) {
                const res = await TexturePacker.pack(packItems);
                setPackResult(res);
                setPackedTextureUrl(res.canvas.toDataURL());
                console.log(`Packed result: ${res.items.length} items, size ${res.width}x${res.height} `);
            } else {
                setPackResult(null);
                setPackedTextureUrl(null);
            }

        } catch (e) {
            console.error('Failed to load PSD:', e);
        }
    };

    const updatePacking = async (currentRoot: PsdLayer, currentMeta: Record<number, LayerMeta>) => {
        const packItems: PackItem[] = [];
        const previewItems: PreviewItem[] = [];
        const traverse = (layer: PsdLayer) => {
            if (layer.id === undefined) {
                layer.children?.forEach(traverse);
                return;
            }
            const meta = currentMeta[layer.id];
            // Add to pack items if it's a leaf (or has image data) and visible? 
            // AND is visible in metadata (which defaults to !hidden)
            if (layer.canvas && meta && meta.visible) {
                packItems.push({
                    id: layer.id.toString(),
                    width: layer.canvas.width,
                    height: layer.canvas.height,
                    image: layer.canvas
                });
                previewItems.push({
                    id: layer.id,
                    image: layer.canvas,
                    left: layer.left || 0,
                    top: layer.top || 0
                });
            }
            layer.children?.forEach(traverse);
        };
        traverse(currentRoot);
        setCompositionItems(previewItems);

        console.log(`Repacking ${packItems.length} items`);

        if (packItems.length > 0) {
            const res = await TexturePacker.pack(packItems);
            setPackResult(res);
            setPackedTextureUrl(res.canvas.toDataURL());
        } else {
            setPackResult(null);
            setPackedTextureUrl(null);
        }
    };

    const handleLayerVisibilityChange = (layer: any, visible: boolean) => {
        if (!psdRoot) return;

        // Let's cast to PsdLayer
        const psdLayer = layer as PsdLayer;

        const newMeta = { ...layerMeta };
        if (psdLayer.id !== undefined && newMeta[psdLayer.id]) {
            newMeta[psdLayer.id] = {
                ...newMeta[psdLayer.id]!,
                visible: visible
            };
            setLayerMeta(newMeta);
            updatePacking(psdRoot, newMeta);
        }
    };

    // Derived EmgData
    const emgData = useMemo(() => {
        if (!packResult || !psdRoot) return undefined;

        // Collect export items similar to handleExport but purely for JSON generation
        const exportItems: ExportItem[] = [];
        const traverse = (layer: PsdLayer) => {
            if (layer.id !== undefined) {
                const packed = packResult.items.find(p => p.id === layer.id!.toString());
                if (packed && layerMeta[layer.id]) {
                    exportItems.push({
                        packed: packed,
                        meta: layerMeta[layer.id],
                        originalLayer: layer
                    });
                }
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot);

        return EmgGenerator.createData(packResult, exportItems, psdRoot.width, psdRoot.height);
    }, [packResult, psdRoot, layerMeta]);

    const handleExport = async () => {
        if (!psdRoot) return;
        try {
            // Re-collect visible layers/items based on current meta
            // (Or just pack all like before? User might have changed visibility?)
            // For consistency let's re-pack based on *visible* layers in meta

            const packItems: PackItem[] = [];
            const exportItems: ExportItem[] = [];

            // We need to traverse again to match layers with meta
            const traverse = (layer: PsdLayer) => {
                const meta = layerMeta[layer.id!];
                if (meta && meta.visible && layer.canvas && layer.id !== undefined) {
                    packItems.push({
                        id: layer.id.toString(),
                        width: layer.canvas.width,
                        height: layer.canvas.height,
                        image: layer.canvas
                    });
                }
                layer.children?.forEach(traverse);
            };
            traverse(psdRoot);

            if (packItems.length === 0) {
                alert('No visible layers to export');
                return;
            }

            const packResult = await TexturePacker.pack(packItems);

            // Map back packed items to ExportItems
            // We need original layer data for positioning (left/top)

            const traverseForExport = (layer: PsdLayer) => {
                // Find packed item for this layer
                if (layer.id !== undefined) {
                    const packed = packResult.items.find(p => p.id === layer.id!.toString());
                    if (packed) {
                        exportItems.push({
                            packed: packed,
                            meta: layerMeta[layer.id!],
                            originalLayer: layer
                        });
                    }
                }
                layer.children?.forEach(traverseForExport);
            };
            traverseForExport(psdRoot);

            if (!psdRoot.width || !psdRoot.height) {
                throw new Error("PSD dimensions missing");
            }

            const blob = await EmgGenerator.generate(
                packResult,
                exportItems,
                psdRoot.width,
                psdRoot.height
            );

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'model.emg';
            link.click();
        } catch (e) {
            console.error('Export failed:', e);
        }
    };

    return (
        <>
            <input
                type="file"
                accept=".psd"
                style={{ display: 'none' }}
                id="psd-upload-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePsdLoad(file);
                    // Reset value so same file can be selected again
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
                        emgData={emgData}
                    />
                }
                onLoadPsd={() => document.getElementById('psd-upload-input')?.click()}
            />
        </>
    );
}

export default App;

