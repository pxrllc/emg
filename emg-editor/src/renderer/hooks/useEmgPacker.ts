import { useState, useEffect, useMemo, useRef } from 'react';
import { PsdLoader, FileLoader, PsdLayer } from '../services/PsdLoader';
import { SourceLoader, type LoadedSource } from '../services/SourceLoader';
import { EmgLoader, isEmgFile } from '../services/EmgLoader';
import { FRAME_COUNT_WARNING } from '../services/AnimationLoader';
import { Psd, type Layer } from 'ag-psd';
import { TexturePacker, PackItem, PackResult } from '../services/TexturePacker';
import { EmgGenerator, ExportItem, EmgData } from '../services/EmgGenerator';
import { PreviewItem } from '../components/PreviewPanel';
import { defaultPartAnimation, emptyExpression, emptyMapping, type AvatarExpression, type AvatarMapping, type AvatarPreset, type LayerMeta, type PartAnimation } from '../types';
import type { ToastMessage } from '../components/Toast';
import { buildParts, flattenLayers, frameIdOf, type PartInfo } from '../parts';
import {
    applyTemplate, buildTemplate, isTemplate, TEMPLATE_EXT,
    type EditorTemplate, type TemplateReport,
} from '../services/Template';

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
                newMeta[layer.id].partId = currentPartId;
                newMeta[layer.id].frameName = currentFrameName;
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
            if (m.defaultVisible === false) m.visible = false;
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

    /** 今の内容を捨てて最初からにする。読み込みの直前に必ず通す。 */
    const resetEditingState = () => {
        setPartAnimations({});
        setPreviewFrame({});
        setPreviewOff({});
        setMapping(emptyMapping());
        setPresets([]);
        setExpressions([]);
        applyTree(null, {});
    };

    const handlePsdLoad = async (file: File) => {
        try {
            resetEditingState();
            // `.emg` は「書き出したものの続き」なので、開く経路も同じ入口にする。
            if (isEmgFile(file.name)) { await importEmg(file); return; }
            const root = await FileLoader.load(file);
            applyTree(root, recalculateMeta(root, {}));
        } catch (e) {
            // alert はレンダラ全体を止める（ブラウザでもう一度触るまで何も動かなくなる）。
            console.error('Failed to load file:', e);
            setToast({ title: '読み込めませんでした', body: String(e instanceof Error ? e.message : e), tone: 'error' });
        }
    };

    /**
     * 2 つ目以降のソースを取り込んで、いま開いている木に合流させる。
     *
     * 合成は「1 本の木にまとめる」形にする。走査結果がこれまでどおり単一の
     * packItems 配列になり、**全素材が 1 枚のアトラスに詰められる**（要件 R-1）。
     * ソースごとに PackResult を持つ実装にはしない。
     */
    const handleSourceAdd = async (file: File) => {
        try {
            if (isEmgFile(file.name)) { await importEmg(file); return; }
            mergeSource(await SourceLoader.load(file), file.name);
        } catch (e) {
            console.error('Failed to add source:', e);
            setToast({ title: `${file.name} を取り込めませんでした`, body: String(e instanceof Error ? e.message : e), tone: 'error' });
        }
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
    const importEmg = async (file: File) => {
        const loaded = await EmgLoader.load(file);
        const renamed = mergeSource(loaded.source, file.name);
        if (!renamed) return;

        // 合流時にパーツが改名されたら、partID を参照しているものを付け替える。
        // sprites / presets / mapping.json はすべて partID で結び付いているので、
        // ここを飛ばすと「読めたのに何も動かない」ファイルになる。
        const pid = (id: string) => renamed.get(id) ?? id;
        const animations = Object.fromEntries(
            Object.entries(loaded.animations).map(([k, a]) => [pid(k), { ...a, spriteID: pid(a.spriteID) }]));
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

        // アニメーションはパーツ単位で独立しているので重ねる。
        // まばたき・プリセット・表情は presetID の参照で結び付いた一式なので置き換える
        // （テンプレートの適用と同じ判断）。
        setPartAnimations(prev => ({ ...prev, ...animations }));
        setMapping(mapping);
        setPresets(presets);
        setExpressions(loaded.expressions);

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

    const handlePsdUpdate = (newRoot: Psd) => {
        applyTree(newRoot, recalculateMeta(newRoot, layerMetaRef.current));
    };

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
        setMapping(prev => {
            if (prev.blinkPartId || prev.lipSyncPartId) return prev;   // 触られている

            const match = (kws: string[], exclude?: string) => parts.find(p =>
                p.type === 'switch' && p.partId !== exclude &&
                kws.some(k => p.partId.toLowerCase().includes(k)));

            const blink = match(['eye', 'blink', '瞳', '目']);
            const lip = match(['mouth', 'lip', '口'], blink?.partId);
            if (!blink && !lip) return prev;

            return { ...prev, blinkPartId: blink?.partId ?? '', lipSyncPartId: lip?.partId ?? '' };
        });
    }, [parts]);


    /**
     * プレビューの合成。**書き出される .emg と同じ規則で描く**。
     *
     * 以前は「visible なレイヤーを全部重ねる」だけだったため、switch パーツの差分が
     * 全部同時に描かれていた（目 6 枚が重なって潰れる）。実際の再生時とは似ても
     * 似つかない絵で、差分の確認ができなかった。
     *   - switch : プレビュー中のフレーム 1 つだけを描く（既定は part.default）
     *   - static : defaultVisible が false のパーツは初期状態で描かない（v0.5.0 §4）
     */
    const compositionItems = useMemo<PreviewItem[]>(() => {
        const items: PreviewItem[] = [];
        for (const layer of flattenLayers(psdRoot)) {
            const meta = layerMeta[layer.id!];
            if (!meta || !meta.visible) continue;

            const part = partById.get(meta.partId);
            if (!part) continue;

            // v0.5.0 §4: static は初期非表示トグル、switch は §4.3 の未選択。
            const off = previewOff[part.partId] ?? !part.defaultVisible;
            if (off) continue;

            if (part.type === 'switch') {
                const active = previewFrame[part.partId] ?? part.defaultFrameId;
                if (frameIdOf(layer, meta) !== active) continue;
            }

            items.push({
                id: layer.id!,
                image: layer.canvas!,
                left: layer.left || 0,
                top: layer.top || 0,
            });
        }
        return items;
    }, [psdRoot, layerMeta, partById, previewFrame, previewOff]);

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
                packItems.push({
                    id: layer.id.toString(),
                    width: layer.canvas.width,
                    height: layer.canvas.height,
                    image: layer.canvas
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
        runPack();
    }, [psdRoot, layerMeta]);

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
                exportItems.push({
                    packed: packed,
                    meta: layerMeta[layer.id!],
                    originalLayer: layer,
                    zIndex: zIndices[index]
                });
            }
        });

        return EmgGenerator.createData(packResult, exportItems, psdRoot.width, psdRoot.height, partAnimations, presets);
    }, [packResult, psdRoot, layerMeta, partAnimations, presets]);

    const handleExport = async () => {
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
                    packItems.push({
                        id: layer.id.toString(),
                        width: layer.canvas.width,
                        height: layer.canvas.height,
                        image: layer.canvas
                    });
                    allExportableLayers.push(layer);
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
                partAnimations,
                (phase, percent) => setExportProgress({ phase, percent }),
                mapping,
                presets,
                expressions
            );

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'model.emg';
            link.click();

            // 「全素材を 1 枚のテクスチャに詰める」が守られたかを、
            // ここで必ず利用者に見せる。以前は console.warn だけで、
            // 分割されても DevTools を開かない限り気づけなかった。
            const usedPx = exportItems.reduce((n, i) => n + i.packed.width * i.packed.height, 0);
            const atlasPx = result.atlases.reduce((n, a) => n + a.width * a.height, 0);
            const occupancy = atlasPx > 0 ? Math.round(100 * usedPx / atlasPx) : 0;
            const sizes = result.atlases.map(a => `${a.width}×${a.height}`).join(', ');

            setToast(result.atlases.length === 1
                ? {
                    title: '書き出しました',
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
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `avatar${TEMPLATE_EXT}`;
        link.click();
        setToast({
            title: 'テンプレートを書き出しました',
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

    const handleSaveProject = () => {
        const projectData = {
            version: '1.0',
            layerMeta: layerMeta
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'project.json';
        link.click();
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
                    if (data.layerMeta) {
                        setLayerMeta(data.layerMeta);
                        setToast({ title: '設定を読み込みました' });
                    }
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
        packResult,
        emgData,
        parts,
        selectedPartId,
        previewFrame,
        previewOff,
        partAnimations,
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
        handleSourceAdd,
        handleSheetImport,
        handlePsdUpdate,
        handleLayerVisibilityChange,
        handleExport,
        handleSaveProject,
        handleLoadProject,
        handleTemplateSave,
        handleTemplateLoad,
        templateReport,
        setTemplateReport,
        handleVisibilityAll,
        handleTypeAll,
        handlePartTypeChange,
        handlePartDefaultFrameChange,
        handlePartExportChange,
        handlePartDefaultVisibleChange,
        handleAnimationToggle,
        handleAnimationChange,
        handleAnimationAddFrame,
        handleAnimationRemoveFrame,
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
        toast,
        setToast,
    };
}
