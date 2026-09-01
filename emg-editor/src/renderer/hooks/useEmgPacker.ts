import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PsdLoader, FileLoader, PsdLayer } from '../services/PsdLoader';
import { SourceLoader, type LoadedSource } from '../services/SourceLoader';
import { groupSequences, loadSequence } from '../services/SequenceLoader';
import { EmgLoader, isEmgFile } from '../services/EmgLoader';
import { baseNameOf, downloadBlob, prepareSave } from '../services/download';
import { FRAME_COUNT_WARNING } from '../services/AnimationLoader';
import { Psd, type Layer } from 'ag-psd';
import { TexturePacker, PackItem, PackResult } from '../services/TexturePacker';
import { EmgGenerator, ExportItem, EmgData } from '../services/EmgGenerator';
import { PreviewItem } from '../components/PreviewPanel';
import { defaultPartAnimation, emptyExpression, emptyMapping, emptyTransform, IDENTITY_SOURCE_TRANSFORM, parseTransformKey, transformKey, type AvatarExpression, type AvatarMapping, type AvatarPreset, type LayerMeta, type PartAnimation, type PartTransform, type SourceEntry, type SourceTransform, type TransformGroup } from '../types';
import {
    bakeLayer, buildSourceMatrices, fromPartTransformPatch, sliceLayer, sourceMatrix, sourcePivot,
    transformedBounds, type SourceRect,
} from '../services/sourceTransform';
import type { ToastMessage } from '../components/Toast';
import { buildParts, flattenLayers, frameIdOf, type PartInfo } from '../parts';
import { computeBounds, type Bounds } from '../services/composite';
import { useHistory, type DocumentSnapshot } from './useHistory';
import { isPlayable, sequenceDuration, sequenceFrameAt } from '../services/sequence';
import { hasAnimation } from '../services/transform';
import {
    applyTemplate, buildTemplate, isTemplate, TEMPLATE_EXT,
    type EditorTemplate, type TemplateReport,
} from '../services/Template';

/**
 * アトラスを詰め直すまでの待ち時間（ミリ秒）。
 *
 * 連続する編集（バウンディングボックスのドラッグなど）で毎回詰め直さないための間。
 * アトラスの表示と JSON プレビューだけがこの結果を使う。合成プレビューは
 * レイヤーの canvas から直接描くので、ここを待たずに追従する。
 */
const PACK_DEBOUNCE_MS = 250;

// ag-psd returns opacity as 0-255; normalize to 0.0-1.0
const normalizeOpacity = (v?: number): number => {
    if (typeof v !== 'number') return 1.0;
    return v > 1 ? v / 255 : v;
};

/** 木の中で使われている最大のレイヤー ID。取り込み時の採番の起点にする。 */
const maxLayerId = (layers: PsdLayer[]): number => {
    let max = 0;
    const walk = (ls: PsdLayer[]) => {
        for (const l of ls) {
            if (typeof l.id === 'number' && l.id > max) max = l.id;
            if (l.children) walk(l.children);
        }
    };
    walk(layers);
    return max;
};

/** 葉レイヤー（画像を持つもの）の数。取り込み結果の表示に使う。 */
const countLeaves = (layers: PsdLayer[]): number => {
    let n = 0;
    const walk = (ls: PsdLayer[]) => {
        for (const l of ls) {
            if (l.canvas) n++;
            if (l.children) walk(l.children);
        }
    };
    walk(layers);
    return n;
};

// ---- パーツ単位の layerMeta 変換 -------------------------------------------
// UI からの操作とテンプレートの適用が、同じ規則を通るようにするために切り出した。
// 片方だけ直すと「手で押したときと、テンプレートを当てたときで結果が違う」になる。

type MetaMap = Record<number, LayerMeta>;

/**
 * パーツの種別を変える。所属レイヤー全部に反映する。
 *
 * switch では `isDefault` が、static では `defaultVisible` が意味を持つ。
 * 切り替え時に反対側を消しておかないと、書き出しに前の型の判断が残って混ざる。
 */
const setPartType = (prev: MetaMap, part: PartInfo, type: 'static' | 'switch'): MetaMap => {
    // 全レイヤーが PSD で非表示だった static パーツは、捨てずにパーツごと
    // 「初期非表示のトグル」として書き出す（v0.5.0 §4）。recalculateMeta と同じ判定。
    const allHidden = part.layerIds.every(id => prev[id]?.defaultVisible === false);
    const next = { ...prev };

    for (const id of part.layerIds) {
        const m = next[id];
        if (!m) continue;

        // switch → static のとき、defaultVisible はまだ無い（switch では
        // isDefault の方が意味を持つ側だったため）。ここで ?? true に倒すと
        // 差分 6 枚が全部「常時表示」になり、目が 6 枚重なった絵が書き出される。
        // 引き継ぐべきは「既定だったフレームだけが見える」という状態。
        const keepVisible = type !== 'static'
            ? true
            : allHidden || (m.type === 'switch' ? !!m.isDefault : (m.defaultVisible ?? true));

        next[id] = {
            ...m,
            type,
            isDefault: type === 'switch' ? m.isDefault : undefined,
            defaultVisible: type === 'static' ? keepVisible : undefined,
            visible: keepVisible,
        };
    }

    // static から switch に「変換した」ときだけ、既定が無い状態を避けるために
    // 先頭フレームを既定にする。すでに switch のパーツに対しては行わない。
    // v0.5.0 §4.3 の「初期状態はなし」を選んでいるパーツで Switch を
    // 押し直すたびに、その指定が消えてしまうため。
    if (type === 'switch' && part.type !== 'switch' && !part.layerIds.some(id => next[id]?.isDefault)) {
        for (const id of part.frames[0]?.layerIds ?? []) {
            if (next[id]) next[id] = { ...next[id], isDefault: true };
        }
    }
    return next;
};

/** switch パーツの既定フレーム。`null` は「どれも表示しない」（v0.5.0 §4.3）。 */
const setPartDefaultFrame = (prev: MetaMap, part: PartInfo, frameId: string | null): MetaMap => {
    const next = { ...prev };
    for (const f of part.frames) {
        for (const id of f.layerIds) {
            if (next[id]) next[id] = { ...next[id], isDefault: frameId !== null && f.frameId === frameId };
        }
    }
    return next;
};

/** static パーツの初期表示（v0.5.0 §4）。 */
const setPartDefaultVisible = (prev: MetaMap, part: PartInfo, defaultVisible: boolean): MetaMap => {
    const next = { ...prev };
    for (const id of part.layerIds) {
        if (next[id]) next[id] = { ...next[id], defaultVisible, visible: true };
    }
    return next;
};

/** 取り込んだ素材をキャンバス上で平行移動する。 */
const shiftLayers = (layers: PsdLayer[], dx: number, dy: number): void => {
    for (const l of layers) {
        if (typeof l.left === 'number') l.left += dx;
        if (typeof l.top === 'number') l.top += dy;
        if (typeof l.right === 'number') l.right += dx;
        if (typeof l.bottom === 'number') l.bottom += dy;
        if (l.children) shiftLayers(l.children, dx, dy);
    }
};

/**
 * アニメーション画像のフレーム遅延から、再生設定を組み立てる。
 *
 * GIF はフレームごとに遅延が違うのが普通で、v0.3.0 の `fps`（等間隔）では
 * 表現できない。v0.5.0 6 章の `keys` がそのための仕組み。
 * 全フレームが同じ遅延なら、素直に `fps` + `frames` に落とす
 * （出力が読みやすく、6 章に未対応の実装でも動く）。
 */
const buildAnimationFromDurations = (
    partId: string, frames: string[], durations: number[]
): PartAnimation => {
    const first = durations[0] ?? 0.1;
    const uniform = durations.every(d => Math.abs(d - first) < 0.005);

    // fps は整数なので、1/遅延 が整数から離れていると再現できない
    // （0.08 秒 → 12.5fps を 13 に丸めると 4% 速くなる）。
    // その場合は keys にして、元の遅延をそのまま保つ。
    const rawFps = first > 0 ? 1 / first : 12;
    const roundedFps = Math.max(1, Math.round(rawFps));
    const exact = Math.abs(1 / roundedFps - first) < 0.002;

    return {
        enabled: true,
        spriteID: partId,
        frames,
        timing: uniform && exact ? 'fps' : 'keys',
        fps: roundedFps,
        durations,
        sequenceType: 'ordered',
        triggerType: 'auto_loop',
        intervalMin: 3,
        intervalMax: 8,
    };
};

/** partID はファイル全体で一意でなければならない（emg-json-spec.md 6 章）。 */
const uniqueGroupName = (siblings: PsdLayer[], base: string): string => {
    const used = new Set(siblings.map(l => l.name).filter(Boolean) as string[]);
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
};

/** 木の中のグループ名を全部集める。どの階層のグループ名も partID になりうる。 */
const collectGroupNames = (layers: PsdLayer[], out = new Set<string>()): Set<string> => {
    for (const l of layers) {
        if (l.children && l.children.length > 0) {
            if (l.name) out.add(l.name);
            collectGroupNames(l.children, out);
        }
    }
    return out;
};

/**
 * 取り込むグループ名が既存の partID とぶつかるなら改名する。
 *
 * 同じキャラクターの `.emg` を今開いている木に足すと、`Mouth` も `Eyes` も
 * 両方に居る。partID は名前で決まるので、そのままだと 2 つのパーツが 1 つに
 * 合流し、同じフレーム識別子が重複した壊れたパーツになる（レイヤーは倍に
 * 増えるのにパーツ数は変わらない、という形で表面化する）。
 *
 * `@` 始まりはフレームグループ（partID にならない）なので触らない。
 * 戻り値は「元の名前 → 新しい名前」。`.emg` の presets / mapping / sprites は
 * partID を参照しているので、呼び出し側がこれで付け替える。
 */
const renameColliding = (incoming: PsdLayer[], used: Set<string>): Map<string, string> => {
    const renamed = new Map<string, string>();
    const walk = (layers: PsdLayer[]) => {
        for (const l of layers) {
            if (!l.children || l.children.length === 0) continue;
            const name = l.name;
            if (name && !name.startsWith('@')) {
                if (used.has(name)) {
                    let n = 2;
                    let next = `${name}_${n}`;
                    while (used.has(next)) next = `${name}_${++n}`;
                    renamed.set(name, next);
                    l.name = next;
                    used.add(next);
                } else {
                    used.add(name);
                }
            }
            walk(l.children);
        }
    };
    walk(incoming);
    return renamed;
};

/**
 * 書き出す `textureZIndex` を決める。
 *
 * 明示的な z を持つレイヤー（`.emg` から読み込んだもの）はその値を保ち、
 * 持たないレイヤー（PSD などから作ったもの）は**その上に**走査順で積む。
 *
 * 明示的な z が 1 つも無ければ baseline は 0 になり、結果は走査順そのもの
 * ＝ 従来と完全に同じになる。
 */
const resolveZIndices = (layers: PsdLayer[], meta: Record<number, LayerMeta>): number[] => {
    let maxExplicit = -1;
    for (const l of layers) {
        const z = meta[l.id!]?.zIndex;
        if (typeof z === 'number' && z > maxExplicit) maxExplicit = z;
    }
    const baseline = maxExplicit + 1;

    let n = 0;
    return layers.map(l => {
        const z = meta[l.id!]?.zIndex;
        return typeof z === 'number' ? z : baseline + n++;
    });
};

/**
 * ツリーで動かしたレイヤーの明示 z を、移動先の位置に合わせて振り直す。
 *
 * これが無いと、**`.emg` を読み込んだ後は重なり順を編集できません。**
 * `EmgLoader` は全レイヤーに `meta.zIndex` を入れ、`resolveZIndices` は明示値を
 * 走査順より優先するため、唯一の z 編集手段であるツリーの並べ替えが無効になります。
 *
 * 明示 z を捨てて走査順に戻す方法は取れません。実ファイルの z は**パーツをまたいで
 * 入れ子になっていないことがあり**（仕様 §2 の frameName の例。上着 20 / 体 10 /
 * スカート 5）、木の形からは復元できないため、1 枚動かしただけで残り全部の
 * 重なりが壊れます。
 *
 * 規則は「掴んだものを、移動先で**真後ろに来たレイヤーのすぐ手前**へ差し込む」。
 * 手前側の隣は見ません — 明示 z のファイルでは前後の隣同士が z 上でも隣り合って
 * いるとは限らず、中点を取っても意味を持たないためです。
 *
 * グループを掴んだ場合は中の葉がまとめて動きます。塊の中の重なりは変えません。
 */
const reassignExplicitZ = (
    root: Psd,
    meta: Record<number, LayerMeta>,
    movedId: number,
): Record<number, LayerMeta> => {
    const findLayer = (ls: PsdLayer[]): PsdLayer | undefined => {
        for (const l of ls) {
            if (l.id === movedId) return l;
            const hit = l.children ? findLayer(l.children as PsdLayer[]) : undefined;
            if (hit) return hit;
        }
        return undefined;
    };
    const movedRoot = findLayer((root.children ?? []) as PsdLayer[]);
    if (!movedRoot) return meta;

    const movedIds = new Set<number>();
    const collect = (l: PsdLayer) => {
        if (l.canvas && l.id !== undefined) movedIds.add(l.id);
        (l.children as PsdLayer[] | undefined)?.forEach(collect);
    };
    collect(movedRoot);

    const flat = flattenLayers(root);
    const others = flat.filter(l => !movedIds.has(l.id!));
    // 明示 z を持つものだけが対象。持たないレイヤーは走査順で決まるので、
    // 並べ替えはもともとそのまま効いている。
    const targets = flat.filter(l => movedIds.has(l.id!) && typeof meta[l.id!]?.zIndex === 'number');
    if (targets.length === 0 || others.length === 0) return meta;

    const eff = resolveZIndices(flat, meta);
    const zOf = new Map<number, number>();
    flat.forEach((l, i) => zOf.set(l.id!, eff[i]));

    // 部分木は走査順で連続するので、塊の直前に来たレイヤーが差し込み先の基準になる。
    const firstIdx = flat.findIndex(l => movedIds.has(l.id!));
    const pred = firstIdx > 0 ? flat[firstIdx - 1] : null;

    const next = { ...meta };

    // 直前が走査順のレイヤー（明示 z 無し）なら、こちらも明示 z を捨てて同じ土俵に乗せる。
    // 明示 z の一群は必ず走査順の一群より背面に来るため、値を振っても前に出られず、
    // 「そこから先へは動かせない」状態が残ってしまう。
    if (pred && typeof meta[pred.id!]?.zIndex !== 'number') {
        for (const l of targets) {
            const m = { ...next[l.id!] };
            delete m.zIndex;
            next[l.id!] = m;
        }
        return next;
    }

    // 差し込む先頭の値。最背面へ動かしたときは、残りの最小値をそのまま奪う。
    const target = pred ? zOf.get(pred.id!)! + 1 : Math.min(...others.map(l => zOf.get(l.id!)!));

    // 場所を空ける。target 以上の明示 z を、差し込む枚数だけ押し上げる。
    const shift = targets.length;
    for (const l of others) {
        const z = next[l.id!]?.zIndex;
        if (typeof z === 'number' && z >= target) next[l.id!] = { ...next[l.id!], zIndex: z + shift };
    }

    // 塊の中の重なりは変えない。いまの z の順に詰め直す。
    [...targets]
        .sort((a, b) => zOf.get(a.id!)! - zOf.get(b.id!)!)
        .forEach((l, i) => { next[l.id!] = { ...next[l.id!], zIndex: target + i }; });

    return next;
};

const recalculateMeta = (root: Psd, currentMeta: Record<number, LayerMeta>): Record<number, LayerMeta> => {
    const newMeta = { ...currentMeta };

    // 「@」始まりのグループは *フレーム* グループとして扱う（v0.5.0 §2 の frameName）。
    // 通常のグループはこれまでどおりパーツ（深い階層が partID を上書きする）。
    //
    // 目印を必要とするのは、この traverse がもともと「どのグループ階層も partID を
    // 上書きする」規則で動いており、階層の深さだけでは frameName と区別できないため。
    // 接頭辞を opt-in にすることで既存の PSD の解釈は一切変わらない。
    //
    //   衣装        （グループ）→ partID = 衣装
    //     @制服     （グループ）→ frameName = 制服（partID は 衣装 のまま）
    //       上着
    //       スカート
    const FRAME_GROUP_PREFIX = '@';

    /**
     * グループが差分パーツ（switch）か、重ねて使うパーツ（static）かを推定する。
     *
     * 以前は「グループなら常に switch」だった。`Body`（体・首・脚・スカート…を重ねて
     * 1 つの体にするグループ）まで差分扱いになるため、書き出した .emg では体の
     * 10 枚のうち 1 枚しか描かれない。プレビューが全レイヤーを重ねて描いていたので
     * 画面上は正常に見えていたが、出力は最初から壊れていた。
     *
     * 判定は PSD の慣習に従う。差分グループは「1 つだけ表示して残りは非表示」に
     * してあるので、非表示が可視と同数以上あれば差分群とみなす。逆に全部（または
     * ほとんど）が同時に見えているなら、それは重ねて使うパーツ。
     */
    const inferGroupType = (layer: PsdLayer): 'static' | 'switch' => {
        const leaves = (layer.children ?? []).filter(c => !c.children || c.children.length === 0);
        if (leaves.length === 0) return 'static';   // 直属のレイヤーが無いので実質どちらでもよい
        const hidden = leaves.filter(c => c.hidden).length;
        const visible = leaves.length - hidden;
        return hidden > 0 && hidden >= visible ? 'switch' : 'static';
    };

    const traverse = (
        layer: PsdLayer,
        defaultPartId: string,
        defaultType: 'static' | 'switch',
        defaultFrameName?: string
    ) => {
        const isGroup = layer.children && layer.children.length > 0;

        let currentPartId = defaultPartId;
        let currentType = defaultType;
        let currentFrameName = defaultFrameName;

        if (isGroup) {
            const name = layer.name || `Group_${layer.id}`;
            if (name.startsWith(FRAME_GROUP_PREFIX)) {
                currentFrameName = name.slice(FRAME_GROUP_PREFIX.length);
                currentType = 'switch';   // フレームを持つ以上、親は排他パーツ
            } else {
                currentPartId = name;
                currentType = inferGroupType(layer);
                currentFrameName = undefined;
            }
        }

        if (layer.id !== undefined) {
            if (!newMeta[layer.id]) {
                // PSD では差分（表情など）は 1 枚だけ表示され残りは非表示になっている。
                // それをそのまま「書き出さない」にすると switch パーツの差分が全部落ちて
                // 切り替えられなくなるため、switch は既定で全レイヤーを書き出し、
                // PSD で表示されていたものを isDefault（初期表示）とする。
                //
                // static は PSD の可視性を defaultVisible として持たせる。v0.5.0 §4 により
                // 「初期非表示のトグル」として書き出せるようになったため、
                // 非表示のアクセサリ類を捨てずに済む。
                const isSwitch = currentType === 'switch';
                newMeta[layer.id] = {
                    id: layer.id,
                    partId: currentPartId,
                    type: currentType,
                    frameName: currentFrameName,
                    visible: true,
                    isDefault: isSwitch ? !layer.hidden : undefined,
                    defaultVisible: isSwitch ? undefined : !layer.hidden,
                    opacity: normalizeOpacity(layer.opacity),
                    blendMode: layer.blendMode || 'normal'
                };
            } else {
                // **その場で書き換えない。** newMeta は浅いコピーなので、
                // 中の LayerMeta は呼び出し前の状態と同じオブジェクト。
                // 書き換えると、取り消し用に取ってあるスナップショットの中身まで
                // 変わってしまう（パーツ名を戻せない、という形で表面化した）。
                newMeta[layer.id] = {
                    ...newMeta[layer.id],
                    partId: currentPartId,
                    frameName: currentFrameName,
                };
            }
        }

        if (isGroup) {
            layer.children?.forEach(l => traverse(l, currentPartId, currentType, currentFrameName));
        }
    };

    root.children?.forEach(child => {
        const isGroup = child.children && child.children.length > 0;
        const pid = child.name || `Root_${child.id}`;
        const ptype = isGroup ? inferGroupType(child) : 'static';

        traverse(child, pid, ptype);
    });

    // static パーツの後処理。
    // 「全レイヤーが非表示」なら、パーツごと初期非表示のトグルとして書き出す（v0.5.0 §4）。
    // 「一部だけ非表示」なら、その隠れレイヤーは意図的に使っていないものとみなし、
    // 書き出しから外す（常時表示される static に混ぜると意図しない重なりになるため）。
    const staticByPart = new Map<string, LayerMeta[]>();
    for (const id in newMeta) {
        const m = newMeta[id];
        if (m.type !== 'static') continue;
        if (!staticByPart.has(m.partId)) staticByPart.set(m.partId, []);
        staticByPart.get(m.partId)!.push(m);
    }
    for (const metas of staticByPart.values()) {
        const allHidden = metas.every(m => m.defaultVisible === false);
        if (allHidden) continue;   // パーツごとトグルにするのでレイヤーは全部残す
        for (const m of metas) {
            if (m.defaultVisible === false) newMeta[m.id] = { ...m, visible: false };
        }
    }

    return newMeta;
};

export function useEmgPacker() {
    const [psdRoot, setPsdRoot] = useState<Psd | null>(null);
    const [atlasUrls, setAtlasUrls] = useState<string[]>([]);
    const [selectedLayer, setSelectedLayer] = useState<PsdLayer | null>(null);
    const [layerMeta, setLayerMeta] = useState<Record<number, LayerMeta>>({});
    const [packResult, setPackResult] = useState<PackResult | null>(null);

    /**
     * 取り込んだ素材の一覧。合流したあとの木には出自が残らないため、
     * 取り込んだ時点で控える（`mergeSource`）。
     */
    const [sources, setSources] = useState<SourceEntry[]>([]);

    /**
     * 一覧で選んでいる素材。プレビューにバウンディングボックスを出す対象。
     *
     * パーツの選択とは排他にする（`handleSelectSource` / `handleSelectPart`）。
     * 枠が 2 つ出ていると、掴んだものがどちらに効くのか分からない。
     */
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

    /**
     * 直前の `mergeSource` が作った葉レイヤーの id。
     * 複製したものを「元のすぐ手前」へ置き直すのに、合流直後の同期的な値が要る。
     */
    const lastMergedLeafIds = useRef<number[]>([]);

    /**
     * ヌル（複数パーツをまとめて動かす入れ物）。
     * 実体は「所属パーツが同じトランスフォームとアンカーを共有している」状態で、
     * それを保つのは `handleTransformChange` の配り込み。
     */
    const [transformGroups, setTransformGroups] = useState<TransformGroup[]>([]);

    /**
     * `.emg` に動きを含めるか（`sprites[]` を書くか）。
     *
     * 切るとコマ送り（`sequence`）とトランスフォーム（§7 `tracks`）が出ません。
     * 静止画として配りたいときや、**§7 を実装していない再生側へ渡すとき**に使います
     * （§7 を描画へ反映しているのは 6 実装中 3 つで、`targetLayer` に至っては
     * どこも未対応）。まばたき・口パク（`mapping.json`）とプリセットは残ります —
     * あちらは `sprites[]` とは別の仕組みなので、切る理由がありません。
     */
    const [includeAnimation, setIncludeAnimation] = useState(true);

    // 複数ファイルを続けて取り込むとき、state はまだ前回の値を返す
    // （setPsdRoot は同じ関数内では反映されない）。そのまま次のファイルを
    // 処理すると 1 つ前の木に合流させてしまい、先に入れたものが消える。
    // 同期的に読める控えを持ち、取り込み処理はこちらを見る。
    const psdRootRef = useRef<Psd | null>(null);
    const layerMetaRef = useRef<Record<number, LayerMeta>>({});

    /** psdRoot と layerMeta は必ず対で更新する（片方だけだとメタが欠ける）。 */
    const applyTree = (root: Psd | null, meta: Record<number, LayerMeta>) => {
        psdRootRef.current = root;
        layerMetaRef.current = meta;
        setPsdRoot(root);
        setLayerMeta(meta);
    };

    // layerMeta はパーツ操作など applyTree を通らない経路でも更新される。
    // 同期しておかないと、それらの編集内容が次の取り込みで失われる。
    useEffect(() => { psdRootRef.current = psdRoot; }, [psdRoot]);
    useEffect(() => { layerMetaRef.current = layerMeta; }, [layerMeta]);


    const [toast, setToast] = useState<ToastMessage | null>(null);

    // 書き出しの進捗。4096x8192 の PNG エンコードで十数秒かかるため、
    // 押した直後に無反応に見えてしまう。割合は目安で、正確さは求めていない。
    const [exportProgress, setExportProgress] = useState<{ phase: string; percent: number } | null>(null);

    /**
     * 出来上がったが、まだ保存していない `.emg`。
     *
     * 保存ダイアログを出せない環境では、書き出しの直後に自動で落とすと
     * ブラウザに黙って捨てられる（操作から続いていない扱い）。押されたときに
     * 落とすため、ここに置いてボタンを「保存する」に変える。
     */
    const [pendingExport, setPendingExport] = useState<{ blob: Blob; name: string } | null>(null);

    // プレビュー専用の状態。書き出し結果には一切影響しない。
    //   previewFrame : switch パーツで今どの差分を見ているか（既定は part.default）
    //   previewOff   : プレビュー上で伏せているパーツ（顔の確認で髪を退かす等）
    const [previewFrame, setPreviewFrame] = useState<Record<string, string>>({});
    const [previewOff, setPreviewOff] = useState<Record<string, boolean>>({});
    const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

    // partID -> アニメーション設定。sprites[] の元になる（emg-json-spec.md 7 章）。
    // レイヤーではなくパーツ単位で持つのは、sprites[] が targetPartID を単位に
    // フレームを切り替える仕様だから。
    const [partAnimations, setPartAnimations] = useState<Record<string, PartAnimation>>({});

    // mapping.json の編集状態。まばたき・口パクの役割パーツとフレーム割り当て。
    // 空のまま書き出すと消費側で目も口も動かないため、書き出し前に未割り当てを知らせる。
    const [mapping, setMapping] = useState<AvatarMapping>(emptyMapping);

    // 状態の組（presets[]）。差分として持つ（types.ts の AvatarPreset を参照）。
    const [presets, setPresets] = useState<AvatarPreset[]>([]);

    // 表情（mapping.json の expressions）。構造はプリセットが持ち、
    // 表情はそれを参照して目・口だけを足す（types.ts の AvatarExpression を参照）。
    const [expressions, setExpressions] = useState<AvatarExpression[]>([]);

    // partID -> トランスフォーム（v0.5.0 §7 の tracks[]）。
    // sequence（差分の切り替え）とは別の軸なので partAnimations とは分けて持つ。
    // 書き出しでは 1 つの sprite にまとめる（§10.5: loop は tracks、trigger は sequence）。
    const [partTransforms, setPartTransforms] = useState<Record<string, PartTransform>>({});

    /**
     * パーツごとに「いま編集している対象」（0.5.3 §7.4.1）。undefined ならパーツ全体。
     *
     * **キャンバスとタイムラインで共有します。** 別々に持つと、バウンディング
     * ボックスを引いて動かしたものと、数値欄に出ている値が別物になる。
     */
    const [transformTarget, setTransformTarget] = useState<Record<string, string | undefined>>({});

    // ---- 再生 --------------------------------------------------------------
    // scope は「今どの範囲を動かしているか」。単体再生のときに他のパーツまで
    // 動くと、そのパーツの動きだけを見たいのに全体が揺れて確認にならない。
    const [transformTime, setTransformTime] = useState(0);
    const [playScope, setPlayScope] = useState<string | 'all' | null>(null);

    useEffect(() => {
        if (!playScope) return;
        let raf = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;
            setTransformTime(t => t + dt);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playScope]);

    /**
     * トランスフォームを書き換える。第 1 引数はパーツ、または「パーツ + フレーム」（§7.4.1）。
     *
     * **パーツ単位の変更は、同じヌルの全メンバーへ配ります。** ヌルの実体は
     * 「メンバーが同じトランスフォームと同じアンカーを共有している」状態であり、
     * それを保てるのはここだけです（バウンディングボックス・タイムライン・数値欄の
     * どれから来た変更もここを通る）。
     *
     * フレーム単位（§7.4.1）の変更は配りません。フレーム識別子はパーツの中の名前なので、
     * 他のパーツに同じ識別子がある保証が無く、あっても別物です。
     */
    const handleTransformChange = (partId: string, patch: Partial<PartTransform>) => {
        const parsed = parseTransformKey(partId);
        const group = parsed.frame === undefined
            ? transformGroups.find(g => g.partIds.includes(parsed.partId))
            : undefined;
        const targets = group ? group.partIds : [parsed.partId];
        setPartTransforms(prev => {
            const next = { ...prev };
            for (const id of targets) {
                const key = group ? id : partId;
                next[key] = { ...(next[key] ?? emptyTransform()), ...patch };
            }
            return next;
        });
    };

    /** そのパーツが属するヌル。無ければ undefined。 */
    const groupOfPart = useCallback(
        (partId: string) => transformGroups.find(g => g.partIds.includes(partId)),
        [transformGroups]);

    const handlePlayToggle = (scope: string | 'all') => {
        // **更新関数の中で別の setState を呼んではいけない。** React は更新関数を
        // 再実行することがあるので、そこに置いた setTransformTime(0) は毎フレーム
        // 積み直され、時刻が 0 に張り付く（実際にそうなった）。
        // 判定は現在値で行い、副作用はここに出す。
        const next = playScope === scope ? null : scope;
        // 別の対象に切り替えるときは頭出しする。途中から始まると
        // 「押したのに動かない」（キーの無い区間だった）が起きる。
        if (next && next !== playScope) setTransformTime(0);
        setPlayScope(next);
    };

    const handleTransformReset = () => { setPlayScope(null); setTransformTime(0); };

    /**
     * 再生できるものが 1 つでもあるか。
     *
     * **コマ送り（`sequence`）と座標変換（`tracks`）の両方**を見る。以前は
     * `tracks` しか見ていなかったので、GIF を読み込んだだけの状態では
     * 「全体」ボタンが押せず、再生する手段が無かった。
     */
    const anyPlayable = useMemo(
        () => Object.values(partAnimations).some(isPlayable)
            || Object.values(partTransforms).some(hasAnimation),
        [partAnimations, partTransforms]
    );

    /** そのパーツに再生できるものがあるか（単体再生ボタンの有効・無効）。 */
    const partPlayable = useCallback((partId: string) => {
        if (isPlayable(partAnimations[partId])) return true;
        return Object.entries(partTransforms).some(([k, t]) =>
            parseTransformKey(k).partId === partId && hasAnimation(t));
    }, [partAnimations, partTransforms]);

    // ---- 取り消し / やり直し ------------------------------------------------
    // 対象は「書き出しに影響する状態」だけ。プレビューの差分選択や再生位置は
    // 含めない（useHistory の DocumentSnapshot を参照）。
    const snapshot = useMemo<DocumentSnapshot>(() => ({
        psdRoot, layerMeta, partAnimations, partTransforms, mapping, presets, expressions, sources,
        transformGroups,
    }), [psdRoot, layerMeta, partAnimations, partTransforms, mapping, presets, expressions, sources,
        transformGroups]);

    const restoreSnapshot = useCallback((s: DocumentSnapshot) => {
        // ツリーとメタは必ず対で戻す。片方だけだとメタが欠ける。
        applyTree(s.psdRoot, s.layerMeta);
        setPartAnimations(s.partAnimations);
        setPartTransforms(s.partTransforms);
        setMapping(s.mapping);
        setPresets(s.presets);
        setExpressions(s.expressions);
        setSources(s.sources);
        setTransformGroups(s.transformGroups);
        // 再生は止める。戻した先にキーが無いことがあり、
        // 「動いているのに何も起きない」状態になる。
        setPlayScope(null);
    }, []);

    // 読み込みが終わるたびに進める。これより前には戻れなくてよい。
    const [loadToken, setLoadToken] = useState(0);

    /**
     * いま扱っている素材の名前。保存名の芯にする。
     * 固定名だと書き出すたびに `model (1).emg` と積み上がり、
     * どれがどの素材か分からなくなる。
     */
    const [projectName, setProjectName] = useState('untitled');
    const history = useHistory(snapshot, restoreSnapshot, loadToken);

    /** 今の内容を捨てて最初からにする。読み込みの直前に必ず通す。 */
    const resetEditingState = () => {
        setPendingExport(null);
        setPartAnimations({});
        setPartTransforms({});
        setTransformTarget({});
        setPlayScope(null);
        setTransformTime(0);
        setPreviewFrame({});
        setPreviewOff({});
        setMapping(emptyMapping());
        setPresets([]);
        setExpressions([]);
        setSources([]);
        setTransformGroups([]);
        applyTree(null, {});
    };

    const handlePsdLoad = async (file: File) => {
        try {
            resetEditingState();
            // `.emg` は「書き出したものの続き」なので、開く経路も同じ入口にする。
            if (isEmgFile(file.name)) {
                await importEmg(file);
                setProjectName(baseNameOf(file.name));
            } else {
                setProjectName(baseNameOf(file.name));
                // **SourceLoader を通す。** 以前はここで FileLoader（PSD / KRA 専用）を
                // 直接呼んでいたため、選択ダイアログが受け付ける GIF や PNG を選ぶと
                // 「Invalid signature: 'GIF8'」で失敗していた。「素材を追加」でしか
                // 読めないという状態で、GIF を再生できない原因もこれだった。
                mergeSource(await SourceLoader.load(file), file.name);
            }
            // 読み込み完了。**「開く」のときだけ**履歴を捨てる。
            // 「素材を追加」は普通の編集なので、取り消せなければならない。
            setLoadToken(n => n + 1);
        } catch (e) {
            // alert はレンダラ全体を止める（ブラウザでもう一度触るまで何も動かなくなる）。
            console.error('Failed to load file:', e);
            setToast({ title: '読み込めませんでした', body: String(e instanceof Error ? e.message : e), tone: 'error' });
        }
    };

    /**
     * 空のキャンバスから始める。
     *
     * これが無いと、何かを読み込むまでキャンバスの寸法が決まらず、
     * 最初に入れた素材の大きさがそのまま作品の大きさになっていた。
     * 先に器を決めてから素材を置ける方が、配置を考えて作る場合には自然。
     */
    const handleNewProject = (width: number, height: number) => {
        resetEditingState();
        applyTree({ width, height, children: [] } as unknown as Psd, {});
        setLoadToken(n => n + 1);
        setProjectName('untitled');
        setToast({ title: '新規作成', body: `${width} × ${height} px の空のキャンバス` });
    };

    /**
     * キャンバスの寸法を変える（`baseCanvasWidth` / `baseCanvasHeight`）。
     *
     * `align === 'topLeft'` は座標を一切触りません。書き出した `basePosition` が
     * そのままなので、既に配布したファイルと位置がずれません。
     * `align === 'center'` は増減分の半分だけ全レイヤーを動かします。
     */
    const handleCanvasResize = (width: number, height: number, align: 'topLeft' | 'center') => {
        const root = psdRootRef.current;
        if (!root) return;

        let children = root.children ?? [];
        if (align === 'center') {
            const dx = Math.round((width - (root.width ?? 0)) / 2);
            const dy = Math.round((height - (root.height ?? 0)) / 2);
            if (dx !== 0 || dy !== 0) {
                // レイヤーは不変に扱う（取り消しのスナップショットが参照を共有しているため、
                // その場で書き換えると過去の状態まで動いてしまう）。
                const shift = (ls: PsdLayer[]): PsdLayer[] => ls.map(l => ({
                    ...l,
                    left: typeof l.left === 'number' ? l.left + dx : l.left,
                    top: typeof l.top === 'number' ? l.top + dy : l.top,
                    right: typeof l.right === 'number' ? l.right + dx : l.right,
                    bottom: typeof l.bottom === 'number' ? l.bottom + dy : l.bottom,
                    children: l.children ? shift(l.children as PsdLayer[]) : undefined,
                }));
                children = shift(children as PsdLayer[]);

                // アンカーはキャンバス座標なので一緒に動かす（v0.4.0 §3）。
                // 置き去りにすると、回転の中心だけが元の場所に残る。
                setPartTransforms(prev => {
                    const next: Record<string, PartTransform> = {};
                    for (const [k, t] of Object.entries(prev)) {
                        next[k] = t.anchor
                            ? { ...t, anchor: { x: t.anchor.x + dx, y: t.anchor.y + dy } }
                            : t;
                    }
                    return next;
                });
            }
        }

        applyTree({ ...root, width, height, children }, layerMetaRef.current);
    };

    /**
     * 2 つ目以降のソースを取り込んで、いま開いている木に合流させる。
     *
     * 合成は「1 本の木にまとめる」形にする。走査結果がこれまでどおり単一の
     * packItems 配列になり、**全素材が 1 枚のアトラスに詰められる**（要件 R-1）。
     * ソースごとに PackResult を持つ実装にはしない。
     */
    /**
     * `.emg` を編集中に足そうとしている。開くのか足すのかを尋ねるまで保留する。
     *
     * `.emg` は 1 つで完結したファイルなので、放り込んだ人はたいてい
     * 「開きたい」。黙って合流させると、元の絵が残ったまま別のものが増え、
     * しかも意味づけ（まばたき等）が上書きされる。
     */
    const [pendingEmgDrop, setPendingEmgDrop] = useState<File | null>(null);

    const handleSourceAdd = async (file: File) => {
        // 空なら迷う余地がないのでそのまま開く。
        if (isEmgFile(file.name) && (psdRootRef.current?.children?.length ?? 0) > 0) {
            setPendingEmgDrop(file);
            return;
        }
        try {
            // 空から足した最初の素材で名前を決める。以後は上書きしない
            // （2 つ目を足すたびに保存名が変わると探しにくい）。
            if (projectName === 'untitled') setProjectName(baseNameOf(file.name));
            if (isEmgFile(file.name)) { await importEmg(file); return; }
            mergeSource(await SourceLoader.load(file), file.name);
        } catch (e) {
            console.error('Failed to add source:', e);
            setToast({ title: `${file.name} を取り込めませんでした`, body: String(e instanceof Error ? e.message : e), tone: 'error' });
        }
    };

    /**
     * 複数のファイルをまとめて取り込む。
     *
     * **連番の画像は 1 本のアニメーションにまとめます。** `frame_001.png` …
     * `frame_120.png` を 1 枚ずつ入れると 120 個の別パーツになり、再生順を手で
     * 組み直すことになるためです。GIF と同じ扱い（`kind: 'animation'`）に落とし、
     * そのまま再生できる状態にします。
     *
     * まとめるのは**共通名が一致して 2 枚以上ある組だけ**です。無関係な画像を
     * 束ねて放り込んだときに、勝手に 1 本のアニメーションへ変えてしまわないため
     * （`groupSequences` を参照）。残りは今までどおり 1 つずつ取り込みます。
     */
    const handleSourcesAdd = async (files: File[]) => {
        if (files.length === 0) return;
        const { groups, rest } = groupSequences(files);

        for (const g of groups) {
            try {
                if (projectName === 'untitled') setProjectName(g.baseName);
                const source = await loadSequence(g);
                mergeSource(source, `${g.baseName}（連番 ${g.files.length} コマ）`);
            } catch (e) {
                console.error('Failed to add sequence:', e);
                setToast({
                    title: `${g.baseName} の連番を取り込めませんでした`,
                    body: String(e instanceof Error ? e.message : e), tone: 'error',
                });
            }
        }
        // **1 つずつ順に。** 並行にすると合流が同じ木を同時に書き換えて取りこぼす。
        for (const f of rest) await handleSourceAdd(f);
    };

    /**
     * `.emg` を編集状態に戻す。
     *
     * レイヤーは `mergeSource` に流す（ID の採番・キャンバスの拡張・トーストが
     * 1 か所で済む）。`.emg` にしか無い情報 — sprites / presets / mapping.json —
     * だけをここで足す。
     *
     * **元の PSD を置き換えるものではありません。** グループ階層、書き出しに
     * 含めなかったレイヤー、トリミング前の余白は戻りません。
     */
    const importEmg = async (file: File, mode: 'open' | 'merge' = 'open') => {
        const loaded = await EmgLoader.load(file);
        const renamed = mergeSource(loaded.source, file.name);
        if (!renamed) return;

        // 合流時にパーツが改名されたら、partID を参照しているものを付け替える。
        // sprites / presets / mapping.json はすべて partID で結び付いているので、
        // ここを飛ばすと「読めたのに何も動かない」ファイルになる。
        const pid = (id: string) => renamed.get(id) ?? id;
        const animations = Object.fromEntries(
            Object.entries(loaded.animations).map(([k, a]) => [pid(k), { ...a, spriteID: pid(a.spriteID) }]));
        const transforms = Object.fromEntries(
            Object.entries(loaded.transforms).map(([k, t]) => [pid(k), t]));
        const presets = loaded.presets.map(p => ({
            ...p,
            parts: Object.fromEntries(Object.entries(p.parts).map(([k, v]) => [pid(k), v])),
            toggles: Object.fromEntries(Object.entries(p.toggles).map(([k, v]) => [pid(k), v])),
        }));
        const mapping = {
            ...loaded.mapping,
            blinkPartId: loaded.mapping.blinkPartId ? pid(loaded.mapping.blinkPartId) : '',
            lipSyncPartId: loaded.mapping.lipSyncPartId ? pid(loaded.mapping.lipSyncPartId) : '',
        };

        // アニメーションとトランスフォームはパーツ単位で独立しているので重ねる。
        setPartAnimations(prev => ({ ...prev, ...animations }));
        setPartTransforms(prev => ({ ...prev, ...transforms }));

        if (mode === 'open') {
            // まばたき・プリセット・表情は presetID の参照で結び付いた一式なので置き換える。
            setMapping(mapping);
            setPresets(presets);
            setExpressions(loaded.expressions);
        } else {
            // **合流のときは今の設定を壊さない。** 以前はここでも置き換えていたため、
            // 編集中のファイルに `.emg` を足すと、それまでのまばたき・口パクの
            // 割り当てが黙って消えていた。
            let keptMapping = false;
            setMapping(prev => {
                const touched = !!prev.blink.open || !!prev.blink.closed
                    || !!prev.lipSync.a || !!prev.lipSync.n;
                if (touched) { keptMapping = true; return prev; }
                return mapping;
            });
            // プリセットと表情は名前がぶつからないものだけ足す。
            setPresets(prev => {
                const used = new Set(prev.map(p => p.presetID));
                return [...prev, ...presets.filter(p => !used.has(p.presetID))];
            });
            setExpressions(prev => {
                const used = new Set(prev.map(e => e.name));
                return [...prev, ...loaded.expressions.filter(e => !used.has(e.name))];
            });
            if (keptMapping) {
                loaded.warnings.push('今のまばたき・口パクの割り当てを残したため、'
                    + '読み込んだ側の割り当ては使いませんでした');
            }
        }

        if (loaded.warnings.length > 0) {
            setToast({
                title: '読み込みました（戻せなかったものがあります）',
                body: loaded.warnings.join(' / '),
                tone: 'error',
            });
        }
    };

    /**
     * 読み込んだソースを今の木に合流させる。
     *
     * ファイルの読み方（PSD / 画像 / GIF / スプライトシート）によらず、
     * ここから先は同じ処理にする。経路が分かれると ID の採番やアニメーション設定の
     * 登録を片方だけ書き忘れる（実際に起きた）。
     */
    const mergeSource = (source: LoadedSource, fileName: string): Map<string, string> | null => {
        if (source.children.length === 0) {
            setToast({ title: '取り込めませんでした', body: `${fileName} にレイヤーがありません。`, tone: 'error' });
            return null;
        }

            // 何も開いていない場合も同じ経路を通す。分けると、ID の採番や
            // アニメーション設定の登録を片方だけ書き忘れる（実際に起きた:
            // 画像・GIF のレイヤーは ID を持たないため、ID を振らない経路では
            // recalculateMeta がメタを作れず、パーツが 0 個になっていた）。
            const base: Psd = psdRootRef.current ?? { width: 0, height: 0, children: [] };

            // 1. ID を振り直す。PsdLoader.ensureIds は読み込みごとに 1 から数え直すうえ、
            //    ImageLoader / AnimationLoader のレイヤーはそもそも ID を持たない。
            //    ここで必ず一意な ID を与える（layerMeta のキーになる）。
            let nextId = maxLayerId(base.children ?? []) + 1;
            // ソースが編集状態の初期値を持っている場合（`.emg` の読み込み）、
            // 新しい ID に結び付けて種に渡す。recalculateMeta は既にメタがある
            // レイヤーには推定を当てないので、これで既定の推定を迂回できる。
            const seed: Record<number, LayerMeta> = {};
            const reid = (layers: PsdLayer[]): PsdLayer[] => layers.map(l => {
                const id = nextId++;
                const m = source.metaOf?.(l);
                if (m) seed[id] = { ...m, id, partId: '' };
                return { ...l, id, children: l.children ? reid(l.children) : undefined };
            });
            const incoming = reid(source.children as PsdLayer[]);

            // この素材が持ち込んだ葉レイヤーを控える。一覧・削除・一括配置の対象。
            const incomingLeafIds: number[] = [];
            const collectLeaves = (ls: PsdLayer[]) => ls.forEach(l => {
                if (l.children && l.children.length > 0) collectLeaves(l.children as PsdLayer[]);
                else if (l.id !== undefined) incomingLeafIds.push(l.id);
            });
            collectLeaves(incoming);
            lastMergedLeafIds.current = incomingLeafIds;

            // 1.5. partID がぶつかるグループを改名する。
            const renamed = renameColliding(incoming, collectGroupNames(base.children ?? []));

            // 2. キャンバスは大きい方に合わせて広げる。既存レイヤーは動かさない
            //    （動かすと今まで書き出していた座標が変わってしまう）。
            const canvasW = Math.max(base.width ?? 0, source.width);
            const canvasH = Math.max(base.height ?? 0, source.height);

            // 3. 取り込んだ素材は新しいキャンバスの中央に置く。
            //    左上に積むと既存の絵と重なって何が入ったのか分からない。
            const dx = Math.round((canvasW - source.width) / 2);
            const dy = Math.round((canvasH - source.height) / 2);
            if (dx !== 0 || dy !== 0) shiftLayers(incoming, dx, dy);

            // 4. ソース 1 つ = グループ 1 つ。グループ名がそのまま partID になる。
            //
            // ただし何も開いていないところに PSD / KRA を入れたときは包まない。
            // 包むと文書自身のトップレベルのグループがパーツの起点でなくなり、
            // 「開く」で読んだ場合と構造が変わってしまう（ルート直下の単独レイヤーが
            // 独立したパーツにならず、ファイル名のパーツに吸収される）。
            const wrap = (base.children?.length ?? 0) > 0 || source.kind !== 'document';
            const group: PsdLayer | null = wrap ? {
                id: nextId++,
                name: uniqueGroupName(base.children ?? [], source.name),
                hidden: false,
                children: incoming,
                canvas: undefined,
            } : null;

            // 前面に積む（ag-psd の children は背面 → 前面）。
            const newRoot: Psd = {
                ...base,
                width: canvasW,
                height: canvasH,
                children: group ? [...(base.children ?? []), group] : incoming,
            };

            applyTree(newRoot, recalculateMeta(newRoot, { ...layerMetaRef.current, ...seed }));

            // アニメーションなら、そのまま再生できる状態にしておく。
            // フレームを取り込んだだけでは静止した差分パーツにしかならず、
            // 利用者が手で再生順を組み直すことになる。
            if (source.kind === 'animation' && source.frameDurations && group) {
                const frames = incoming.map(l => l.name ?? '');
                setPartAnimations(prev => ({
                    ...prev,
                    [group.name!]: buildAnimationFromDurations(group.name!, frames, source.frameDurations!),
                }));
            }

            const frameNote = source.kind === 'animation'
                ? `${incoming.length} フレーム`
                : `${countLeaves(incoming)} レイヤー`;

            // フレーム数が多いとアトラスを圧迫し、「1 枚に収める」が崩れる。
            // 書き出してから気づくのでは遅いので、取り込んだ時点で伝える。
            const label = group?.name ?? source.name;

            // 素材として記録する。**空のところに PSD を入れた場合はグループで
            // 包まれない**ので、id で持っておかないと後から範囲が分からない。
            setSources(prev => [...prev, {
                id: `src${Date.now().toString(36)}${prev.length}`,
                name: label,
                fileName,
                kind: isEmgFile(fileName) ? 'emg' : source.kind,
                layerIds: incomingLeafIds,
                transform: { ...IDENTITY_SOURCE_TRANSFORM },
            }]);

            const renameNote = renamed.size > 0
                ? ` 名前が重なるパーツを改名しました: ${[...renamed].map(([a, b]) => `${a} → ${b}`).join('、')}`
                : '';
            setToast(source.kind === 'animation' && incoming.length > FRAME_COUNT_WARNING
                ? {
                    title: `取り込み（フレームが多めです）`,
                    body: `${label} — ${frameNote}。テクスチャ 1 枚に収まらない場合があります。`
                        + `書き出し後の枚数を確認してください。${renameNote}`,
                }
                : { title: '取り込み', body: `${label}（${frameNote}）${renameNote}` });

            return renamed;
    };

    /** スプライトシートの切り出し結果を取り込む（格子と fps はダイアログで決める）。 */
    const handleSheetImport = (
        sheetName: string,
        sliced: { width: number; height: number; children: Layer[]; frameDurations: number[] }
    ) => {
        mergeSource({
            name: sheetName,
            width: sliced.width,
            height: sliced.height,
            children: sliced.children,
            kind: 'animation',
            frameDurations: sliced.frameDurations,
        }, sheetName);
    };

    /**
     * 素材 1 件を複製する。同じ絵をもう一度置きたいとき（左右の飾り、並べる小物）に使う。
     *
     * 取り込み経路（`mergeSource`）に載せます。ID の振り直し・partID の衝突改名・
     * 素材としての記録が全部そこにあるためで、別経路を書くと必ずどれかを書き忘れます。
     *
     * **canvas は共有します。** 焼き込み（`bakeLayer`）は常に新しい canvas を作るので、
     * 元と複製が同じ画素を指していても互いに干渉しません。複製のたびにアトラスの
     * 元画像まで倍にすると、10 個並べただけで 8192px に収まらなくなります。
     */
    /**
     * レイヤーの一群を複製して、いまの木へ足す。
     *
     * 取り込み経路（`mergeSource`）に載せます。ID の振り直し・partID の衝突改名・
     * 素材としての記録が全部そこにあるためで、別経路を書くと必ずどれかを書き忘れます。
     *
     * **canvas は共有します。** 焼き込み（`bakeLayer` / `sliceLayer`）は常に新しい
     * canvas を作るので、元と複製が同じ画素を指していても互いに干渉しません。
     * 複製のたびに元画像まで倍にすると、10 個並べただけで 8192px に収まらなくなります。
     *
     * 戻り値は「元の partID → 改名後の partID」。呼び出し側が動きや変形を
     * 付け替えるのに使います（飛ばすと「複製したのに動かない」になる）。
     */
    const duplicateLayers = (
        owned: Set<number>,
        name: string,
        fileName: string,
        kind: SourceEntry['kind'],
    ): Map<string, string> | null => {
        const root = psdRootRef.current;
        if (!root || owned.size === 0) return null;

        const leavesOf = (l: PsdLayer): number[] =>
            (l.children && l.children.length > 0)
                ? (l.children as PsdLayer[]).flatMap(leavesOf)
                : (l.id !== undefined && l.canvas ? [l.id] : []);

        // 対象の葉だけでできている**最上位の**ノードを集める。葉を個別に拾うと
        // グループの階層（`@` で始まるフレームグループなど）が消え、partID や
        // frameName の作られ方が変わってしまう。
        const picked: PsdLayer[] = [];
        const walk = (ls: PsdLayer[]) => {
            for (const l of ls) {
                const leaves = leavesOf(l);
                if (leaves.length === 0) continue;
                if (leaves.every(id => owned.has(id))) picked.push(l);
                else if (l.children) walk(l.children as PsdLayer[]);
            }
        };
        walk((root.children ?? []) as PsdLayer[]);
        if (picked.length === 0) return null;

        // 複製した木と、元のレイヤーのメタを結び付けておく。木の形から推定させると、
        // 1 コマだけの switch や初期非表示の static を取り違える（`metaOf` を参照）。
        // 9 スライスの設定もここで一緒に引き継がれる。
        const metaByClone = new WeakMap<PsdLayer, Omit<LayerMeta, 'id' | 'partId'>>();
        const clone = (l: PsdLayer): PsdLayer => {
            const c: PsdLayer = {
                ...l,
                children: l.children ? (l.children as PsdLayer[]).map(clone) : undefined,
            };
            const m = l.id !== undefined ? layerMetaRef.current[l.id] : undefined;
            if (m) {
                const { id: _id, partId: _p, ...rest } = m;
                metaByClone.set(c, rest);
            }
            return c;
        };

        // 寸法はいまのキャンバスと同じにする。`mergeSource` は差分の半分だけ中央へ
        // 寄せるので、同じ大きさを渡せば座標が動かない（複製は元の真上に載る）。
        return mergeSource({
            name,
            width: root.width ?? 0,
            height: root.height ?? 0,
            children: picked.map(clone) as unknown as Layer[],
            kind: kind === 'emg' ? 'document' : kind,
            metaOf: (l) => metaByClone.get(l as PsdLayer),
        }, fileName);
    };

    /**
     * 複製したレイヤーを、**元のパーツのすぐ手前**の重なり順に置く。
     *
     * これが無いと、複製は元と**同じ `textureZIndex` を引き継ぎます**
     * （`metaOf` が元のメタごと渡すため）。同じ深さに少しずれて重なるので、
     * 元が置き換わったように見えます。仕様上も同じ z の順序は未定義です（§10）。
     *
     * ついでに全レイヤーの z を明示値として確定させます。明示 z を持たないファイルでは
     * 走査順が z になり、合流したものは必ず最前面へ行くため、「元のすぐ上」を
     * 表す方法がそれ以外にありません。並べ替えは `reassignExplicitZ` が引き続き効きます。
     */
    const placeDuplicateAboveOriginal = (originalPartId: string, newIds: number[]) => {
        const dupSet = new Set(newIds);
        setLayerMeta(prev => {
            const layers = flattenLayers(psdRootRef.current);
            if (layers.length === 0) return prev;
            const eff = resolveZIndices(layers, prev);
            const zOf = new Map<number, number>();
            layers.forEach((l, i) => zOf.set(l.id!, eff[i]));

            const origIds = layers
                .filter(l => !dupSet.has(l.id!) && prev[l.id!]?.partId === originalPartId)
                .map(l => l.id!);
            if (origIds.length === 0) return prev;

            const base = Math.max(...origIds.map(id => zOf.get(id)!));
            const dup = layers.filter(l => dupSet.has(l.id!)).map(l => l.id!)
                .sort((a, b) => zOf.get(a)! - zOf.get(b)!);
            if (dup.length === 0) return prev;

            const next = { ...prev };
            for (const l of layers) {
                const id = l.id!;
                if (!next[id] || dupSet.has(id)) continue;
                const z = zOf.get(id)!;
                next[id] = { ...next[id], zIndex: z > base ? z + dup.length : z };
            }
            dup.forEach((id, i) => {
                if (next[id]) next[id] = { ...next[id], zIndex: base + 1 + i };
            });
            return next;
        });
    };

    /** 複製で改名された partID へ、動きと変形を持っていく。 */
    const carryOverPartSettings = (renamed: Map<string, string>, oldParts: Set<string>) => {
        const pid = (id: string) => renamed.get(id) ?? id;
        setPartAnimations(prev => {
            const next = { ...prev };
            for (const p of oldParts) {
                const a = prev[p];
                if (a && pid(p) !== p) next[pid(p)] = { ...a, spriteID: pid(a.spriteID) };
            }
            return next;
        });
        setPartTransforms(prev => {
            const next = { ...prev };
            for (const [key, t] of Object.entries(prev)) {
                const parsed = parseTransformKey(key);
                if (!oldParts.has(parsed.partId) || pid(parsed.partId) === parsed.partId) continue;
                next[transformKey(pid(parsed.partId), parsed.frame)] = { ...t };
            }
            return next;
        });
    };

    /** そのパーツに属する葉レイヤーの id。 */
    const layerIdsOfPart = (partId: string): Set<number> => {
        const out = new Set<number>();
        for (const [idStr, m] of Object.entries(layerMetaRef.current)) {
            if (m.partId === partId) out.add(Number(idStr));
        }
        // グループのメタも partId を持つので、canvas を持つ葉だけに絞る。
        const leaves = new Set(flattenLayers(psdRootRef.current).map(l => l.id!));
        return new Set([...out].filter(id => leaves.has(id)));
    };

    /**
     * パーツ 1 つを複製する。同じ絵をもう一度置きたいとき（左右の飾り、並べる小物）に使う。
     * 複製は新しい partID を持つ別のパーツになるので、差分もアニメーションも独立して扱えます。
     */
    const handlePartDuplicate = (partId: string) => {
        const owned = layerIdsOfPart(partId);
        if (owned.size === 0) return;
        const OFFSET = 40;
        const renamed = duplicateLayers(owned, partId, partId, 'document');
        if (!renamed) return;
        // 重なり順を「元のすぐ手前」に直す。合流直後は元と同じ z を持っている。
        placeDuplicateAboveOriginal(partId, lastMergedLeafIds.current);

        // 真上に重なったままだと増えたことが分からない。少しずらして置く。
        setSources(prev => prev.map((s, i) => i === prev.length - 1
            ? { ...s, name: `${partId} 複製`, transform: { x: OFFSET, y: OFFSET, scale: 1, rotation: 0 } }
            : s));
        carryOverPartSettings(renamed, new Set([partId]));

        const to = renamed.get(partId);
        // **複製した側を選んでおく。** 大きなパーツを少しずらして置くと、元がその下に
        // 隠れて「元が消えた」ように見える。どちらが複製かを枠で示し、そのまま
        // 動かせるようにする。
        if (to) {
            handleSelectSource(null);
            setSelectedPartId(to);
        }
        setToast({
            title: 'パーツを複製',
            body: to
                ? `${partId} → ${to}。元のすぐ手前に、${OFFSET}px ずらして置きました（選択中）。`
                : `${partId} を複製しました（${OFFSET}px ずらして配置）`,
        });
    };

    /**
     * 素材 1 件の配置（移動・拡大縮小・回転）を変える。
     *
     * 値を持つだけで、画素には触らない。書き出しのときに 1 回だけ焼き込む。
     */
    /**
     * 素材の配置が変わったとき、明示的なアンカーを一緒に動かす。
     *
     * **アンカーはキャンバスの絶対座標で持っています**（§7.4 のとおり
     * `anchor_x` / `anchor_y` はキャンバス座標）。素材を拡大縮小・回転・移動すると
     * 絵はその行列で動きますが、保存済みのアンカーは置き去りになり、回転の中心だけが
     * 元の場所に残ります。ヌルの共有アンカーも同じで、まとめて動かしたはずのものが
     * ばらけて見えます。
     *
     * 既定のアンカー（外接矩形の中心）は毎回計算し直すので影響を受けません。
     * 崩れるのは**利用者が置き直したアンカーと、ヌルが書き込んだ共有アンカー**だけです。
     *
     * 旧行列で戻してから新行列で送り直します（`M_new(M_old⁻¹(anchor))`）。
     * 拡大・回転・移動のどれが変わっても、これ 1 つで正しく追従します。
     */
    const remapAnchorsForSource = (
        entry: SourceEntry,
        from: SourceTransform,
        to: SourceTransform,
    ) => {
        const rects: SourceRect[] = [];
        const byId = new Map<number, PsdLayer>();
        for (const l of flattenLayers(psdRootRef.current)) byId.set(l.id!, l);
        for (const id of entry.layerIds) {
            const l = byId.get(id);
            if (!l) continue;
            const img = slicedCanvases.get(id) ?? l.canvas!;
            rects.push({ left: l.left ?? 0, top: l.top ?? 0, width: img.width, height: img.height });
        }
        if (rects.length === 0) return;

        const pivot = sourcePivot(rects);
        const mOld = sourceMatrix(from, pivot);
        const mNew = sourceMatrix(to, pivot);

        // この素材が持ち込んだレイヤーの partID。
        const affected = new Set<string>();
        for (const id of entry.layerIds) {
            const p = layerMetaRef.current[id]?.partId;
            if (p) affected.add(p);
        }
        if (affected.size === 0) return;

        const inv = mOld.inverse();
        setPartTransforms(prev => {
            let touched = false;
            const next: Record<string, PartTransform> = {};
            for (const [key, t] of Object.entries(prev)) {
                if (!t.anchor || !affected.has(parseTransformKey(key).partId)) {
                    next[key] = t;
                    continue;
                }
                const p = mNew.transformPoint(inv.transformPoint(new DOMPoint(t.anchor.x, t.anchor.y)));
                next[key] = { ...t, anchor: { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 } };
                touched = true;
            }
            return touched ? next : prev;
        });
    };

    const handleSourceTransform = (sourceId: string, patch: Partial<SourceTransform>) => {
        const entry = sources.find(s => s.id === sourceId);
        if (!entry) return;
        const next = { ...entry.transform, ...patch };
        remapAnchorsForSource(entry, entry.transform, next);
        setSources(prev => prev.map(s => s.id === sourceId ? { ...s, transform: next } : s));
    };

    /** 配置を等倍・無回転・原点に戻す。 */
    const handleSourceTransformReset = (sourceId: string) => {
        const entry = sources.find(s => s.id === sourceId);
        if (!entry) return;
        remapAnchorsForSource(entry, entry.transform, IDENTITY_SOURCE_TRANSFORM);
        setSources(prev => prev.map(s =>
            s.id === sourceId ? { ...s, transform: { ...IDENTITY_SOURCE_TRANSFORM } } : s));
    };

    /**
     * 素材 1 件を、持ち込んだレイヤーごと取り除く。
     *
     * **消えたパーツを指している設定も一緒に片付けます。** 残すと、書き出した
     * `.emg` に存在しない partID を指すまばたき・プリセット・トランスフォームが
     * 残り、「読めるのに動かない」ファイルになります。何を落としたかは
     * 黙って捨てず、必ず知らせます（編集中に割り当てが消えるのは、
     * この編集器で実際に起きた不具合の形そのものなので）。
     */
    const handleSourceRemove = (sourceId: string) => {
        const entry = sources.find(s => s.id === sourceId);
        const root = psdRootRef.current;
        if (!entry || !root) return;

        const doomed = new Set(entry.layerIds);
        const before = buildParts(root, layerMetaRef.current).map(p => p.partId);

        // 対象の葉を取り除く。空になったグループも畳む（残すと partID だけが
        // 中身なしで生き残り、パーツ一覧に幽霊が出る）。
        const prune = (ls: PsdLayer[]): PsdLayer[] => {
            const out: PsdLayer[] = [];
            for (const l of ls) {
                if (l.id !== undefined && doomed.has(l.id)) continue;
                if (l.children && l.children.length > 0) {
                    const kids = prune(l.children as PsdLayer[]);
                    if (kids.length === 0) continue;
                    out.push({ ...l, children: kids });
                } else {
                    out.push(l);
                }
            }
            return out;
        };
        const newRoot: Psd = { ...root, children: prune((root.children ?? []) as PsdLayer[]) };

        const meta = { ...layerMetaRef.current };
        for (const id of entry.layerIds) delete meta[id];
        const newMeta = recalculateMeta(newRoot, meta);

        const after = new Set(buildParts(newRoot, newMeta).map(p => p.partId));
        const gone = new Set(before.filter(p => !after.has(p)));

        applyTree(newRoot, newMeta);
        setSources(prev => prev.filter(s => s.id !== sourceId));

        // ここから後始末。消えた partID を指しているものだけを外す。
        const dropped: string[] = [];

        if (gone.size > 0) {
            setPartAnimations(prev => {
                const next = { ...prev };
                for (const p of gone) if (next[p]) { delete next[p]; }
                return next;
            });
            setPartTransforms(prev => Object.fromEntries(
                Object.entries(prev).filter(([k]) => !gone.has(parseTransformKey(k).partId))));
            setTransformTarget(prev => Object.fromEntries(
                Object.entries(prev).filter(([k]) => !gone.has(k))));
            setPreviewFrame(prev => Object.fromEntries(
                Object.entries(prev).filter(([k]) => !gone.has(k))));
            setPreviewOff(prev => Object.fromEntries(
                Object.entries(prev).filter(([k]) => !gone.has(k))));

            // まばたき・口パクは partID 単位。担当パーツごと消えたら、
            // フレームの割り当ても意味を失うので一緒に空にする。
            setMapping(prev => {
                let next = prev;
                if (prev.blinkPartId && gone.has(prev.blinkPartId)) {
                    next = { ...next, blinkPartId: '', blink: { open: '', half: '', closed: '' } };
                    dropped.push('まばたきの割り当て');
                }
                if (prev.lipSyncPartId && gone.has(prev.lipSyncPartId)) {
                    next = { ...next, lipSyncPartId: '', lipSync: { a: '', i: '', u: '', e: '', o: '', n: '', open: '' } };
                    dropped.push('口パクの割り当て');
                }
                // 表情の blink / lipSync は、mapping が指すパーツのフレーム識別子。
                // 担当パーツが消えたら宙に浮くので同時に空にする。
                const blinkGone = !!prev.blinkPartId && gone.has(prev.blinkPartId);
                const lipGone = !!prev.lipSyncPartId && gone.has(prev.lipSyncPartId);
                if (blinkGone || lipGone) {
                    setExpressions(exs => exs.map(e => ({
                        ...e,
                        blink: blinkGone ? { open: '', half: '', closed: '' } : e.blink,
                        lipSync: lipGone ? { a: '', i: '', u: '', e: '', o: '', n: '' } : e.lipSync,
                    })));
                }
                return next;
            });

            // プリセットは差分なので、消えた partID の項目だけを外す。
            // プリセット自体は残す — 表情が presetID で参照しているため、
            // 消すとその参照まで壊れる。
            let touchedPresets = 0;
            setPresets(prev => prev.map(p => {
                const parts = Object.fromEntries(Object.entries(p.parts).filter(([k]) => !gone.has(k)));
                const toggles = Object.fromEntries(Object.entries(p.toggles).filter(([k]) => !gone.has(k)));
                const changed = Object.keys(parts).length !== Object.keys(p.parts).length
                    || Object.keys(toggles).length !== Object.keys(p.toggles).length;
                if (changed) touchedPresets++;
                return changed ? { ...p, parts, toggles } : p;
            }));
            if (touchedPresets > 0) dropped.push(`プリセット ${touchedPresets} 件の一部`);

            // ヌルからも外す。残すと存在しない partID を抱えたまま「N パーツ」と
            // 表示され、実際に動くのは残りだけ、という状態になる。
            setTransformGroups(prev => {
                let changed = false;
                const next = prev
                    .map(g => {
                        const kept = g.partIds.filter(p => !gone.has(p));
                        if (kept.length !== g.partIds.length) changed = true;
                        return { ...g, partIds: kept };
                    })
                    .filter(g => g.partIds.length > 0);
                if (next.length !== prev.length) changed = true;
                if (changed) dropped.push('ヌルの所属');
                return changed ? next : prev;
            });
        }

        const note = dropped.length > 0 ? ` 併せて外しました: ${dropped.join('、')}。` : '';
        setToast({
            title: '素材を削除',
            body: `${entry.name}（${entry.layerIds.length} レイヤー）を取り除きました。${note}`
                + ' 取り消しは Ctrl+Z。',
        });
    };

    /**
     * ツリー側の編集（並べ替え・改名）を反映する。
     *
     * `movedLayerId` は並べ替えのときだけ渡る。明示 z を持つレイヤーは走査順を
     * 無視するため、動かしたものの z をここで振り直さないと並べ替えが無効になる
     * （`reassignExplicitZ` を参照）。
     */
    /**
     * レイヤー 1 枚の位置をずらす（`basePosition`）。
     *
     * 9 スライスの仕上がり寸法を左・上のハンドルで縮めたとき、反対側を動かさない
     * ために使います。仕上がりはレイヤーの左上から描かれるので、幅を縮めた分だけ
     * 左上を動かさないと、掴んでいない右端のほうが動いてしまいます。
     */
    const handleLayerOffset = (layerId: number, dx: number, dy: number) => {
        const root = psdRootRef.current;
        if (!root || (dx === 0 && dy === 0)) return;
        const shift = (ls: PsdLayer[]): PsdLayer[] => ls.map(l => {
            if (l.id === layerId) {
                return {
                    ...l,
                    left: (l.left ?? 0) + dx,
                    top: (l.top ?? 0) + dy,
                    right: typeof l.right === 'number' ? l.right + dx : l.right,
                    bottom: typeof l.bottom === 'number' ? l.bottom + dy : l.bottom,
                };
            }
            return l.children ? { ...l, children: shift(l.children as PsdLayer[]) } : l;
        });
        applyTree({ ...root, children: shift((root.children ?? []) as PsdLayer[]) }, layerMetaRef.current);
    };

    const handlePsdUpdate = (newRoot: Psd, movedLayerId?: number) => {
        const base = layerMetaRef.current;
        const meta = movedLayerId !== undefined
            ? reassignExplicitZ(newRoot, base, movedLayerId)
            : base;
        applyTree(newRoot, recalculateMeta(newRoot, meta));
    };

    /**
     * レイヤー id → 素材の配置行列。恒等の素材は載らない（大多数はこれ）。
     * プレビューはこの行列のまま描き、書き出しのときだけ焼き込む。
     */
    /**
     * 9 スライスで描き直した canvas（`LayerMeta.slice` を持つレイヤーだけ）。
     *
     * 合成のたびに描き直すと、レイヤーを 1 つ触るだけで全部が再標本化されます。
     * 設定が変わったときだけ作り直し、以降は使い回します。
     */
    const slicedCanvases = useMemo(() => {
        const out = new Map<number, HTMLCanvasElement>();
        for (const l of flattenLayers(psdRoot)) {
            const s = layerMeta[l.id!]?.slice;
            if (s) out.set(l.id!, sliceLayer(l.canvas!, s));
        }
        return out;
    }, [psdRoot, layerMeta]);

    /** そのレイヤーの実際に描く画像。9 スライスがあれば描き直したもの。 */
    const imageOf = useCallback(
        (layer: PsdLayer) => slicedCanvases.get(layer.id!) ?? layer.canvas!,
        [slicedCanvases]);

    const sourceMatrices = useMemo(() => {
        const rects = new Map<number, { left: number; top: number; width: number; height: number }>();
        for (const l of flattenLayers(psdRoot)) {
            // 9 スライス後の大きさで測る。元の大きさで測ると、素材の中心（＝回転軸）が
            // 引き伸ばした絵の中心とずれる。
            const img = slicedCanvases.get(l.id!) ?? l.canvas!;
            rects.set(l.id!, {
                left: l.left ?? 0, top: l.top ?? 0,
                width: img.width, height: img.height,
            });
        }
        return buildSourceMatrices(sources, id => rects.get(id));
    }, [sources, psdRoot, slicedCanvases]);

    /**
     * パッキング・書き出しに渡す 1 枚。素材の配置があれば焼き込む。
     *
     * EMG の静的なレイヤーは矩形と `basePosition` しか持たず回転を表現できない
     * ため、配置は画素に落とすしかない（`sourceTransform.ts` の説明を参照）。
     */
    const bakedOf = useCallback((layer: PsdLayer) => {
        const image = imageOf(layer);
        const m = sourceMatrices.get(layer.id!);
        const left = layer.left ?? 0;
        const top = layer.top ?? 0;
        if (!m) return { canvas: image, left, top };
        return bakeLayer(image, left, top, m);
    }, [sourceMatrices, imageOf]);

    /**
     * 焼き込んだ後の左上（= `basePosition`）だけを求める。
     *
     * 位置しか要らないところで `bakedOf` を呼ぶと、そのたびに全レイヤーを
     * 再標本化することになる（JSON プレビューは頻繁に作り直される）。
     * `bakeLayer` と同じ丸め方を使うので、値は焼き込んだ結果と一致する。
     */
    const bakedOriginOf = useCallback((layer: PsdLayer) => {
        const m = sourceMatrices.get(layer.id!);
        const left = layer.left ?? 0;
        const top = layer.top ?? 0;
        if (!m) return { left, top };
        const img = imageOf(layer);
        const b = transformedBounds({ left, top, width: img.width, height: img.height }, m);
        return { left: Math.floor(b.left), top: Math.floor(b.top) };
    }, [sourceMatrices, imageOf]);

    /**
     * 選んでいる素材の、**変形前の**外接矩形と配置。
     *
     * 変形前で持つのは `TransformOverlay` が行列を自分で掛けるため。
     * 変形後の矩形を渡すと、回転済みの枠にもう一度回転が掛かる。
     */
    const selectedSource = useMemo(() => {
        const entry = sources.find(s => s.id === selectedSourceId);
        if (!entry) return null;
        const rects: SourceRect[] = [];
        for (const l of flattenLayers(psdRoot)) {
            if (!entry.layerIds.includes(l.id!)) continue;
            rects.push({
                left: l.left ?? 0, top: l.top ?? 0,
                width: l.canvas!.width, height: l.canvas!.height,
            });
        }
        if (rects.length === 0) return null;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const r of rects) {
            left = Math.min(left, r.left);
            top = Math.min(top, r.top);
            right = Math.max(right, r.left + r.width);
            bottom = Math.max(bottom, r.top + r.height);
        }
        return {
            entry,
            bounds: { partId: entry.id, left, top, right, bottom },
            pivot: sourcePivot(rects),
        };
    }, [sources, selectedSourceId, psdRoot]);

    /** 一覧で素材を選ぶ。パーツの選択は解く（枠は 1 つだけ出す）。 */
    const handleSelectSource = (sourceId: string | null) => {
        setSelectedSourceId(sourceId);
        if (sourceId) setSelectedPartId(null);
    };

    /** バウンディングボックスからの変更。数値欄と同じ経路へ落とす。 */
    const handleSourceBoxChange = (patch: Partial<PartTransform>) => {
        const entry = sources.find(s => s.id === selectedSourceId);
        if (!entry) return;
        const next = fromPartTransformPatch(patch, entry.transform);
        if (next) handleSourceTransform(entry.id, next);
    };

    /**
     * ファイル全体の重なり順（背面 → 前面）。
     *
     * **`textureZIndex` はファイル全体で 1 本の順序**で、パーツをまたいで
     * 入れ子になっている必要がありません（仕様 §2 の frameName の例がまさにそれ）。
     * 一方この編集器は z を木の走査順から作るため、パーツは木の中で連続した
     * かたまりでなければならず、
     *
     *   顔のベース（体パーツ） → 首（別パーツ） → 後ろ髪（体パーツ）
     *
     * のように**別パーツを挟む重なり**が木の形だけでは表せません。
     * ここはその並びを木と切り離して直接編集するための一覧です。
     */
    const zOrder = useMemo(() => {
        const layers = flattenLayers(psdRoot);
        const eff = resolveZIndices(layers, layerMeta);
        return layers
            .map((l, i) => ({
                id: l.id!,
                name: l.name ?? '',
                partId: layerMeta[l.id!]?.partId ?? '',
                z: eff[i],
                visible: layerMeta[l.id!]?.visible ?? true,
            }))
            .sort((a, b) => a.z - b.z);
    }, [psdRoot, layerMeta]);

    /**
     * 重なり順をまとめて置き換える。`ids` は**背面 → 前面**の順。
     *
     * 全レイヤーに明示 z を書きます。一部だけ明示にすると、明示を持たない層が
     * まとめて最前面に来る（`resolveZIndices` の baseline）ため、途中に挟む
     * という指定ができないためです。木の並べ替えは `reassignExplicitZ` が
     * 引き続き効きます。
     */
    const handleReorderZ = (ids: number[]) => {
        setLayerMeta(prev => {
            const next = { ...prev };
            ids.forEach((id, i) => {
                if (next[id]) next[id] = { ...next[id], zIndex: i };
            });
            return next;
        });
    };

    /** 明示 z を捨てて、レイヤーツリーの並び順に戻す。 */
    const handleResetZ = () => {
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
                const m = next[Number(key)];
                if (m?.zIndex === undefined) continue;
                const copy = { ...m };
                delete copy.zIndex;
                next[Number(key)] = copy;
            }
            return next;
        });
        setToast({ title: '重なり順を戻しました', body: 'レイヤーツリーの並び順から作り直します。' });
    };

    /**
     * レイヤー 1 枚のメタを書き換える。
     *
     * **`switch` パーツの合成モードは、パーツ全体へ配ります。** `switch` のレイヤーは
     * 同じものの入れ替え候補（コマ・差分）なので、コマごとに合成の仕方が変わる状況が
     * ありません。1 枚だけ変えると、そのコマが表示されている間だけ見え方が変わる、
     * という説明のつかない状態になります。
     *
     * `static` は重ねて 1 つの絵にする別々のものなので、レイヤーごとに違って構いません
     * （影だけ乗算、光だけスクリーン、など）。そちらは配りません。
     *
     * 読み込んだ値は揃えません。PSD が `switch` グループの中で別々の合成モードを
     * 持っていることはありえるので、取り込んだ時点で潰すと情報が消えます。
     * 揃うのは利用者が触ったときだけです。
     */
    const handleLayerMetaChange = (layerId: number, meta: LayerMeta) => {
        const prevMeta = layerMetaRef.current[layerId];
        const part = parts.find(p => p.partId === meta.partId);

        // 描画に効くのはこの 2 つだけ。配る対象もこれに限る
        // （`partId` や種別まで配ると、木の構造から導いている値を壊す）。
        const drawProps: (keyof LayerMeta)[] = ['opacity', 'blendMode'];
        const changed = prevMeta
            ? drawProps.filter(k => prevMeta[k] !== meta[k])
            : [];

        // 選んでいるのがグループか。グループ自体は描かれないので、
        // そこへ不透明度や合成モードを書いても**何も起きません**。
        // 利用者から見れば「効かない」ので、配下の葉へ配ります。
        const layers = flattenLayers(psdRootRef.current);
        const isLeaf = layers.some(l => l.id === layerId);
        const descendants = new Set<number>();
        if (!isLeaf) {
            const find = (ls: PsdLayer[]): PsdLayer | undefined => {
                for (const l of ls) {
                    if (l.id === layerId) return l;
                    const hit = l.children ? find(l.children as PsdLayer[]) : undefined;
                    if (hit) return hit;
                }
                return undefined;
            };
            const node = find((psdRootRef.current?.children ?? []) as PsdLayer[]);
            const collect = (l: PsdLayer) => {
                if (l.canvas && l.id !== undefined) descendants.add(l.id);
                (l.children as PsdLayer[] | undefined)?.forEach(collect);
            };
            if (node) collect(node);
        }

        // `switch` のレイヤーは同じものの入れ替え候補（コマ・差分）なので、
        // 描き方がコマごとに変わる状況がありません。1 枚だけ変えると
        // 「そのコマが出ている間だけ見え方が違う」という説明のつかない状態に
        // なるため、パーツ全体へ配ります。`static` は重ねて 1 つの絵にする
        // 別々のものなので配りません（影だけ乗算、光だけ半透明、など）。
        const spreadToPart = part?.type === 'switch' && changed.length > 0;

        setLayerMeta(prev => {
            const next = { ...prev, [layerId]: meta };
            if (changed.length === 0) return next;

            const patch: Partial<LayerMeta> = {};
            for (const k of changed) (patch as Record<string, unknown>)[k] = meta[k];

            for (const [key, m] of Object.entries(prev)) {
                const id = Number(key);
                if (id === layerId) continue;
                const target = descendants.has(id) || (spreadToPart && m.partId === meta.partId);
                if (target) next[id] = { ...m, ...patch };
            }
            return next;
        });
    };

    /**
     * パーツの全レイヤーに同じ合成モードを入れる。
     *
     * **合成モードはレイヤーごとの設定です**（v0.4.0 §5 / `layers[].blendMode`）。
     * ところが連番やスプライトシートから来たパーツはコマ数ぶんのレイヤーを持つため、
     * 1 枚だけ設定しても、表示中のコマ以外は素のまま描かれます。しかもレイヤーツリーは
     * 前面から並ぶので、一番上に見えている `Dust_4` を触っても、表示されているのは
     * 一番奥の `Dust_1` という食い違いが起きます（実際にそう報告されました）。
     *
     * 塵や光のようなエフェクトは「パーツ全体をスクリーンで乗せる」使い方が普通なので、
     * パーツ単位で入れられるようにします。1 枚ずつ変えたい場合はレイヤータブが残ります。
     */
    const handlePartBlendModeChange = (partId: string, mode: string) => {
        setLayerMeta(prev => {
            const next = { ...prev };
            let touched = false;
            for (const [key, m] of Object.entries(prev)) {
                if (m.partId !== partId || m.blendMode === mode) continue;
                next[Number(key)] = { ...m, blendMode: mode };
                touched = true;
            }
            return touched ? next : prev;
        });
    };

    /**
     * パーツごとの合成モード。全レイヤーで一致していればその値、混ざっていれば `null`。
     * 選択欄に「混在」を出し分けるために要る。
     */
    const partBlendModes = useMemo(() => {
        const out: Record<string, string | null> = {};
        for (const m of Object.values(layerMeta)) {
            if (!m.partId) continue;
            const v = m.blendMode || 'normal';
            if (!(m.partId in out)) out[m.partId] = v;
            else if (out[m.partId] !== v) out[m.partId] = null;
        }
        return out;
    }, [layerMeta]);

    /** psdRoot + layerMeta から導出したパーツ一覧（parts.ts）。 */
    const parts = useMemo<PartInfo[]>(() => buildParts(psdRoot, layerMeta), [psdRoot, layerMeta]);

    const partById = useMemo(() => {
        const m = new Map<string, PartInfo>();
        for (const p of parts) m.set(p.partId, p);
        return m;
    }, [parts]);

    /**
     * 役割パーツの初期値をキーワードから推測する。
     *
     * **推測は初期値を作るときだけに使います。** 書き出しは利用者の指定
     * （`mapping` の状態）をそのまま書きます。`textureID` は `"14"` のような
     * 番号のことが多く、名前からフレームは当てられないため、
     * フレームの割り当ては空のままにして利用者に選ばせます。
     *
     * 一度でも利用者が触ったら上書きしません（指定を消さないため）。
     */
    useEffect(() => {
        if (parts.length === 0) return;
        if (mapping.blinkPartId || mapping.lipSyncPartId) return;   // 触られている

        const match = (kws: string[], exclude?: string) => parts.find(p =>
            p.type === 'switch' && p.partId !== exclude &&
            kws.some(k => p.partId.toLowerCase().includes(k)));

        const blink = match(['eye', 'blink', '瞳', '目']);
        const lip = match(['mouth', 'lip', '口'], blink?.partId);
        if (!blink && !lip) return;

        // 利用者の操作ではないので履歴に残さない。読み込み直後に 1 手積まれると、
        // 最初の取り消しが空振りしたように見える。
        history.skipNext();
        setMapping(prev => ({
            ...prev, blinkPartId: blink?.partId ?? '', lipSyncPartId: lip?.partId ?? '',
        }));
    }, [parts, mapping, history]);


    /**
     * プレビューの合成。**書き出される .emg と同じ規則で描く**。
     *
     * 以前は「visible なレイヤーを全部重ねる」だけだったため、switch パーツの差分が
     * 全部同時に描かれていた（目 6 枚が重なって潰れる）。実際の再生時とは似ても
     * 似つかない絵で、差分の確認ができなかった。
     *   - switch : プレビュー中のフレーム 1 つだけを描く（既定は part.default）
     *   - static : defaultVisible が false のパーツは初期状態で描かない（v0.5.0 §4）
     */
    /**
     * 再生中に各 switch パーツが出しているコマ。
     *
     * **これが無いと、GIF もスプライトシートもまばたきも 1 コマ目で止まったまま**
     * になります（トランスフォームだけが動いていました）。
     *
     * 対象の絞り方はトランスフォームと同じ — 単体再生ならそのパーツだけ、
     * 「全体」なら全部。止まっているときは空で、手で選んだ差分がそのまま出ます。
     */
    const playingFrame = useMemo<Record<string, string>>(() => {
        if (!playScope) return {};
        const out: Record<string, string> = {};
        for (const [partId, anim] of Object.entries(partAnimations)) {
            if (playScope !== 'all' && parseTransformKey(playScope).partId !== partId) continue;
            const frame = sequenceFrameAt(anim, transformTime);
            if (frame !== undefined) out[partId] = frame;
        }
        return out;
    }, [partAnimations, playScope, transformTime]);

    /**
     * 合成対象を組み立てる。
     *
     * `time` を渡すと**その時刻の姿**（コマ送りを含む）を返します。渡さなければ
     * 今のプレビュー状態です。書き出しは前者を使うので、画面と同じ規則で
     * 任意の時刻を描けます。
     */
    const composeAt = useCallback((time?: number): PreviewItem[] => {
        const items: (PreviewItem & { z: number })[] = [];
        const layers = flattenLayers(psdRoot);
        // 書き出しと同じ z 順で並べる。走査順のまま描くと、`.emg` から読み込んだ
        // 「パーツをまたいで z が入れ子になっているファイル」でプレビューだけ
        // 重なりが変わる。バウンディングボックスは見えている絵を掴むものなので、
        // ここがずれていると掴む対象を間違える。
        const zIndices = resolveZIndices(layers, layerMeta);

        for (const [index, layer] of layers.entries()) {
            const meta = layerMeta[layer.id!];
            if (!meta || !meta.visible) continue;

            const part = partById.get(meta.partId);
            if (!part) continue;

            // v0.5.0 §4: static は初期非表示トグル、switch は §4.3 の未選択。
            const off = previewOff[part.partId] ?? !part.defaultVisible;
            if (off) continue;

            if (part.type === 'switch') {
                // 時刻を指定されたら、その時刻のコマ。指定が無ければ
                // 再生中のコマ → 手で選んだ差分 → 既定 の順。
                const active = time !== undefined
                    ? (sequenceFrameAt(partAnimations[part.partId], time)
                        ?? previewFrame[part.partId] ?? part.defaultFrameId)
                    : (playingFrame[part.partId] ?? previewFrame[part.partId] ?? part.defaultFrameId);
                if (frameIdOf(layer, meta) !== active) continue;
            }

            items.push({
                id: layer.id!,
                partId: part.partId,
                frameId: frameIdOf(layer, meta),
                image: imageOf(layer),
                left: layer.left || 0,
                top: layer.top || 0,
                opacity: meta.opacity ?? 1,
                blendMode: meta.blendMode,
                source: sourceMatrices.get(layer.id!),
                z: zIndices[index],
            });
        }
        items.sort((a, b) => a.z - b.z);
        return items;
    }, [psdRoot, layerMeta, partById, previewFrame, previewOff, playingFrame, partAnimations, sourceMatrices, imageOf]);

    const compositionItems = useMemo<PreviewItem[]>(() => composeAt(), [composeAt]);

    /**
     * ヌルごとの外接矩形（メンバー全部の合併）。
     * 共有アンカーの既定値と、プレビューに出す枠の両方に使う。
     */
    const groupBounds = useMemo(() => {
        const out: Record<string, Bounds> = {};
        const byPart = computeBounds(compositionItems);
        for (const g of transformGroups) {
            let box: Bounds | undefined;
            for (const pid of g.partIds) {
                const b = byPart[transformKey(pid)];
                if (!b) continue;
                box = box ? {
                    partId: g.id,
                    left: Math.min(box.left, b.left), top: Math.min(box.top, b.top),
                    right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom),
                } : { ...b, partId: g.id };
            }
            if (box) out[g.id] = box;
        }
        return out;
    }, [transformGroups, compositionItems]);

    /**
     * メンバー全員に、共有アンカーと同じトランスフォームを配り直す。
     *
     * ヌルを作った直後・出入りがあった直後に必ず通す。既定のアンカーは
     * 「そのパーツ自身の外接矩形の中心」なので、揃えないとメンバーが
     * それぞれ別の点を軸に回る（ばらける）。
     */
    const syncGroup = useCallback((g: TransformGroup, seedFrom?: string) => {
        const byPart = computeBounds(compositionItems);
        let box: Bounds | undefined;
        for (const pid of g.partIds) {
            const b = byPart[transformKey(pid)];
            if (!b) continue;
            box = box ? {
                partId: g.id,
                left: Math.min(box.left, b.left), top: Math.min(box.top, b.top),
                right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom),
            } : { ...b, partId: g.id };
        }
        if (!box) return;
        const anchor = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
        setPartTransforms(prev => {
            // 種は「既に動きを持っているメンバー」。無ければ素の値から始める。
            const seedKey = seedFrom
                ?? g.partIds.find(id => prev[id] && hasAnimation(prev[id]))
                ?? g.partIds.find(id => prev[id]);
            const seed = (seedKey && prev[seedKey]) ? prev[seedKey] : emptyTransform();
            const next = { ...prev };
            for (const id of g.partIds) next[id] = { ...seed, anchor };
            return next;
        });
    }, [compositionItems]);

    /** 選んでいるパーツ（複数選択が無いので、いまは 1 つ）からヌルを作る。 */
    const handleGroupCreate = (partIds: string[]) => {
        const free = partIds.filter(id => !transformGroups.some(g => g.partIds.includes(id)));
        if (free.length === 0) return;
        const g: TransformGroup = {
            id: `null${Date.now().toString(36)}`,
            name: `ヌル ${transformGroups.length + 1}`,
            partIds: free,
        };
        setTransformGroups(prev => [...prev, g]);
        syncGroup(g);
        setToast({ title: 'ヌルを作成', body: `${g.name}（${free.length} パーツ）。まとめて動かせます。` });
    };

    /** メンバーの出入り。1 つのパーツは高々 1 つのヌルにしか入れない。 */
    const handleGroupToggleMember = (groupId: string, partId: string) => {
        const g = transformGroups.find(x => x.id === groupId);
        if (!g) return;
        const inside = g.partIds.includes(partId);
        if (!inside && transformGroups.some(o => o.id !== groupId && o.partIds.includes(partId))) {
            setToast({
                title: '入れられません',
                body: `${partId} は既に別のヌルに入っています。先にそちらから外してください。`,
                tone: 'error',
            });
            return;
        }
        const next: TransformGroup = {
            ...g,
            partIds: inside ? g.partIds.filter(p => p !== partId) : [...g.partIds, partId],
        };
        setTransformGroups(prev => prev.map(x => x.id === groupId ? next : x));
        if (next.partIds.length > 0) syncGroup(next);
    };

    const handleGroupRename = (groupId: string, name: string) => {
        setTransformGroups(prev => prev.map(g => g.id === groupId ? { ...g, name } : g));
    };

    /**
     * ヌルを解く。**メンバーのトランスフォームはそのまま残します。**
     * 解いた瞬間に絵が動くと、何が起きたのか分からないため。
     */
    const handleGroupDelete = (groupId: string) => {
        const g = transformGroups.find(x => x.id === groupId);
        setTransformGroups(prev => prev.filter(x => x.id !== groupId));
        if (g) setToast({
            title: 'ヌルを解除', body: `${g.name} を解きました。各パーツの動きはそのまま残ります。`,
        });
    };


    /**
     * 動くものの中で一番長い尺（秒）。書き出しの既定値に使う。
     * `pingpong` は往復で 1 周なので 2 倍。
     */
    const contentDuration = useMemo(() => {
        let d = 0;
        for (const a of Object.values(partAnimations)) {
            if (a.enabled) d = Math.max(d, sequenceDuration(a));
        }
        for (const t of Object.values(partTransforms)) {
            if (hasAnimation(t)) d = Math.max(d, t.loop === 'pingpong' ? t.duration * 2 : t.duration);
        }
        return Math.round(d * 100) / 100;
    }, [partAnimations, partTransforms]);

    useEffect(() => {
        if (!psdRoot) return;

        const packItems: PackItem[] = [];

        const traverse = (layer: PsdLayer) => {
            if (layer.id === undefined) {
                layer.children?.forEach(traverse);
                return;
            }
            const meta = layerMeta[layer.id];
            if (layer.canvas && meta && meta.visible) {
                // 素材の配置は焼き込んでから詰める。焼く前の寸法で詰めると、
                // 拡大した素材がアトラスからはみ出す。
                const baked = bakedOf(layer);
                packItems.push({
                    id: layer.id.toString(),
                    width: baked.canvas.width,
                    height: baked.canvas.height,
                    image: baked.canvas
                });
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot);

        const runPack = async () => {
            if (packItems.length > 0) {
                try {
                    console.log(`Packing ${packItems.length} items...`);
                    const res = await TexturePacker.pack(packItems);
                    setPackResult(res);
                    // 分割された場合も全枚数を渡す。1 枚目だけ出していたころは、
                    // 2 枚目以降に載った素材がプレビューから消えていた。
                    setAtlasUrls(res.atlases.map(a => a.canvas.toDataURL()));
                } catch (e) {
                    console.error("Packing failed", e);
                    setPackResult(null);
                    setAtlasUrls([]);
                }
            } else {
                setPackResult(null);
                setAtlasUrls([]);
            }
        };
        // **少し待ってから詰める。** バウンディングボックスを引いている間は
        // 1 フレームごとに素材の配置が変わる。そのたびに全レイヤーを焼き直して
        // アトラスに詰め直すと、掴んでいる間ずっと固まる（実測で操作不能）。
        // プレビューの合成は行列のまま描いていて、この結果を待たない。
        const timer = setTimeout(runPack, PACK_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [psdRoot, layerMeta, bakedOf]);

    const handleVisibilityAll = (visible: boolean) => {
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id in next) {
                next[id] = { ...next[id], visible };
            }
            return next;
        });
    };

    const handleTypeAll = (type: 'static' | 'switch') => {
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id in next) {
                next[id] = { ...next[id], type };
            }
            return next;
        });
    };

    // ---- パーツ単位の操作 --------------------------------------------------
    // partID は複数レイヤーにまたがるため、1 枚ずつ直させると必ず取りこぼす
    // （目 6 枚のうち 1 枚だけ static、のような壊れた状態が作れてしまう）。
    // パーツを単位にすることで、その状態自体が表現できなくなる。

    /** パーツの type を切り替える。所属レイヤー全部に反映する。 */
    const handlePartTypeChange = (partId: string, type: 'static' | 'switch') => {
        const part = partById.get(partId);
        if (!part) return;
        setLayerMeta(prev => setPartType(prev, part, type));
    };

    /**
     * switch パーツの既定フレーム（.emg の part.default）を決める。
     *
     * frameId に null を渡すと「初期状態でどれも表示しない」（v0.5.0 §4.3）。
     * チークや青ざめのように、差分を持ちながら常態は「無し」であるパーツ用。
     * isDefault が 1 つも立っていない状態がそれを表す。
     */
    const handlePartDefaultFrameChange = (partId: string, frameId: string | null) => {
        const part = partById.get(partId);
        if (!part) return;
        setLayerMeta(prev => setPartDefaultFrame(prev, part, frameId));
        // 「なし」を既定にしたらプレビューもその状態にする。
        if (frameId === null) setPreviewOff(prev => ({ ...prev, [partId]: true }));
    };

    /** パーツごと書き出しに含めるか。static の「初期非表示トグル」もこれで表す。 */
    const handlePartExportChange = (partId: string, include: boolean) => {
        const part = partById.get(partId);
        if (!part) return;
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of part.layerIds) {
                if (next[id]) next[id] = { ...next[id], visible: include };
            }
            return next;
        });
    };

    /** static パーツの初期表示（v0.5.0 §4）。false なら初期非表示のトグルとして書き出す。 */
    const handlePartDefaultVisibleChange = (partId: string, defaultVisible: boolean) => {
        const part = partById.get(partId);
        if (!part) return;
        setLayerMeta(prev => setPartDefaultVisible(prev, part, defaultVisible));
        setPreviewOff(prev => ({ ...prev, [partId]: !defaultVisible }));
    };

    // ---- プレビュー操作（書き出しには影響しない） --------------------------
    const handlePreviewFrame = (partId: string, frameId: string) => {
        setPreviewFrame(prev => ({ ...prev, [partId]: frameId }));
        setPreviewOff(prev => ({ ...prev, [partId]: false }));
    };

    // ---- アニメーション（emg-json-spec.md 7 章） ------------------------------

    /**
     * パーツにアニメーションを付ける / 外す。
     * 初期値は「そのパーツの全フレームを並び順どおり 12fps でループ」。
     */
    const handleAnimationToggle = (partId: string, enabled: boolean) => {
        const part = partById.get(partId);
        if (!part) return;
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (cur) return { ...prev, [partId]: { ...cur, enabled } };
            if (!enabled) return prev;
            return {
                ...prev,
                [partId]: defaultPartAnimation(partId, part.frames.map(f => f.frameId)),
            };
        });
    };

    const handleAnimationChange = (partId: string, patch: Partial<PartAnimation>) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            const next = { ...cur, ...patch };
            // frames と durations は同じ長さでなければならない（keys の組み立てで対応が崩れる）。
            if (patch.frames) {
                next.durations = patch.frames.map((_, i) => cur.durations[i] ?? 0.1);
            }
            return { ...prev, [partId]: next };
        });
    };

    /**
     * アニメーションを丸ごと差し替える（無ければ作る）。
     *
     * `handleAnimationChange` は既存が無ければ何もしません（部分更新なので、
     * 半端な `PartAnimation` を作らないための守り）。自動まばたきのように
     * **こちらが完全な設定を組み立てて渡す**経路では作れないと困るので分けます。
     */
    const handleAnimationSet = (partId: string, anim: PartAnimation) => {
        setPartAnimations(prev => ({ ...prev, [partId]: anim }));
    };

    /** 再生順の末尾にフレームを足す。同じフレームを何度でも置ける（まばたきの往復など）。 */
    const handleAnimationAddFrame = (partId: string, frameId: string) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            return {
                ...prev,
                [partId]: {
                    ...cur,
                    frames: [...cur.frames, frameId],
                    durations: [...cur.durations, cur.durations[cur.durations.length - 1] ?? 0.1],
                },
            };
        });
    };

    const handleAnimationRemoveFrame = (partId: string, index: number) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            return {
                ...prev,
                [partId]: {
                    ...cur,
                    frames: cur.frames.filter((_, i) => i !== index),
                    durations: cur.durations.filter((_, i) => i !== index),
                },
            };
        });
    };

    const handleAnimationDurationChange = (partId: string, index: number, seconds: number) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            const durations = [...cur.durations];
            durations[index] = seconds;
            return { ...prev, [partId]: { ...cur, durations } };
        });
    };

    // ---- 状態の組（presets[]） ---------------------------------------------
    // 作り方は「プレビューで見た目を作る → 保存」。エディタは既にプリセットが
    // 必要とする状態（previewFrame / previewOff）を持っているので、
    // フォームに partID を打ち込ませる UI にはしない。

    /**
     * 今のプレビュー状態を、**既定との差分**として書き出す。
     *
     * 全パーツを列挙しないのは仕様 §5.2 のため。現れない partID の状態は
     * 変更されないので、差分にしておくとプリセット同士を重ねられる
     * （表情と衣装が別々のパーツに触れている限り衝突しない）。
     */
    const capturePreviewAsDelta = (): Pick<AvatarPreset, 'parts' | 'toggles'> => {
        const partsOut: Record<string, string> = {};
        const togglesOut: Record<string, boolean> = {};

        for (const part of parts) {
            if (part.exportedCount === 0) continue;   // 「使わない」パーツは対象外

            const defaultOff = !part.defaultVisible;
            const off = previewOff[part.partId] ?? defaultOff;
            if (off !== defaultOff) togglesOut[part.partId] = !off;

            // 伏せているパーツのフレームは記録しない（表示していないので意味が無い）
            if (part.type === 'switch' && !off) {
                const frame = previewFrame[part.partId] ?? part.defaultFrameId;
                if (frame && frame !== part.defaultFrameId) partsOut[part.partId] = frame;
            }
        }
        return { parts: partsOut, toggles: togglesOut };
    };

    /** 保存前に「何が記録されるか」を見せるため、UI からも同じ計算を使う。 */
    const previewDelta = useMemo(capturePreviewAsDelta, [parts, previewFrame, previewOff]);

    const handlePresetSave = (label: string, excluded: Set<string> = new Set()) => {
        const name = label.trim();
        if (!name) return;

        // presetID はファイル内で一意にする。外部から呼ぶキーになるため。
        let presetID = name;
        let n = 2;
        while (presets.some(p => p.presetID === presetID)) presetID = `${name}_${n++}`;

        const delta = capturePreviewAsDelta();
        // 記録から外された項目を落とす。プレビューは前のプリセットの状態を
        // 引きずるので、これが無いと「怒り眉」に口の変更まで混ざる。
        for (const key of excluded) {
            const partId = key.slice(2);
            if (key.startsWith('p:')) delete delta.parts[partId];
            else delete delta.toggles[partId];
        }

        setPresets(prev => [...prev, { presetID, label: name, ...delta }]);
        setToast({ title: '保存しました', body: name });
    };

    /** プレビューをそのプリセットの状態にする。差分なので、触れないパーツは今のまま。 */
    const handlePresetApply = (presetID: string) => {
        const preset = presets.find(p => p.presetID === presetID);
        if (!preset) return;
        setPreviewFrame(prev => ({ ...prev, ...preset.parts }));
        setPreviewOff(prev => {
            const next = { ...prev };
            for (const [partId, visible] of Object.entries(preset.toggles)) next[partId] = !visible;
            return next;
        });
    };

    /** 今のプレビュー状態で上書きする。 */
    const handlePresetUpdate = (presetID: string) => {
        const delta = capturePreviewAsDelta();
        setPresets(prev => prev.map(p => p.presetID === presetID ? { ...p, ...delta } : p));
        setToast({ title: '更新しました', body: presetID });
    };

    const handlePresetRename = (presetID: string, label: string) => {
        const name = label.trim();
        if (!name) return;
        setPresets(prev => prev.map(p => p.presetID === presetID ? { ...p, label: name } : p));
    };

    const handlePresetDelete = (presetID: string) => {
        setPresets(prev => prev.filter(p => p.presetID !== presetID));
        // 参照が宙に浮かないよう、表情側の参照も外す。
        setExpressions(prev => prev.map(e => e.presetID === presetID ? { ...e, presetID: '' } : e));
    };

    // ---- 表情（mapping.json の expressions） --------------------------------

    const handleExpressionAdd = (name: string) => {
        const n = name.trim();
        if (!n || expressions.some(e => e.name === n)) return;
        setExpressions(prev => [...prev, emptyExpression(n)]);
    };

    const handleExpressionChange = (name: string, patch: Partial<AvatarExpression>) => {
        setExpressions(prev => prev.map(e => e.name === name ? { ...e, ...patch } : e));
    };

    const handleExpressionRename = (name: string, next: string) => {
        const n = next.trim();
        if (!n || n === name || expressions.some(e => e.name === n)) return;
        setExpressions(prev => prev.map(e => e.name === name ? { ...e, name: n } : e));
    };

    const handleExpressionDelete = (name: string) => {
        setExpressions(prev => prev.filter(e => e.name !== name));
    };

    /** v0.5.0 §4.3: プレビューを「どれも表示しない」にする。 */
    const handlePreviewNone = (partId: string) => {
        setPreviewOff(prev => ({ ...prev, [partId]: true }));
    };

    const handlePreviewToggle = (partId: string) => {
        const part = partById.get(partId);
        const current = previewOff[partId] ?? !(part?.defaultVisible ?? true);
        setPreviewOff(prev => ({ ...prev, [partId]: !current }));
    };

    const handlePreviewReset = () => {
        setPreviewFrame({});
        setPreviewOff({});
    };

    const handleLayerVisibilityChange = (layer: any, visible: boolean) => {
        const psdLayer = layer as PsdLayer;
        if (psdLayer.id === undefined) return;

        // Collect this layer and all its descendants
        const ids: number[] = [psdLayer.id];
        const collectDescendants = (l: PsdLayer) => {
            l.children?.forEach(child => {
                if (child.id !== undefined) ids.push(child.id);
                collectDescendants(child);
            });
        };
        collectDescendants(psdLayer);

        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of ids) {
                if (next[id]) next[id] = { ...next[id], visible };
            }
            return next;
        });
    };

    const emgData = useMemo((): EmgData | undefined => {
        if (!psdRoot) return undefined;

        // Return minimal structure while waiting for pack result (enables JSON tab immediately)
        if (!packResult) {
            return {
                version: '0.3.0',
                baseCanvasWidth: psdRoot.width || 0,
                baseCanvasHeight: psdRoot.height || 0,
                textures: [],
                parts: [],
                sprites: []
            };
        }

        const exportItems: ExportItem[] = [];
        const allExportableLayers: PsdLayer[] = [];

        const traverse = (layer: PsdLayer) => {
            if (layer.id !== undefined && layerMeta[layer.id]?.visible && layer.canvas) {
                allExportableLayers.push(layer);
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot as PsdLayer);

        // ag-psd の children は「下から上」（index 0 = 最背面）。textureZIndex は
        // 仕様上「大きいほど前面」なので、走査順をそのまま z にすればよい。
        // 以前は totalLayers-1-index として最背面に最大値を与えており、
        // 書き出した .emg の重なり順が全て前後逆になっていた。
        const zIndices = resolveZIndices(allExportableLayers, layerMeta);

        allExportableLayers.forEach((layer, index) => {
            const packed = packResult.items.find(p => p.id === layer.id!.toString());
            if (packed && layerMeta[layer.id!]) {
                // basePosition は焼き込んだ後の左上。素材を動かしても JSON が
                // 元の位置のままだと、画面と書き出しが食い違う。
                // ここは位置しか要らないので、画素は作らない。
                const origin = bakedOriginOf(layer);
                exportItems.push({
                    packed: packed,
                    meta: layerMeta[layer.id!],
                    originalLayer: { ...layer, left: origin.left, top: origin.top },
                    zIndex: zIndices[index]
                });
            }
        });

        // **`partTransforms` を渡す。** 渡していなかったため、JSON プレビューは
        // トランスフォームを持つファイルでも `"sprites": []` を出していた。
        // 書き出し本体（`handleExport`）は渡しているので、出力そのものは正しいが、
        // 確認手段のほうが嘘をついている状態だった。
        return EmgGenerator.createData(
            packResult, exportItems, psdRoot.width, psdRoot.height,
            partAnimations, presets, partTransforms);
    }, [packResult, psdRoot, layerMeta, partAnimations, presets, partTransforms, bakedOriginOf]);

    const handleExport = async () => {
        // 保存先は押された瞬間に押さえる（download.ts の prepareSave を参照）。
        // アトラスの PNG 生成に十数秒かかるため、後から保存しようとすると
        // ブロックされて「押したのにファイルが無い」になる。
        let target;
        try {
            target = await prepareSave(`${projectName}.emg`, 'application/zip', ['.emg']);
        } catch {
            return;   // 保存先の選択をやめた
        }
        if (!psdRoot) return;

        // 進捗表示を描画させてから重い処理に入る。React の state 更新だけでは
        // 同期処理の前に描画が挟まらず、バーが出ないまま固まったように見える。
        const step = async (phase: string, percent: number) => {
            setExportProgress({ phase, percent });
            await new Promise(r => setTimeout(r, 0));
        };

        try {
            await step('レイヤーを集めています', 5);
            const packItems: PackItem[] = [];
            const allExportableLayers: PsdLayer[] = [];

            const traverse = (layer: PsdLayer) => {
                const meta = layerMeta[layer.id!];
                if (meta && meta.visible && layer.canvas && layer.id !== undefined) {
                    // 素材の配置をここで 1 回だけ画素に落とす（`sourceTransform.ts`）。
                    const baked = bakedOf(layer);
                    packItems.push({
                        id: layer.id.toString(),
                        width: baked.canvas.width,
                        height: baked.canvas.height,
                        image: baked.canvas
                    });
                    allExportableLayers.push({ ...layer, left: baked.left, top: baked.top });
                }
                layer.children?.forEach(traverse);
            };
            traverse(psdRoot as PsdLayer);

            if (packItems.length === 0) {
                setToast({ title: '書き出せません', body: '書き出し対象のレイヤーがありません。', tone: 'error' });
                return;
            }

            await step('テクスチャに詰めています', 18);
            const result = await TexturePacker.pack(packItems);
            const exportItems: ExportItem[] = [];
            // ag-psd の children は「下から上」（index 0 = 最背面）。
            // textureZIndex は「大きいほど前面」なので走査順がそのまま z になる。
            const zIndices = resolveZIndices(allExportableLayers, layerMeta);

            allExportableLayers.forEach((layer, index) => {
                const packed = result.items.find(p => p.id === layer.id!.toString());
                const meta = layerMeta[layer.id!];
                if (packed && meta) {
                    const zIndex = zIndices[index];
                    exportItems.push({
                        packed: packed,
                        meta: meta,
                        originalLayer: layer,
                        zIndex: zIndex
                    });
                }
            });

            if (!psdRoot.width || !psdRoot.height) {
                throw new Error("PSD dimensions missing");
            }

            const blob = await EmgGenerator.generate(
                result,
                exportItems,
                psdRoot.width,
                psdRoot.height,
                includeAnimation ? partAnimations : {},
                (phase, percent) => setExportProgress({ phase, percent }),
                mapping,
                presets,
                expressions,
                includeAnimation ? partTransforms : {}
            );

            if (target.kind !== 'picker') {
                // 自動で落とすと捨てられることがあるので、押してもらう。
                setPendingExport({ blob, name: target.name });
            }
            const saved = target.kind === 'picker' ? await target.write(blob) : target.name;

            // 「全素材を 1 枚のテクスチャに詰める」が守られたかを、
            // ここで必ず利用者に見せる。以前は console.warn だけで、
            // 分割されても DevTools を開かない限り気づけなかった。
            const usedPx = exportItems.reduce((n, i) => n + i.packed.width * i.packed.height, 0);
            const atlasPx = result.atlases.reduce((n, a) => n + a.width * a.height, 0);
            const occupancy = atlasPx > 0 ? Math.round(100 * usedPx / atlasPx) : 0;
            const sizes = result.atlases.map(a => `${a.width}×${a.height}`).join(', ');

            setToast(result.atlases.length === 1
                ? {
                    title: target.kind === 'picker' ? '書き出しました' : '書き出しました（「保存する」を押してください）',
                    body: `model.emg — テクスチャ 1 枚 ${sizes}（占有率 ${occupancy}%）/ ${exportItems.length} レイヤー`,
                }
                : {
                    title: `書き出しました（テクスチャが ${result.atlases.length} 枚に分割）`,
                    body: `8192px に収まらないため分割しました: ${sizes}。`
                        + `不要なパーツを「使わない」にする、素材を縮小する、などで 1 枚に収まります。`,
                });
        } catch (e) {
            console.error('Export failed:', e);
            setToast({ title: '書き出しに失敗しました', body: String(e instanceof Error ? e.message : e), tone: 'error' });
        } finally {
            setExportProgress(null);
        }
    };

    /**
     * 選択中のレイヤー（またはグループ）を、その場で新しいグループに包む。
     *
     * グループ名がそのまま partID になるので、これは「このレイヤーを独立した
     * パーツにする」操作でもある。空グループをルート末尾に作ってから 1 枚ずつ
     * ドラッグする、という以前の手順を置き換える。
     */
    const handleGroupSelected = (): string | null => {
        if (!psdRoot || !selectedLayer || selectedLayer.id === undefined) return null;

        const targetId = selectedLayer.id;
        const groupId = Date.now();
        const groupName = 'New Part';
        let wrapped = false;

        const clone = (l: PsdLayer): PsdLayer => ({ ...l, children: l.children?.map(clone) });
        const rebuild = (layers: PsdLayer[]): PsdLayer[] => layers.map(l => {
            if (l.id === targetId) {
                wrapped = true;
                return { id: groupId, name: groupName, hidden: false, children: [l], canvas: undefined } as PsdLayer;
            }
            if (l.children) return { ...l, children: rebuild(l.children) };
            return l;
        });

        const newRoot: Psd = { ...psdRoot, children: rebuild((psdRoot.children ?? []).map(clone)) };
        if (!wrapped) return null;

        handlePsdUpdate(newRoot);
        return groupName;
    };

    /**
     * パーツ名（= PSD グループ名 = partID）を変更する。
     * recalculateMeta がグループ名から partID を引き直すので、名前を変えれば追従する。
     *
     * **partID をキーにしているものは全部付け替えます。** 木とプレビューだけ直していた
     * ため、名前を変えた瞬間に動き・トランスフォーム・ヌルの所属・まばたきの割り当て・
     * プリセットの項目が静かに外れていました。ヌルは特にわかりにくく、「3 パーツ」と
     * 表示されたまま、実際に動くのは 2 つだけ、という状態になります
     * （残った側は存在しない partID を指している）。
     */
    const handleRenamePart = (partId: string, newName: string) => {
        if (!psdRoot || !newName.trim() || newName === partId) return;

        const rename = (layers: PsdLayer[]): PsdLayer[] => layers.map(l => {
            const next: PsdLayer = { ...l, children: l.children ? rename(l.children) : undefined };
            if (l.children && l.name === partId) next.name = newName;
            return next;
        });

        handlePsdUpdate({ ...psdRoot, children: rename(psdRoot.children ?? []) });

        // partID をキーにしているプレビュー状態も付け替える
        setPreviewFrame(prev => {
            if (!(partId in prev)) return prev;
            const { [partId]: v, ...rest } = prev;
            return { ...rest, [newName]: v };
        });
        setPreviewOff(prev => {
            if (!(partId in prev)) return prev;
            const { [partId]: v, ...rest } = prev;
            return { ...rest, [newName]: v };
        });
        setSelectedPartId(cur => (cur === partId ? newName : cur));

        /** partID をキーにした Record を付け替える。 */
        const rekey = <T,>(prev: Record<string, T>): Record<string, T> => {
            if (!(partId in prev)) return prev;
            const { [partId]: v, ...rest } = prev;
            return { ...rest, [newName]: v };
        };

        setPartAnimations(prev => {
            if (!(partId in prev)) return prev;
            const next = rekey(prev);
            // spriteID は既定で partID と同じ。名前に合わせて追従させる
            // （残すと書き出した .emg の sprite 名だけ古いままになる）。
            const a = next[newName];
            if (a && a.spriteID === partId) next[newName] = { ...a, spriteID: newName };
            return next;
        });

        // トランスフォームのキーは partID か「partID + フレーム識別子」（§7.4.1）。
        setPartTransforms(prev => {
            const next: Record<string, PartTransform> = {};
            let touched = false;
            for (const [key, t] of Object.entries(prev)) {
                const parsed = parseTransformKey(key);
                if (parsed.partId === partId) {
                    next[transformKey(newName, parsed.frame)] = t;
                    touched = true;
                } else {
                    next[key] = t;
                }
            }
            return touched ? next : prev;
        });
        setTransformTarget(prev => rekey(prev));

        // ヌルの所属。ここを飛ばすと、存在しない partID を抱えたまま
        // 「N パーツ」と表示され、実際に動くのは残りだけになる。
        setTransformGroups(prev => prev.map(g => g.partIds.includes(partId)
            ? { ...g, partIds: g.partIds.map(p => (p === partId ? newName : p)) }
            : g));

        // mapping.json はパーツを名前で指す。
        setMapping(prev => ({
            ...prev,
            blinkPartId: prev.blinkPartId === partId ? newName : prev.blinkPartId,
            lipSyncPartId: prev.lipSyncPartId === partId ? newName : prev.lipSyncPartId,
        }));

        // プリセットは partID をキーにした差分（§5.2）。
        setPresets(prev => prev.map(p => ({
            ...p,
            parts: rekey(p.parts),
            toggles: rekey(p.toggles),
        })));
    };

    // ---- テンプレート（別の素材へ持ち込む） --------------------------------

    /**
     * 今の割り当てをテンプレートとして書き出す。
     *
     * `handleSaveProject` とは別物です。あちらは `layerMeta` をそのまま落とすので、
     * キーが**レイヤーの数値 ID** — 同じ素材の続きにしか使えません。
     * テンプレートは partID とフレーム識別子だけを持ちます。
     */
    const handleTemplateSave = () => {
        if (!psdRoot) return;
        const tpl = buildTemplate(parts, partAnimations, mapping, presets, expressions);
        const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' });
        const saved = downloadBlob(blob, `${projectName}${TEMPLATE_EXT}`);
        setToast({
            title: `テンプレートを書き出しました（${saved}）`,
            body: `${Object.keys(tpl.partTypes).length} パーツ / プリセット ${tpl.presets.length} / 表情 ${tpl.expressions.length}`,
        });
    };

    /** 適用結果。名前が当たらなかったものを必ず見せるので、消えないダイアログで出す。 */
    const [templateReport, setTemplateReport] = useState<TemplateReport | null>(null);

    const handleTemplateLoad = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                if (!isTemplate(data)) {
                    setToast({
                        title: 'テンプレートとして読めません',
                        body: `templateVersion がありません。「設定を読込」用の project.json ではありませんか？`,
                        tone: 'error',
                    });
                    return;
                }
                applyTemplateToState(data);
            } catch (err) {
                setToast({ title: 'テンプレートを読み込めませんでした', body: String(err), tone: 'error' });
            }
        };
        input.click();
    };

    const applyTemplateToState = (tpl: EditorTemplate) => {
        const app = applyTemplate(tpl, parts);

        setLayerMeta(prev => {
            let next = prev;
            for (const part of parts) {
                const type = app.partTypes[part.partId];
                if (type) next = setPartType(next, part, type);

                // 種別を変えた後に当てる。static になったパーツに既定フレームを
                // 書いても意味が無いので、最終的な種別で分ける。
                const finalType = type ?? part.type;
                if (finalType === 'switch') {
                    if (part.partId in app.defaults) {
                        next = setPartDefaultFrame(next, part, app.defaults[part.partId]);
                    }
                } else if (part.partId in app.toggles) {
                    next = setPartDefaultVisible(next, part, app.toggles[part.partId]);
                }
            }
            return next;
        });

        // アニメーションは差分で重ねる。テンプレートに出てこないパーツの設定を
        // 消す理由が無い（プリセットの「触れていないものは変えない」と同じ考え方）。
        setPartAnimations(prev => ({ ...prev, ...app.animations }));
        // 一方、まばたき・プリセット・表情は一式で意味を持つので置き換える。
        // 混ぜると presetID の衝突で「どちらの怒り眉か」が決まらなくなる。
        setMapping(app.mapping);
        setPresets(app.presets);
        setExpressions(app.expressions);
        handlePreviewReset();
        setTemplateReport(app.report);
    };

    /** 保留していた `.emg` を落とす。押された瞬間なので確実に保存される。 */
    const handleSavePending = () => {
        if (!pendingExport) return;
        const saved = downloadBlob(pendingExport.blob, pendingExport.name);
        setPendingExport(null);
        setToast({ title: '保存しました', body: `ダウンロードフォルダに ${saved}` });
    };

    /**
     * 編集状態をファイルに保存する。
     *
     * **書き出しに影響するものは全部入れます。** 以前は `layerMeta` だけで、
     * アニメーション・トランスフォーム・ヌル・まばたき・プリセット・表情・素材の配置が
     * まるごと落ちていました（読み込み直すと、レイヤーの種別だけが戻る状態）。
     * 何を入れるべきかの基準は取り消し履歴と同じ ——
     * {@link DocumentSnapshot} に入っているものが「書き出しに影響する状態」です。
     *
     * 木（`psdRoot`）は入れません。canvas は JSON にできませんし、素材そのものは
     * 別に開き直す前提です。したがってこのファイルは**同じ素材を同じ順で開いた状態**へ
     * 適用するものです（レイヤー id で結び付けるため）。
     */
    const handleSaveProject = () => {
        const projectData = {
            version: '2.0',
            savedAt: new Date().toISOString(),
            projectName,
            layerMeta,
            partAnimations,
            partTransforms,
            transformGroups,
            transformTarget,
            mapping,
            presets,
            expressions,
            sources,
            includeAnimation,
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const saved = downloadBlob(blob, `${projectName}.project.json`);
        setToast({
            title: `設定を保存しました（${saved}）`,
            body: 'レイヤーの種別・動き・ヌル・目と口・状態・表情・素材の配置を含みます。',
        });
    };

    const handleLoadProject = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const data = JSON.parse(re.target?.result as string);
                    if (!data || typeof data !== 'object' || !data.layerMeta) {
                        setToast({
                            title: '設定として読めません',
                            body: 'layerMeta がありません。テンプレート（.emgtpl.json）ではありませんか？',
                            tone: 'error',
                        });
                        return;
                    }

                    // **レイヤー id で結び付ける。** 別の素材に当てると何も一致しないので、
                    // 黙って空振りさせず、いくつ当たったかを知らせる。
                    const live = new Set(flattenLayers(psdRootRef.current).map(l => l.id!));
                    const hit = Object.keys(data.layerMeta)
                        .filter(k => live.has(Number(k))).length;

                    setLayerMeta(data.layerMeta);
                    // v1 は layerMeta しか持っていない。無いものは触らない
                    // （読み込みで今の設定を消さないため）。
                    const restored: string[] = ['レイヤーの種別'];
                    if (data.partAnimations) { setPartAnimations(data.partAnimations); restored.push('動き（コマ送り）'); }
                    if (data.partTransforms) { setPartTransforms(data.partTransforms); restored.push('トランスフォーム'); }
                    if (data.transformGroups) { setTransformGroups(data.transformGroups); restored.push('ヌル'); }
                    if (data.transformTarget) setTransformTarget(data.transformTarget);
                    if (data.mapping) { setMapping(data.mapping); restored.push('目と口'); }
                    if (data.presets) { setPresets(data.presets); restored.push('状態'); }
                    if (data.expressions) { setExpressions(data.expressions); restored.push('表情'); }
                    if (data.sources) { setSources(data.sources); restored.push('素材の配置'); }
                    if (typeof data.projectName === 'string' && data.projectName) setProjectName(data.projectName);
                    if (typeof data.includeAnimation === 'boolean') setIncludeAnimation(data.includeAnimation);

                    const total = Object.keys(data.layerMeta).length;
                    setToast(hit === 0 && total > 0
                        ? {
                            title: '設定を読み込みましたが、レイヤーが一致しません',
                            body: `${total} 件のうち 0 件しか今の素材に当たりません。`
                                + '保存したときと同じ素材を同じ順で開いてから読み込んでください。',
                            tone: 'error',
                        }
                        : {
                            title: '設定を読み込みました',
                            body: `${restored.join('・')}（レイヤー ${hit}/${total} 件が一致）`,
                        });
                } catch (err) {
                    console.error(err);
                    setToast({ title: '設定を読み込めませんでした', body: String(err), tone: 'error' });
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    return {
        psdRoot,
        atlasUrls,
        selectedLayer,
        layerMeta,
        compositionItems,
        composeAt,
        contentDuration,
        packResult,
        emgData,
        parts,
        selectedPartId,
        previewFrame,
        previewOff,
        partAnimations,
        partTransforms,
        transformTarget,
        setTransformTarget,
        transformTime,
        playScope,
        handleTransformChange,
        handlePlayToggle,
        handleTransformReset,
        anyPlayable,
        partPlayable,
        setTransformTime,
        mapping,
        setMapping,
        presets,
        expressions,
        handleExpressionAdd,
        handleExpressionChange,
        handleExpressionRename,
        handleExpressionDelete,
        previewDelta,
        handlePresetSave,
        handlePresetApply,
        handlePresetUpdate,
        handlePresetRename,
        handlePresetDelete,
        handlePsdLoad,
        handleNewProject,
        handleCanvasResize,
        projectName,
        setProjectName,
        handleSourceAdd,
        handleSourcesAdd,
        sources, handleSourceRemove, handleSourceTransform, handleSourceTransformReset,
        handlePartDuplicate,
        selectedSourceId, handleSelectSource, selectedSource, handleSourceBoxChange,
        transformGroups, groupOfPart, groupBounds,
        handleGroupCreate, handleGroupToggleMember, handleGroupRename, handleGroupDelete,
        pendingEmgDrop,
        resolveEmgDrop: (how: 'open' | 'merge' | 'cancel') => {
            const file = pendingEmgDrop;
            setPendingEmgDrop(null);
            if (!file || how === 'cancel') return;
            if (how === 'open') { void handlePsdLoad(file); return; }
            void (async () => {
                try { await importEmg(file, 'merge'); }
                catch (e) {
                    setToast({ title: `${file.name} を取り込めませんでした`,
                        body: String(e instanceof Error ? e.message : e), tone: 'error' });
                }
            })();
        },
        handleSheetImport,
        handlePsdUpdate,
        handleLayerVisibilityChange,
        handleExport,
        pendingExport,
        handleSavePending,
        handleSaveProject,
        handleLoadProject,
        handleTemplateSave,
        handleTemplateLoad,
        templateReport,
        setTemplateReport,
        handleVisibilityAll,
        handleTypeAll,
        handlePartTypeChange,
        handlePartBlendModeChange, partBlendModes, handleLayerMetaChange,
        handlePartDefaultFrameChange,
        handlePartExportChange,
        handlePartDefaultVisibleChange,
        handleAnimationToggle,
        handleAnimationChange,
        handleAnimationAddFrame,
        handleAnimationRemoveFrame,
        handleAnimationSet,
        handleLayerOffset,
        zOrder, handleReorderZ, handleResetZ,
        includeAnimation, setIncludeAnimation,
        handleAnimationDurationChange,
        handlePreviewFrame,
        handlePreviewNone,
        handlePreviewToggle,
        handlePreviewReset,
        handleGroupSelected,
        handleRenamePart,
        setSelectedPartId,
        setSelectedLayer,
        setLayerMeta,
        exportProgress,
        history,
        toast,
        setToast,
    };
}
