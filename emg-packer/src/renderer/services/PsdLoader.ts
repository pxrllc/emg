import { readPsd, type Psd, type Layer } from 'ag-psd';

export type PsdLayer = Layer;

export class PsdLoader {
    /**
     * Reads a File object (from input[type=file] or drag-drop) and parses it as a PSD.
     */
    static async load(file: File): Promise<Psd> {
        let arrayBuffer: ArrayBuffer;
        if (typeof file.arrayBuffer === 'function') {
            arrayBuffer = await file.arrayBuffer();
        } else {
            arrayBuffer = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
        }

        // Parse the PSD file
        // skipLayerImageData: false ensures we get pixel data for layers
        // useImageData: true might be needed for Canvas compatibility, 
        // but ag-psd returns pixel data as Uint8ClampedArray by default which is good.
        const psd = readPsd(arrayBuffer, {
            skipLayerImageData: false,
            skipCompositeImageData: true, // We usually don't need the flattened image
            skipThumbnail: true,
            useImageData: false, // Return HTMLCanvasElement
        });

        console.log('PSD Loaded:', psd);
        return psd;
    }
}
