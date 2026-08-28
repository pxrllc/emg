/**
 * アニメーション GIF を書き出す。
 *
 * 外部ライブラリを足していないのは、必要なのが**この用途に限れば**
 * 素直な部分（メディアンカットの減色と LZW）だけで、依存を 1 つ増やすほどでは
 * ないため。汎用の GIF ライブラリが持つ機能（フレーム差分、インターレース、
 * 局所パレット）は使わない。
 *
 * 仕様は GIF89a。透明色を 1 つ確保し、各フレームは前のフレームを消してから
 * 描く（disposal = 2）。差分最適化をしないのは、透明を含む素材で
 * 「前フレームが透けて残る」事故を確実に避けるため。
 */

export interface GifFrame {
    /** RGBA。長さは width * height * 4。 */
    data: Uint8ClampedArray;
    /** 表示時間（秒）。GIF の単位は 1/100 秒なので、その粒度に丸められる。 */
    delay: number;
}

/** 透明として扱うアルファのしきい値。これ未満は完全な透明にする。 */
const ALPHA_CUTOFF = 128;

// ---- パレット（メディアンカット）-------------------------------------------

interface Box { colors: number[]; }   // colors は 0xRRGGBB

/**
 * 全フレームから 1 つの共通パレットを作る。
 *
 * フレームごとに局所パレットを持たせる方が色は良くなるが、GIF の
 * 「前フレームを消して描く」と組み合わせると色がちらつく。動きを見るための
 * 書き出しなので、安定を採る。
 */
function buildPalette(frames: GifFrame[], maxColors: number): number[] {
    // 標本を集める。全画素を見ると 1920x1080x60 で 1 億を超えるので間引く。
    const counts = new Map<number, number>();
    const stride = Math.max(1, Math.floor(
        frames.reduce((n, f) => n + f.data.length / 4, 0) / 200_000));
    for (const f of frames) {
        for (let i = 0, p = 0; i < f.data.length; i += 4, p++) {
            if (p % stride !== 0) continue;
            if (f.data[i + 3] < ALPHA_CUTOFF) continue;
            // 5bit に量子化してから数える。似た色を 1 つにまとめて箱の分割を安定させる。
            const c = ((f.data[i] & 0xf8) << 16) | ((f.data[i + 1] & 0xf8) << 8) | (f.data[i + 2] & 0xf8);
            counts.set(c, (counts.get(c) ?? 0) + 1);
        }
    }
    const unique = [...counts.keys()];
    if (unique.length === 0) return [0x000000];
    if (unique.length <= maxColors) return unique;

    let boxes: Box[] = [{ colors: unique }];
    while (boxes.length < maxColors) {
        // 一番「広がっている」箱を割る。
        let target = -1, bestRange = -1, bestChannel = 0;
        boxes.forEach((box, i) => {
            if (box.colors.length < 2) return;
            for (let ch = 0; ch < 3; ch++) {
                const shift = 16 - ch * 8;
                let lo = 255, hi = 0;
                for (const c of box.colors) {
                    const v = (c >> shift) & 0xff;
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                if (hi - lo > bestRange) { bestRange = hi - lo; target = i; bestChannel = ch; }
            }
        });
        if (target < 0 || bestRange <= 0) break;

        const shift = 16 - bestChannel * 8;
        const box = boxes[target];
        const sorted = [...box.colors].sort((a, b) => ((a >> shift) & 0xff) - ((b >> shift) & 0xff));
        const mid = sorted.length >> 1;
        boxes = [
            ...boxes.slice(0, target),
            { colors: sorted.slice(0, mid) },
            { colors: sorted.slice(mid) },
            ...boxes.slice(target + 1),
        ];
    }

    return boxes.filter(b => b.colors.length > 0).map(box => {
        let r = 0, g = 0, b = 0;
        for (const c of box.colors) { r += (c >> 16) & 0xff; g += (c >> 8) & 0xff; b += c & 0xff; }
        const n = box.colors.length;
        return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n));
    });
}

/** 最も近いパレット番号。同じ色を何度も引くのでキャッシュする。 */
function makeMapper(palette: number[]) {
    const cache = new Map<number, number>();
    return (r: number, g: number, b: number): number => {
        const key = (r << 16) | (g << 8) | b;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        let best = 0, bestD = Infinity;
        for (let i = 0; i < palette.length; i++) {
            const p = palette[i];
            const dr = r - ((p >> 16) & 0xff), dg = g - ((p >> 8) & 0xff), db = b - (p & 0xff);
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; best = i; }
        }
        cache.set(key, best);
        return best;
    };
}

// ---- 出力バッファ -----------------------------------------------------------

class Out {
    private buf = new Uint8Array(new ArrayBuffer(1 << 16));
    private len = 0;
    private grow(n: number) {
        if (this.len + n <= this.buf.length) return;
        let size = this.buf.length;
        while (size < this.len + n) size *= 2;
        const next = new Uint8Array(new ArrayBuffer(size));
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
    }
    byte(v: number) { this.grow(1); this.buf[this.len++] = v & 0xff; }
    short(v: number) { this.byte(v); this.byte(v >> 8); }
    bytes(a: ArrayLike<number>) { this.grow(a.length); this.buf.set(a as Uint8Array, this.len); this.len += a.length; }
    ascii(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
    take(): Uint8Array<ArrayBuffer> { return this.buf.slice(0, this.len) as Uint8Array<ArrayBuffer>; }
}

// ---- LZW --------------------------------------------------------------------

/**
 * GIF の LZW。**符号長は可変**で、辞書が埋まるたびに 1 bit ずつ伸びる。
 * 固定長で書くと、読み手は途中から全く別の並びとして解釈する。
 */
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array<ArrayBuffer> {
    const out = new Out();
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;

    let dict = new Map<string, number>();
    const reset = () => {
        dict = new Map();
        for (let i = 0; i < clear; i++) dict.set(String(i), i);
    };
    reset();
    let next = eoi + 1;
    let codeSize = minCodeSize + 1;

    let bits = 0, nbits = 0;
    const chunk: number[] = [];
    const emit = (code: number) => {
        bits |= code << nbits;
        nbits += codeSize;
        while (nbits >= 8) {
            chunk.push(bits & 0xff);
            bits >>= 8;
            nbits -= 8;
        }
    };

    emit(clear);
    let prefix = String(indices[0]);
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const cand = prefix + ',' + k;
        if (dict.has(cand)) { prefix = cand; continue; }
        emit(dict.get(prefix)!);
        dict.set(cand, next++);
        if (next > (1 << codeSize)) {
            if (codeSize < 12) codeSize++;
            else { emit(clear); reset(); next = eoi + 1; codeSize = minCodeSize + 1; }
        }
        prefix = String(k);
    }
    emit(dict.get(prefix)!);
    emit(eoi);
    if (nbits > 0) chunk.push(bits & 0xff);

    // サブブロック（最大 255 バイト）に割る。
    for (let i = 0; i < chunk.length; i += 255) {
        const part = chunk.slice(i, i + 255);
        out.byte(part.length);
        out.bytes(part);
    }
    out.byte(0);
    return out.take();
}

// ---- 本体 -------------------------------------------------------------------

export interface GifOptions {
    width: number;
    height: number;
    /** 0 なら無限ループ。 */
    loops?: number;
    /** 進捗（0〜1）。 */
    onProgress?: (ratio: number) => void;
}

export function encodeGif(frames: GifFrame[], opts: GifOptions): Blob {
    const { width, height, loops = 0, onProgress } = opts;
    if (frames.length === 0) throw new Error('フレームがありません');

    // 透明用に 1 つ空けるので 255 色まで。
    const palette = buildPalette(frames, 255);
    const transparentIndex = palette.length;   // パレット末尾の次を透明にする
    const mapTo = makeMapper(palette);

    const out = new Out();
    out.ascii('GIF89a');
    out.short(width);
    out.short(height);
    // グローバルカラーテーブルあり / 色深度 8 / サイズ
    const tableSize = Math.max(2, 1 << Math.ceil(Math.log2(Math.max(2, palette.length + 1))));
    out.byte(0x80 | 0x70 | (Math.log2(tableSize) - 1));
    out.byte(0);   // 背景色
    out.byte(0);   // アスペクト比

    for (let i = 0; i < tableSize; i++) {
        const c = palette[i] ?? 0;
        out.byte((c >> 16) & 0xff); out.byte((c >> 8) & 0xff); out.byte(c & 0xff);
    }

    // NETSCAPE 拡張（ループ）
    out.byte(0x21); out.byte(0xff); out.byte(11);
    out.ascii('NETSCAPE2.0');
    out.byte(3); out.byte(1); out.short(loops); out.byte(0);

    const minCodeSize = Math.max(2, Math.ceil(Math.log2(tableSize)));

    frames.forEach((frame, fi) => {
        const n = width * height;
        const indices = new Uint8Array(n);
        for (let p = 0; p < n; p++) {
            const i = p * 4;
            indices[p] = frame.data[i + 3] < ALPHA_CUTOFF
                ? transparentIndex
                : mapTo(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
        }

        // Graphic Control Extension。disposal 2 = 描く前に消す。
        const delayCs = Math.max(1, Math.round(frame.delay * 100));
        out.byte(0x21); out.byte(0xf9); out.byte(4);
        out.byte((2 << 2) | 1);          // disposal=2, 透明色あり
        out.short(delayCs);
        out.byte(transparentIndex);
        out.byte(0);

        // Image Descriptor
        out.byte(0x2c);
        out.short(0); out.short(0);
        out.short(width); out.short(height);
        out.byte(0);                      // 局所テーブルなし・非インターレース

        out.byte(minCodeSize);
        out.bytes(lzwEncode(indices, minCodeSize));

        onProgress?.((fi + 1) / frames.length);
    });

    out.byte(0x3b);   // Trailer
    return new Blob([out.take()], { type: 'image/gif' });
}
