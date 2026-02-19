
// --- avatar.json ---

export interface EmgAvatar {
    version: string;
    name?: string; // Project Name
    width: number;
    height: number;
    parts: EmgPart[];
    textures: EmgTexture[];
    layers: EmgLayer[];
    sprites: EmgSprite[]; // Legacy/Unity compatibility, might not be used in runtime v0.1 heavily if states.json is primary
}

export interface EmgPart {
    partID: string;
    type: 'static' | 'switch';
    default?: string; // textureID for initial state
    layers?: EmgPartLayer[]; // v0.2.2 Nested Layers
}

export interface EmgPartLayer {
    layerID?: string; // might be missing or optional in sub-layer?
    textureID: string;
    textureFile?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    basePosition_x?: number;
    basePosition_y?: number;
    textureZIndex?: number;
    opacity?: number;
    blendMode?: string;
    // ... mapped to EmgLayer during load
}

export interface EmgTexture {
    id?: string; // "0", "1"... (Optional if using textureFile mapping)
    src?: string; // Filename in zip (Spec)
    textureFile?: string; // Filename in zip (Packer v0.2.2 output)
    width: number;
    height: number;
    // Runtime internal: Blob URL after loading
    blobUrl?: string;
}

export interface EmgLayer {
    layerID: string;
    partID: string;
    textureID: string;
    x: number; // Atlas X
    y: number; // Atlas Y
    width: number;
    height: number;
    // Normalized UVs are computed in runtime or provided? Spec says pixel coords in `x,y,w,h`
    // We can use x,y,w,h to draw from atlas

    // Canvas placement
    // Spec might have different names. Checking json-spec.md...
    // spec says: basePosition_x, basePosition_y.
    // Let's stick to the JSON we generated in Packer: x, y (Canvas coords in Packer vs Atlas coords)
    // Wait, Packer's `EmgLayer` had `uv` and `x,y` (Canvas position).
    // Let's strictly follow the latest Packer output structure for now, but keep in mind the Spec.

    // Based on Packer source `EmgGenerator.ts`:
    // x, y: Canvas Position (Top-Left)
    // uv: { u, v, w, h } Normalized
    // opacity, blendMode, visible, zIndex

    uv?: {
        u: number; v: number; w: number; h: number;
    };
    // Pixel-based Atlas Coords (Alternative to UV)
    srcX?: number;
    srcY?: number;
    srcWidth?: number;
    srcHeight?: number;
    opacity: number;
    blendMode: string;
    visible: boolean;
    zIndex: number;
}

export interface EmgSprite {
    // Legacy / Unity animation definitions
    spriteID: string;
    targetPartID: string;
    fps: number;
    sequence: {
        type: 'ordered' | 'random_hold';
        frames: string[];
    };
    trigger?: {
        type: 'auto_loop' | 'random_interval' | 'external';
        intervalMin?: number;
        intervalMax?: number;
    };
}

// --- states.json (EMG Web Runtime Specific Extension) ---

export interface EmgStates {
    version: string;
    defaultState: string;
    states: EmgState[];
}

export interface EmgState {
    name: string; // "neutral", "talk", "happy"...
    properties?: {
        blink?: {
            enabled: boolean;
            intervalMin: number;
            intervalMax: number;
            duration: number; // closed time
        };
        animation?: {
            restartOnStateEnter: boolean;
        };
    };
    trigger?: {
        type: 'key';
        key: string;
        mode?: 'toggle' | 'hold';
    };
    variants: EmgVariant[];
}

export interface EmgVariant {
    tags: {
        [key: string]: string; // "mouth": "open", "eyes": "blink"
    };
    // Which textureIDs to apply for this variant
    // Key: PartID, Value: TextureID
    overrides: {
        [partID: string]: string;
    };
}
