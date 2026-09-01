import type { TransformKey } from '../types';

/**
 * イージング。
 *
 * **EMG の `tracks[]` にイージングはありません。** §7.5 が定めるのは
 * `step` / `linear` / `cubic`（Catmull-Rom 固定）の 3 つだけで、
 * 「ゆっくり始まってすっと終わる」といった曲線を書く場所がありません。
 *
 * そこでイージングは**キーに焼き込みます**。選んだ区間の中に、曲線を標本化した
 * キーを挿し、補間は `linear` にします。出来上がる `.emg` はただのキー列なので、
 * どの実装でも同じ動きになります。仕様側に持たせるより、こちらのほうが
 * 「実装ごとに曲線が違う」という事故が起きません。
 */

export interface EasingPreset {
    id: string;
    label: string;
    /** cubic-bezier の制御点。null は等速（キーを挿さない）。 */
    bezier: [number, number, number, number] | null;
}

/** 代表的なものだけを置く。数を増やすと選ぶほうが迷う。 */
export const EASING_PRESETS: EasingPreset[] = [
    { id: 'linear', label: '等速', bezier: null },
    { id: 'ease-in', label: 'イーズイン', bezier: [0.42, 0, 1, 1] },
    { id: 'ease-out', label: 'イーズアウト', bezier: [0, 0, 0.58, 1] },
    { id: 'ease-in-out', label: 'イーズインアウト', bezier: [0.42, 0, 0.58, 1] },
];

/** 区間に挿すキーの数。多いほど曲線に近いが、編集しづらくなる。 */
const SAMPLES = 8;

/** 3 次ベジェの 1 次元成分。制御点は (0,0) と (1,1) が両端に固定。 */
function bezierAt(a: number, b: number, s: number): number {
    const u = 1 - s;
    return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
}

/**
 * 時間の進み `x`（0..1）に対する値の進み `y`。
 *
 * CSS の `cubic-bezier` と同じ定義。x から媒介変数 s を求めてから y を出します
 * （x と s は一致しないため、s をそのまま使うと曲線が変わってしまう）。
 * 二分法で十分な精度が出るうえ、発散しません。
 */
export function easeProgress(bezier: [number, number, number, number], x: number): number {
    const [x1, y1, x2, y2] = bezier;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, s = x;
    for (let i = 0; i < 24; i++) {
        s = (lo + hi) / 2;
        const cx = bezierAt(x1, x2, s);
        if (cx < x) lo = s; else hi = s;
    }
    return bezierAt(y1, y2, s);
}

/**
 * `from` と `to` の間を、イージングを焼き込んだキー列に置き換える。
 *
 * 区間の内側にあった既存のキーは捨てます。イージングは「この 2 点の間をどう繋ぐか」
 * の指定なので、中に別の値が残っていると結果が指定と一致しません。
 *
 * `bezier` が null（等速）なら、内側を空にするだけです。
 */
export function applyEasing(
    keys: TransformKey[],
    from: TransformKey,
    to: TransformKey,
    bezier: [number, number, number, number] | null,
): TransformKey[] {
    const span = to.t - from.t;
    if (span <= 0) return keys;

    const outside = keys.filter(k => k.t <= from.t + 1e-6 || k.t >= to.t - 1e-6);
    if (!bezier) return [...outside].sort((a, b) => a.t - b.t);

    const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;
    const inserted: TransformKey[] = [];
    for (let i = 1; i <= SAMPLES; i++) {
        const x = i / (SAMPLES + 1);
        const t = round(from.t + span * x, 3);
        // 端と重なる標本は入れない（同じ時刻に 2 つキーがある状態を作らない）。
        if (t <= from.t || t >= to.t) continue;
        inserted.push({ t, v: round(from.v + (to.v - from.v) * easeProgress(bezier, x), 3) });
    }
    return [...outside, ...inserted].sort((a, b) => a.t - b.t);
}
