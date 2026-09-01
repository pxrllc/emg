import {
    isIdentitySourceTransform, TRANSFORM_DEFAULTS,
    type LayerSlice, type PartTransform, type SourceTransform,
} from '../types';

/**
 * 素材ごとの一括配置（移動・拡大縮小・回転）。
 *
 * プレビューでは**行列のまま**描き（`composite.ts` が `CompositeItem.source` を
 * 受け取る）、書き出しのときだけ 1 回だけ焼き込みます。倍率をいじるたびに
 * 再標本化すると、触るほど画質が落ちていくためです。
 */

export interface SourceRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * 回転・拡大の中心。素材の外接矩形の中心に置く。
 *
 * レイヤーごとの中心にすると、素材が「まとまりとして」回らずにばらけます。
 * §7.4 のアンカーがレイヤーごとに独立しているのとは逆で、こちらは
 * 「取り込んだ 1 ファイルを 1 枚の絵として置き直す」ための操作です。
 */
export function sourcePivot(rects: SourceRect[]): { x: number; y: number } {
    if (rects.length === 0) return { x: 0, y: 0 };
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const r of rects) {
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.left + r.width);
        bottom = Math.max(bottom, r.top + r.height);
    }
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * キャンバス座標 → キャンバス座標の行列。
 *
 * 適用順は中心へ寄せる → 拡大 → 回転 → 戻す → 平行移動。§7.4 と同じ順序に
 * 揃えてあります（実装ごとに順序が違うと、同じ数値で違う絵になるため）。
 */
export function sourceMatrix(tf: SourceTransform, pivot: { x: number; y: number }): DOMMatrix {
    return new DOMMatrix()
        .translateSelf(tf.x, tf.y)
        .translateSelf(pivot.x, pivot.y)
        .rotateSelf(tf.rotation)
        .scaleSelf(tf.scale, tf.scale)
        .translateSelf(-pivot.x, -pivot.y);
}

/** 矩形の 4 隅を変換したときの外接矩形。 */
export function transformedBounds(
    rect: SourceRect,
    m: DOMMatrix,
): { left: number; top: number; right: number; bottom: number } {
    const corners = [
        [rect.left, rect.top],
        [rect.left + rect.width, rect.top],
        [rect.left, rect.top + rect.height],
        [rect.left + rect.width, rect.top + rect.height],
    ];
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const [x, y] of corners) {
        const p = m.transformPoint(new DOMPoint(x, y));
        left = Math.min(left, p.x);
        top = Math.min(top, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
    }
    return { left, top, right, bottom };
}

/**
 * 行列を 1 枚のレイヤーに焼き込む。書き出しとパッキング用。
 *
 * 返す `left` / `top` がそのまま `basePosition` になります。回転すると
 * 外接矩形が広がるので、元の canvas より大きくなることがあります。
 */
export function bakeLayer(
    image: HTMLCanvasElement,
    left: number,
    top: number,
    m: DOMMatrix,
): { canvas: HTMLCanvasElement; left: number; top: number } {
    const b = transformedBounds({ left, top, width: image.width, height: image.height }, m);
    const x0 = Math.floor(b.left);
    const y0 = Math.floor(b.top);
    const w = Math.max(1, Math.ceil(b.right) - x0);
    const h = Math.max(1, Math.ceil(b.bottom) - y0);

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return { canvas: image, left, top };

    // 縮小はブラウザ既定の補間だと粗くなる。素材の置き直しは 1 回きりなので
    // 品質側に振ってよい。
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 焼き込んだ canvas の原点は外接矩形の左上。行列の平行移動分をずらす。
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    ctx.drawImage(image, left, top);

    return { canvas: out, left: x0, top: y0 };
}

/**
 * 9 スライスで描き直した canvas を作る。
 *
 * 四隅は等倍のまま、上下の辺は横だけ、左右の辺は縦だけ、中央は両方向へ伸ばします。
 * 余白の合計が出力の大きさを超える場合は、**伸ばす部分が消えるだけ**にして
 * 角が重ならないように余白側を詰めます（そうしないと角が二重に描かれる）。
 *
 * 焼き込み専用です。EMG のレイヤーは矩形しか持たないため、9 スライスを
 * 再生時に解決する方法がありません（{@link LayerSlice} の説明を参照）。
 */
export function sliceLayer(image: HTMLCanvasElement, s: LayerSlice): HTMLCanvasElement {
    const outW = Math.max(1, Math.round(s.width));
    const outH = Math.max(1, Math.round(s.height));

    // 余白が出力に収まらないときは比例で詰める。角が重なると絵が壊れる。
    const shrink = (a: number, b: number, total: number) => {
        const sum = a + b;
        if (sum <= total) return [a, b] as const;
        const k = sum > 0 ? total / sum : 0;
        return [Math.floor(a * k), Math.floor(b * k)] as const;
    };
    const [dl, dr] = shrink(s.left, s.right, outW);
    const [dt, db] = shrink(s.top, s.bottom, outH);
    // 元画像側の余白は詰めない（切り出す場所は元のまま）。
    const sl = Math.min(s.left, image.width);
    const sr = Math.min(s.right, Math.max(0, image.width - sl));
    const st = Math.min(s.top, image.height);
    const sb = Math.min(s.bottom, Math.max(0, image.height - st));

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d');
    if (!ctx) return image;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const sxs = [0, sl, image.width - sr];
    const sws = [sl, Math.max(0, image.width - sl - sr), sr];
    const sys = [0, st, image.height - sb];
    const shs = [st, Math.max(0, image.height - st - sb), sb];
    const dxs = [0, dl, outW - dr];
    const dws = [dl, Math.max(0, outW - dl - dr), dr];
    const dys = [0, dt, outH - db];
    const dhs = [dt, Math.max(0, outH - dt - db), db];

    // タイルは**いったん切り出してから**引き伸ばす。
    // 元画像から直接 drawImage で拡大すると、補間が矩形の外（隣のタイル）まで
    // 読みに行き、継ぎ目に 1〜2px の滲みが出る（実測: 8px の赤枠の内側 1px が
    // 赤と青の中間色になっていた）。切り出した後なら外に読むものが無い。
    const tile = document.createElement('canvas');
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const sw = sws[c], sh = shs[r], dw = dws[c], dh = dhs[r];
            if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;

            if (sw === dw && sh === dh) {
                // 等倍のタイル（四隅は必ずこれ）。補間を切ってそのまま写す。
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(image, sxs[c], sys[r], sw, sh, dxs[c], dys[r], dw, dh);
                ctx.imageSmoothingEnabled = true;
                continue;
            }

            tile.width = sw;
            tile.height = sh;
            const tctx = tile.getContext('2d');
            if (!tctx) continue;
            tctx.imageSmoothingEnabled = false;
            tctx.drawImage(image, sxs[c], sys[r], sw, sh, 0, 0, sw, sh);
            ctx.drawImage(tile, 0, 0, sw, sh, dxs[c], dys[r], dw, dh);
        }
    }
    return out;
}

/**
 * 素材の配置を、バウンディングボックス（`TransformOverlay`）が扱える形にする。
 *
 * **ハンドルの実装を 2 本持ちません。** §7 のトランスフォームと素材の配置は
 * 適用順（アンカーへ寄せる → 拡大 → 回転 → 戻す → 平行移動）が同一なので、
 * 同じ枠をそのまま使えます。別に書くと、掴んだ結果と数値欄が食い違ったときに
 * どちらが正しいのか分からなくなります。
 *
 * `tracks` は空。素材の配置は時間で動くものではありません。
 */
export function toPartTransform(tf: SourceTransform, pivot: { x: number; y: number }): PartTransform {
    return {
        base: {
            ...TRANSFORM_DEFAULTS,
            translate_x: tf.x,
            translate_y: tf.y,
            rotation: tf.rotation,
            scale_x: tf.scale,
            scale_y: tf.scale,
        },
        anchor: pivot,
        tracks: [],
        duration: 2,
        loop: 'loop',
        phaseOffset: 0,
    };
}

/**
 * バウンディングボックスからの変更を素材の配置へ戻す。
 *
 * 拡大は縦横同率なので、**動いた側の軸**を採ります。角ハンドルは両方動くので
 * どちらでも同じ値になり、辺ハンドルはその軸の変化がそのまま全体に効きます。
 * `anchor` は素材の外接矩形の中心に固定なので受け取りません（枠の中心を
 * ずらす操作は、配置としては意味を持たない）。
 */
export function fromPartTransformPatch(
    patch: Partial<PartTransform>,
    current: SourceTransform,
): Partial<SourceTransform> | null {
    const base = patch.base;
    if (!base) return null;
    const out: Partial<SourceTransform> = {};
    if (base.translate_x !== current.x) out.x = base.translate_x;
    if (base.translate_y !== current.y) out.y = base.translate_y;
    if (base.rotation !== current.rotation) out.rotation = base.rotation;
    const sx = base.scale_x, sy = base.scale_y;
    if (sx !== current.scale || sy !== current.scale) {
        out.scale = Math.max(0.01, sx !== current.scale ? sx : sy);
    }
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * 素材ごとの行列を、レイヤー id から引ける形にまとめる。
 *
 * 恒等の素材は載せません。大多数はこれなので、載せると全レイヤーに
 * 無意味な行列演算が付いて回ります。
 */
export function buildSourceMatrices(
    sources: { layerIds: number[]; transform: SourceTransform }[],
    rectOf: (layerId: number) => SourceRect | undefined,
): Map<number, DOMMatrix> {
    const out = new Map<number, DOMMatrix>();
    for (const s of sources) {
        if (isIdentitySourceTransform(s.transform)) continue;
        const rects: SourceRect[] = [];
        for (const id of s.layerIds) {
            const r = rectOf(id);
            if (r) rects.push(r);
        }
        if (rects.length === 0) continue;
        const m = sourceMatrix(s.transform, sourcePivot(rects));
        for (const id of s.layerIds) {
            if (rectOf(id)) out.set(id, m);
        }
    }
    return out;
}
