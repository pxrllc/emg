import JSZip from 'jszip';
import type { PackResult } from './TexturePacker';
import type { LayerMeta } from '../types';
import type { PackedItem } from './TexturePacker';
import type { Layer } from 'ag-psd';

export interface EmgData {
    version: string;
    width: number;
    height: number;
    parts: EmgPart[];
    textures: EmgTexture[];
    layers: EmgLayer[];
    sprites: EmgSprite[];
}

export interface EmgPart {
    partID: string;
    type: 'static' | 'switch';
}

export interface EmgTexture {
    id: string;
    src: string;
    width: number;
    height: number;
}

export interface EmgLayer {
    layerID: string;
    partID: string;
    textureID: string;
    x: number;
    y: number;
    width: number;
    height: number;
    uv: {
        u: number; // x
        v: number; // y
        w: number; // width
        h: number; // height
    };
    opacity: number;
    blendMode: string;
    visible: boolean;
    zIndex: number;
}

export interface EmgSprite {
    // For MVP, we might not generate sprites yet or just basics
}

export type ExportItem = {
    packed: PackedItem;
    meta: LayerMeta;
    originalLayer: Layer;
};

export class EmgGenerator {
    static createData(
        packResult: PackResult,
        items: ExportItem[],
        psdWidth: number,
        psdHeight: number
    ): EmgData {
        // Collect unique parts
        const partsMap = new Map<string, EmgPart>();
        const layers: EmgLayer[] = [];

        // Assuming we want to sort layers by some order? (PSD order usually: bottom to top for Z?)
        // But `items` comes from packedItems which might be sorted by size.
        // We should probably rely on Z-index or just use the order provided if we sort it before calling.
        // For now we just assign Z-index based on iteration order, so caller should sort if needed.

        let zIndexCounter = 0;

        for (const { packed, meta, originalLayer } of items) {
            // Ensure part exists
            // Use meta.partId if available, fallback to layer name?
            const partId = meta?.partId || originalLayer.name || '';
            const type = meta?.type || 'static'; // Default type

            if (!partsMap.has(partId)) {
                partsMap.set(partId, {
                    partID: partId,
                    type: type as any // Cast for now
                });
            }

            // UV calc (normalized 0-1)
            const u = packed.x / packResult.width;
            const v = packed.y / packResult.height;
            const w = packed.width / packResult.width;
            const h = packed.height / packResult.height;

            layers.push({
                layerID: packed.id,
                partID: partId,
                textureID: '0',
                x: originalLayer.left || 0,
                y: originalLayer.top || 0,
                width: packed.width,
                height: packed.height,
                uv: { u, v, w, h },
                opacity: originalLayer.opacity != null ? originalLayer.opacity / 255 : 1.0, // ag-psd opacity is 0-255
                blendMode: originalLayer.blendMode || 'normal',
                visible: !originalLayer.hidden,
                zIndex: zIndexCounter++
            });
        }

        return {
            version: '0.2.2',
            width: psdWidth,
            height: psdHeight,
            parts: Array.from(partsMap.values()),
            textures: [{
                id: '0',
                src: 'texture_0.png',
                width: packResult.width,
                height: packResult.height
            }],
            layers: layers,
            sprites: []
        };
    }

    static async generate(
        packResult: PackResult,
        items: ExportItem[],
        psdWidth: number,
        psdHeight: number
    ): Promise<Blob> {
        const zip = new JSZip();

        // 1. Save Texture
        const textureName = 'texture_0.png';
        const textureBlob = await new Promise<Blob | null>(resolve =>
            packResult.canvas.toBlob(resolve, 'image/png')
        );
        if (!textureBlob) throw new Error('Failed to generate texture blob');
        zip.file(textureName, textureBlob);

        // 2. Generate JSON
        const emgData = EmgGenerator.createData(packResult, items, psdWidth, psdHeight);
        zip.file('data.json', JSON.stringify(emgData, null, 2));

        return await zip.generateAsync({ type: 'blob' });
    }
}
