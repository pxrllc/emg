import JSZip from 'jszip';
import type { PackResult } from './TexturePacker';
import type { LayerMeta } from '../types';
import type { PackedItem } from './TexturePacker';
import type { Layer } from 'ag-psd';
import { generateDraftMapping } from './MappingGenerator';

export interface EmgData {
    version: string;
    /** v0.4.0 §2。理解できない実装に読ませてはならない機能の宣言。 */
    requiredExtensions?: string[];
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
    /**
     * v0.5.0 §4。パーツの初期表示。false のときのみ出力する。
     * static は「初期非表示のトグル」、switch は「初期状態でどのフレームも
     * 表示しない」を意味する（§4.3）。
     */
    defaultVisible?: boolean;
    default?: string; // v0.5.0 以降はフレーム識別子
    layers: EmgPartLayer[];
}

export interface EmgPartLayer {
    textureID: string;
    textureFile: string;
    /** v0.5.0 §2。同じ値を持つレイヤーは同時に表示される。 */
    frameName?: string;
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

        // textureZIndex（前面ほど大きい値）は呼び出し側が ExportItem.zIndex として渡す。
        // TexturePacker が items を高さ順に並べ替えるため、ここに届いた時点の配列順からは
        // 元の重なり順を復元できない。呼び出し側（useEmgPacker）がレイヤーツリーを
        // 上から走査した際の index を使って zIndex を計算している。
        // アトラスが複数枚に分割されている場合、レイヤーごとに参照先が異なる
        // （emg-json-spec.md 1.3）。単一枚なら従来どおり 'texture.png' の 1 種類。

        // packed.id（パッキング用の内部ID）→ 出力する textureID の対応。
        const packedIdToTextureId = new Map<string, string>();

        // textureID はレイヤー名から作り、同一パーツ内で重複したら連番サフィックスを付ける。
        // パーツをまたいだ重複は許容する（consumer 側は partID との組で識別するため）。
        const partLayerNames = new Map<string, Set<string>>();

        // Let's generate Parts
        for (const item of items) {
            const partId = item.meta.partId || item.originalLayer.name || 'undefined';

            if (!partsMap.has(partId)) {
                partsMap.set(partId, {
                    partID: partId,
                    type: item.meta.type as 'static' | 'switch',
                    // 後段で値を入れる。ここでキーを作っておくと JSON の並びが
                    // partID / type / defaultVisible / default / layers になって読みやすい
                    // （undefined のキーは JSON.stringify が省く）。
                    defaultVisible: undefined,
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
                // v0.5.0 §1.2: default はフレーム識別子で解決される。
                part.default = item.meta.frameName ?? textureId;
            }
            // Fallback default
            if (part.type === 'switch' && !part.default) {
                part.default = textureId;
            }

            // Calculate UV / Atlas coords
            // v0.2.2 uses x,y,width,height in ATLAS pixels.

            part.layers.push({
                textureID: textureId,
                ...(item.meta.frameName ? { frameName: item.meta.frameName } : {}),
                textureFile: packResult.atlases[item.packed.atlasIndex].textureFile,
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

        // v0.5.0 §2.6: 1 フレームに 2 枚以上のレイヤーが属する場合のみ宣言する。
        // 未対応の実装はそのファイルを描画できないうえ、失敗として検知もできないため。
        // フレームが 1 枚ずつなら frameName は単なる別名であり、宣言は不要
        // （不必要に古い実装を締め出さない）。
        // v0.5.0 §4: 全レイヤーが PSD で非表示だった static パーツは、
        // 捨てずに「初期非表示」として書き出す（帽子や眼鏡を後から出せるようにする）。
        // 一部だけ非表示のパーツは従来どおり見えているレイヤーのみを持つ。
        // v0.5.0 §4.3: switch パーツも defaultVisible: false を取れる。
        // 「チーク／青ざめのどれか」でありながら「どれも出ていない」のが常態、
        // という対象のための状態。isDefault が 1 つも立っていないことで表す。
        for (const part of emgParts) {
            const partItems = items.filter(i => i.meta.partId === part.partID);
            if (partItems.length === 0) continue;

            if (part.type === 'static') {
                if (partItems.every(i => i.meta.defaultVisible === false)) {
                    part.defaultVisible = false;
                }
            } else if (!partItems.some(i => i.meta.isDefault)) {
                part.defaultVisible = false;
            }
        }

        const hasMultiLayerFrame = emgParts.some(part => {
            const counts = new Map<string, number>();
            for (const l of part.layers) {
                const fid = l.frameName ?? l.textureID;
                counts.set(fid, (counts.get(fid) ?? 0) + 1);
            }
            return [...counts.values()].some(n => n > 1);
        });

        // v0.5.0 §4.7: switch での defaultVisible: false は宣言が必須。
        // 未対応の実装は default のフレームを描いてしまい、出ないはずのチークが
        // 出続ける（= 誤った絵）ため。static のみの場合は宣言してはならない。
        const hasSwitchNone = emgParts.some(p => p.type === 'switch' && p.defaultVisible === false);

        const requiredExtensions = [
            ...(hasMultiLayerFrame ? ['EMG_frame_name'] : []),
            ...(hasSwitchNone ? ['EMG_switch_none'] : []),
        ];

        return {
            version: '0.5.3',
            ...(requiredExtensions.length > 0 ? { requiredExtensions } : {}),
            baseCanvasWidth: psdWidth,
            baseCanvasHeight: psdHeight,
            textures: packResult.atlases.map(a => ({
                textureFile: a.textureFile,
                width: a.width,
                height: a.height
            })),
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

        // 1. Save Textures
        // アトラスは複数枚になりうる（emg-json-spec.md 1.3）。エントリ名は
        // createData が textures[] に書くものと一致させる必要がある。
        for (const atlas of packResult.atlases) {
            const textureBlob = await new Promise<Blob | null>(resolve =>
                atlas.canvas.toBlob(resolve, 'image/png')
            );
            if (!textureBlob) throw new Error(`Failed to generate texture blob: ${atlas.textureFile}`);
            zip.file(atlas.textureFile, textureBlob);
        }

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

