import type { Psd, Layer } from 'ag-psd';

export type PartType = 'static' | 'switch';

/** UI に出す1パーツ分の情報。 */
export interface PartInfo {
    /** 生成される .emg の partID。 */
    partId: string;
    /** 自動判定の既定値（ルート直下が単独レイヤーなら static、グループなら switch）。 */
    defaultType: PartType;
    /** このパーツに属する、実際に書き出されるレイヤー数（画像を持つもの）。 */
    layerCount: number;
}

/** 1レイヤー分の解析結果。convert.ts が書き出しに使う。 */
export interface AnalyzedLayer {
    layer: Layer;
    partId: string;
    visible: boolean;
    opacity: number;
    blendMode: string;
}

// ag-psd は opacity を 0-255 で返すことがあるため 0.0-1.0 に正規化する
// （emg-packer/src/renderer/hooks/useEmgPacker.ts と同じ扱い）。
const normalizeOpacity = (v?: number): number => {
    if (typeof v !== 'number') return 1.0;
    return v > 1 ? v / 255 : v;
};

/**
 * PSD を走査して「実際に生成される partID」ごとのレイヤー一覧を作る。
 *
 * partID の決まり方は emg-packer の recalculateMeta() と同一にしてある:
 * ルート直下の名前を起点とし、**グループに入るたびに内側のグループ名で上書きされる**。
 * そのため「ルート直下の項目名」と「生成される partID」は一致しないことがある。
 *   体（レイヤー単体）→ partID "体"
 *   表情（グループ）
 *     └ 目（グループ）→ partID "目"   ← ルート直下は「表情」だが partID は「目」
 * UI でベース/差分を選ばせる単位は、この "実際の partID" でなければならない。
 */
export function analyzePsd(root: Psd): { parts: PartInfo[]; layers: AnalyzedLayer[] } {
    const layers: AnalyzedLayer[] = [];
    // ルート直下での既定 type を partID ごとに覚える（最初に現れたものを採用）。
    const defaultTypeByPart = new Map<string, PartType>();

    const traverse = (layer: Layer, inheritedPartId: string, inheritedType: PartType) => {
        const isGroup = !!layer.children && layer.children.length > 0;

        let partId = inheritedPartId;
        let type = inheritedType;
        if (isGroup) {
            partId = layer.name || `Group_${layer.id}`;
            type = 'switch';
        }

        if (!defaultTypeByPart.has(partId)) defaultTypeByPart.set(partId, type);

        if (isGroup) {
            layer.children?.forEach(child => traverse(child, partId, type));
            return;
        }

        // 画像を持つ葉レイヤーだけが .emg に書き出される。
        if (layer.canvas) {
            layers.push({
                layer,
                partId,
                visible: !layer.hidden,
                opacity: normalizeOpacity(layer.opacity),
                blendMode: layer.blendMode || 'normal',
            });
        }
    };

    root.children?.forEach(child => {
        const isGroup = !!child.children && child.children.length > 0;
        traverse(child, child.name || `Root_${child.id}`, isGroup ? 'switch' : 'static');
    });

    // レイヤーを1枚も持たない partID は UI に出しても選びようがないので除外する。
    const countByPart = new Map<string, number>();
    for (const l of layers) {
        countByPart.set(l.partId, (countByPart.get(l.partId) ?? 0) + 1);
    }

    const parts: PartInfo[] = [];
    for (const [partId, count] of countByPart) {
        parts.push({
            partId,
            defaultType: defaultTypeByPart.get(partId) ?? 'switch',
            layerCount: count,
        });
    }

    return { parts, layers };
}
