import type { Layer } from 'ag-psd';
import type { PackItem } from '../services/TexturePacker';

export function extractPackableLayers(root: Layer): PackItem[] {
    const items: PackItem[] = [];

    function traverse(layer: Layer) {
        if (layer.children) {
            layer.children.forEach(traverse);
        } else {
            // It's a leaf layer
            // Layer interface has top, left, bottom, right
            const width = (layer.right || 0) - (layer.left || 0);
            const height = (layer.bottom || 0) - (layer.top || 0);

            if (layer.canvas && width > 0 && height > 0 && !layer.hidden) {
                items.push({
                    id: layer.name || 'unnamed',
                    width: width,
                    height: height,
                    image: layer.canvas
                });
            }
        }
    }

    traverse(root);
    return items;
}
