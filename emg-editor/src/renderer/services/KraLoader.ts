import JSZip from 'jszip';
import type { Psd, Layer } from 'ag-psd';

/** Maps Krita compositeop names to ag-psd BlendMode strings */
const KRA_BLEND_MODE: Record<string, string> = {
    normal:       'normal',
    erase:        'normal',
    behind:       'normal',
    multiply:     'multiply',
    screen:       'screen',
    overlay:      'overlay',
    darken:       'darken',
    lighten:      'lighten',
    color_dodge:  'color dodge',
    color_burn:   'color burn',
    hard_light:   'hard light',
    soft_light:   'soft light',
    difference:   'difference',
    exclusion:    'exclusion',
    hue:          'hue',
    saturation:   'saturation',
    color:        'color',
    luminize:     'luminosity',
    'pass through': 'pass through',
};

export class KraLoader {
    static async load(file: File): Promise<Psd> {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        // Parse maindoc.xml
        const mainDocEntry = zip.file('maindoc.xml');
        if (!mainDocEntry) throw new Error('Invalid KRA file: missing maindoc.xml');

        const mainDocXml = await mainDocEntry.async('string');
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(mainDocXml, 'text/xml');

        const imageEl = xmlDoc.querySelector('IMAGE');
        if (!imageEl) throw new Error('Invalid KRA file: missing IMAGE element');

        const width = parseInt(imageEl.getAttribute('width') || '0', 10);
        const height = parseInt(imageEl.getAttribute('height') || '0', 10);
        if (!width || !height) throw new Error('Invalid KRA file: missing canvas dimensions');

        let idCounter = 1;

        const parseLayerEl = async (el: Element): Promise<Layer | null> => {
            const name = el.getAttribute('name') || 'Layer';
            const type = el.getAttribute('type') || '';
            const visible = el.getAttribute('visible') !== 'false';
            const opacity = parseInt(el.getAttribute('opacity') || '255', 10);
            const compositeop = el.getAttribute('compositeop') || 'normal';
            const blendMode = KRA_BLEND_MODE[compositeop] || 'normal';
            const x = parseInt(el.getAttribute('x') || '0', 10);
            const y = parseInt(el.getAttribute('y') || '0', 10);
            const id = idCounter++;

            if (type === 'grouplayer') {
                const childLayersEl = el.querySelector(':scope > layers');
                const children: Layer[] = [];
                if (childLayersEl) {
                    // KRA children are stored bottom-to-top in XML; keep that order (ag-psd does the same)
                    const childEls = Array.from(childLayersEl.children).reverse();
                    for (const child of childEls) {
                        const parsed = await parseLayerEl(child);
                        if (parsed) children.push(parsed);
                    }
                }
                return {
                    id,
                    name,
                    hidden: !visible,
                    opacity,
                    blendMode: blendMode as any,
                    children: children.length > 0 ? children : [],
                };
            }

            if (type === 'paintlayer') {
                const filename = el.getAttribute('filename') || '';
                if (!filename) return null;

                // PNG is stored under layers/<filename>
                const entry = zip.file(`layers/${filename}`) ?? zip.file(filename);
                if (!entry) return null;

                const pngBytes = await entry.async('uint8array');
                const canvas = await KraLoader.bytesToCanvas(pngBytes);
                if (!canvas) return null;

                return {
                    id,
                    name,
                    hidden: !visible,
                    opacity,
                    blendMode: blendMode as any,
                    canvas,
                    left: x,
                    top: y,
                };
            }

            // Skip adjustment/filter/clone layers
            return null;
        };

        const rootLayersEl = imageEl.querySelector(':scope > layers');
        const children: Layer[] = [];
        if (rootLayersEl) {
            const rootEls = Array.from(rootLayersEl.children).reverse();
            for (const el of rootEls) {
                const layer = await parseLayerEl(el);
                if (layer) children.push(layer);
            }
        }

        return { width, height, children };
    }

    private static async bytesToCanvas(pngBytes: Uint8Array): Promise<HTMLCanvasElement | null> {
        const rawBuffer = pngBytes.buffer instanceof ArrayBuffer
            ? pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength) as ArrayBuffer
            : new Uint8Array(pngBytes).buffer as ArrayBuffer;
        const blob = new Blob([rawBuffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d')!.drawImage(img, 0, 0);
            return canvas;
        } catch {
            return null;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}
