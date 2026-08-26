import type { Layer } from 'ag-psd';
import { FileLoader } from './PsdLoader';
import { ImageLoader } from './ImageLoader';

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
    /** 1 枚の画像か、レイヤー構造を持つ文書か。合成時の扱いを分ける。 */
    kind: 'document' | 'image';
}

export class SourceLoader {
    /** ファイル選択ダイアログの accept 属性。 */
    static readonly ACCEPT = ['.psd', '.kra', '.clip', ...ImageLoader.EXTENSIONS.map(e => `.${e}`)].join(',');

    static async load(file: File): Promise<LoadedSource> {
        const name = file.name.replace(/\.[^.]+$/, '') || 'source';

        if (ImageLoader.supports(file.name)) {
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
