import { PngAvatarAdapter } from './emg-lite/adapter/png-adapter';
import type { EMGLiteState, EMGModelDefinition } from './emg-lite/types';

export class Viewer {
    private adapter: PngAvatarAdapter;
    private imgElement: HTMLImageElement;
    private noAssetMsg: HTMLElement;

    public onError: ((path: string) => void) | null = null;
    public onSuccess: (() => void) | null = null;

    constructor(basePath: string = '/assets') {
        console.log('Viewer init started');
        this.adapter = new PngAvatarAdapter({
            basePath: basePath, // Assets served from /public/assets available at /assets
            // default extensions and suffixes apply
        });

        this.imgElement = document.getElementById('avatar-img') as HTMLImageElement;
        this.noAssetMsg = document.getElementById('no-asset-msg') as HTMLElement;

        this.imgElement.onerror = () => {
            console.error('Image load error:', this.imgElement.src);
            // this.imgElement.style.display = 'none';
            this.noAssetMsg.classList.remove('hidden');
            this.noAssetMsg.textContent = 'Err: ' + this.imgElement.src;
            this.onError?.(this.imgElement.src);
        };

        this.imgElement.onload = () => {
            this.imgElement.style.display = 'block';
            this.noAssetMsg.classList.add('hidden');
            this.onSuccess?.();
        };
    }

    public setOverrideImage(url: string) {
        this.imgElement.src = url;
    }

    // State
    private blinking: boolean = false;
    private currentState?: EMGLiteState;

    // Advanced Config
    public setModelDefinition(def: EMGModelDefinition) {
        this.adapter.setModelDefinition(def);
        if (this.currentState) {
            this.update(this.currentState);
        }
    }

    public setBlobMap(map: Record<string, string>) {
        this.adapter.setBlobMap(map);
        if (this.currentState) {
            this.update(this.currentState);
        }
    }

    public setBlinking(isBlinking: boolean) {
        if (this.blinking === isBlinking) return;
        this.blinking = isBlinking;
        if (this.currentState) {
            this.update(this.currentState);
        }
    }

    public update(state: EMGLiteState) {
        this.currentState = state;
        const imagePath = this.adapter.resolveImage(state, this.blinking);
        console.log('Update Viewer:', imagePath, 'Blink:', this.blinking);

        if (!imagePath) {
            // Task 44: Handle no image resolved
            this.imgElement.style.display = 'none';
            return;
        }

        // Ensure visible if valid path found
        this.imgElement.style.display = 'block';

        // Anchor Logic (Default 0.5)
        const def = this.adapter.getModelDefinition(); // Access directly or via stored prop
        const ax = def?.anchorX ?? 0.5;
        const ay = def?.anchorY ?? 0.5;
        this.imgElement.style.objectPosition = `${ax * 100}% ${ay * 100}%`;


        // Only update if changed to avoid flickering if caching isn't perfect
        try {
            const url = new URL(imagePath, window.location.origin).href;
            if (this.imgElement.src !== url) {
                this.imgElement.src = imagePath;
            }
        } catch (e) {
            console.warn('Invalid URL:', imagePath);
        }
    }
}
