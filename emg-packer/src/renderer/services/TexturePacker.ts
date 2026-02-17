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
    static async pack(items: PackItem[], maxMapWidth = 2048, maxMapHeight = 2048): Promise<PackResult> {
        // Sort items by height (descending) for better packing
        const sortedItems = [...items].sort((a, b) => b.height - a.height);

        const packedItems: PackedItem[] = [];
        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;

        // We'll calculate the needed width/height dynamically, but bounded by max
        let canvasWidth = 0;
        let canvasHeight = 0;

        // First pass: Calculate positions
        for (const item of sortedItems) {
            if (currentX + item.width > maxMapWidth) {
                // New row
                currentX = 0;
                currentY += rowHeight;
                rowHeight = 0;
            }

            if (currentY + item.height > maxMapHeight) {
                // Cannot fit
                console.warn(`Cannot fit item ${item.id} into atlas`);
                continue; // Or throw error / resize atlas
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
