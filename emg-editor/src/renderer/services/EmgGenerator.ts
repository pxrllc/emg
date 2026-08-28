import JSZip from 'jszip';
import type { PackResult } from './TexturePacker';
import { TRANSFORM_PATHS, transformKey, type AvatarExpression, type AvatarMapping, type AvatarPreset, type LayerMeta, type PartAnimation, type PartTransform, type TransformPath } from '../types';
import type { PackedItem } from './TexturePacker';
import type { Layer } from 'ag-psd';
import { buildMapping, findMappingControlledParts, generateDraftMapping } from './MappingGenerator';
import { staticValue } from './transform';

export interface EmgData {
    version: string;
    /** v0.4.0 §2。理解できない実装に読ませてはならない機能の宣言。 */
    requiredExtensions?: string[];
    baseCanvasWidth: number;
    baseCanvasHeight: number;
    textures: EmgTexture[];
    parts: EmgPart[];
    sprites: EmgSprite[];
    /** v0.5.0 §5。複数パーツの状態をまとめて名前で呼ぶ。空なら出力しない。 */
    presets?: EmgPreset[];
}

/** v0.5.0 §5。 */
export interface EmgPreset {
    presetID: string;
    label?: string;
    parts?: Record<string, string>;
    toggles?: Record<string, boolean>;
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
    /**
     * v0.4.0 §3。回転・拡縮の中心。**キャンバス座標**。不在時は `basePosition` と同値。
     *
     * 0.5.3 §7.4 のとおり**アンカーはレイヤーごとに独立**しており、
     * トランスフォームは各レイヤー自身のアンカーを軸に適用される。
     * パーツ全体を 1 点で回したいときだけ、全レイヤーに同じ値を書く。
     */
    anchor_x?: number;
    anchor_y?: number;
    textureZIndex: number;
    opacity: number;
    blendMode: string;
}

/** emg-json-spec.md 7.1 / v0.5.0 6 章。 */
export interface EmgSequence {
    type: 'ordered' | 'random_hold';
    /** 等間隔。`fps` の間隔で 1 フレームずつ進む。`keys` と排他。 */
    frames?: string[];
    /** v0.5.0 6 章。不等間隔。`t` は再生開始からの秒数（昇順）。`frames` と排他。 */
    keys?: { t: number; frame: string }[];
}

/** emg-json-spec.md 7.2。 */
export interface EmgTrigger {
    type: 'auto_loop' | 'random_interval' | 'external';
    intervalMin?: number;
    intervalMax?: number;
}

/** v0.5.0 §7.2。座標変換のキーフレーム列。 */
export interface EmgTrack {
    /** v0.5.0 §7.3 の 6 種のいずれか。 */
    path: string;
    keys: { t: number; v: number }[];
    interpolation?: 'step' | 'linear' | 'cubic';
}

/** emg-json-spec.md 7 章。partID 単位のアニメーション。 */
export interface EmgSprite {
    spriteID: string;
    /**
     * 対象パーツ。
     * **`sequence` を持つ場合は switch でなければならない**（v0.5.0 §7.1）。
     * `tracks` のみを持つ sprite は static / switch のどちらでもよい。
     */
    targetPartID: string;
    /** v0.4.0 で任意化（不在時 12）。`sequence.keys` を使う場合は不要（v0.5.0 6.1）。 */
    fps?: number;
    sequence?: EmgSequence;
    /** 不在時、プレイヤーは自律再生してはならない（7 章）。 */
    trigger?: EmgTrigger;
    /**
     * 0.5.3 §7.4.1。トランスフォームの対象をパーツ内の 1 フレームに絞る。
     * 値はフレーム識別子。不在ならパーツ全体。
     */
    targetLayer?: string;
    /** v0.5.0 §7。 */
    tracks?: EmgTrack[];
    /** `tracks` を持つ場合は必須（§7.2）。 */
    duration?: number;
    /** §7.6。`tracks` にのみ効く（§10.5）。不在時は `"loop"`。 */
    loop?: 'once' | 'loop' | 'pingpong';
    phaseOffset?: number;
}

/**
 * 書き出しの進捗。割合は目安で、正確な残り時間を表すものではない。
 * 押した直後に無反応に見える（アトラスの PNG 生成で十数秒かかる）のを避けるのが目的。
 */
export type ExportProgressCallback = (phase: string, percent: number) => void;

export type ExportItem = {
    packed: PackedItem;
    meta: LayerMeta;
    originalLayer: Layer;
    zIndex: number; // calculated in App.tsx
};

/** JSON に小数の誤差を書き散らさないための丸め。 */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export class EmgGenerator {
    /**
     * 編集状態のアニメーション設定を `sprites[]` に変換する。
     *
     * 仕様上の制約をここで強制する。UI 側の抜け漏れで不正なファイルが出ないよう、
     * 書き出しの直前で必ず通す。
     *   - `targetPartID` のパーツは switch でなければならない（7 章）
     *   - `frames` の要素は対象パーツに実在するフレーム識別子でなければならない（7.1）
     *   - mapping.json が掌握するパーツは自律発火してはならない（7.3）
     */
    private static buildSprites(
        parts: EmgPart[],
        animations: Record<string, PartAnimation>,
        transforms: Record<string, PartTransform> = {}
    ): EmgSprite[] {
        const controlled = findMappingControlledParts(parts);
        const sprites: EmgSprite[] = [];
        const usedIds = new Set<string>();

        for (const part of parts) {
            const anim = animations[part.partID];
            const frames = new Set(part.layers.map(l => l.frameName ?? l.textureID));

            // この対象に効くトランスフォーム。パーツ全体を指すものと、
            // パーツ内のフレームを指すもの（0.5.3 §7.4.1）がありうる。
            const tf = transforms[transformKey(part.partID)];
            const tracks = EmgGenerator.buildTracks(tf);

            // sequence は switch パーツにしか付けられない（v0.5.0 §7.1）。
            // tracks はどちらのパーツにも付けられる（体や髪を動かすためのもの）。
            const wantSequence = !!anim?.enabled && part.type === 'switch';

            // フレームを狙うトランスフォームは、それぞれ独立した sprite になる。
            for (const frame of frames) {
                const ftf = transforms[transformKey(part.partID, frame)];
                const ftracks = EmgGenerator.buildTracks(ftf);
                if (ftracks.length === 0 || !ftf) continue;
                // レイヤーが 1 枚しかないパーツで targetLayer を書くと、
                // 効果は同じなのに宣言義務だけ増える（§7.4.1 規則 4）。
                const narrow = frames.size > 1;
                let sid = `${part.partID}_${frame}`;
                let m = 1;
                while (usedIds.has(sid)) sid = `${part.partID}_${frame}_${m++}`;
                usedIds.add(sid);
                sprites.push({
                    spriteID: sid,
                    targetPartID: part.partID,
                    ...(narrow ? { targetLayer: frame } : {}),
                    tracks: ftracks,
                    duration: Math.max(0.05, ftf.duration),
                    loop: EmgGenerator.hasMovingTrack(ftf) ? ftf.loop : 'once',
                    ...(ftf.phaseOffset ? { phaseOffset: ftf.phaseOffset } : {}),
                });
            }

            if (!wantSequence && tracks.length === 0) continue;

            let sequence: EmgSequence | undefined;
            if (wantSequence && anim) {
                const seq = anim.frames.filter(f => frames.has(f));
                if (seq.length > 0) {
                    sequence = { type: anim.sequenceType };
                    if (anim.timing === 'keys') {
                        // durations は「そのフレームの表示秒数」。keys は累積時刻なので積算する（6.1）。
                        let t = 0;
                        sequence.keys = seq.map((frame, i) => {
                            const key = { t: Math.round(t * 1000) / 1000, frame };
                            t += Math.max(0.001, anim.durations[i] ?? 0.1);
                            return key;
                        });
                    } else {
                        sequence.frames = seq;
                    }
                }
            }
            if (!sequence && tracks.length === 0) continue;

            // spriteID はファイル内で一意にする。外部から再生を指示するキーになるため。
            const wanted = anim?.spriteID || part.partID;
            let spriteID = wanted;
            let n = 1;
            while (usedIds.has(spriteID)) spriteID = `${wanted}_${n++}`;
            usedIds.add(spriteID);

            const sprite: EmgSprite = {
                spriteID,
                targetPartID: part.partID,
            };
            if (sequence) sprite.sequence = sequence;

            // §10.5: loop は tracks にのみ効き、sequence の繰り返しは trigger が決める。
            // 1 つの sprite に両方載せてよいのはそのため。
            if (tracks.length > 0 && tf) {
                sprite.tracks = tracks;
                sprite.duration = Math.max(0.05, tf.duration);
                sprite.loop = EmgGenerator.hasMovingTrack(tf) ? tf.loop : 'once';
                if (tf.phaseOffset) sprite.phaseOffset = tf.phaseOffset;
            }

            // keys を使う場合 fps は不要（6.1）。書くと解釈が二重になる。
            if (sequence && anim?.timing === 'fps') sprite.fps = anim.fps;

            // 7.3: mapping.json が blink/lipSync として明示指定するパーツは、
            // mapping 側が表示を掌握する。trigger を書かなければ
            // 「プレイヤーは自律再生してはならない」になる（7 章）。
            // trigger は sequence の繰り返しを決めるもの（§10.5）なので、
            // tracks しか無い sprite には書かない。
            if (sequence && anim && !controlled.has(part.partID)) {
                if (anim.triggerType === 'random_interval') {
                    sprite.trigger = {
                        type: 'random_interval',
                        intervalMin: anim.intervalMin,
                        intervalMax: anim.intervalMax,
                    };
                } else {
                    sprite.trigger = { type: anim.triggerType };
                }
            }

            sprites.push(sprite);
        }

        return sprites;
    }

    /** 動くトラック（キーが 2 つ以上）が 1 つでもあるか。 */
    private static hasMovingTrack(tf: PartTransform): boolean {
        return tf.tracks.some(t => t.keys.length > 1);
    }

    /** そのパスが動くか。動くなら basePosition への畳み込みはできない。 */
    private static isMoving(tf: PartTransform, path: TransformPath): boolean {
        return (tf.tracks.find(t => t.path === path)?.keys.length ?? 0) > 1;
    }

    /**
     * 編集状態のトランスフォームを `tracks[]` に変換する。
     *
     * **平行移動はここに出しません。** `basePosition` に畳み込めるので
     * （`createData` がそうしている）、トラックにすると同じことを 2 通りで
     * 表せる状態になります。動く平行移動だけがトラックになります。
     *
     * 静止した回転・拡縮は EMG に書く場所がないため、**キー 1 つのトラック**に
     * します。§7.6 の `once` が「1 回再生し、最後のキーの値を保持する」と
     * 定めているので、これが静止値の正しい表し方です。
     */
    private static buildTracks(tf: PartTransform | undefined): EmgTrack[] {
        if (!tf) return [];
        const out: EmgTrack[] = [];

        for (const p of TRANSFORM_PATHS) {
            const track = tf.tracks.find(t => t.path === p.path);
            const keys = track?.keys ?? [];

            if (keys.length > 1) {
                out.push({
                    path: p.path,
                    keys: keys.map(k => ({ t: round3(k.t), v: round3(k.v) })),
                    interpolation: track!.interpolation,
                });
                continue;
            }

            // 動かないもの。値が既定と同じなら書く必要がない。
            const v = staticValue(tf, p.path);
            if (v === p.def) continue;
            // 平行移動は basePosition が持つ。
            if (p.path === 'translate_x' || p.path === 'translate_y') continue;
            out.push({ path: p.path, keys: [{ t: 0, v: round3(v) }], interpolation: 'linear' });
        }
        return out;
    }

    /**
     * 編集状態を `presets[]` に変換する。
     *
     * 参照先が実在するものだけを通す。仕様 0.5.2 §10.6 では読み込み側が
     * 欠落項目を無視することになっているが、**生成側は書いてはならない**ので
     * ここで落とす（`tools/emg-validate.js` も同じものを検査する）。
     */
    private static buildPresets(
        parts: EmgPart[], presets: AvatarPreset[]
    ): EmgPreset[] {
        const byId = new Map(parts.map(p => [p.partID, p]));
        const out: EmgPreset[] = [];

        for (const src of presets) {
            const partEntries: Record<string, string> = {};
            for (const [partID, frameID] of Object.entries(src.parts)) {
                const part = byId.get(partID);
                if (!part || part.type !== 'switch') continue;
                if (!part.layers.some(l => (l.frameName ?? l.textureID) === frameID)) continue;
                partEntries[partID] = frameID;
            }

            const toggleEntries: Record<string, boolean> = {};
            for (const [partID, visible] of Object.entries(src.toggles)) {
                if (byId.has(partID)) toggleEntries[partID] = visible;
            }

            // 中身が空になったプリセットは書き出さない（適用しても何も起きない）。
            if (Object.keys(partEntries).length === 0 && Object.keys(toggleEntries).length === 0) continue;

            out.push({
                presetID: src.presetID,
                ...(src.label ? { label: src.label } : {}),
                ...(Object.keys(partEntries).length > 0 ? { parts: partEntries } : {}),
                ...(Object.keys(toggleEntries).length > 0 ? { toggles: toggleEntries } : {}),
            });
        }
        return out;
    }

    static createData(
        packResult: PackResult,
        items: ExportItem[],
        psdWidth: number,
        psdHeight: number,
        animations: Record<string, PartAnimation> = {},
        presets: AvatarPreset[] = [],
        transforms: Record<string, PartTransform> = {}
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

            // 静止した平行移動は basePosition に畳み込む（トラックにしない）。
            // 動く平行移動だけが tracks[] に出る（buildTracks を参照）。
            //
            // パーツ全体を狙うものと、このレイヤーのフレームを狙うもの（0.5.3）の
            // **両方**を足す。フレーム側を見落とすと、房だけずらした位置が黙って消える。
            const frameId = item.meta.frameName ?? textureId;
            let shiftX = 0, shiftY = 0;
            for (const tf of [transforms[transformKey(partId)],
                              transforms[transformKey(partId, frameId)]]) {
                if (!tf) continue;
                // 効いている静止値を使う。キーが 1 つのトラックは静止値の
                // 表し方なので、そこで base を読むとプレビューと食い違う。
                if (!EmgGenerator.isMoving(tf, 'translate_x')) shiftX += staticValue(tf, 'translate_x');
                if (!EmgGenerator.isMoving(tf, 'translate_y')) shiftY += staticValue(tf, 'translate_y');
            }

            part.layers.push({
                textureID: textureId,
                ...(item.meta.frameName ? { frameName: item.meta.frameName } : {}),
                textureFile: packResult.atlases[item.packed.atlasIndex].textureFile,
                x: item.packed.x,
                y: item.packed.y,
                width: item.packed.width,
                height: item.packed.height,
                basePosition_x: (item.originalLayer.left || 0) + shiftX,
                basePosition_y: (item.originalLayer.top || 0) + shiftY,
                // アンカーは後段でまとめて入れる（パーツの外接矩形が要るため）。
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

        // ---- アンカー（v0.4.0 §3）--------------------------------------------
        // **回転・拡縮を書き出すパーツには、必ずアンカーも書く。**
        // 仕様の既定は `basePosition` と同値（＝そのレイヤーの左上）だが、
        // エディタは外接矩形の中心を回転の中心として見せている。書かずに出すと、
        // 画面で見た絵と消費側が描く絵が食い違う。
        for (const part of emgParts) {
            if (part.layers.length === 0) continue;

            // 対象ごとに書く。0.5.3 §7.4 のとおりアンカーはレイヤーごとに独立なので、
            // 「髪だけ根元を軸に回す」ときは髪のレイヤーにだけその軸が付く。
            const groups = new Map<string, EmgPartLayer[]>();
            for (const l of part.layers) {
                const fid = l.frameName ?? l.textureID;
                if (!groups.has(fid)) groups.set(fid, []);
                groups.get(fid)!.push(l);
            }

            const targets: { tf: PartTransform; layers: EmgPartLayer[] }[] = [];
            const whole = transforms[transformKey(part.partID)];
            if (whole) targets.push({ tf: whole, layers: part.layers });
            for (const [fid, layers] of groups) {
                const tf = transforms[transformKey(part.partID, fid)];
                if (tf) targets.push({ tf, layers });
            }

            for (const { tf, layers } of targets) {
                const spins = TRANSFORM_PATHS.some(p =>
                    (p.path === 'rotation' || p.path === 'scale_x' || p.path === 'scale_y')
                    && (EmgGenerator.isMoving(tf, p.path) || staticValue(tf, p.path) !== p.def));
                if (!spins) continue;

                let anchor = tf.anchor;
                if (!anchor) {
                    // 既定は**その対象の**外接矩形の中心。プレビューと同じ規則にする。
                    const left = Math.min(...layers.map(l => l.basePosition_x));
                    const top = Math.min(...layers.map(l => l.basePosition_y));
                    const right = Math.max(...layers.map(l => l.basePosition_x + l.width));
                    const bottom = Math.max(...layers.map(l => l.basePosition_y + l.height));
                    anchor = { x: (left + right) / 2, y: (top + bottom) / 2 };
                } else {
                    // 平行移動を basePosition に畳み込んだ分だけ、中心も動かす。
                    const shiftX = EmgGenerator.isMoving(tf, 'translate_x') ? 0 : staticValue(tf, 'translate_x');
                    const shiftY = EmgGenerator.isMoving(tf, 'translate_y') ? 0 : staticValue(tf, 'translate_y');
                    anchor = { x: anchor.x + shiftX, y: anchor.y + shiftY };
                }
                for (const l of layers) {
                    l.anchor_x = round3(anchor.x);
                    l.anchor_y = round3(anchor.y);
                }
            }
        }

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

        const builtPresets = EmgGenerator.buildPresets(emgParts, presets);
        const builtSprites = EmgGenerator.buildSprites(emgParts, animations, transforms);

        // 0.5.3 §7.4.1: targetLayer を使うファイルは宣言が必須。
        // 未対応の実装は無視してパーツ全体を動かすため、髪だけ揺れるはずの絵で
        // 体ごと揺れる（= 誤った絵）。
        const hasLayerTransform = builtSprites.some(s => s.targetLayer !== undefined);

        const requiredExtensions = [
            ...(hasMultiLayerFrame ? ['EMG_frame_name'] : []),
            ...(hasSwitchNone ? ['EMG_switch_none'] : []),
            ...(hasLayerTransform ? ['EMG_layer_transform'] : []),
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
            sprites: builtSprites,
            ...(builtPresets.length > 0 ? { presets: builtPresets } : {})
        };
    }

    static async generate(
        packResult: PackResult,
        items: ExportItem[], // This items array needs to have Z-info or be re-sorted?
        psdWidth: number,
        psdHeight: number,
        animations: Record<string, PartAnimation> = {},
        onProgress?: ExportProgressCallback,
        mappingState?: AvatarMapping,
        presets: AvatarPreset[] = [],
        expressions: AvatarExpression[] = [],
        transforms: Record<string, PartTransform> = {}
    ): Promise<Blob> {
        const zip = new JSZip();
        const report = (phase: string, percent: number) => onProgress?.(phase, percent);

        // 1. Save Textures
        // アトラスは複数枚になりうる（emg-json-spec.md 1.3）。エントリ名は
        // createData が textures[] に書くものと一致させる必要がある。
        //
        // 4096x8192 の PNG エンコードは数秒かかるため、ここが体感上いちばん長い。
        for (let i = 0; i < packResult.atlases.length; i++) {
            const atlas = packResult.atlases[i];
            report(
                packResult.atlases.length > 1
                    ? `テクスチャを書き出し中（${i + 1}/${packResult.atlases.length}）`
                    : 'テクスチャを書き出し中',
                35 + Math.round(25 * i / packResult.atlases.length)
            );
            const textureBlob = await new Promise<Blob | null>(resolve =>
                atlas.canvas.toBlob(resolve, 'image/png')
            );
            if (!textureBlob) throw new Error(`Failed to generate texture blob: ${atlas.textureFile}`);
            zip.file(atlas.textureFile, textureBlob);
        }

        // 2. Generate JSON
        report('定義を生成中', 62);
        const emgData = EmgGenerator.createData(packResult, items, psdWidth, psdHeight, animations, presets, transforms);
        zip.file('data.json', JSON.stringify(emgData, null, 2));

        // 3. mapping.json（任意）。
        //    利用者が割り当てを持っていればそれを書き、無ければ従来どおり
        //    キーワード推測のドラフトを出す。推測は初期値のためのものなので、
        //    割り当てがある限り推測結果で上書きしない。
        const mapping = mappingState
            ? buildMapping(emgData, mappingState, expressions, presets)
            : generateDraftMapping(emgData);
        if (mapping) {
            zip.file('mapping.json', JSON.stringify(mapping, null, 2));
        }

        // JSZip は onUpdate で実際の進捗を返すので、ここだけは推測ではない値になる。
        report('パッケージ中', 65);
        return await zip.generateAsync({ type: 'blob' }, meta => {
            report('パッケージ中', 65 + Math.round(0.35 * (meta.percent ?? 0)));
        });
    }
}

