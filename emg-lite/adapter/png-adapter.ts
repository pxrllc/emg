import { EMGLiteState } from '../types';

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

    constructor(config: PngAdapterConfig) {
        this.config = {
            fileExtension: '.png',
            talkingSuffix: '_open',
            silentSuffix: '_closed',
            defaultEmotion: 'neutral',
            ...config,
        };
    }

    /**
     * Resolve the image path for the given state
     * @param state Current EMG Lite state
     * @returns Relative path to the image file
     */
    public resolveImage(state: EMGLiteState): string {
        const emotion = state.emotion || this.config.defaultEmotion;
        const suffix = state.speaking ? this.config.talkingSuffix : this.config.silentSuffix;

        // Construct filename: <emotion><suffix>.<ext>
        // Example: neutral_open.png
        return `${this.config.basePath}/${emotion}${suffix}${this.config.fileExtension}`;
    }
}
