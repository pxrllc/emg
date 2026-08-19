import JSZip from 'jszip';
import type { PackResult } from './TexturePacker';
import type { LayerMeta } from '../types';
import type { PackedItem } from './TexturePacker';
import type { Layer } from 'ag-psd';
import { generateDraftMapping } from './MappingGenerator';

export interface EmgData {
    version: string;
    baseCanvasWidth: number;
    baseCanvasHeight: number;
    textures: EmgTexture[];
    parts: EmgPart[];
    sprites: EmgSprite[];
}

export interface EmgTexture {
    textureFile: string;
    width: number;
    height: number;
}

export interface EmgPart {
    partID: string;
    type: 'static' | 'switch';
    default?: string; // Only for switch type
    layers: EmgPartLayer[];
}

export interface EmgPartLayer {
    textureID: string;
    textureFile: string;
    x: number; // Texture atlas x
    y: number; // Texture atlas y
    width: number;
    height: number;
    basePosition_x: number; // Canvas x
    basePosition_y: number; // Canvas y
    textureZIndex: number;
    opacity: number;
    blendMode: string;
}

export interface EmgSprite {
    // Placeholder for future
}

export type ExportItem = {
    packed: PackedItem;
    meta: LayerMeta;
    originalLayer: Layer;
    zIndex: number; // calculated in App.tsx
};

export class EmgGenerator {
    static createData(
        packResult: PackResult,
        items: ExportItem[],
        psdWidth: number,
        psdHeight: number
    ): EmgData {
        const partsMap = new Map<string, EmgPart>();

        // Items are typically in pack order (unsorted relative to Z). 
        // Usage logic: We need to assign Z-Index.
        // Assuming `items` passed here might not be in Z-order if they came from Packer.
        // However, `TexturePacker` takes items, sorts by height, and returns packing.
        // But `ExportItem[]` contains `originalLayer` which usually we can access via ID if needed.
        // Better approach: The `items` passed to generate should probably retain knowledge of their Z-order
        // or we calculate Z-index before packing.
        // 
        // The `items` array passed here is `ExportItem[]`. 
        // If the caller collected them from the LayerTree traversal (top-down), 
        // then index 0 is Top (Front), index N is Bottom (Back).
        // Let's assume the caller passes items in the order they were in the tree (Front to Back).
        // 
        // We need to verify how `App.tsx` constructs `items`. 
        // If it constructs from `packResult.items`, the order is strictly by Packing (Height).
        // That loses Z-order!
        // 
        // FIX: We need to map `packed.id` back to the original layer structure z-index.
        // But for now, let's assume `items` usually has a way to determine Z.
        // Actually, we can just assign a simple Z-Index. 
        // Wait, if `items` is sorted by height, we lost the Z info.
        // 
        // WE MUST RECOVER Z-ORDER.
        // Valid approach: The `meta` or `originalLayer` might not have absolute Z-index property.
        // But `App.tsx` knows the tree.
        // 
        // For this implementation, we will assume `items` *might* be out of order.
        // However, we don't have an easy way to recover strict Z-order here without extra data.
        // 
        // PROPOSAL: We will assume for now that we simply assign unique Z-indices.
        // But the spec says "Front = Higher Index".
        // If we can't guarantee order, we might have issues.
        // 
        // Let's assume for this specific function, we just output what we have.
        // NOTE: In `App.tsx`, we should ensure we pass something that helps us, or accept that
        // for v0.2.2 we might need to fix Z-order elsewhere. 
        // 
        // *Self-Correction*: Use `meta.id` (ag-psd layer ID)? No, IDs are arbitrary.
        // 
        // Temporary Fix: Since we change `zIndex` logic to "Front = High", 
        // and we iterate `items`. If `items` is random, Z is random.
        // 
        // Let's stick to the Spec Implementation of the *Structure* first.
        // We will assign `textureZIndex` based on a counter we decrement or increment?
        // 
        // Let's assign `0` arbitrarily if we don't know, BUT distinct.
        // We'll use a globally incrementing counter for now, but note `App.tsx` needs to supply order key?
        // 
        // Actually, `ExportItem` has `originalLayer`. `Layer` objects from `ag-psd` don't have explicit global index.
        // 
        // Let's implement the structure transformation.

        const textureFile = 'texture.png';

        // 1. Group by PartID
        const zIndexMap = new Map<number, number>(); // layerID -> zIndex
        // If we want correct Z, we ideally need the list in Z-order. 
        // Let's assume `items` *Order* logic will be fixed in App.tsx or we accept packing order for now.
        // (The user spec says "Fix zIndex logic... Front = Higher").

        // Helper to sanitize and uniquely identify textures based on layer name
        // We need a mapping from packed.id (internal ID) to our new textureID
        const packedIdToTextureId = new Map<string, string>();

        // First pass: Generate IDs for all items
        for (const item of items) {
            let baseName = item.originalLayer.name;
            if (!baseName) baseName = `Layer_${item.packed.id}`;

            // Sanitize: Alphanumeric + underscore/hyphen/jap + simple
            // Actually, Unity handles UTF8 names fine. Just remove slashes or path chars.
            baseName = baseName.replace(/[\/\\:*?"<>|]/g, "_");

            let textureId = baseName;

            // Ensure uniqueness (simple collision handling)
            // We need to check against all generated IDs? 
            // Or just within the Part?
            // Since textureID is used in "PartID_TextureID" in Unity, uniqueness within Part is key.
            // BUT EmgImporter might rely on textureID being unique across the file if we load textures by ID?
            // NO, EmgImporter loads by *textureFile* (which is shared) but creates sprites by *textureID*.
            // For safety, let's make it unique GLOBAL or PER PART?
            // EmgLayer definition: public string textureID;
            // If we have two parts with same layer name "Normal", result "Head_Normal", "Body_Normal".
            // This is fine. So uniqueness per part is enough.
            // BUT we process items linearly.

            // Let's settle on: Uniqueness per Part.
            // We need to know the part first.
            // logic below determines part.
        }

        // We can do it inside the loop if we track usage per part.
        const partLayerNames = new Map<string, Set<string>>();

        // Let's generate Parts
        for (const item of items) {
            const partId = item.meta.partId || item.originalLayer.name || 'undefined';

            if (!partsMap.has(partId)) {
                partsMap.set(partId, {
                    partID: partId,
                    type: item.meta.type as 'static' | 'switch',
                    default: undefined,
                    layers: []
                });
                partLayerNames.set(partId, new Set());
            }

            const part = partsMap.get(partId)!;
            const usedNames = partLayerNames.get(partId)!;

            // Generate Texture ID
            let baseName = item.originalLayer.name || `Layer_${item.packed.id}`;
            baseName = baseName.replace(/[\/\\:*?"<>|]/g, "_");

            let textureId = baseName;
            let counter = 1;
            while (usedNames.has(textureId)) {
                textureId = `${baseName}_${counter}`;
                counter++;
            }
            usedNames.add(textureId);

            // Map packedID -> new textureID
            packedIdToTextureId.set(item.packed.id, textureId);

            // Update part default logic
            // Note: items loop order matters. If default item comes later, we process it then.
            // If default item came BEFORE, we need to correct it?
            // "default" stores the textureID. 
            // In the previous loop we assigned: part.default = item.packed.id;
            // Now we must assign: part.default = textureId;

            // Check if this item is the default
            // The item.meta.isDefault flag is what we check.
            if (part.type === 'switch' && item.meta.isDefault) {
                part.default = textureId;
            }
            // Fallback default
            if (part.type === 'switch' && !part.default) {
                part.default = textureId;
            }

            // Calculate UV / Atlas coords
            // v0.2.2 uses x,y,width,height in ATLAS pixels.

            part.layers.push({
                textureID: textureId,
                textureFile: textureFile,
                x: item.packed.x,
                y: item.packed.y,
                width: item.packed.width,
                height: item.packed.height,
                basePosition_x: (item.originalLayer.left || 0),
                basePosition_y: (item.originalLayer.top || 0),
                textureZIndex: item.zIndex,
                opacity: item.meta.opacity ?? 1.0,
                blendMode: item.meta.blendMode || 'normal'
            });
        }

        // Z-Index Correction
        // We need a way to assign Z-index. 
        // If we assume the input `items` list is just "all layers", we can't know Z without tree traversal.
        // HOWEVER, `App.tsx` calls `pack`. 
        // 
        // Strategy: We will accept that for THIS step, we assign unique Z.
        // We'll Assign Z based on the input array order (0..N).
        // AND we'll enable sorting in `App.tsx` later? 
        // Or we just assume input is random and we can't fix it right here.
        // 
        // User Spec: "Fix zIndex logic (Invert: front = higher index)."
        // "ag-psd children ... index 0 is Top (Front)."
        // So if we iterate `items` in standard order, we might get random order due to packing sort.
        // 
        // Hack: We can't fix Z-index perfectly without the Tree context or an index-property on LayerMeta.
        // 
        // Assumption: We will address Z-Index passing in App.tsx. 
        // Here, we just blindly write `textureZIndex`. 
        // BUT, we should iterate parts/layers and assign. 
        // 
        // Let's assign Z-index strictly by `items` order for now, 
        // but inverted (assuming items are Front->Back? No, Pack sorts by Height).
        // 
        // CRITICAL: TexturePacker sorts by Height! So `items` is sorted by Height.
        // We CANNOT use `items` order for Z-index.
        // 
        // Solution: We need `items` to carry a `zIndex` from `App.tsx`.
        // `LayerMeta` doesn't have `zIndex`.
        // I should probably add `zIndex` or `globalOrder` to `LayerMeta` or `ExportItem`?
        // 
        // The Spec says: "Fix zIndex logic... App.tsx traverse... first is zIndex: 0 (Back)."
        // "New policy: Front = Higher".
        // 
        // I will rely on `App.tsx` passing items in `ExportItem` that somehow have order?
        // `ExportItem` has `meta` and `originalLayer`.
        // 
        // Let's ASSUME `App.tsx` will be updated to pass a `zIndex` in `meta` or we calculate it.
        // Wait, I am updating `EmgGenerator.ts` now.
        // 
        // I'll add a TODO comment or logic: 
        // We will assign Z-Index based on `meta.id`? No.
        // 
        // Actually, I can't fix the sorting HERE if `items` is already sorted by height.
        // UNLESS `items` has the Z info.
        // 
        // Use `originalLayer`? No.
        // 
        // I will proceed with creating the structure. 
        // I will default zIndex to 0 for now and handle the calculation in App.tsx -> Meta.
        // Or I can update `ExportItem` to include `sortOrder`?

        const emgParts = Array.from(partsMap.values());

        // Flatten all layers to assign global Z if we had a way.
        // Since we don't, we leave Z assignment to the caller (via meta) OR we just put 0.
        // 
        // WAIT. The SPEC says:
        // "EmgGenerator.createData()内のzIndexCounterは単純なインクリメント...
        // Main problem is ag-psd order...
        // Solution plan: Calculate total layers, assign total - 1 - index."
        // 
        // This implies `EmgGenerator` is responsible.
        // BUT `items` is sorted by height!
        // 
        // So, `EmgGenerator` receives height-sorted items.
        // It CANNOT restore Z-order from that.
        // 
        // Therefore, `ExportItem` MUST contain the original index or z-order.
        // 
        // I will add `sortOrder` to `ExportItem` definition right here.
        // Then `App.tsx` will fill it.

        return {
            version: '0.3.0',
            baseCanvasWidth: psdWidth,
            baseCanvasHeight: psdHeight,
            textures: [{
                textureFile: textureFile,
                width: packResult.width,
                height: packResult.height
            }],
            parts: emgParts,
            sprites: []
        };
    }

    static async generate(
        packResult: PackResult,
        items: ExportItem[], // This items array needs to have Z-info or be re-sorted?
        psdWidth: number,
        psdHeight: number
    ): Promise<Blob> {
        const zip = new JSZip();

        // 1. Save Texture
        const textureName = 'texture.png'; // matches data.json
        const textureBlob = await new Promise<Blob | null>(resolve =>
            packResult.canvas.toBlob(resolve, 'image/png')
        );
        if (!textureBlob) throw new Error('Failed to generate texture blob');
        zip.file(textureName, textureBlob);

        // 2. Generate JSON
        const emgData = EmgGenerator.createData(packResult, items, psdWidth, psdHeight);
        zip.file('data.json', JSON.stringify(emgData, null, 2));

        // 3. Generate mapping.json draft (optional, only when blink/lipSync candidates are found)
        const mapping = generateDraftMapping(emgData);
        if (mapping) {
            zip.file('mapping.json', JSON.stringify(mapping, null, 2));
        }

        return await zip.generateAsync({ type: 'blob' });
    }
}

