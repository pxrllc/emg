/**
 * `layers[].blendMode`（v0.4.0 §5 / 0.5.4 §10.11）。
 *
 * 許容値は CSS `mix-blend-mode` と同じ集合で、canvas の
 * `globalCompositeOperation` に同じ名前がそのまま通ります。
 * **定義済みでない値は `normal` として描かなければなりません**（§5.2）。
 */

/**
 * v0.4.0 §5.1 の 16 語。0.5.4 §10.11 の `plus-lighter`（加算）は下の理由で未対応。
 */
const KNOWN_BLEND_MODES = new Set<string>([
    'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light',
    'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    // **`plus-lighter`（加算・0.5.4 §10.11）は入れていません。**
    // canvas の `globalCompositeOperation` はこの値を受け付けず（CSS の
    // `mix-blend-mode` にはあるが canvas には無い）、代入しても `source-over` の
    // まま描かれます。代わりに Porter-Duff の `lighter` を使うのは §10.11.2 が
    // 禁じています（アルファまで足して半透明部分が濁るため）。
    //
    // 正しく描くには「色は lighter、アルファは通常合成」を作るための 2 パス目が
    // 要ります（emg-editor の `composite.ts` の `restoreAlpha` がそれ）。
    // ここは未実装なので、§5.2 / §5.3 に従い `normal` として描きます。
]);

/**
 * canvas の合成モードへ変換する。`normal` と未知の値は `source-over`。
 *
 * **ここに来る値はすべて「分離可能な合成モード」で、アルファは source-over のまま
 * 合成されます。** 重ねても透明度は保たれます。
 *
 * 加算に Porter-Duff の `lighter` を使ってはいけません。あちらはアルファまで足すため、
 * 半透明の部分が重ねるたびに不透明へ寄っていきます（0.5.4 §10.11.2 が明示的に禁じています）。
 * `plus-lighter` は色だけを加算し、アルファは通常どおりです。
 */
export function compositeOp(mode: string | undefined | null): GlobalCompositeOperation {
    return mode && KNOWN_BLEND_MODES.has(mode)
        ? (mode as GlobalCompositeOperation)
        : 'source-over';
}
