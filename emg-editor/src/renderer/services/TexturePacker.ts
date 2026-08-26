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

export class TexturePacker {
    /**
     * 全アイテムを 1 枚のアトラスへ詰める。収まらない場合は複数枚に分割する
     * （emg-json-spec.md 1.3）。
     *
     * 1 枚に収まる場合の出力は分割対応前と同一（`texture.png` 1 枚、2048 から倍々に拡大）。
     * 既存ファイルとのバイト互換を保つため、単一時はファイル名に連番を付けない。
     */
    static async pack(items: PackItem[], startSize = 2048, maxSize = 8192): Promise<PackResult> {
        // Sort items by height (descending) for better packing
        const sortedItems = [...items].sort((a, b) => b.height - a.height);

        const oversized = sortedItems.find(i => i.width > maxSize || i.height > maxSize);
        if (oversized) {
            // 1 枚に載らないアイテムは分割しても救えない。
            throw new Error(
                `Item ${oversized.id} (${oversized.width}x${oversized.height}) is larger than the maximum atlas size ${maxSize}`
            );
        }

        // 1. まず単一アトラスを試す（2048 → 4096 → 8192）
        for (let size = startSize; size <= maxSize; size *= 2) {
            try {
                const single = await TexturePacker.tryPack(sortedItems, size, size);
                return {
                    atlases: [{ ...single.atlas, textureFile: 'texture.png' }],
                    items: single.items.map(i => ({ ...i, atlasIndex: 0 })),
                };
            } catch {
                // 次のサイズで再試行
            }
        }

        // 2. 収まらないので maxSize のアトラスへ順に詰めていく
        const atlases: PackedAtlas[] = [];
        const packed: PackedItem[] = [];
        let remaining = sortedItems;

        while (remaining.length > 0) {
            const { atlas, items: fitted, rest } =
                await TexturePacker.packUpTo(remaining, maxSize, maxSize);

            if (fitted.length === 0) {
                // 上の oversized チェックを通っている以上ここには来ないが、
                // 無限ループを避けるため保険を置く。
                throw new Error('Failed to pack items: no progress');
            }

            const atlasIndex = atlases.length;
            atlases.push({ ...atlas, textureFile: `texture_${atlasIndex}.png` });
            packed.push(...fitted.map(i => ({ ...i, atlasIndex })));
            remaining = rest;
        }

        console.warn(`Atlas split into ${atlases.length} textures (${maxSize}px limit)`);
        return { atlases, items: packed };
    }

    /** 全アイテムが収まらなければ例外。単一アトラスの試行に使う。 */
    private static async tryPack(
        sortedItems: PackItem[], mapWidth: number, mapHeight: number
    ): Promise<{ atlas: Omit<PackedAtlas, 'textureFile'>; items: Omit<PackedItem, 'atlasIndex'>[] }> {
        const r = await TexturePacker.packUpTo(sortedItems, mapWidth, mapHeight);
        if (r.rest.length > 0) throw new Error('Cannot fit');
        return { atlas: r.atlas, items: r.items };
    }

    /**
     * 収まる分だけ詰め、入らなかったアイテムを rest として返す。
     * シェルフ packing のため、1 つ入らなくても後続の小さいものは入りうるが、
     * z 順とは無関係な並び替え済みの配列なので、順序は結果に影響しない。
     */
    private static async packUpTo(
        sortedItems: PackItem[], mapWidth: number, mapHeight: number
    ): Promise<{ atlas: Omit<PackedAtlas, 'textureFile'>; items: Omit<PackedItem, 'atlasIndex'>[]; rest: PackItem[] }> {
        const packedItems: Omit<PackedItem, 'atlasIndex'>[] = [];
        const rest: PackItem[] = [];
        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;

        let canvasWidth = 0;
        let canvasHeight = 0;

        for (const item of sortedItems) {
            if (item.width > mapWidth || item.height > mapHeight) {
                rest.push(item);
                continue;
            }

            if (currentX + item.width > mapWidth) {
                // New row
                currentX = 0;
                currentY += rowHeight;
                rowHeight = 0;
            }

            if (currentY + item.height > mapHeight) {
                // このアトラスにはもう入らない
                rest.push(item);
                continue;
            }

            packedItems.push({
                ...item,
                x: currentX,
                y: currentY
            });

            currentX += item.width;
            rowHeight = Math.max(rowHeight, item.height);

            canvasWidth = Math.max(canvasWidth, currentX);
            canvasHeight = Math.max(canvasHeight, currentY + rowHeight);
        }

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = nextPowerOfTwo(canvasWidth);
        canvas.height = nextPowerOfTwo(canvasHeight);
        const ctx = canvas.getContext('2d');

        if (!ctx) throw new Error('Failed to get 2D context');

        // Draw
        for (const p of packedItems) {
            ctx.drawImage(p.image, p.x, p.y);
        }

        return {
            atlas: { canvas, width: canvas.width, height: canvas.height },
            items: packedItems,
            rest
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
