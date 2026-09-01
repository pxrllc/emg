import { evaluateTransform, transformMatrix } from './transform';
import { transformedBounds } from './sourceTransform';
import { transformKey, type PartTransform } from '../types';

/**
 * 合成に使う 1 枚。プレビューと書き出しで同じものを使う。
 *
 * **描画規則を 2 か所に書かない。** プレビューで見た絵と書き出した GIF が
 * 食い違うと、どちらが正しいのか確かめる手段が無くなる。
 */
export interface CompositeItem {
    id: number;
    partId: string;
    /** フレーム識別子。0.5.3 §7.4.1 のフレーム単位トランスフォームの宛先。 */
    frameId: string;
    image: HTMLCanvasElement;
    left: number;
    top: number;
    /** レイヤー自身の不透明度。§7.4 の 6 番目でトランスフォーム側と掛け合わせる。 */
    opacity: number;
    /**
     * 素材ごとの一括配置（`sourceTransform.ts`）。恒等なら不在。
     *
     * これは**配置そのもの**で、書き出し時にレイヤーへ焼き込まれます。
     * したがって §7 のトランスフォームより内側に掛かります（置いた結果に対して
     * tracks が動く、という順序）。外接矩形もこれを通した後のものを使うので、
     * アンカーの既定は画面で見えている中心と一致します。
     */
    source?: DOMMatrix;
    /**
     * 合成モード（v0.4.0 §5）。不在・未知の値は `"normal"` として描く（§5.2）。
     *
     * 許容値は CSS の `mix-blend-mode` と同じ集合で、canvas の
     * `globalCompositeOperation` に同じ名前がそのまま通ります。
     */
    blendMode?: string;
}

/**
 * v0.4.0 §5.1 の許容値。ここに無い名前は `normal` として描く（§5.2）。
 *
 * 加算（`plus-lighter`）は 0.5.4 §10.11 で追加された値です。CSS Blending L2 の
 * 値で、色は `min(1, Cb + Cs)`、アルファは通常どおり source-over。
 */
const BLEND_MODES = new Set([
    'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light',
    'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    'plus-lighter',
]);

/**
 * canvas の合成モード。
 *
 * **ここに来る値はすべて「分離可能な合成モード」で、アルファは source-over のまま
 * 合成されます。** つまり重ねても透明度は保たれます。加算も同じで、
 * Porter-Duff の `lighter` は**使いません** — あちらはアルファまで足すため、
 * 半透明の部分が重ねるたびに不透明へ寄っていきます（0.5.4 §10.11.2）。
 */
function compositeOp(mode: string | undefined): GlobalCompositeOperation {
    // **canvas は `plus-lighter` を受け付けません。** CSS の `mix-blend-mode` には
    // ある値ですが、`globalCompositeOperation` には無く、代入しても無視されて
    // `source-over` のまま描かれます（実測: Chrome 151 で代入後の値が source-over）。
    // 加算は Porter-Duff の `lighter` で色を足し、アルファは後で戻します
    // （`restoreAlpha`）。0.5.4 §10.11.2 が「アルファまで足してはならない」と
    // 定めているため、`lighter` を素で使いっぱなしにはしません。
    if (mode === ADDITIVE) return 'lighter';
    return mode && BLEND_MODES.has(mode)
        ? (mode as GlobalCompositeOperation)
        : 'source-over';
}

/** 0.5.4 §10.11 の加算。 */
const ADDITIVE = 'plus-lighter';

/**
 * 加算で膨らんだアルファを、通常合成のアルファへ戻す。
 *
 * `lighter` はアルファも足すため、半透明の部分や背景が重ねるたびに不透明へ
 * 寄っていきます（§10.11.2 が禁じている挙動）。色は加算の結果を使い、
 * **アルファだけを「全レイヤーを通常合成したときの値」に差し替えます**。
 *
 * 入口の状態から積み直すので、呼び出し側が先に背景を敷いていても壊しません。
 * 加算のレイヤーが 1 枚も無いときは何もしません（そのときは canvas の
 * 分離可能な合成モードがアルファを正しく扱うため）。
 */
function restoreAlpha(
    ctx: CanvasRenderingContext2D,
    entry: HTMLCanvasElement,
    items: CompositeItem[],
    transforms: Record<string, PartTransform>,
    bounds: Record<string, Bounds>,
    time: number,
    base: DOMMatrix | undefined,
): void {
    const { width, height } = ctx.canvas;
    if (width === 0 || height === 0) return;

    const mask = document.createElement('canvas');
    mask.width = width;
    mask.height = height;
    const mctx = mask.getContext('2d');
    if (!mctx) return;

    // 入口の状態（背景など）から始める。
    mctx.drawImage(entry, 0, 0);
    for (const item of items) {
        mctx.save();
        const { matrix, alpha } = itemMatrix(item, transforms, bounds, time);
        const m = base && matrix ? base.multiply(matrix) : (matrix ?? base);
        if (m) mctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        mctx.globalAlpha = alpha;
        mctx.drawImage(item.image, item.left, item.top);
        mctx.restore();
    }

    const out = ctx.getImageData(0, 0, width, height);
    const ref = mctx.getImageData(0, 0, width, height);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = ref.data[i];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(out, 0, 0);
}

/** 変形前の外接矩形（キャンバス座標）。 */
export interface Bounds {
    partId: string;
    left: number; top: number; right: number; bottom: number;
}

/**
 * 対象ごとの外接矩形。パーツ全体と、フレーム単位（0.5.3 §7.4.1）の両方を持つ。
 * アンカーの既定（矩形の中心）もここから決まる。
 */
export function computeBounds(items: CompositeItem[]): Record<string, Bounds> {
    const out: Record<string, Bounds> = {};
    const add = (key: string, partId: string, item: CompositeItem) => {
        // 素材の配置を通した後の矩形で測る。通さないと、素材を動かしたときに
        // バウンディングボックスとアンカーだけが元の場所に残る。
        const box = itemBounds(item);
        const cur = out[key];
        if (!cur) {
            out[key] = { partId, ...box };
        } else {
            cur.left = Math.min(cur.left, box.left);
            cur.top = Math.min(cur.top, box.top);
            cur.right = Math.max(cur.right, box.right);
            cur.bottom = Math.max(cur.bottom, box.bottom);
        }
    };
    for (const item of items) {
        add(transformKey(item.partId), item.partId, item);
        add(transformKey(item.partId, item.frameId), item.partId, item);
    }
    return out;
}

/** 1 枚ぶんの外接矩形（素材の配置を通した後・キャンバス座標）。 */
function itemBounds(item: CompositeItem): { left: number; top: number; right: number; bottom: number } {
    const rect = { left: item.left, top: item.top, width: item.image.width, height: item.image.height };
    if (!item.source) {
        return { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
    }
    return transformedBounds(rect, item.source);
}

/** そのレイヤーに掛かる行列。素材の配置 → パーツ全体 → フレームの順に重ねる。 */
export function itemMatrix(
    item: CompositeItem,
    transforms: Record<string, PartTransform>,
    bounds: Record<string, Bounds>,
    time: number,
): { matrix: DOMMatrix | null; alpha: number } {
    let matrix: DOMMatrix | null = null;
    let alpha = item.opacity;
    for (const key of [transformKey(item.partId), transformKey(item.partId, item.frameId)]) {
        const tf = transforms[key];
        const b = bounds[key];
        if (!tf || !b) continue;
        const v = evaluateTransform(tf, time);
        const anchor = tf.anchor ?? {
            x: (b.left + b.right) / 2,
            y: (b.top + b.bottom) / 2,
        };
        const next = transformMatrix(v, anchor.x, anchor.y);
        matrix = matrix ? matrix.multiply(next) : next;
        alpha *= v.opacity;
    }
    // 素材の配置は**一番内側**。「置いた結果」に対して §7 が動く順序にする。
    // A.multiply(B) は B を先に適用する行列なので、§7 側から掛ける。
    if (item.source) matrix = matrix ? matrix.multiply(item.source) : item.source;
    return { matrix, alpha };
}

/**
 * 合成を描く。`items` は背面 → 前面の順であること（`textureZIndex` の昇順）。
 * 呼び出し側は事前に `clearRect` すること（背景を敷きたい場合があるため）。
 */
export function drawComposite(
    ctx: CanvasRenderingContext2D,
    items: CompositeItem[],
    transforms: Record<string, PartTransform>,
    bounds: Record<string, Bounds>,
    time: number,
    /**
     * 全体に掛ける行列（書き出しの倍率など）。
     *
     * **`ctx.scale()` を呼んでおくだけでは効きません。** レイヤーごとの変形は
     * `setTransform` で行列を**置き換える**ので、事前に掛けた拡大は捨てられ、
     * 変形を持つパーツだけ拡大されない、という食い違いになります。
     */
    base?: DOMMatrix,
): void {
    // 加算があるときだけ、入口の状態を控える（アルファを戻すのに要る）。
    const hasAdditive = items.some(i => i.blendMode === ADDITIVE);
    let entry: HTMLCanvasElement | null = null;
    if (hasAdditive && ctx.canvas.width > 0 && ctx.canvas.height > 0) {
        entry = document.createElement('canvas');
        entry.width = ctx.canvas.width;
        entry.height = ctx.canvas.height;
        entry.getContext('2d')?.drawImage(ctx.canvas, 0, 0);
    }

    for (const item of items) {
        ctx.save();
        const { matrix, alpha } = itemMatrix(item, transforms, bounds, time);
        const m = base && matrix ? base.multiply(matrix) : (matrix ?? base);
        if (m) ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = compositeOp(item.blendMode);
        ctx.drawImage(item.image, item.left, item.top);
        ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (entry) restoreAlpha(ctx, entry, items, transforms, bounds, time, base);
}
