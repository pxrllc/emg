import type { EmgData, EmgPart } from './EmgGenerator';

export interface EmgSemanticMapping {
    avatarId: string;
    baseMapping: {
        blinkPartKey?: string;
        blink: { open: string; half: string; closed: string };
        lipSyncPartKey?: string;
        lipSync: { open?: string; a: string; i: string; u: string; e: string; o: string; n: string };
    };
    expressions: Record<string, {
        parts?: Record<string, string[]>;
        eyebrow?: string;
        other?: string[];
        overrides?: {
            blink?: { open: string; half: string; closed: string };
            lipSync?: { a: string; i: string; u: string; e: string; o: string; n: string };
        };
    }>;
}

const BLINK_KEYWORDS = ['eye', 'eyes', 'blink', '瞳', '目'];
const LIP_SYNC_KEYWORDS = ['mouth', 'lip', '口'];

function findPartByKeyword(parts: EmgPart[], keywords: string[]): EmgPart | undefined {
    return parts.find(part =>
        part.type === 'switch' &&
        keywords.some(kw => part.partID.toLowerCase().includes(kw.toLowerCase()))
    );
}

/** blink / lipSync に選ばれるパーツを求める。generateDraftMapping と同じ判定。 */
function resolveRolePairs(parts: EmgPart[]): { blink?: EmgPart; lipSync?: EmgPart } {
    const blink = findPartByKeyword(parts, BLINK_KEYWORDS);
    const lipSync = blink
        ? findPartByKeyword(parts.filter(p => p !== blink), LIP_SYNC_KEYWORDS)
        : findPartByKeyword(parts, LIP_SYNC_KEYWORDS);
    return { blink, lipSync };
}

/**
 * 生成される mapping.json が **明示的に**掌握する partID。
 *
 * emg-json-spec.md 7.3: `blinkPartKey` / `lipSyncPartKey` で指定された partID を
 * `targetPartID` に持つ `sprites[]` は自律発火してはならない。mapping.json 側が
 * そのパーツの表示を決めるため、両方が動くと取り合いになる。
 *
 * 判定を generateDraftMapping と共有するのは、片方だけ変えると
 * 「mapping は掌握しているのに sprite も自律再生する」ファイルが出てしまうため。
 */
export function findMappingControlledParts(parts: EmgPart[]): Set<string> {
    const { blink, lipSync } = resolveRolePairs(parts);
    // 候補が片方も無ければ mapping.json 自体を出さない（generateDraftMapping と同じ条件）。
    if (!blink && !lipSync) return new Set();

    const out = new Set<string>();
    if (blink) out.add(blink.partID);
    if (lipSync) out.add(lipSync.partID);
    return out;
}

/**
 * emg-mapping-spec.md の「自動生成ヒューリスティック」節（非規範的・推奨アルゴリズム）に基づき、
 * partID のキーワードから最小限の mapping.json ドラフトを生成する。
 *
 * blink/lipSync 候補パーツが見つからない場合（senti.emg のように全レイヤーが単一パーツにまとまっている等）
 * は null を返し、mapping.json 自体を生成しない。
 *
 * blink/lipSync のレイヤー単位の状態（open/half/closed, 母音別）は、対象パーツがちょうど3レイヤー構成の
 * 場合のみ位置的フォールバックで仮埋めする（emg-mapping-spec.md の「既知の制限」参照）。それ以外は
 * 空文字列のプレースホルダーとして残し、ユーザーの手動編集を前提としたドラフトにする。
 */
export function generateDraftMapping(emgData: EmgData): EmgSemanticMapping | null {
    const { blink: blinkPart, lipSync: lipSyncPart } = resolveRolePairs(emgData.parts);

    if (!blinkPart && !lipSyncPart) return null;

    const blink = { open: '', half: '', closed: '' };
    if (blinkPart && blinkPart.layers.length === 3) {
        blink.open = blinkPart.layers[0].textureID;
        blink.half = blinkPart.layers[1].textureID;
        blink.closed = blinkPart.layers[2].textureID;
    }

    return {
        avatarId: 'avatar',
        baseMapping: {
            blinkPartKey: blinkPart?.partID,
            blink,
            lipSyncPartKey: lipSyncPart?.partID,
            lipSync: { open: '', a: '', i: '', u: '', e: '', o: '', n: '' }
        },
        expressions: {
            default: {}
        }
    };
}
