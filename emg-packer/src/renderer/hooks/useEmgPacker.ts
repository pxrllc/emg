import { useState, useEffect, useMemo } from 'react';
import { PsdLoader, FileLoader, PsdLayer } from '../services/PsdLoader';
import { Psd } from 'ag-psd';
import { TexturePacker, PackItem, PackResult } from '../services/TexturePacker';
import { EmgGenerator, ExportItem, EmgData } from '../services/EmgGenerator';
import { PreviewItem } from '../components/PreviewPanel';
import type { LayerMeta } from '../types';
import type { ToastMessage } from '../components/Toast';

// ag-psd returns opacity as 0-255; normalize to 0.0-1.0
const normalizeOpacity = (v?: number): number => {
    if (typeof v !== 'number') return 1.0;
    return v > 1 ? v / 255 : v;
};

const recalculateMeta = (root: Psd, currentMeta: Record<number, LayerMeta>): Record<number, LayerMeta> => {
    const newMeta = { ...currentMeta };

    const traverse = (layer: PsdLayer, defaultPartId: string, defaultType: 'static' | 'switch') => {
        const isGroup = layer.children && layer.children.length > 0;
        
        let currentPartId = defaultPartId;
        let currentType = defaultType;
        
        if (isGroup) {
            currentPartId = layer.name || `Group_${layer.id}`;
            currentType = 'switch';
        }

        if (layer.id !== undefined) {
            if (!newMeta[layer.id]) {
                newMeta[layer.id] = {
                    id: layer.id,
                    partId: currentPartId,
                    type: currentType,
                    visible: !layer.hidden,
                    opacity: normalizeOpacity(layer.opacity),
                    blendMode: layer.blendMode || 'normal'
                };
            } else {
                newMeta[layer.id].partId = currentPartId;
            }
        }
        
        if (isGroup) {
            layer.children?.forEach(l => traverse(l, currentPartId, currentType));
        }
    };

    root.children?.forEach(child => {
        const isGroup = child.children && child.children.length > 0;
        const pid = child.name || `Root_${child.id}`;
        const ptype = isGroup ? 'switch' : 'static';
        
        traverse(child, pid, ptype);
    });

    return newMeta;
};

export function useEmgPacker() {
    const [psdRoot, setPsdRoot] = useState<Psd | null>(null);
    const [packedTextureUrl, setPackedTextureUrl] = useState<string | null>(null);
    const [selectedLayer, setSelectedLayer] = useState<PsdLayer | null>(null);
    const [layerMeta, setLayerMeta] = useState<Record<number, LayerMeta>>({});
    const [compositionItems, setCompositionItems] = useState<PreviewItem[]>([]);
    const [packResult, setPackResult] = useState<PackResult | null>(null);
    const [toast, setToast] = useState<ToastMessage | null>(null);

    const handlePsdLoad = async (file: File) => {
        try {
            const root = await FileLoader.load(file);
            const initialMeta = recalculateMeta(root, {});
            setLayerMeta(initialMeta);
            setPsdRoot(root);
        } catch (e) {
            console.error('Failed to load file:', e);
            alert(String(e instanceof Error ? e.message : e));
        }
    };

    const handlePsdUpdate = (newRoot: Psd) => {
        const newMeta = recalculateMeta(newRoot, layerMeta);
        setLayerMeta(newMeta);
        setPsdRoot(newRoot);
    };

    useEffect(() => {
        if (!psdRoot) return;

        const packItems: PackItem[] = [];
        const previewItems: PreviewItem[] = [];

        const traverse = (layer: PsdLayer) => {
            if (layer.id === undefined) {
                layer.children?.forEach(traverse);
                return;
            }
            const meta = layerMeta[layer.id];
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
        traverse(psdRoot);

        setCompositionItems(previewItems);

        const runPack = async () => {
            if (packItems.length > 0) {
                try {
                    console.log(`Packing ${packItems.length} items...`);
                    const res = await TexturePacker.pack(packItems);
                    setPackResult(res);
                    setPackedTextureUrl(res.canvas.toDataURL());
                } catch (e) {
                    console.error("Packing failed", e);
                    setPackResult(null);
                    setPackedTextureUrl(null);
                }
            } else {
                setPackResult(null);
                setPackedTextureUrl(null);
            }
        };
        runPack();
    }, [psdRoot, layerMeta]);

    const handleVisibilityAll = (visible: boolean) => {
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id in next) {
                next[id] = { ...next[id], visible };
            }
            return next;
        });
    };

    const handleTypeAll = (type: 'static' | 'switch') => {
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id in next) {
                next[id] = { ...next[id], type };
            }
            return next;
        });
    };

    const handleLayerVisibilityChange = (layer: any, visible: boolean) => {
        const psdLayer = layer as PsdLayer;
        if (psdLayer.id === undefined) return;

        // Collect this layer and all its descendants
        const ids: number[] = [psdLayer.id];
        const collectDescendants = (l: PsdLayer) => {
            l.children?.forEach(child => {
                if (child.id !== undefined) ids.push(child.id);
                collectDescendants(child);
            });
        };
        collectDescendants(psdLayer);

        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of ids) {
                if (next[id]) next[id] = { ...next[id], visible };
            }
            return next;
        });
    };

    const emgData = useMemo((): EmgData | undefined => {
        if (!psdRoot) return undefined;

        // Return minimal structure while waiting for pack result (enables JSON tab immediately)
        if (!packResult) {
            return {
                version: '0.2.2',
                baseCanvasWidth: psdRoot.width || 0,
                baseCanvasHeight: psdRoot.height || 0,
                textures: [],
                parts: [],
                sprites: []
            };
        }

        const exportItems: ExportItem[] = [];
        const allExportableLayers: PsdLayer[] = [];

        const traverse = (layer: PsdLayer) => {
            if (layer.id !== undefined && layerMeta[layer.id]?.visible && layer.canvas) {
                allExportableLayers.push(layer);
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot as PsdLayer);

        const totalLayers = allExportableLayers.length;

        allExportableLayers.forEach((layer, index) => {
            const packed = packResult.items.find(p => p.id === layer.id!.toString());
            if (packed && layerMeta[layer.id!]) {
                exportItems.push({
                    packed: packed,
                    meta: layerMeta[layer.id!],
                    originalLayer: layer,
                    zIndex: totalLayers - 1 - index // Front (index=0) gets highest Z
                });
            }
        });

        return EmgGenerator.createData(packResult, exportItems, psdRoot.width, psdRoot.height);
    }, [packResult, psdRoot, layerMeta]);

    const handleExport = async () => {
        if (!psdRoot) return;
        try {
            const packItems: PackItem[] = [];
            const allExportableLayers: PsdLayer[] = [];

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

            const result = await TexturePacker.pack(packItems);
            const exportItems: ExportItem[] = [];
            const totalLayers = allExportableLayers.length;

            console.log('--- Exporting Layers ---');
            allExportableLayers.forEach((layer, index) => {
                const packed = result.items.find(p => p.id === layer.id!.toString());
                const meta = layerMeta[layer.id!];
                if (packed && meta) {
                    // Front layer (index=0) gets highest Z-Index
                    const zIndex = totalLayers - 1 - index;
                    console.log(`Layer: ${layer.name}, Index: ${index}, Z-Index: ${zIndex}`);
                    exportItems.push({
                        packed: packed,
                        meta: meta,
                        originalLayer: layer,
                        zIndex: zIndex
                    });
                }
            });

            if (!psdRoot.width || !psdRoot.height) {
                throw new Error("PSD dimensions missing");
            }

            const blob = await EmgGenerator.generate(
                result,
                exportItems,
                psdRoot.width,
                psdRoot.height
            );

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'model.emg';
            link.click();

            setToast({
                title: 'Export Complete',
                body: `model.emg (${exportItems.length} layers)`
            });
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

    return {
        psdRoot,
        packedTextureUrl,
        selectedLayer,
        layerMeta,
        compositionItems,
        packResult,
        emgData,
        handlePsdLoad,
        handlePsdUpdate,
        handleLayerVisibilityChange,
        handleExport,
        handleSaveProject,
        handleLoadProject,
        handleVisibilityAll,
        handleTypeAll,
        setSelectedLayer,
        setLayerMeta,
        toast,
        setToast,
    };
}
