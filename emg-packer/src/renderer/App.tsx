
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

    // Helper to recalculate metadata based on current tree structure
    const recalculateMeta = (root: Psd, currentMeta: Record<number, LayerMeta>): Record<number, LayerMeta> => {
        const newMeta = { ...currentMeta };

        root.children?.forEach(child => {
            // Top-level item determines the PartID
            const partId = child.name || `Part_${child.id}`;
            const partType = (child.children && child.children.length > 0) ? 'switch' : 'static'; // Heuristic

            // Assign to the top-level item itself
            if (child.id !== undefined) {
                if (!newMeta[child.id]) {
                    newMeta[child.id] = {
                        id: child.id,
                        partId: partId,
                        type: partType,
                        visible: !child.hidden
                    };
                } else {
                    // Update PartID if moved
                    newMeta[child.id].partId = partId;
                }
            }

            // Traverse descendants and assign same PartID
            const traverse = (layer: PsdLayer, pid: string) => {
                if (layer.id !== undefined) {
                    if (!newMeta[layer.id]) {
                        newMeta[layer.id] = {
                            id: layer.id,
                            partId: pid,
                            type: 'static', // layers inside are just layers
                            visible: !layer.hidden
                        };
                    } else {
                        newMeta[layer.id].partId = pid;
                    }
                }
                layer.children?.forEach(l => traverse(l, pid));
            };
            child.children?.forEach(l => traverse(l, partId));
        });

        return newMeta;
    };

    const handlePsdLoad = async (file: File) => {
        try {
            const root = await PsdLoader.load(file);
            console.log('PSD Loaded:', root);

            // Initial Meta Calculation
            const initialMeta = recalculateMeta(root, {});

            // Batch updates
            setLayerMeta(initialMeta);
            setPsdRoot(root);

        } catch (e) {
            console.error('Failed to load PSD:', e);
        }
    };

    const handlePsdUpdate = (newRoot: Psd) => {
        // Called when LayerTree reorders items
        const newMeta = recalculateMeta(newRoot, layerMeta);
        setLayerMeta(newMeta);
        setPsdRoot(newRoot);
    };

    // Effect to handle Packing and Composition updates whenever PSD or Meta changes
    useEffect(() => {
        if (!psdRoot) return;

        const packItems: PackItem[] = [];
        const previewItems: PreviewItem[] = [];

        const traverse = (layer: PsdLayer) => {
            // Skip if no ID (shouldn't happen for valid layers)
            if (layer.id === undefined) {
                layer.children?.forEach(traverse);
                return;
            }

            const meta = layerMeta[layer.id];

            // Collect items if they have canvas and are visible in meta
            if (layer.canvas && meta && meta.visible) {
                packItems.push({
                    id: layer.id.toString(),
                    width: layer.canvas.width,
                    height: layer.canvas.height,
                    image: layer.canvas
                });
                // Preview uses same items
                previewItems.push({
                    id: layer.id,
                    image: layer.canvas,
                    left: layer.left || 0,
                    top: layer.top || 0
                });
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot);

        setCompositionItems(previewItems);

        // Async packing
        const runPack = async () => {
            if (packItems.length > 0) {
                try {
                    console.log(`Packing ${packItems.length} items...`);
                    const res = await TexturePacker.pack(packItems);
                    setPackResult(res);
                    setPackedTextureUrl(res.canvas.toDataURL());
                } catch (e) {
                    console.error("Packing failed", e);
                }
            } else {
                setPackResult(null);
                setPackedTextureUrl(null);
            }
        };
        runPack();

    }, [psdRoot, layerMeta]);

    const handleLayerVisibilityChange = (layer: any, visible: boolean) => {
        const psdLayer = layer as PsdLayer;
        if (psdLayer.id !== undefined) {
            setLayerMeta(prev => ({
                ...prev,
                [psdLayer.id!]: {
                    ...prev[psdLayer.id!],
                    visible: visible
                }
            }));
        }
    };

    // Derived EmgData
    const emgData = useMemo(() => {
        if (!packResult || !psdRoot) return undefined;

        const exportItems: ExportItem[] = [];
        // Traverse to collect all visible/exportable layers in Front-to-Back order
        // ag-psd children are Front-to-Back.

        let allExportableLayers: PsdLayer[] = [];
        const traverse = (layer: PsdLayer) => {
            if (layer.id !== undefined && layerMeta[layer.id]?.visible && layer.canvas) {
                allExportableLayers.push(layer);
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot as PsdLayer);

        const totalLayers = allExportableLayers.length;

        // Map them to ExportItems with Z-Index
        allExportableLayers.forEach((layer, index) => {
            const packed = packResult.items.find(p => p.id === layer.id!.toString());
            // Note: If packed is missing (e.g. not packed due to size), we skip? 
            // Or we should have ensured packResult contains it. 
            // PackResult only contains packed items.
            if (packed && layerMeta[layer.id!]) {
                exportItems.push({
                    packed: packed,
                    meta: layerMeta[layer.id!],
                    originalLayer: layer,
                    zIndex: index // Front (High Index) gets Max Z
                });
            }
        });

        return EmgGenerator.createData(packResult, exportItems, psdRoot.width, psdRoot.height);
    }, [packResult, psdRoot, layerMeta]);

    const handleExport = async () => {
        if (!psdRoot) return;
        try {
            // Re-collect visible layers/items based on current meta
            // For consistency let's re-pack based on *visible* layers in meta

            const packItems: PackItem[] = [];

            // Collection for Z-Index calculation (Front-to-Back)
            let allExportableLayers: PsdLayer[] = [];

            const traverse = (layer: PsdLayer) => {
                const meta = layerMeta[layer.id!];
                if (meta && meta.visible && layer.canvas && layer.id !== undefined) {
                    packItems.push({
                        id: layer.id.toString(),
                        width: layer.canvas.width,
                        height: layer.canvas.height,
                        image: layer.canvas
                    });
                    allExportableLayers.push(layer);
                }
                layer.children?.forEach(traverse);
            };
            traverse(psdRoot as PsdLayer);

            if (packItems.length === 0) {
                alert('No visible layers to export');
                return;
            }

            const packResult = await TexturePacker.pack(packItems);

            // Map back packed items to ExportItems with Z-Index
            const exportItems: ExportItem[] = [];
            const totalLayers = allExportableLayers.length;

            console.log('--- Exporting Layers ---');
            allExportableLayers.forEach((layer, index) => {
                const packed = packResult.items.find(p => p.id === layer.id!.toString());
                if (packed) {
                    // Default Front=High (Top of list = High Z)
                    // assuming ag-psd returns Back-to-Front (Standard)
                    const zIndex = index;

                    console.log(`Layer: ${layer.name}, Index: ${index}, Z-Index: ${zIndex}`);

                    exportItems.push({
                        packed: packed,
                        meta: layerMeta[layer.id!],
                        originalLayer: layer,
                        zIndex: zIndex
                    });
                }
            });

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
            alert('Export failed: ' + e);
        }
    };

    const handleSaveProject = () => {
        const projectData = {
            version: '1.0',
            layerMeta: layerMeta
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'project.json';
        link.click();
    };

    const handleLoadProject = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const data = JSON.parse(re.target?.result as string);
                    if (data.layerMeta) {
                        // Merge or Replace? 
                        // If we replace, we lose IDs for layers not in the JSON (if any).
                        // But project file should be authoritative.
                        // However, we must ensure IDs match PSD.
                        // We'll merge: update existing keys, keep others? Or strict replace?
                        // Let's Replace, assuming project matches PSD.
                        setLayerMeta(data.layerMeta);
                        alert('Project settings loaded.');
                    }
                } catch (err) {
                    console.error(err);
                    alert('Failed to load project file');
                }
            };
            reader.readAsText(file);
        };
        input.click();
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
                        onPsdUpdate={handlePsdUpdate}
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
                    />
                }
                onLoadPsd={() => document.getElementById('psd-upload-input')?.click()}
            />
        </>
    );
}

export default App;

