import type { PartAnimation } from '../types';

/**
 * `sprites[].sequence` を時刻で評価する（emg-json-spec.md 7.1 / v0.5.0 6 章）。
 *
 * トランスフォーム（`transform.ts`）と対になるもので、こちらは**どのコマを出すか**
 * を決めます。プレビューの再生はこの 2 つを同じ時計で回します。
 */

/** 1 周の長さ（秒）。`fps` なら コマ数 ÷ fps、`keys` なら表示秒数の合計。 */
export function sequenceDuration(anim: PartAnimation): number {
    if (anim.frames.length === 0) return 0;
    if (anim.timing === 'keys') {
        return anim.frames.reduce((t, _, i) => t + Math.max(0.001, anim.durations[i] ?? 0.1), 0);
    }
    return anim.frames.length / Math.max(1, anim.fps);
}

/**
 * 決定的な擬似乱数。`random_hold` の「どれを選ぶか」に使う。
 *
 * `Math.random` を使うと、同じ時刻を 2 回描いたときに違うコマが出ます。
 * プレビューはスクラブで前後に動かすので、時刻から一意に決まらないと
 * 「戻したのに絵が違う」ことになります。書き出した `.emg` を再生する側が
 * どう選ぶかは実装依存ですが（7.1）、エディタ側は再現できる必要があります。
 */
function hash(n: number): number {
    let x = (n | 0) + 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/**
 * 時刻 `time` に表示するフレーム識別子。動かせない場合は `undefined`。
 *
 * `trigger` は見ません。**再生ボタンは「作ったものを見る」ための操作**であり、
 * `trigger` は書き出したファイルを再生する側が「いつ始めるか」を決めるものです
 * （7 章）。ここで `external` を再生しないと、口パク用に組んだ並びを
 * エディタ上で一度も確認できなくなります。
 */
export function sequenceFrameAt(anim: PartAnimation | undefined, time: number): string | undefined {
    if (!anim || !anim.enabled || anim.frames.length === 0) return undefined;

    const total = sequenceDuration(anim);
    if (!(total > 0)) return anim.frames[0];

    let t = time % total;
    if (t < 0) t += total;

    if (anim.sequenceType === 'random_hold') {
        // 1 周ごとに 1 つ選んで、その周のあいだ保持する。
        const cycle = Math.floor(time / total);
        return anim.frames[Math.floor(hash(cycle) * anim.frames.length) % anim.frames.length];
    }

    if (anim.timing === 'keys') {
        let acc = 0;
        for (let i = 0; i < anim.frames.length; i++) {
            acc += Math.max(0.001, anim.durations[i] ?? 0.1);
            if (t < acc) return anim.frames[i];
        }
        return anim.frames[anim.frames.length - 1];
    }

    const i = Math.floor(t * Math.max(1, anim.fps));
    return anim.frames[Math.min(i, anim.frames.length - 1)];
}

/** 再生できるか（コマが 2 つ以上ある）。 */
export function isPlayable(anim: PartAnimation | undefined): boolean {
    return !!anim?.enabled && anim.frames.length > 1;
}
