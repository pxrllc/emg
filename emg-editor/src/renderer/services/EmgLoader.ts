import JSZip from 'jszip';
import type { Layer } from 'ag-psd';
import type { EmgData, EmgPart, EmgPartLayer, EmgSprite } from './EmgGenerator';
import type { EmgSemanticMapping } from './MappingGenerator';
import {
    emptyExpression, emptyMapping,
    type AvatarExpression, type AvatarMapping, type AvatarPreset,
    type LayerMeta, type PartAnimation,
} from '../types';
import type { LoadedSource } from './SourceLoader';

/**
 * `.emg` をエディタの編集状態に戻す。
 *
 * **これは「書き出したものの続きから編集する」ための経路です。** 元の PSD を
 * 置き換えるものではありません。`.emg` に入っていないもの（グループ階層、
 * 書き出しに含めなかったレイヤー、トリミング前の余白）は戻りません。
 * したがって `.emg` → 編集 → `.emg` は成立しますが、`.emg` から PSD には戻せません。
 *
 * アトラスからの切り出しは**再パッキングを伴います**。読み込んで書き出すと
 * アトラス上の配置は変わりますが、`basePosition` と `textureZIndex` を保つので
 * 絵は変わりません。
 */

/** このエディタが理解する `requiredExtensions` の識別子（emg-extensions-registry.md）。 */
const KNOWN_EXTENSIONS = new Set(['EMG_frame_name', 'EMG_switch_none']);

export interface LoadedEmg {
    source: LoadedSource;
    animations: Record<string, PartAnimation>;
    presets: AvatarPreset[];
    mapping: AvatarMapping;
    expressions: AvatarExpression[];
    /** 読めたが完全には戻せなかったもの。黙って落とさず利用者に見せる。 */
    warnings: string[];
}

/** ファイル名から `.emg` かどうか。拡張子でしか判別できない（中身は ZIP）。 */
export function isEmgFile(name: string): boolean {
    return /\.emg$/i.test(name);
}

/** フレーム識別子（v0.5.0 §1.1）。参照はすべてこれで解決する。 */
const frameIdOfLayer = (l: EmgPartLayer): string => l.frameName ?? l.textureID;

export class EmgLoader {
    static async load(file: File): Promise<LoadedEmg> {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const warnings: string[] = [];

        // 参照プレイヤーと同じ探し方。`model.json` で書き出された古いファイルも読める。
        const jsonEntry =
            zip.file(/(^|\/)data\.json$/i)[0]
            ?? zip.file(/\.json$/i).find(f => !/mapping\.json$/i.test(f.name));
        if (!jsonEntry) throw new Error('data.json が見つかりません。');

        const data = JSON.parse(await jsonEntry.async('text')) as EmgData;
        if (!Array.isArray(data.parts) || !Array.isArray(data.textures)) {
            throw new Error('parts[] / textures[] がありません。EMG v0.3.0 以降のファイルが必要です。');
        }

        // v0.4.0 F5: 理解できない識別子を持つファイルは読み込まない。
        // エディタも消費側の一種で、無視して開くと「読めたのに絵が違う」ものを
        // 書き戻してしまう。
        const unknown = (data.requiredExtensions ?? []).filter(id => !KNOWN_EXTENSIONS.has(id));
        if (unknown.length > 0) {
            throw new Error(
                `このエディタが対応していない機能を要求しています: ${unknown.join(', ')}。`
                + `（requiredExtensions は「無視すると違う絵になる」ものの宣言なので、開けません）`
            );
        }

        // ---- アトラス --------------------------------------------------------
        // レイヤーごとに textureFile が違いうる（複数アトラスに分割されたファイル）。
        const atlases = new Map<string, HTMLCanvasElement>();
        for (const tex of data.textures) {
            const entry = zip.file(tex.textureFile)
                ?? zip.file(new RegExp(`(^|/)${escapeRegExp(tex.textureFile)}$`, 'i'))[0];
            if (!entry) {
                // 0.5.2 §10.9: テクスチャが欠けているファイルは読み込みを失敗させる。
                throw new Error(`テクスチャ ${tex.textureFile} が入っていません。`);
            }
            atlases.set(tex.textureFile, await decodeToCanvas(await entry.async('blob')));
        }

        // ---- レイヤー --------------------------------------------------------
        const metaByLayer = new WeakMap<Layer, Omit<LayerMeta, 'id' | 'partId'>>();

        // パーツは「一番奥のレイヤー」の順に並べる。ツリーの上下と絵の重なりが
        // だいたい一致していないと、読み込んだ直後に何がどこにあるか分からない。
        // 実際の z は meta.zIndex が持つので、この並びは表示上の都合でしかない。
        const ordered = [...data.parts].sort((a, b) => minZ(a) - minZ(b));

        const children: Layer[] = [];
        for (const part of ordered) {
            const group = buildPartGroup(part, atlases, metaByLayer, warnings);
            if (group) children.push(group);
        }
        if (children.length === 0) throw new Error('描けるレイヤーがありませんでした。');

        const source: LoadedSource = {
            name: file.name.replace(/\.[^.]+$/, '') || 'emg',
            width: data.baseCanvasWidth || 0,
            height: data.baseCanvasHeight || 0,
            children,
            kind: 'document',
            metaOf: l => metaByLayer.get(l),
        };

        // ---- sprites / presets ----------------------------------------------
        const animations: Record<string, PartAnimation> = {};
        for (const sprite of data.sprites ?? []) {
            const part = data.parts.find(p => p.partID === sprite.targetPartID);
            if (!part) {
                warnings.push(`スプライト "${sprite.spriteID}" の対象パーツ "${sprite.targetPartID}" がありません`);
                continue;
            }
            animations[part.partID] = toAnimation(sprite, part);
        }

        const presets: AvatarPreset[] = (data.presets ?? []).map(p => ({
            presetID: p.presetID,
            label: p.label ?? p.presetID,
            parts: { ...(p.parts ?? {}) },
            toggles: { ...(p.toggles ?? {}) },
        }));

        // ---- mapping.json ----------------------------------------------------
        const mappingEntry = zip.file(/mapping\.json$/i)[0];
        let mapping = emptyMapping();
        let expressions: AvatarExpression[] = [];
        if (mappingEntry) {
            try {
                const sem = JSON.parse(await mappingEntry.async('text')) as EmgSemanticMapping;
                ({ mapping, expressions } = fromSemanticMapping(sem, presets, warnings));
            } catch (e) {
                warnings.push(`mapping.json を読めませんでした（${e instanceof Error ? e.message : e}）`);
            }
        }

        return { source, animations, presets, mapping, expressions, warnings };
    }
}

// ---- 以下、組み立ての細部 ---------------------------------------------------

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const minZ = (part: EmgPart): number =>
    part.layers.reduce((m, l) => Math.min(m, l.textureZIndex ?? 0), Number.POSITIVE_INFINITY);

async function decodeToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return c;
}

/**
 * 1 パーツ分のグループを組む。
 *
 * 合成木は partID をグループ名にして作る。`frameName` を持つレイヤーは
 * `@フレーム名` グループに入れれば、既存の走査規則（recalculateMeta）に
 * そのまま乗る — 読み込み専用の解釈を足さずに済む。
 */
function buildPartGroup(
    part: EmgPart,
    atlases: Map<string, HTMLCanvasElement>,
    metaByLayer: WeakMap<Layer, Omit<LayerMeta, 'id' | 'partId'>>,
    warnings: string[],
): Layer | null {
    const isSwitch = part.type === 'switch';
    // v0.5.0 §4.3: switch の defaultVisible:false は「初期状態でどれも表示しない」。
    // その場合 default は「表示状態にされたときに選ばれるフレーム」として残る。
    const partVisible = part.defaultVisible !== false;
    const defaultFrame = isSwitch && partVisible ? part.default : undefined;

    // 背面 → 前面。ag-psd の children はこの向き。
    const sorted = [...part.layers].sort((a, b) => (a.textureZIndex ?? 0) - (b.textureZIndex ?? 0));

    // frameName ごとにまとめる。最初に現れた位置に置くことで z 順を崩さない。
    const buckets: { frameName?: string; layers: EmgPartLayer[] }[] = [];
    for (const l of sorted) {
        const last = l.frameName !== undefined
            ? buckets.find(b => b.frameName === l.frameName)
            : undefined;
        if (last) last.layers.push(l);
        else buckets.push({ frameName: l.frameName, layers: [l] });
    }

    const children: Layer[] = [];
    for (const bucket of buckets) {
        const frameId = bucket.frameName ?? frameIdOfLayer(bucket.layers[0]);
        const isDefault = isSwitch ? frameId === defaultFrame : undefined;
        const hidden = isSwitch ? !isDefault : !partVisible;

        const leaves: Layer[] = [];
        for (const l of bucket.layers) {
            const leaf = buildLeaf(l, atlases, hidden, warnings);
            if (!leaf) continue;
            metaByLayer.set(leaf, {
                type: part.type,
                frameName: bucket.frameName,
                visible: true,
                isDefault: isSwitch ? isDefault : undefined,
                defaultVisible: isSwitch ? undefined : partVisible,
                opacity: l.opacity ?? 1,
                blendMode: l.blendMode || 'normal',
                // 明示的な z。パーツをまたいで入れ子になっている（仕様 §2 の
                // frameName の例がまさにそれ）ファイルは、木の走査順からは
                // 復元できない。値そのものを持つのが唯一の方法。
                zIndex: l.textureZIndex ?? 0,
            });
            leaves.push(leaf);
        }
        if (leaves.length === 0) continue;

        if (bucket.frameName !== undefined) {
            children.push({ name: `@${bucket.frameName}`, hidden, children: leaves } as Layer);
        } else {
            children.push(...leaves);
        }
    }

    if (children.length === 0) return null;
    return { name: part.partID, hidden: false, children } as Layer;
}

function buildLeaf(
    l: EmgPartLayer,
    atlases: Map<string, HTMLCanvasElement>,
    hidden: boolean,
    warnings: string[],
): Layer | null {
    const atlas = atlases.get(l.textureFile) ?? [...atlases.values()][0];
    if (!atlas || l.width <= 0 || l.height <= 0) {
        warnings.push(`レイヤー "${l.textureID}" を切り出せませんでした`);
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = l.width;
    canvas.height = l.height;
    canvas.getContext('2d')!.drawImage(atlas, l.x, l.y, l.width, l.height, 0, 0, l.width, l.height);

    const left = l.basePosition_x ?? 0;
    const top = l.basePosition_y ?? 0;
    return {
        // textureID がそのままレイヤー名になる。EmgGenerator は名前から textureID を
        // 作るので、これで書き戻したときに同じ識別子に戻る。
        name: l.textureID,
        hidden,
        canvas,
        left, top, right: left + l.width, bottom: top + l.height,
        opacity: l.opacity ?? 1,
        blendMode: (l.blendMode || 'normal') as Layer['blendMode'],
    } as Layer;
}

/** `sprites[]` を編集状態に戻す。 */
function toAnimation(sprite: EmgSprite, part: EmgPart): PartAnimation {
    const keys = sprite.sequence?.keys;
    const frames = keys
        ? keys.map(k => k.frame)
        : [...(sprite.sequence?.frames ?? [])];

    // keys は累積時刻。編集状態は「そのフレームの表示秒数」なので差を取る。
    // 最後の 1 つだけは次の時刻が無いので、直前と同じ長さとみなす。
    const durations = keys
        ? keys.map((k, i) => {
            const next = keys[i + 1];
            if (next) return Math.max(0.001, Math.round((next.t - k.t) * 1000) / 1000);
            const prev = keys[i - 1];
            return prev ? Math.max(0.001, Math.round((k.t - prev.t) * 1000) / 1000) : 0.1;
        })
        : frames.map(() => 0.1);

    return {
        enabled: true,
        spriteID: sprite.spriteID || part.partID,
        frames,
        timing: keys ? 'keys' : 'fps',
        // v0.4.0 で fps は任意になった（不在時 12）。
        fps: sprite.fps ?? 12,
        durations,
        sequenceType: sprite.sequence?.type === 'random_hold' ? 'random_hold' : 'ordered',
        // trigger 不在は「自律再生してはならない」（7 章）。mapping.json が掌握する
        // パーツではこれが正常な状態なので、外部駆動として戻す。
        triggerType: sprite.trigger?.type ?? 'external',
        intervalMin: sprite.trigger?.intervalMin ?? 3,
        intervalMax: sprite.trigger?.intervalMax ?? 8,
    };
}

/** `mapping.json` を編集状態に戻す。 */
function fromSemanticMapping(
    sem: EmgSemanticMapping,
    presets: AvatarPreset[],
    warnings: string[],
): { mapping: AvatarMapping; expressions: AvatarExpression[] } {
    const base = sem.baseMapping ?? { blink: {}, lipSync: {} } as EmgSemanticMapping['baseMapping'];
    const mapping: AvatarMapping = {
        avatarId: sem.avatarId || 'avatar',
        blinkPartId: base.blinkPartKey ?? '',
        blink: {
            open: base.blink?.open ?? '',
            half: base.blink?.half ?? '',
            closed: base.blink?.closed ?? '',
        },
        lipSyncPartId: base.lipSyncPartKey ?? '',
        lipSync: {
            a: base.lipSync?.a ?? '', i: base.lipSync?.i ?? '', u: base.lipSync?.u ?? '',
            e: base.lipSync?.e ?? '', o: base.lipSync?.o ?? '', n: base.lipSync?.n ?? '',
            open: base.lipSync?.open ?? '',
        },
    };

    const presetIds = new Set(presets.map(p => p.presetID));
    const expressions: AvatarExpression[] = [];
    for (const [name, e] of Object.entries(sem.expressions ?? {})) {
        // `default` は「何も足さない」という約束の入れ物なので、一覧には出さない。
        if (name === 'default') continue;

        const expr = emptyExpression(name);
        if (e.presetID) {
            if (presetIds.has(e.presetID)) expr.presetID = e.presetID;
            else warnings.push(`表情 "${name}" が参照するプリセット "${e.presetID}" がありません`);
        }

        // 表情に直接書かれた見た目は**プリセットに移す**。
        //
        // エディタは「見た目はプリセット、表情はそれを参照するだけ」で統一している
        // （2 か所で同じことができると、どちらに書いたかで重ねられるかどうかが
        // 変わる罠になるため）。ただし読み込みで黙って捨てると、開いて書き戻した
        // だけで表情の見た目が全部消える。同じ意味の presets[] に翻訳する。
        const look = toParts(e, warnings, name);
        if (Object.keys(look).length > 0) {
            if (expr.presetID) {
                warnings.push(`表情 "${name}" は presetID と parts の両方を持つため、presetID を優先しました`);
            } else {
                let presetID = name;
                let n = 2;
                while (presetIds.has(presetID)) presetID = `${name}_${n++}`;
                presetIds.add(presetID);
                presets.push({ presetID, label: name, parts: look, toggles: {} });
                expr.presetID = presetID;
            }
        }

        for (const k of ['open', 'half', 'closed'] as const) {
            expr.blink[k] = e.overrides?.blink?.[k] ?? '';
        }
        for (const k of ['a', 'i', 'u', 'e', 'o', 'n'] as const) {
            expr.lipSync[k] = e.overrides?.lipSync?.[k] ?? '';
        }
        expressions.push(expr);
    }

    return { mapping, expressions };
}

/**
 * 表情に直接書かれた見た目を `partID → フレーム識別子` に均す。
 *
 * `parts` の値は配列（`{"Eyebrows": ["01"]}`）。switch パーツは一度に 1 つしか
 * 出せないので、2 つ以上あっても最初のものしか意味を持たない。
 * `eyebrow` / `other` は partID を持たないため、どのパーツの話か決められない。
 */
function toParts(
    e: EmgSemanticMapping['expressions'][string],
    warnings: string[],
    name: string,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [partId, frames] of Object.entries(e.parts ?? {})) {
        const list = Array.isArray(frames) ? frames : [frames];
        if (list.length === 0) continue;
        out[partId] = String(list[0]);
        if (list.length > 1) {
            warnings.push(`表情 "${name}" の "${partId}" は ${list.length} 個指定されているため、先頭の "${list[0]}" だけを使いました`);
        }
    }
    if (e.eyebrow || e.other) {
        warnings.push(`表情 "${name}" の eyebrow / other は partID を持たないため読み込めません`);
    }
    return out;
}
