import { encodeGif, type GifFrame } from './GifEncoder';
import type { CompositeItem } from './composite';

/**
 * プレビューの見た目をアニメーションとして書き出す。
 *
 * 動きを人に見せる／確認するためのもので、`.emg` の代わりではありません。
 * 描画は `composite.ts` を通すので、画面で見たものと同じものが出ます。
 */

export type PreviewFormat = 'gif' | 'webm';

export interface PreviewExportOptions {
    format: PreviewFormat;
    /** 尺（秒）。 */
    duration: number;
    fps: number;
    /** 出力の倍率。1 で原寸。 */
    scale: number;
    width: number;
    height: number;
    /** 透明のまま出すか、下地を敷くか。GIF は 1 色しか透明にできない。 */
    background: 'transparent' | string;
    /** 時刻 t の合成対象を返す（背面 → 前面）。 */
    frameAt: (time: number) => CompositeItem[];
    /** 1 枚描く。呼び出し側が composite.drawComposite を呼ぶ。 */
    draw: (ctx: CanvasRenderingContext2D, items: CompositeItem[], time: number, base: DOMMatrix) => void;
    onProgress?: (phase: string, ratio: number) => void;
}

/** 拡張子。保存名に使う。 */
export function extensionOf(format: PreviewFormat): string {
    return format === 'gif' ? 'gif' : 'webm';
}

/** その環境で WebM を作れるか。作れないと押しても無音で失敗する。 */
export function canRecordWebm(): boolean {
    return typeof MediaRecorder !== 'undefined'
        && typeof HTMLCanvasElement.prototype.captureStream === 'function'
        && (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            || MediaRecorder.isTypeSupported('video/webm'));
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D コンテキストを作れませんでした');
    return { canvas, ctx };
}

export async function exportPreview(opts: PreviewExportOptions): Promise<Blob> {
    const { duration, fps, scale, width, height, background, frameAt, draw, onProgress } = opts;
    const count = Math.max(1, Math.round(duration * fps));
    const { canvas, ctx } = makeCanvas(width * scale, height * scale);

    const paint = (time: number) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (background !== 'transparent') {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        // 倍率は行列として渡す。ctx.scale だけでは setTransform に捨てられる。
        draw(ctx, frameAt(time), time, new DOMMatrix().scaleSelf(scale, scale));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    if (opts.format === 'webm') return recordWebm(canvas, paint, count, fps, onProgress);

    const frames: GifFrame[] = [];
    for (let i = 0; i < count; i++) {
        paint(i / fps);
        frames.push({
            data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            delay: 1 / fps,
        });
        onProgress?.('コマを描いています', (i + 1) / count * 0.6);
        // 長い書き出しで画面が固まらないよう、たまに制御を返す。
        if (i % 8 === 7) await new Promise(r => setTimeout(r, 0));
    }
    return encodeGif(frames, {
        width: canvas.width,
        height: canvas.height,
        onProgress: r => onProgress?.('GIF を組み立てています', 0.6 + r * 0.4),
    });
}

/**
 * WebM。`captureStream(0)` + `requestFrame()` で**1 コマずつ送る**。
 *
 * 引数なしの `captureStream()` は実時間で拾うため、描画が間に合わないと
 * コマが飛び、尺も指定どおりにならない。手で送れば実時間に依存しない。
 */
function recordWebm(
    canvas: HTMLCanvasElement,
    paint: (time: number) => void,
    count: number,
    fps: number,
    onProgress?: (phase: string, ratio: number) => void,
): Promise<Blob> {
    if (!canRecordWebm()) {
        return Promise.reject(new Error('この環境では WebM を書き出せません（MediaRecorder が使えません）'));
    }
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    return new Promise<Blob>((resolve, reject) => {
        rec.onerror = () => reject(new Error('録画に失敗しました'));
        rec.onstop = () => {
            track.stop();
            resolve(new Blob(chunks, { type: 'video/webm' }));
        };
        rec.start();

        let i = 0;
        const step = () => {
            if (i >= count) { rec.stop(); return; }
            paint(i / fps);
            track.requestFrame();
            onProgress?.('コマを送っています', (i + 1) / count);
            i++;
            // requestFrame は同期だが、エンコーダに間を与えるため 1 フレーム待つ。
            setTimeout(step, 1000 / fps);
        };
        step();
    });
}
