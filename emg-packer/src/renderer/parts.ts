import type { Psd } from 'ag-psd';
import type { PsdLayer } from './services/PsdLoader';
import type { LayerMeta } from './types';

/**
 * パーツ / フレームのビューモデル。
 *
 * `.emg` の実体は parts[] だが、エディタ側の状態はレイヤー単位の {@link LayerMeta} しか
 * 持っていない。「このパーツを switch にする」「この差分を既定にする」といった操作も、
 * プレビューを .emg と同じ見た目にすることも、パーツ単位の集約なしには書けないため、
 * ここで psdRoot + layerMeta から導出する。
 *
 * 導出であって状態ではない。partID はグループ名（LayerMeta.partId）が単一の出所。
 */

/** v0.5.0 §1.1。同じフレーム識別子を持つレイヤーは同時に表示される。 */
export interface FrameInfo {
    frameId: string;
    /** 背面→前面の順。 */
    layerIds: number[];
    /** frameName 由来（複数レイヤーをまとめたもの）か、単一レイヤー名か。 */
    named: boolean;
}

export interface PartInfo {
    partId: string;
    type: 'static' | 'switch';
    /** 背面→前面の順。canvas を持つ葉レイヤーのみ。 */
    layerIds: number[];
    /** switch のときのみ意味を持つ。 */
    frames: FrameInfo[];
    /** switch の既定フレーム（part.default になるもの）。 */
    defaultFrameId?: string;
    /** static の初期表示（v0.5.0 §4）。 */
    defaultVisible: boolean;
    /** 書き出し対象になっているレイヤー数。 */
    exportedCount: number;
}

/**
 * フレーム識別子。frameName があればそれ、無ければレイヤー名。
 * EmgGenerator が textureID をレイヤー名から作るため、名前なしの場合はそれと一致する。
 */
export function frameIdOf(layer: PsdLayer, meta: LayerMeta | undefined): string {
    return meta?.frameName ?? layer.name ?? `Layer_${layer.id}`;
}

/** 背面→前面（ag-psd の children 順）に、canvas を持つ葉レイヤーを列挙する。 */
export function flattenLayers(root: Psd | null): PsdLayer[] {
    if (!root) return [];
    const out: PsdLayer[] = [];
    const walk = (layer: PsdLayer) => {
        if (layer.canvas && layer.id !== undefined) out.push(layer);
        layer.children?.forEach(walk);
    };
    root.children?.forEach(child => walk(child as PsdLayer));
    return out;
}

export function buildParts(root: Psd | null, layerMeta: Record<number, LayerMeta>): PartInfo[] {
    const layers = flattenLayers(root);
    const byPart = new Map<string, PartInfo>();

    for (const layer of layers) {
        const meta = layerMeta[layer.id!];
        if (!meta) continue;

        let part = byPart.get(meta.partId);
        if (!part) {
            part = {
                partId: meta.partId,
                type: meta.type,
                layerIds: [],
                frames: [],
                defaultVisible: true,
                exportedCount: 0,
            };
            byPart.set(meta.partId, part);
        }

        part.layerIds.push(layer.id!);
        if (meta.visible) part.exportedCount++;

        const fid = frameIdOf(layer, meta);
        let frame = part.frames.find(f => f.frameId === fid);
        if (!frame) {
            frame = { frameId: fid, layerIds: [], named: meta.frameName !== undefined };
            part.frames.push(frame);
        }
        frame.layerIds.push(layer.id!);

        if (meta.isDefault) part.defaultFrameId = fid;
    }

    // 既定フレームが未設定の switch は先頭のフレームに倒す。EmgGenerator の
    // フォールバックと同じ挙動なので、UI の表示と書き出し結果が食い違わない。
    for (const part of byPart.values()) {
        if (part.type === 'switch' && !part.defaultFrameId) {
            part.defaultFrameId = part.frames[0]?.frameId;
        }
        // static は「全レイヤー非表示」のときだけパーツごと初期非表示になる
        // （recalculateMeta / EmgGenerator と同じ判定）。
        if (part.type === 'static') {
            part.defaultVisible = !part.layerIds.every(id => layerMeta[id]?.defaultVisible === false);
        }
    }

    return Array.from(byPart.values());
}
