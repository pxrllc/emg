import type { PartInfo } from '../parts';
import {
    emptyMapping,
    type AvatarExpression, type AvatarMapping, type AvatarPreset, type PartAnimation,
} from '../types';

/**
 * テンプレート — 一度作った割り当てを、別の素材に持ち込むための形式。
 *
 * **EMG の仕様ではありません。** エディタ固有の中間ファイルなので、
 * `.emg` には入れず、拡張子も紛れないものにしています。
 *
 * 既存の「設定を保存」（`project.json`）はこの用途には使えません。あれは
 * `layerMeta` をそのまま落としたもので、キーが**レイヤーの数値 ID** です。
 * ID は素材ごとに振られるため、別の PSD に読ませても対応が取れません。
 *
 * **テンプレートは名前でしか対応を取りません** — `partID` とフレーム識別子
 * （`frameName ?? textureID`）です。レイヤー画像もアトラス座標も持ちません。
 * 裏返すと、パーツ名やレイヤー名を変えるとテンプレートは当たらなくなります。
 */
export interface EditorTemplate {
    templateVersion: 1;
    /** 由来を追えるようにするだけ。解決には使わない。 */
    savedAt: string;
    /** partID → 種別。 */
    partTypes: Record<string, 'static' | 'switch'>;
    /**
     * switch パーツの既定フレーム。
     * `null` は「初期状態でどれも表示しない」（v0.5.0 §4.3）。
     * キーが無いことと `null` は違う意味なので、undefined に潰さない。
     */
    defaults: Record<string, string | null>;
    /** static パーツの初期表示（v0.5.0 §4）。 */
    toggles: Record<string, boolean>;
    /** partID → アニメーション設定。 */
    animations: Record<string, PartAnimation>;
    mapping: AvatarMapping;
    presets: AvatarPreset[];
    expressions: AvatarExpression[];
}

/** 拡張子。`.emg` と見分けがつき、`project.json` とも混ざらないものにする。 */
export const TEMPLATE_EXT = '.emgtpl.json';

/** 今の編集状態からテンプレートを組む。名前に落とせるものだけを拾う。 */
export function buildTemplate(
    parts: PartInfo[],
    animations: Record<string, PartAnimation>,
    mapping: AvatarMapping,
    presets: AvatarPreset[],
    expressions: AvatarExpression[],
): EditorTemplate {
    const partTypes: EditorTemplate['partTypes'] = {};
    const defaults: EditorTemplate['defaults'] = {};
    const toggles: EditorTemplate['toggles'] = {};

    for (const part of parts) {
        partTypes[part.partId] = part.type;
        if (part.type === 'switch') {
            defaults[part.partId] = part.initiallyNone ? null : (part.defaultFrameId ?? null);
        } else {
            toggles[part.partId] = part.defaultVisible;
        }
    }

    // 有効なものだけ。切ってあるアニメーションを持ち込んでも意味がない。
    const anims: EditorTemplate['animations'] = {};
    for (const [partId, a] of Object.entries(animations)) {
        if (a.enabled) anims[partId] = a;
    }

    return {
        templateVersion: 1,
        savedAt: new Date().toISOString(),
        partTypes,
        defaults,
        toggles,
        animations: anims,
        mapping,
        presets,
        expressions,
    };
}

/** 数えたものと、当たらなかった名前。名前を出さないと直しようがない。 */
export interface ReportLine {
    matched: number;
    total: number;
    /** 丸ごと落ちたもの。 */
    missing: string[];
    /**
     * 適用はされたが中身が欠けたもの。
     *
     * これが無いと「表情 1 / 1」なのに参照先のプリセットが消えている、という
     * 報告になる。数だけ見て通してしまうので、欠けた中身は別に出す。
     */
    notes: string[];
}

export interface TemplateReport {
    parts: ReportLine;
    frames: ReportLine;
    presets: ReportLine;
    expressions: ReportLine;
    animations: ReportLine;
}

/** 適用の結果。当たったものだけが入っている。 */
export interface TemplateApplication {
    partTypes: Record<string, 'static' | 'switch'>;
    defaults: Record<string, string | null>;
    toggles: Record<string, boolean>;
    animations: Record<string, PartAnimation>;
    mapping: AvatarMapping;
    presets: AvatarPreset[];
    expressions: AvatarExpression[];
    report: TemplateReport;
}

const emptyLine = (): ReportLine => ({ matched: 0, total: 0, missing: [], notes: [] });

export function isTemplate(data: unknown): data is EditorTemplate {
    return !!data && typeof data === 'object' && (data as EditorTemplate).templateVersion === 1;
}

/**
 * テンプレートを今の素材に当てる。
 *
 * **名前が一致しないものは適用しません。** 近い名前に当てにいくと、
 * 「Eyes」と「eyes」のような取り違えが黙って通ってしまいます。
 * 落ちたものは {@link TemplateReport} で必ず報告します。
 */
export function applyTemplate(tpl: EditorTemplate, parts: PartInfo[]): TemplateApplication {
    const byId = new Map(parts.map(p => [p.partId, p]));
    const report: TemplateReport = {
        parts: emptyLine(), frames: emptyLine(),
        presets: emptyLine(), expressions: emptyLine(), animations: emptyLine(),
    };

    // ---- パーツ -----------------------------------------------------------
    const partTypes: TemplateApplication['partTypes'] = {};
    for (const [partId, type] of Object.entries(tpl.partTypes ?? {})) {
        report.parts.total++;
        if (byId.has(partId)) {
            report.parts.matched++;
            partTypes[partId] = type;
        } else {
            report.parts.missing.push(partId);
        }
    }

    /**
     * フレーム参照を 1 つ解決する。数えるのはここだけにして、
     * 「21 / 24」の分母が実際の参照数と食い違わないようにする。
     */
    const frame = (partId: string, frameId: string): string | null => {
        if (!frameId) return null; // 未割り当ては参照ではない
        report.frames.total++;
        const part = byId.get(partId);
        if (part?.frames.some(f => f.frameId === frameId)) {
            report.frames.matched++;
            return frameId;
        }
        report.frames.missing.push(`${partId} の "${frameId}"`);
        return null;
    };

    // ---- 既定フレーム / トグル --------------------------------------------
    const defaults: TemplateApplication['defaults'] = {};
    for (const [partId, frameId] of Object.entries(tpl.defaults ?? {})) {
        if (!byId.has(partId)) continue; // パーツ側で既に報告済み
        // null は「どれも表示しない」という指定そのもの。フレーム参照ではない。
        if (frameId === null) { defaults[partId] = null; continue; }
        const hit = frame(partId, frameId);
        // 当たらなかったときは触らない。既定を勝手に外すと絵が変わる。
        if (hit !== null) defaults[partId] = hit;
    }

    const toggles: TemplateApplication['toggles'] = {};
    for (const [partId, visible] of Object.entries(tpl.toggles ?? {})) {
        if (byId.has(partId)) toggles[partId] = visible;
    }

    // ---- まばたき・口パク --------------------------------------------------
    const mapping: AvatarMapping = emptyMapping();
    mapping.avatarId = tpl.mapping?.avatarId || mapping.avatarId;

    const roleFor = (partId: string): string => {
        // 役割パーツは switch でなければ意味を持たない（フレームを切り替えられない）。
        const part = byId.get(partId);
        const type = partTypes[partId] ?? part?.type;
        return part && type === 'switch' ? partId : '';
    };

    if (tpl.mapping?.blinkPartId) {
        mapping.blinkPartId = roleFor(tpl.mapping.blinkPartId);
        if (mapping.blinkPartId) {
            for (const k of ['open', 'half', 'closed'] as const) {
                mapping.blink[k] = frame(mapping.blinkPartId, tpl.mapping.blink?.[k] ?? '') ?? '';
            }
        }
    }
    if (tpl.mapping?.lipSyncPartId) {
        mapping.lipSyncPartId = roleFor(tpl.mapping.lipSyncPartId);
        if (mapping.lipSyncPartId) {
            for (const k of ['a', 'i', 'u', 'e', 'o', 'n', 'open'] as const) {
                mapping.lipSync[k] = frame(mapping.lipSyncPartId, tpl.mapping.lipSync?.[k] ?? '') ?? '';
            }
        }
    }

    // ---- プリセット --------------------------------------------------------
    const presets: AvatarPreset[] = [];
    for (const p of tpl.presets ?? []) {
        report.presets.total++;
        const kept: AvatarPreset = { presetID: p.presetID, label: p.label, parts: {}, toggles: {} };
        for (const [partId, frameId] of Object.entries(p.parts ?? {})) {
            const hit = byId.has(partId) ? frame(partId, frameId) : null;
            if (hit !== null) kept.parts[partId] = hit;
        }
        for (const [partId, visible] of Object.entries(p.toggles ?? {})) {
            if (byId.has(partId)) kept.toggles[partId] = visible;
        }
        // 中身が全部落ちたプリセットは、適用しても何も起きない。残すと嘘になる。
        const before = Object.keys(p.parts ?? {}).length + Object.keys(p.toggles ?? {}).length;
        const after = Object.keys(kept.parts).length + Object.keys(kept.toggles).length;
        if (after > 0) {
            report.presets.matched++;
            presets.push(kept);
            if (after < before) {
                report.presets.notes.push(`"${p.label}" は ${after} / ${before} 件だけ適用`);
            }
        } else {
            report.presets.missing.push(`"${p.label}"（参照先が 1 つも残りません）`);
        }
    }

    // ---- 表情 --------------------------------------------------------------
    const presetIds = new Set(presets.map(p => p.presetID));
    const expressions: AvatarExpression[] = [];
    for (const e of tpl.expressions ?? []) {
        report.expressions.total++;
        const presetID = presetIds.has(e.presetID) ? e.presetID : '';
        const blink = { open: '', half: '', closed: '' };
        const lipSync = { a: '', i: '', u: '', e: '', o: '', n: '' };

        if (mapping.blinkPartId) {
            for (const k of ['open', 'half', 'closed'] as const) {
                blink[k] = frame(mapping.blinkPartId, e.blink?.[k] ?? '') ?? '';
            }
        }
        if (mapping.lipSyncPartId) {
            for (const k of ['a', 'i', 'u', 'e', 'o', 'n'] as const) {
                lipSync[k] = frame(mapping.lipSyncPartId, e.lipSync?.[k] ?? '') ?? '';
            }
        }

        const hasOverride = [...Object.values(blink), ...Object.values(lipSync)].some(Boolean);
        if (presetID || hasOverride) {
            report.expressions.matched++;
            expressions.push({ name: e.name, presetID, blink, lipSync });
            if (e.presetID && !presetID) {
                report.expressions.notes.push(
                    `"${e.name}" は差し替えだけ適用（プリセット "${e.presetID}" がありません）`);
            }
        } else {
            report.expressions.missing.push(
                e.presetID && !presetID
                    ? `"${e.name}"（参照先のプリセット "${e.presetID}" がありません）`
                    : `"${e.name}"（残る指定がありません）`
            );
        }
    }

    // ---- アニメーション ----------------------------------------------------
    const animations: TemplateApplication['animations'] = {};
    for (const [partId, a] of Object.entries(tpl.animations ?? {})) {
        report.animations.total++;
        const part = byId.get(partId);
        const type = partTypes[partId] ?? part?.type;
        if (!part || type !== 'switch') {
            // sprites[].targetPartID は switch でなければならない（7 章）。
            report.animations.missing.push(`"${partId}"（${part ? 'switch ではありません' : 'ありません'}）`);
            continue;
        }
        const keptFrames: string[] = [];
        const keptDurations: number[] = [];
        (a.frames ?? []).forEach((f, i) => {
            if (frame(partId, f) !== null) {
                keptFrames.push(f);
                keptDurations.push(a.durations?.[i] ?? 0.1);
            }
        });
        if (keptFrames.length === 0) {
            report.animations.missing.push(`"${partId}"（フレームが 1 つも残りません）`);
            continue;
        }
        report.animations.matched++;
        animations[partId] = { ...a, frames: keptFrames, durations: keptDurations };
        if (keptFrames.length < (a.frames?.length ?? 0)) {
            report.animations.notes.push(
                `"${partId}" は ${keptFrames.length} / ${a.frames.length} コマだけ適用`);
        }
    }

    return { partTypes, defaults, toggles, animations, mapping, presets, expressions, report };
}
