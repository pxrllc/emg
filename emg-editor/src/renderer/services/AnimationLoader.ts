import type { Layer } from 'ag-psd';
import { trimTransparent } from './trim';

/**
 * アニメーション画像（GIF / アニメーション WebP / APNG）をフレームに分解する。
 *
 * WebCodecs の `ImageDecoder` を使う。Chromium 94 以降に載っており、Electron 33 は
 * Chromium 130 なので追加の依存は要らない。gifuct-js のようなライブラリを入れる
 * 必要はなく、GIF 以外（WebP アニメ・APNG）も同じ経路で扱える。
 *
 * `services/` はブラウザ API のみで完結させる必要がある（emg-web-packer が
 * このディレクトリをそのまま読み込むため）。`ImageDecoder` はブラウザ API なので
 * その制約に反しない。
 */
export interface LoadedAnimation {
    width: number;
    height: number;
    children: Layer[];
    /** 各フレームの表示秒数。`children` と同順・同数。 */
    frameDurations: number[];
}

/** 1 パーツあたりのフレーム数の目安。超えるとアトラスを圧迫する。 */
export const FRAME_COUNT_WARNING = 60;

export class AnimationLoader {
    /** 複数フレームを持つか。1 フレームなら静止画として扱ってよい。 */
    static async isAnimated(file: File): Promise<boolean> {
        if (typeof ImageDecoder === 'undefined') return false;
        try {
            const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type || guessType(file.name) });
            await decoder.tracks.ready;
            const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
            decoder.close();
            return count > 1;
        } catch {
            return false;
        }
    }

    static async load(file: File): Promise<LoadedAnimation> {
        if (typeof ImageDecoder === 'undefined') {
            throw new Error('この環境ではアニメーション画像を読み込めません（ImageDecoder 非対応）。');
        }

        const decoder = new ImageDecoder({
            data: await file.arrayBuffer(),
            type: file.type || guessType(file.name),
        });
        await decoder.tracks.ready;

        const track = decoder.tracks.selectedTrack;
        if (!track) throw new Error(`フレームを読み取れませんでした: ${file.name}`);

        const frameCount = track.frameCount;
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'anim';

        const children: Layer[] = [];
        const frameDurations: number[] = [];
        let width = 0;
        let height = 0;

        try {
            for (let i = 0; i < frameCount; i++) {
                const { image } = await decoder.decode({ frameIndex: i });
                try {
                    width = Math.max(width, image.displayWidth);
                    height = Math.max(height, image.displayHeight);

                    const canvas = document.createElement('canvas');
                    canvas.width = image.displayWidth;
                    canvas.height = image.displayHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) throw new Error('Failed to get 2D context');
                    ctx.drawImage(image, 0, 0);

                    // フレームはキャンバス全面で来る。切り詰めないと、
                    // ほとんど透明な領域でアトラスを埋めることになる。
                    const trimmed = trimTransparent(canvas);

                    // duration はマイクロ秒。値が無い実装もあるので既定 0.1 秒に倒す。
                    frameDurations.push(image.duration ? image.duration / 1e6 : 0.1);

                    if (!trimmed) {
                        // 全面透明のフレーム。詰めるものが無いので 1x1 の空レイヤーにする
                        // （フレーム数と durations の対応を崩さないため捨てない）。
                        const empty = document.createElement('canvas');
                        empty.width = 1;
                        empty.height = 1;
                        children.push(makeLayer(`${baseName}_${pad(i)}`, empty, 0, 0, i > 0));
                        continue;
                    }

                    children.push(makeLayer(
                        `${baseName}_${pad(i)}`, trimmed.canvas, trimmed.dx, trimmed.dy, i > 0
                    ));
                } finally {
                    // VideoFrame は明示的に閉じないとメモリを圧迫する。
                    // canvas へ写した時点で用済みなので、ここで必ず閉じる。
                    image.close();
                }
            }
        } finally {
            decoder.close();
        }

        if (children.length === 0) throw new Error(`フレームがありませんでした: ${file.name}`);

        return { width, height, children, frameDurations };
    }
}

/**
 * フレーム 1 枚をレイヤーにする。
 *
 * 2 枚目以降を hidden にするのは、取り込み後の型推定
 * （useEmgPacker.inferGroupType）が「非表示が可視と同数以上なら差分群」と
 * 判定するため。アニメーションは排他表示なので switch でなければならない。
 */
function makeLayer(
    name: string, canvas: HTMLCanvasElement, left: number, top: number, hidden: boolean
): Layer {
    return {
        name,
        canvas,
        left,
        top,
        right: left + canvas.width,
        bottom: top + canvas.height,
        hidden,
        opacity: 1,
        blendMode: 'normal',
    };
}

/** 通し番号。textureID になるので、並べたときに順序が読めるよう 0 埋めする。 */
function pad(i: number): string {
    return String(i).padStart(2, '0');
}

function guessType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'apng': case 'png': return 'image/png';
        case 'avif': return 'image/avif';
        default: return '';
    }
}
