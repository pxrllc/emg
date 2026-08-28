import { evaluateTransform, transformMatrix } from './transform';
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
        const r = item.left + item.image.width;
        const b = item.top + item.image.height;
        const cur = out[key];
        if (!cur) {
            out[key] = { partId, left: item.left, top: item.top, right: r, bottom: b };
        } else {
            cur.left = Math.min(cur.left, item.left);
            cur.top = Math.min(cur.top, item.top);
            cur.right = Math.max(cur.right, r);
            cur.bottom = Math.max(cur.bottom, b);
        }
    };
    for (const item of items) {
        add(transformKey(item.partId), item.partId, item);
        add(transformKey(item.partId, item.frameId), item.partId, item);
    }
    return out;
}

/** そのレイヤーに掛かる行列。パーツ全体 → フレームの順に重ねる。 */
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
    for (const item of items) {
        ctx.save();
        const { matrix, alpha } = itemMatrix(item, transforms, bounds, time);
        const m = base && matrix ? base.multiply(matrix) : (matrix ?? base);
        if (m) ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.globalAlpha = alpha;
        ctx.drawImage(item.image, item.left, item.top);
        ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
}
