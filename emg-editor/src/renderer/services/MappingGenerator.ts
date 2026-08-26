import type { EmgData, EmgPart } from './EmgGenerator';
import type { AvatarExpression, AvatarMapping, AvatarPreset } from '../types';

export interface EmgSemanticMapping {
    avatarId: string;
    baseMapping: {
        blinkPartKey?: string;
        blink: { open: string; half: string; closed: string };
        lipSyncPartKey?: string;
        lipSync: { open?: string; a: string; i: string; u: string; e: string; o: string; n: string };
    };
    expressions: Record<string, {
        /** v0.5.0 §5.3。先に適用され、parts が後から上書きする。 */
        presetID?: string;
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

/** フレーム識別子。`frameName` があればそれ、無ければ `textureID`（0.5 §1.1）。 */
const frameId = (l: { frameName?: string; textureID: string }) => l.frameName ?? l.textureID;

/**
 * 編集状態から `mapping.json` を組み立てる。
 *
 * 推測ではなく利用者の指定をそのまま書く。`generateDraftMapping` の
 * キーワード推測は**初期値を作るときだけ**に使い、書き出しには使わない。
 *
 * 役割パーツが 1 つも指定されていなければ `null`（`mapping.json` を出さない）。
 * 未割り当てのスロットは書き出さない — 空文字列を書くと、消費側が
 * 「そのフレームを表示せよ」と解釈しかねないため。
 */
export function buildMapping(
    emgData: EmgData,
    state: AvatarMapping,
    expressions: AvatarExpression[] = [],
    presets: AvatarPreset[] = [],
): EmgSemanticMapping | null {
    const find = (partID: string) => emgData.parts.find(p => p.partID === partID);

    // 指定されたパーツが実在し、かつ switch であるものだけを採用する。
    // static パーツはフレームを持たないので役割を担えない。
    const blinkPart = state.blinkPartId ? find(state.blinkPartId) : undefined;
    const lipPart = state.lipSyncPartId ? find(state.lipSyncPartId) : undefined;
    const useBlink = !!blinkPart && blinkPart.type === 'switch';
    const useLip = !!lipPart && lipPart.type === 'switch';

    if (!useBlink && !useLip) return null;

    /** 対象パーツに実在するフレームだけを通す。存在しない値は落とす。 */
    const keep = (part: EmgPart | undefined, value: string) => {
        if (!part || !value) return '';
        return part.layers.some(l => frameId(l) === value) ? value : '';
    };

    const baseMapping: EmgSemanticMapping['baseMapping'] = {
        blink: { open: '', half: '', closed: '' },
        lipSync: { open: '', a: '', i: '', u: '', e: '', o: '', n: '' },
    };

    if (useBlink) {
        baseMapping.blinkPartKey = blinkPart!.partID;
        baseMapping.blink = {
            open: keep(blinkPart, state.blink.open),
            half: keep(blinkPart, state.blink.half),
            closed: keep(blinkPart, state.blink.closed),
        };
    }

    if (useLip) {
        baseMapping.lipSyncPartKey = lipPart!.partID;
        baseMapping.lipSync = {
            open: keep(lipPart, state.lipSync.open),
            a: keep(lipPart, state.lipSync.a),
            i: keep(lipPart, state.lipSync.i),
            u: keep(lipPart, state.lipSync.u),
            e: keep(lipPart, state.lipSync.e),
            o: keep(lipPart, state.lipSync.o),
            n: keep(lipPart, state.lipSync.n),
        };
    }

    return {
        avatarId: state.avatarId.trim() || 'avatar',
        baseMapping,
        expressions: buildExpressions(expressions, presets, blinkPart, lipPart),
    };
}

/**
 * 表情を組み立てる。
 *
 * `default` は必ず置く。プレイヤーは未知の表情名を受け取ると `default` に
 * 落とすため、これが無いと何も適用されない。
 *
 * `overrides` は 1 つでも埋まっていれば出力する。プレイヤーは状態ごとに
 * 「override にあればそれ、無ければ基本の割り当て」と解決するので、
 * 部分指定でも壊れない。
 */
function buildExpressions(
    expressions: AvatarExpression[],
    presets: AvatarPreset[],
    blinkPart?: EmgPart,
    lipPart?: EmgPart,
): EmgSemanticMapping['expressions'] {
    const out: EmgSemanticMapping['expressions'] = { default: {} };
    const presetIds = new Set(presets.map(p => p.presetID));

    const keep = (part: EmgPart | undefined, value: string) =>
        part && value && part.layers.some(l => frameId(l) === value) ? value : '';

    for (const expr of expressions) {
        const name = expr.name.trim();
        if (!name) continue;

        const entry: EmgSemanticMapping['expressions'][string] = {};

        // 参照先が消えているプリセットは書かない（読み込み側は無視するが、
        // 生成側が壊れた参照を書いてよい理由は無い）。
        if (expr.presetID && presetIds.has(expr.presetID)) entry.presetID = expr.presetID;

        const blink = {
            open: keep(blinkPart, expr.blink.open),
            half: keep(blinkPart, expr.blink.half),
            closed: keep(blinkPart, expr.blink.closed),
        };
        const lipSync = {
            a: keep(lipPart, expr.lipSync.a),
            i: keep(lipPart, expr.lipSync.i),
            u: keep(lipPart, expr.lipSync.u),
            e: keep(lipPart, expr.lipSync.e),
            o: keep(lipPart, expr.lipSync.o),
            n: keep(lipPart, expr.lipSync.n),
        };

        const hasBlink = Object.values(blink).some(Boolean);
        const hasLip = Object.values(lipSync).some(Boolean);
        if (hasBlink || hasLip) {
            entry.overrides = {
                ...(hasBlink ? { blink } : {}),
                ...(hasLip ? { lipSync } : {}),
            };
        }

        out[name] = entry;
    }
    return out;
}

/**
 * 未割り当てのスロットを数える。書き出し前に利用者へ知らせるため。
 *
 * 空のまま書き出すと、まばたきも口パクも無反応になる。`textureID` は
 * `"14"` のような番号のことが多く名前から当てられないので、
 * **推測で埋めずに未割り当てとして見せる**のが正しい。
 */
export function countUnassigned(state: AvatarMapping): { blink: number; lipSync: number } {
    const blink = state.blinkPartId
        ? [state.blink.open, state.blink.half, state.blink.closed].filter(v => !v).length
        : 0;
    // `open` は任意なので数えない。
    const lipSync = state.lipSyncPartId
        ? [state.lipSync.a, state.lipSync.i, state.lipSync.u,
           state.lipSync.e, state.lipSync.o, state.lipSync.n].filter(v => !v).length
        : 0;
    return { blink, lipSync };
}
