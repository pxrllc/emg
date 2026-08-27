import {
    TRANSFORM_DEFAULTS,
    type PartTransform, type TransformPath, type TransformTrack,
} from '../types';

/**
 * v0.5.0 §7 のトランスフォームを評価する。
 *
 * **プレビューと書き出しが同じ規則で動くように、ここ 1 か所に置きます。**
 * 補間（§7.5）とループ（§7.6）は仕様で値が一意に定まるよう決められているので、
 * 「見えている絵」と「他の実装で開いた絵」が食い違ってはいけません。
 */

/** ある時刻でのパスごとの値。 */
export type TransformValues = Record<TransformPath, number>;

/**
 * §7.6 のループ規則で、再生時刻を `0..duration` に畳む。
 *
 * `pingpong` の 1 周期は `2 × duration`。`loop` は終端と始端を補間しないので、
 * 単純な剰余でよい。
 */
export function foldTime(
    time: number, duration: number, loop: PartTransform['loop'], phaseOffset = 0,
): number {
    if (!(duration > 0)) return 0;
    const t = time + phaseOffset;
    if (loop === 'once') return Math.min(Math.max(t, 0), duration);

    if (loop === 'pingpong') {
        const period = duration * 2;
        let m = t % period;
        if (m < 0) m += period;
        return m <= duration ? m : period - m;
    }

    let m = t % duration;
    if (m < 0) m += duration;
    return m;
}

/** Catmull-Rom（§7.5 で `cubic` はこれに固定）。制御点を持たない。 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, s: number): number {
    const s2 = s * s;
    const s3 = s2 * s;
    return 0.5 * (
        2 * p1
        + (-p0 + p2) * s
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * s3
    );
}

/** 1 トラックを時刻 `t`（畳んだ後）で評価する。 */
export function evaluateTrack(track: TransformTrack, t: number): number | undefined {
    const keys = track.keys;
    if (keys.length === 0) return undefined;
    if (keys.length === 1) return keys[0].v;

    // 端の外側はそれぞれ端の値を保持する。
    if (t <= keys[0].t) return keys[0].v;
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;

    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i];
    const b = keys[i + 1];

    if (track.interpolation === 'step') return a.v;

    const span = b.t - a.t;
    const s = span > 0 ? (t - a.t) / span : 0;
    if (track.interpolation !== 'cubic') return a.v + (b.v - a.v) * s;

    // 端点は最初／最後のキーを複製して計算する（§7.5）。
    const p0 = keys[i - 1] ?? a;
    const p3 = keys[i + 2] ?? b;
    return catmullRom(p0.v, a.v, b.v, p3.v, s);
}

/**
 * 時刻 `time` におけるパーツのトランスフォーム値。
 *
 * トラックを持たないパスは `base` の値になります（`base` は加算ではありません
 * — types.ts の `PartTransform` を参照）。
 */
export function evaluateTransform(t: PartTransform | undefined, time: number): TransformValues {
    const out: TransformValues = { ...TRANSFORM_DEFAULTS };
    if (!t) return out;

    for (const path of Object.keys(out) as TransformPath[]) {
        out[path] = t.base[path] ?? TRANSFORM_DEFAULTS[path];
    }

    const folded = foldTime(time, t.duration, t.loop, t.phaseOffset);
    for (const track of t.tracks) {
        const v = evaluateTrack(track, folded);
        if (v !== undefined) out[track.path] = v;
    }
    return out;
}

/**
 * §7.4 の適用順序を 2D 行列にする。呼び出し側は `ctx.setTransform` に渡す。
 *
 * ```
 * 1. アンカー点を原点へ移動
 * 2. scale_x / scale_y
 * 3. rotation
 * 4. アンカー点を元の位置へ戻す
 * 5. translate_x / translate_y
 * ```
 * 順序を間違えると「回すと絵が飛ぶ」ので、書き下しておく。
 */
export function transformMatrix(
    v: TransformValues, anchorX: number, anchorY: number,
): DOMMatrix {
    const m = new DOMMatrix();
    m.translateSelf(v.translate_x, v.translate_y);   // 5
    m.translateSelf(anchorX, anchorY);               // 4
    m.rotateSelf(v.rotation);                        // 3（度。時計回りが正）
    m.scaleSelf(v.scale_x, v.scale_y);               // 2
    m.translateSelf(-anchorX, -anchorY);             // 1
    return m;
}

/** そのパスが「動く」か。静止なら書き出しでキー 1 つに畳める。 */
export function isAnimated(t: PartTransform, path: TransformPath): boolean {
    const track = t.tracks.find(tr => tr.path === path);
    return !!track && track.keys.length > 1;
}

/** アニメーションが 1 つでもあるか。再生ボタンの有効・無効に使う。 */
export function hasAnimation(t: PartTransform | undefined): boolean {
    return !!t && t.tracks.some(tr => tr.keys.length > 1);
}
