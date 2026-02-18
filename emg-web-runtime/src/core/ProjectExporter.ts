
import JSZip from 'jszip';
import type { LoadedProject } from './ProjectLoader';

export const exportProject = async (project: LoadedProject): Promise<Blob> => {
    const zip = new JSZip();

    // Save avatar data
    // Using 'data.json' as commonly used by Packer, though 'avatar.json' is also valid.
    zip.file('data.json', JSON.stringify(project.avatar, null, 2));

    // Save states data
    zip.file('states.json', JSON.stringify(project.states, null, 2));

    // Save Assets
    // We iterate through all assets in the map. 
    // Keys are relative paths (e.g. "texture_0.png", "custom/foo.png").
    for (const [path, blobUrl] of project.assets) {
        try {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            zip.file(path, blob);
        } catch (e) {
            console.error(`Failed to export asset: ${path}`, e);
        }
    }

    return await zip.generateAsync({ type: 'blob' });
};
