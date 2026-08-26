/**
 * 非透明部分のバウンディングボックスへ切り詰める。
 *
 * PSD / KRA のレイヤーは ag-psd / KraLoader が既にレイヤー境界で切り出した canvas を
 * 返すため、これまで必要なかった。画像ファイルや（フェーズ 3 の）GIF フレームは
 * **キャンバス全面**で来るので、切り詰めないとアトラスがすぐ破綻する。
 *
 * 500x500 のフレーム 30 枚で 7.5 Mpx。単一アトラスの上限 8192x8192 = 67.1 Mpx の
 * 11% を、ほとんど透明な領域で占めることになる。
 *
 * 切り出した分は `dx` / `dy` として返す。呼び出し側がレイヤーの left / top に
 * 足せばキャンバス上の位置は変わらない（EMG はアトラス座標とキャンバス座標を
 * 別に持つため、これだけで座標系は保たれる）。
 */
export interface TrimResult {
    canvas: HTMLCanvasElement;
    dx: number;
    dy: number;
}

/** 完全に透明なら null（呼び出し側はそのレイヤーを捨ててよい）。 */
export function trimTransparent(source: HTMLCanvasElement): TrimResult | null {
    const w = source.width;
    const h = source.height;
    if (w === 0 || h === 0) return null;

    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { canvas: source, dx: 0, dy: 0 };

    const { data } = ctx.getImageData(0, 0, w, h);

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            // アルファのみ見る。完全透明でない画素を含む範囲を残す。
            if (data[row + x * 4 + 3] !== 0) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (maxX < 0) return null;   // 全面透明

    const tw = maxX - minX + 1;
    const th = maxY - minY + 1;
    if (tw === w && th === h) return { canvas: source, dx: 0, dy: 0 };   // 切るところが無い

    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    const octx = out.getContext('2d');
    if (!octx) return { canvas: source, dx: 0, dy: 0 };
    octx.drawImage(source, minX, minY, tw, th, 0, 0, tw, th);

    return { canvas: out, dx: minX, dy: minY };
}
