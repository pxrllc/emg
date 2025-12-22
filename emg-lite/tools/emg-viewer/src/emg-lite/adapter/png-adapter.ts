import type { EMGLiteState, EMGModelDefinition } from '../types';

/**
 * Configuration for PNG Adapter
 */
export interface PngAdapterConfig {
    /** Root directory path for PNG assets */
    basePath: string;
    /** Extension for image files (default: .png) */
    fileExtension?: string;
    /** Suffix for talking state (default: _open) */
    talkingSuffix?: string;
    /** Suffix for silent state (default: _closed) */
    silentSuffix?: string;
    /** Default emotion if not found/specified (default: neutral) */
    defaultEmotion?: string;
}

/**
 * PNG Avatar Adapter
 * Resolves image paths based on EMGLiteState
 */
export class PngAvatarAdapter {
    private config: Required<PngAdapterConfig>;
    private modelDef?: EMGModelDefinition;
    private blobMap: Record<string, string> = {};

    constructor(
        config: PngAdapterConfig,
        modelDef?: EMGModelDefinition
    ) {
        console.log('PngAvatarAdapter init');
        this.config = {
            fileExtension: '.png',
            talkingSuffix: '_open',
            silentSuffix: '_closed',
            defaultEmotion: 'neutral',
            ...config,
        };
        this.modelDef = modelDef;
    }

    public setModelDefinition(def: EMGModelDefinition) {
        this.modelDef = def;
    }

    public getModelDefinition(): EMGModelDefinition | undefined {
        return this.modelDef;
    }

    public setBlobMap(map: Record<string, string>) {
        this.blobMap = map;
    }

    /**
     * Resolve the image path for the given state
     * @param state Current EMG Lite state
     * @param blinking Internal blink state (true = eyes closed)
     * @returns Relative path to the image file
     */
    public resolveImage(state: EMGLiteState, blinking: boolean = false): string {
        // 1. Try to use Model Definition if available
        if (this.modelDef) {
            const key = `${state.activity}.${state.emotion}`;
            let assets = this.modelDef.mapping[key]; // Changed to 'let' because it might be reassigned

            if (assets) {
                let path: string | undefined;

                // Check Sleep Mode Override
                if (state.sleep) {
                    // Try to find a mapping with isSleep=true
                    // If multiple exist, order is undefined (using first found)
                    for (const mapKey in this.modelDef.mapping) {
                        if (this.modelDef.mapping[mapKey].isSleep) {
                            // Switch effective assets to this sleep state
                            assets = this.modelDef.mapping[mapKey];
                            // Also disable blinking/speaking for sleep? Usually yes.
                            blinking = false; // Sleep implies eyes closed usually
                            state.speaking = false; // Sleep implies quiet
                            break;
                        }
                    }
                }

                // Helper to check config for current candidate
                const canBlink = (slot: string) => {
                    const cfg = assets.imageConfig?.[slot];
                    return cfg?.useForBlink !== false;
                };

                const canLipSync = (slot: string) => {
                    const cfg = assets.imageConfig?.[slot];
                    return cfg?.useForLipSync !== false;
                };

                // Priority Logic for 6-Slots (Updated for Sleep)
                // 1. High Priority Overrides (Blinking usually overrides everything else to act as a blink)
                // Check if blinking requested AND slot exists AND config allows it
                if (blinking && assets.eyesClosed && canBlink('eyesClosed')) {
                    path = assets.eyesClosed;
                }
                // 2. Speaking
                else if (state.speaking && assets.mouthOpen && canLipSync('mouthOpen')) {
                    path = assets.mouthOpen;
                }
                // 4. Explicit Idle States (if defined)
                else if (!state.speaking && assets.mouthClosed) {
                    path = assets.mouthClosed;
                }
                else if (!blinking && assets.eyesOpen) {
                    path = assets.eyesOpen;
                }
                // 5. Fallback
                else {
                    path = assets.base;
                }

                if (path) {
                    // 1a. Check Blob Map (Local Override)
                    // We assume 'path' in modelDef is just the filename for local assets
                    const filename = path.split('/').pop() || path;
                    if (this.blobMap[filename]) {
                        return this.blobMap[filename];
                    }

                    // 1b. Standard Server Path
                    // Combine with assetsRoot.
                    if (!path.startsWith('http') && !path.startsWith('/') && !path.startsWith('./')) {
                        const root = this.modelDef.assetsRoot || '';
                        const sep = root.endsWith('/') ? '' : '/';
                        return `${root}${sep}${path}`;
                    }
                    return path;
                }

                // Task 44: If mapping exists but no path resolved (e.g. empty/unused),
                // do NOT fallback to legacy. Return empty to signal "no image".
                return "";
            }
        }

        // 2. Fallback to legacy logic
        const emotion = state.emotion || this.config.defaultEmotion;
        // Legacy Blinking Logic: If we only have suffixes, blinking usually means "closed" + maybe different file?
        // For legacy, we might just ignore blinking or map it to silentSuffix if we really had to,
        // but typically legacy only handled mouth. Let's keep mouth logic only for legacy.

        // If explicitly blinking requested in legacy mode, we might not have a distinct image.
        // However, user requirement says to enable blink configuration.
        // So legacy fallback is just for the old file structure.

        const suffix = state.speaking ? this.config.talkingSuffix : this.config.silentSuffix;
        return `${this.config.basePath}/${emotion}${suffix}${this.config.fileExtension}`;
    }
}
