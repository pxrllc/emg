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
        const psd = readPsd(arrayBuffer, {
            skipLayerImageData: false,
            skipCompositeImageData: true,
            skipThumbnail: true,
            useImageData: false,
        });

        console.log('PSD Loaded:', psd);

        // Post-process: Flatten layers and assign Group Name as PartID
        // We want to return a flat list of visible layers, but `ag-psd` returns a tree.
        // We'll modify the `children` of the PSD object to be the flat list?
        // Or better, let the UI handle the tree, but ensure we have the partId info.
        // Actually, PsdLoader just returns Psd. EmgGenerator or the UI component likely iterates it.
        // Let's inject `partId` into the layer objects (ag-psd Layer type is open enough or we extend it).

        // We'll traverse and add a custom property `_partName` to identifying the group.
        if (psd.children) {
            PsdLoader.assignPartIds(psd.children);
        }

        return psd;
    }

    private static assignPartIds(layers: Layer[], parentPartId: string = '') {
        for (const layer of layers) {
            // If it's a group (folder), use its name as the partID for its children
            // If it's already inside a group (parentPartId is set), we might want to keep the top-level group name?
            // Requirement: "Group hierarchy by partID". Usually top-level group = Part.

            let currentPartId = parentPartId;

            // If we are at root (no parentPartId) and this is a group, set it as partID
            if (!parentPartId && layer.children && layer.children.length > 0) {
                currentPartId = layer.name || 'Part';
            }

            // If it's a layer (no children or empty children), assign the partId
            // We'll store it in a temporary property. `ag-psd` Layer doesn't have `partId`, 
            // but JS objects can hold it. We might need to cast or just ignore TS error for now.
            (layer as any)._partName = currentPartId;

            if (layer.children) {
                PsdLoader.assignPartIds(layer.children, currentPartId);
            }
        }
    }
}
