import type { Layer } from 'ag-psd';
import { trimTransparent } from './trim';

/**
 * 1 枚の画像ファイルを 1 レイヤーとして読み込む。
 *
 * PSD / KRA と同じ形（ag-psd の Layer）に落とすことで、ツリー・プレビュー・
 * 書き出しのどれも手を入れずに扱える。KraLoader が Psd をゼロから組み立てて
 * いるのと同じやり方。
 *
 * アニメーション GIF は 1 フレーム目のみを読む（複数フレームの取り込みは
 * AnimationLoader の担当）。
 */
export class ImageLoader {
    static readonly EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'];

    static supports(fileName: string): boolean {
        const ext = fileName.split('.').pop()?.toLowerCase();
        return !!ext && ImageLoader.EXTENSIONS.includes(ext);
    }

    static async load(file: File): Promise<{ width: number; height: number; children: Layer[] }> {
        const bitmap = await createImageBitmap(file).catch(() => null);
        if (!bitmap) throw new Error(`画像として読み込めませんでした: ${file.name}`);

        const full = document.createElement('canvas');
        full.width = bitmap.width;
        full.height = bitmap.height;
        const ctx = full.getContext('2d');
        if (!ctx) throw new Error('Failed to get 2D context');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        // 画像はキャンバス全面で来るため、透明な余白を落としてからアトラスへ入れる。
        const trimmed = trimTransparent(full);
        if (!trimmed) throw new Error(`全面が透明です: ${file.name}`);

        // 拡張子を除いた名前をレイヤー名にする。これが textureID の元になる。
        const name = file.name.replace(/\.[^.]+$/, '') || 'image';

        const layer: Layer = {
            name,
            canvas: trimmed.canvas,
            left: trimmed.dx,
            top: trimmed.dy,
            right: trimmed.dx + trimmed.canvas.width,
            bottom: trimmed.dy + trimmed.canvas.height,
            hidden: false,
            opacity: 1,
            blendMode: 'normal',
        };

        // 元画像の寸法をキャンバスサイズとして返す（切り詰めで位置がずれないよう、
        // レイヤー側は dx/dy を持たせてある）。
        return { width: full.width, height: full.height, children: [layer] };
    }
}
