import type { Psd, Layer } from 'ag-psd';

export type PartType = 'static' | 'switch';

/** UI に出す1パーツ分の情報。 */
export interface PartInfo {
    /** 生成される .emg の partID。 */
    partId: string;
    /** 自動判定の既定値（単独レイヤーは static、グループは中身の可視状態から推定）。 */
    defaultType: PartType;
    /** このパーツに属する、実際に書き出されるレイヤー数（画像を持つもの）。 */
    layerCount: number;
}

/** 1レイヤー分の解析結果。convert.ts が書き出しに使う。 */
export interface AnalyzedLayer {
    layer: Layer;
    partId: string;
    /**
     * v0.5.0 §2。このレイヤーが属するフレームの名前。
     * PSD で「@」始まりのグループに入っている場合に付く。
     */
    frameName?: string;
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

    // 「@」始まりのグループは *フレーム* グループとして扱う（v0.5.0 §2 の frameName）。
    // 通常のグループはこれまでどおりパーツ。接頭辞を opt-in にすることで、
    // 既存の PSD の解釈は一切変わらない（emg-packer 側と同じ規則）。
    //
    //   衣装        （グループ）→ partID = 衣装
    //     @制服     （グループ）→ frameName = 制服（partID は 衣装 のまま）
    //       上着
    //       スカート
    const FRAME_GROUP_PREFIX = '@';

    /**
     * グループが差分パーツ（switch）か、重ねて使うパーツ（static）かを推定する。
     * emg-packer の useEmgPacker.inferGroupType と同一の規則。両者が食い違うと、
     * 同じ PSD から違う .emg が出てしまう。
     *
     * 以前は「グループなら常に switch」だったため、`Body`（体・脚・スカート…を
     * 重ねて 1 つの体にするグループ）まで差分扱いになり、書き出した .emg では
     * 10 枚のうち 1 枚しか描かれなかった。差分グループは PSD 上で「1 つだけ表示
     * して残りは非表示」にしてある、という慣習を判定に使う。
     */
    const inferGroupType = (layer: Layer): PartType => {
        const leaves = (layer.children ?? []).filter(c => !c.children || c.children.length === 0);
        if (leaves.length === 0) return 'static';
        const hidden = leaves.filter(c => c.hidden).length;
        const visible = leaves.length - hidden;
        return hidden > 0 && hidden >= visible ? 'switch' : 'static';
    };

    const traverse = (
        layer: Layer,
        inheritedPartId: string,
        inheritedType: PartType,
        inheritedFrameName?: string
    ) => {
        const isGroup = !!layer.children && layer.children.length > 0;

        let partId = inheritedPartId;
        let type = inheritedType;
        let frameName = inheritedFrameName;
        if (isGroup) {
            const name = layer.name || `Group_${layer.id}`;
            if (name.startsWith(FRAME_GROUP_PREFIX)) {
                frameName = name.slice(FRAME_GROUP_PREFIX.length);
                type = 'switch';   // フレームを持つ以上、親は排他パーツ
            } else {
                partId = name;
                type = inferGroupType(layer);
                frameName = undefined;
            }
        }

        if (!defaultTypeByPart.has(partId)) defaultTypeByPart.set(partId, type);

        if (isGroup) {
            layer.children?.forEach(child => traverse(child, partId, type, frameName));
            return;
        }

        // 画像を持つ葉レイヤーだけが .emg に書き出される。
        if (layer.canvas) {
            layers.push({
                layer,
                partId,
                frameName,
                visible: !layer.hidden,
                opacity: normalizeOpacity(layer.opacity),
                blendMode: layer.blendMode || 'normal',
            });
        }
    };

    root.children?.forEach(child => {
        const isGroup = !!child.children && child.children.length > 0;
        traverse(child, child.name || `Root_${child.id}`, isGroup ? inferGroupType(child) : 'static');
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
