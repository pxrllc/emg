import type { Layer } from 'ag-psd';
import type { LayerMeta } from '../types';
import { FileLoader } from './PsdLoader';
import { ImageLoader } from './ImageLoader';
import { AnimationLoader } from './AnimationLoader';

/**
 * 取り込んだ 1 ファイル分。読み込み元の種類によらず同じ形にする。
 *
 * `children` は ag-psd の Layer 配列（背面 → 前面）。PSD / KRA / 画像のどれも
 * この形に落ちるため、ツリー・プレビュー・パッキング・書き出しは
 * ソースの種類を知らずに済む。
 */
export interface LoadedSource {
    /** ファイル名から作った表示名。合成時にグループ名 = partID になる。 */
    name: string;
    /** 元のキャンバス寸法。合成先のキャンバスを決めるのに使う。 */
    width: number;
    height: number;
    children: Layer[];
    /** 1 枚の画像か、レイヤー構造を持つ文書か、アニメーションか。合成時の扱いを分ける。 */
    kind: 'document' | 'image' | 'animation';
    /**
     * `kind === 'animation'` のときの各フレームの表示秒数（`children` と同順）。
     * 取り込み側がこれを `sprites[]` の元になる設定に変換する。
     */
    frameDurations?: number[];
    /**
     * レイヤーごとの編集状態の初期値。既定の推定を上書きしたいソース用。
     *
     * `.emg` の読み込みがこれを使う。木の形から種別を推定する既定の規則では、
     * 差分が 1 コマだけの switch パーツや、初期非表示の static パーツを
     * 取り違える（前者は非表示レイヤーが無いので static、後者は全部非表示なので
     * switch に見える）。ファイルが答えを持っているのに推定するのは間違い。
     *
     * 引数は**取り込み前の**レイヤーオブジェクト。合流時に ID が振り直されるので、
     * 呼び出し側はその場で新しい ID に結び付ける。
     */
    metaOf?: (layer: Layer) => Omit<LayerMeta, 'id' | 'partId'> | undefined;
}

export class SourceLoader {
    /**
     * ファイル選択ダイアログの accept 属性。
     * `.emg` は EmgLoader が受け持つが、選べないと入口が無いのでここに載せる。
     */
    static readonly ACCEPT = ['.psd', '.kra', '.clip', '.emg', ...ImageLoader.EXTENSIONS.map(e => `.${e}`)].join(',');

    static async load(file: File): Promise<LoadedSource> {
        const name = file.name.replace(/\.[^.]+$/, '') || 'source';

        if (ImageLoader.supports(file.name)) {
            // GIF / WebP / APNG は複数フレームを持ちうる。静止画として 1 コマ目だけ
            // 取り込んでしまうと、アニメーションであることに気づけない。
            if (await AnimationLoader.isAnimated(file)) {
                const anim = await AnimationLoader.load(file);
                return {
                    name,
                    width: anim.width,
                    height: anim.height,
                    children: anim.children,
                    kind: 'animation',
                    frameDurations: anim.frameDurations,
                };
            }
            const img = await ImageLoader.load(file);
            return { name, width: img.width, height: img.height, children: img.children, kind: 'image' };
        }

        // PSD / KRA。`.clip` はここで案内付きの例外になる。
        const psd = await FileLoader.load(file);
        return {
            name,
            width: psd.width ?? 0,
            height: psd.height ?? 0,
            children: psd.children ?? [],
            kind: 'document',
        };
    }
}
