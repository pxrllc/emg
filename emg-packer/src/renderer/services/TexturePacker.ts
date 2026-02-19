export interface PackItem {
    id: string;
    width: number;
    height: number;
    image: CanvasImageSource; // ImageBitmap, HTMLCanvasElement, etc.
}

export interface PackedItem extends PackItem {
    x: number;
    y: number;
}

export interface PackResult {
    canvas: HTMLCanvasElement;
    items: PackedItem[];
    width: number;
    height: number;
}

export class TexturePacker {
    static async pack(items: PackItem[], startSize = 2048, maxSize = 8192): Promise<PackResult> {
        let currentSize = startSize;

        // Sort items by height (descending) for better packing
        const sortedItems = [...items].sort((a, b) => b.height - a.height);

        while (currentSize <= maxSize) {
            try {
                return await TexturePacker.tryPack(sortedItems, currentSize, currentSize);
            } catch (e) {
                console.warn(`Packing failed at ${currentSize}x${currentSize}, retrying...`);
                if (currentSize >= maxSize) {
                    throw new Error(`Failed to pack items: Exceeded max atlas size ${maxSize}`);
                }
                currentSize *= 2;
            }
        }
        throw new Error('Unexpected packing failure');
    }

    private static async tryPack(sortedItems: PackItem[], mapWidth: number, mapHeight: number): Promise<PackResult> {
        const packedItems: PackedItem[] = [];
        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;

        let canvasWidth = 0;
        let canvasHeight = 0;

        for (const item of sortedItems) {
            if (item.width > mapWidth || item.height > mapHeight) {
                throw new Error(`Item ${item.id} is larger than atlas size`);
            }

            if (currentX + item.width > mapWidth) {
                // New row
                currentX = 0;
                currentY += rowHeight;
                rowHeight = 0;
            }

            if (currentY + item.height > mapHeight) {
                // Cannot fit - Throw to trigger retry
                throw new Error('Cannot fit');
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
            canvas,
            items: packedItems,
            width: canvas.width,
            height: canvas.height
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
