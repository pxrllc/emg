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
 * **`random_interval` は「間」を再現します。** まばたきのように、休んで・一度動いて・
 * また休む、という見え方が本体だからです。連続ループとして見せると、3〜8 秒に 1 回
 * 瞬くはずのものが瞬きっぱなしになり、作ったものを確認できません。
 * 休んでいる間は `undefined` を返し、呼び出し側が既定のコマ（開いた目など）へ
 * 落とします。
 *
 * **`auto_loop` と `external` は連続で回します。** `external` は書き出したファイルを
 * 再生する側が「いつ始めるか」を決めるものなので、ここで止めると口パク用に組んだ
 * 並びをエディタ上で一度も確認できなくなります。
 *
 * 間の長さは時刻から一意に決めます（`hash`）。`Math.random` だと、スクラブで
 * 戻したときに違う結果になります。
 */
export function sequenceFrameAt(anim: PartAnimation | undefined, time: number): string | undefined {
    if (!anim || !anim.enabled || anim.frames.length === 0) return undefined;

    const total = sequenceDuration(anim);
    if (!(total > 0)) return anim.frames[0];

    /** 何周目か（`random_hold` の抽選に使う）。 */
    let cycle: number;
    /** 1 周の中での位置（秒）。 */
    let t: number;

    if (anim.triggerType === 'random_interval') {
        const min = Math.max(0, anim.intervalMin ?? 0);
        const max = Math.max(min, anim.intervalMax ?? min);
        const at = Math.max(0, time);

        // 「休み → 1 周」を繰り返す。休みが先なので、0 秒から即動き出しません
        // （即発火だと `auto_loop` と見分けがつかない）。
        let cursor = 0;
        let n = 0;
        // 間隔が 0 に潰れている場合に無限に回らないよう、回数で頭打ちにする。
        const LIMIT = 10000;
        for (; n < LIMIT; n++) {
            const gap = min + hash(n * 2 + 1) * (max - min);
            if (at < cursor + gap) return undefined;   // 休み中。既定のコマに落ちる
            cursor += gap;
            if (at < cursor + total) break;
            cursor += total;
        }
        if (n >= LIMIT) return undefined;
        cycle = n;
        t = at - cursor;
    } else {
        t = time % total;
        if (t < 0) t += total;
        cycle = Math.floor(time / total);
    }

    if (anim.sequenceType === 'random_hold') {
        // 1 周ごとに 1 つ選んで、その周のあいだ保持する。
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
