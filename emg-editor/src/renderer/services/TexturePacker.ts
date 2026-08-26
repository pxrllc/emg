export interface PackItem {
    id: string;
    width: number;
    height: number;
    image: CanvasImageSource; // ImageBitmap, HTMLCanvasElement, etc.
}

export interface PackedItem extends PackItem {
    x: number;
    y: number;
    /** このアイテムが載っているアトラスの番号（PackResult.atlases のインデックス）。 */
    atlasIndex: number;
}

export interface PackedAtlas {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    /** `textures[].textureFile` および ZIP のエントリ名になる。 */
    textureFile: string;
}

export interface PackResult {
    atlases: PackedAtlas[];
    items: PackedItem[];
}

/** 配置だけを表す中間結果。canvas を持たないので試行を何度でも安く回せる。 */
interface Placement {
    item: PackItem;
    x: number;
    y: number;
    atlasIndex: number;
}

interface AtlasSize {
    width: number;
    height: number;
}

interface Layout {
    sizes: AtlasSize[];
    placements: Placement[];
}

interface FreeRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 候補にする 1 辺の長さ。GPU 互換のため 2 の冪に限る。 */
const SIDE_CANDIDATES = [64, 128, 256, 512, 1024, 2048, 4096, 8192];

/**
 * MaxRects（Best Short Side Fit）による矩形詰め。
 *
 * 以前はシェルフ packing だった。高さ降順に並べて横に敷き詰め、行の高さを
 * 行内で最も高いアイテムに合わせる方式で、行内の低いアイテムの下が丸ごと死ぬ。
 * 実ファイルでの占有率は 36〜43% しかなく、「全素材を 1 枚のテクスチャに詰める」
 * という要件に対して、本来 1 枚に入る量が分割される原因になっていた。
 */
class MaxRects {
    private free: FreeRect[];

    constructor(width: number, height: number) {
        this.free = [{ x: 0, y: 0, width, height }];
    }

    /**
     * 収まる位置を探して確定する。収まらなければ null。
     * BSSF: 余る辺のうち短い方が最小になる自由矩形を選ぶ。隙間を細長く残しにくい。
     */
    insert(width: number, height: number): { x: number; y: number } | null {
        let best: FreeRect | null = null;
        let bestShort = Infinity;
        let bestLong = Infinity;

        for (const r of this.free) {
            if (r.width < width || r.height < height) continue;
            const leftoverH = r.width - width;
            const leftoverV = r.height - height;
            const shortFit = Math.min(leftoverH, leftoverV);
            const longFit = Math.max(leftoverH, leftoverV);
            if (shortFit < bestShort || (shortFit === bestShort && longFit < bestLong)) {
                best = r;
                bestShort = shortFit;
                bestLong = longFit;
            }
        }

        if (!best) return null;

        const placed: FreeRect = { x: best.x, y: best.y, width, height };

        // 置いた矩形と重なる自由矩形をすべて分割し直す
        const next: FreeRect[] = [];
        for (const r of this.free) {
            if (!MaxRects.splitInto(r, placed, next)) next.push(r);
        }
        this.free = next;
        this.prune();

        return { x: placed.x, y: placed.y };
    }

    /**
     * used と重なる free を、重ならない部分の矩形群に分割して out へ入れる。
     * 重なっていなければ false（呼び出し側が元の矩形をそのまま残す）。
     */
    private static splitInto(free: FreeRect, used: FreeRect, out: FreeRect[]): boolean {
        if (used.x >= free.x + free.width || used.x + used.width <= free.x
            || used.y >= free.y + free.height || used.y + used.height <= free.y) {
            return false;
        }

        // 上側
        if (used.y > free.y && used.y < free.y + free.height) {
            out.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
        }
        // 下側
        if (used.y + used.height < free.y + free.height) {
            const y = used.y + used.height;
            out.push({ x: free.x, y, width: free.width, height: free.y + free.height - y });
        }
        // 左側
        if (used.x > free.x && used.x < free.x + free.width) {
            out.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
        }
        // 右側
        if (used.x + used.width < free.x + free.width) {
            const x = used.x + used.width;
            out.push({ x, y: free.y, width: free.x + free.width - x, height: free.height });
        }
        return true;
    }

    /** 他の自由矩形に完全に含まれるものを捨てる。放置すると候補が指数的に増える。 */
    private prune(): void {
        const contains = (a: FreeRect, b: FreeRect) =>
            b.x >= a.x && b.y >= a.y
            && b.x + b.width <= a.x + a.width
            && b.y + b.height <= a.y + a.height;

        const kept: FreeRect[] = [];
        for (let i = 0; i < this.free.length; i++) {
            let contained = false;
            for (let j = 0; j < this.free.length; j++) {
                if (i !== j && contains(this.free[j], this.free[i])) {
                    // 同一矩形が 2 つあると相互に「含まれる」と判定され両方消えるので、
                    // 同値のときは添字が小さい方だけを残す。
                    if (!contains(this.free[i], this.free[j]) || j < i) {
                        contained = true;
                        break;
                    }
                }
            }
            if (!contained) kept.push(this.free[i]);
        }
        this.free = kept;
    }
}

export class TexturePacker {
    /**
     * 全アイテムを 1 枚のアトラスへ詰める。収まらない場合は複数枚に分割する
     * （emg-json-spec.md 1.3）。
     *
     * 1 枚に収まる場合はファイル名に連番を付けない（`texture.png`）。
     */
    static async pack(items: PackItem[], startSize = 64, maxSize = 8192): Promise<PackResult> {
        const oversized = items.find(i => i.width > maxSize || i.height > maxSize);
        if (oversized) {
            // 1 枚に載らないアイテムは分割しても救えない。
            throw new Error(
                `Item ${oversized.id} (${oversized.width}x${oversized.height}) is larger than the maximum atlas size ${maxSize}`
            );
        }

        const layout = TexturePacker.layout(items, startSize, maxSize);
        return TexturePacker.rasterize(layout);
    }

    /**
     * 配置を決める。canvas を作らないため、サイズ候補を何通り試しても安い。
     *
     * 以前は収まるか判定する前に canvas を作って全アイテムを drawImage しており、
     * 2048 で失敗 → 4096 で失敗 → 8192 で成功、という経路では 3 回分の描画が
     * 無駄に走っていた。
     */
    private static layout(items: PackItem[], startSize: number, maxSize: number): Layout {
        // MaxRects は大きいものから入れるほど良い結果になる。
        // 長辺降順、同値なら面積降順。
        const sorted = [...items].sort((a, b) =>
            Math.max(b.width, b.height) - Math.max(a.width, a.height)
            || b.width * b.height - a.width * a.height);

        const usedArea = sorted.reduce((s, i) => s + i.width * i.height, 0);

        // 1. 単一アトラスを試す。小さい面積の候補から順に見て、最初に収まったものを採る。
        //    正方形に限らないのは、縦横比の偏った素材では非正方形の方が小さくなるため。
        for (const size of TexturePacker.candidateSizes(startSize, maxSize, usedArea)) {
            const placements = TexturePacker.tryFit(sorted, size);
            if (placements) {
                return { sizes: [TexturePacker.shrink(placements, size)], placements };
            }
        }

        // 2. 収まらないので maxSize のアトラスへ順に詰めていく
        const sizes: AtlasSize[] = [];
        const placements: Placement[] = [];
        let remaining = sorted;

        while (remaining.length > 0) {
            const atlasIndex = sizes.length;
            const bin = new MaxRects(maxSize, maxSize);
            const fitted: Placement[] = [];
            const rest: PackItem[] = [];

            for (const item of remaining) {
                const pos = bin.insert(item.width, item.height);
                if (pos) fitted.push({ item, x: pos.x, y: pos.y, atlasIndex });
                else rest.push(item);
            }

            if (fitted.length === 0) {
                // 上の oversized チェックを通っている以上ここには来ないが、
                // 無限ループを避けるため保険を置く。
                throw new Error('Failed to pack items: no progress');
            }

            sizes.push(TexturePacker.shrink(fitted, { width: maxSize, height: maxSize }));
            placements.push(...fitted);
            remaining = rest;
        }

        console.warn(`Atlas split into ${sizes.length} textures (${maxSize}px limit)`);
        return { sizes, placements };
    }

    /** 面積の小さい順に並べた 2 の冪サイズの候補。明らかに入らないものは省く。 */
    private static candidateSizes(startSize: number, maxSize: number, usedArea: number): AtlasSize[] {
        const sides = SIDE_CANDIDATES.filter(s => s >= startSize && s <= maxSize);
        const out: AtlasSize[] = [];
        for (const width of sides) {
            for (const height of sides) {
                // 面積が実使用量に満たない候補は詰めるまでもなく不可能。
                if (width * height < usedArea) continue;
                out.push({ width, height });
            }
        }
        return out.sort((a, b) =>
            a.width * a.height - b.width * b.height
            // 同面積なら正方形に近い方を先に（極端に細長いアトラスを避ける）
            || Math.abs(a.width - a.height) - Math.abs(b.width - b.height));
    }

    /** 指定サイズに全アイテムが収まるなら配置を返す。1 つでも入らなければ null。 */
    private static tryFit(sorted: PackItem[], size: AtlasSize): Placement[] | null {
        const bin = new MaxRects(size.width, size.height);
        const placements: Placement[] = [];
        for (const item of sorted) {
            const pos = bin.insert(item.width, item.height);
            if (!pos) return null;
            placements.push({ item, x: pos.x, y: pos.y, atlasIndex: 0 });
        }
        return placements;
    }

    /** 実際に使われた範囲まで縮める。候補サイズより小さく収まることが多い。 */
    private static shrink(placements: Placement[], size: AtlasSize): AtlasSize {
        let w = 0;
        let h = 0;
        for (const p of placements) {
            w = Math.max(w, p.x + p.item.width);
            h = Math.max(h, p.y + p.item.height);
        }
        return {
            width: Math.min(size.width, nextPowerOfTwo(w)),
            height: Math.min(size.height, nextPowerOfTwo(h)),
        };
    }

    /** 確定した配置を 1 度だけ描画する。 */
    private static rasterize(layout: Layout): PackResult {
        const single = layout.sizes.length === 1;

        const atlases: PackedAtlas[] = layout.sizes.map((size, index) => {
            const canvas = document.createElement('canvas');
            canvas.width = size.width;
            canvas.height = size.height;
            return {
                canvas,
                width: size.width,
                height: size.height,
                textureFile: single ? 'texture.png' : `texture_${index}.png`,
            };
        });

        const contexts = atlases.map(a => {
            const ctx = a.canvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get 2D context');
            return ctx;
        });

        for (const p of layout.placements) {
            contexts[p.atlasIndex].drawImage(p.item.image, p.x, p.y);
        }

        return {
            atlases,
            items: layout.placements.map(p => ({
                ...p.item,
                x: p.x,
                y: p.y,
                atlasIndex: p.atlasIndex,
            })),
        };
    }
}

function nextPowerOfTwo(v: number): number {
    v--;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v++;
    return Math.max(v, 64); // Minimum size
}
