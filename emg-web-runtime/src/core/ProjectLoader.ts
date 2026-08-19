
import JSZip from 'jszip';
import type { EmgAvatar, EmgStates, EmgSemanticMapping } from '../types/schema';

export interface LoadedProject {
    avatar: EmgAvatar;
    states: EmgStates;
    assets: Map<string, string>; // path -> blobUrl
    mapping?: EmgSemanticMapping; // mapping.json (v0.3.0+, optional)
}

class ProjectLoader {
    async load(file: File): Promise<LoadedProject> {
        const zip = new JSZip();
        try {
            const content = await zip.loadAsync(file);
            const fileName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension

            // 1. Load avatar.json
            const avatarFile = content.file('avatar.json') || content.file('data.json'); // Support both for now? data.json is v0.2.2 standard in packer.
            // Let's assume standard is data.json for now based on Packer implementation, or check both.
            // Requirement says "avatar.json", but Packer output "data.json". 
            // We should support "data.json" as primary if coming from Packer.

            let avatarJsonStr: string | undefined;
            if (avatarFile) {
                avatarJsonStr = await avatarFile.async('string');
            } else {
                const dataFile = content.file('data.json');
                if (dataFile) avatarJsonStr = await dataFile.async('string');
            }

            if (!avatarJsonStr) throw new Error('avatar.json (or data.json) not found in ZIP.');
            const avatar: EmgAvatar = JSON.parse(avatarJsonStr);

            // Set Name if missing (from filename)
            if (!avatar.name) {
                avatar.name = fileName;
            }

            // 1.5. Polyfill / Migration for v0.2.2 (Parts-based structure)
            if (!avatar.layers || avatar.layers.length === 0) {
                // Flatten layers from parts
                const flattenedLayers: any[] = [];
                if (avatar.parts) {
                    avatar.parts.forEach(part => {
                        if (part.layers) {
                            part.layers.forEach((l: any) => {
                                // Ensure standard properties
                                l.partID = l.partID || part.partID;
                                // Ensure layerID exists (for React keys and selection)
                                if (!l.layerID) {
                                    l.layerID = l.textureID || `${part.partID}_${l.zIndex || 0}`;
                                }
                                // Map textureZIndex -> zIndex if missing
                                if (l.zIndex === undefined && l.textureZIndex !== undefined) {
                                    l.zIndex = l.textureZIndex;
                                }
                                // Map Packer Coords to Runtime Coords
                                // Packer: x,y=Atlas, basePosition=Canvas
                                // Runtime: srcX,srcY=Atlas, x,y=Canvas

                                // 1. Save Atlas Coords
                                if (l.srcX === undefined) l.srcX = l.x;
                                if (l.srcY === undefined) l.srcY = l.y;
                                if (l.srcWidth === undefined) l.srcWidth = l.width;
                                if (l.srcHeight === undefined) l.srcHeight = l.height;

                                // 2. Map Canvas Coords
                                if (l.basePosition_x !== undefined) l.x = l.basePosition_x;
                                if (l.basePosition_y !== undefined) l.y = l.basePosition_y;

                                // If basePosition is missing (legacy?), keep l.x as canvas x (dangerous if it was atlas x)
                                // But Packer v0.2.2 always outputs basePosition.

                                flattenedLayers.push(l);
                            });
                        }
                    });
                }
                avatar.layers = flattenedLayers;
            }

            // Force visibility and opacity for Web Runtime (User Request)
            if (avatar.layers) {
                avatar.layers.forEach(layer => {
                    // Ensure zIndex exists
                    if (layer.zIndex === undefined && (layer as any).textureZIndex !== undefined) {
                        layer.zIndex = (layer as any).textureZIndex;
                    }
                    if (layer.visible === undefined) layer.visible = true;
                    if (layer.opacity === undefined) layer.opacity = 1.0;
                });
            }

            // 2. Load states.json (Optional in some contexts, but mandatory for Runtime v0.1 functionality?)
            // If missing, generate defaults? Requirement says "states.json (mandatory)".
            // But Packer might not export it yet.
            // Verification: "Import Project... generates default if missing?"
            // Requirement says "states.json (mandatory)".
            // However, Packer doesn't generate it yet. We might need to generate a default one in-memory if missing for v0.1 dev testing.

            let states: EmgStates;
            const statesFile = content.file('states.json');
            if (statesFile) {
                const statesJsonStr = await statesFile.async('string');
                states = JSON.parse(statesJsonStr);
            } else {
                console.warn('states.json not found. Generating default states.');
                states = this.generateDefaultStates();
            }

            // PATCH: Add default key triggers if missing (for legacy/imported projects)
            const defaultTriggers: Record<string, string> = {
                'neutral': '1',
                'joy': '2',
                'angry': '3',
                'sorrow': '4'
            };

            states.states.forEach(s => {
                if (!s.trigger && defaultTriggers[s.name]) {
                    s.trigger = {
                        type: 'key',
                        key: defaultTriggers[s.name],
                        mode: 'toggle'
                    };
                }
            });

            // 2.5. Load mapping.json (Optional companion file, v0.3.0+)
            let mapping: EmgSemanticMapping | undefined;
            const mappingFile = content.file('mapping.json');
            if (mappingFile) {
                try {
                    const mappingJsonStr = await mappingFile.async('string');
                    mapping = JSON.parse(mappingJsonStr);
                } catch (e) {
                    console.warn('Failed to parse mapping.json, ignoring:', e);
                    mapping = undefined;
                }
            }

            // 3. Load Assets (Textures)
            const assets = new Map<string, string>();
            const texturePaths = new Set<string>();

            // 3a. Ensure Textures have IDs (Polyfill)
            if (avatar.textures) {
                avatar.textures.forEach((t, index) => {
                    const src = t.src || t.textureFile;
                    if (src) {
                        t.src = src; // Polyfill src for Runtime use
                        texturePaths.add(src);
                    } else {
                        console.warn('Texture definition missing src or textureFile:', t);
                    }
                    // Ensure ID exists
                    if (!t.id) {
                        t.id = index.toString();
                    }
                });
            }

            // 3b. Fix Layer TextureIDs (Polyfill for Packer v0.2.2)
            // Packer v0.2.2 sets layer.textureID = layerID, but we want it to point to the Texture (Atlas).
            // Current Packer only outputs 1 texture. So we map all to "0".
            if (avatar.layers && avatar.textures && avatar.textures.length > 0) {
                const availableTextureIds = new Set(avatar.textures.map(t => t.id));
                const defaultTextureId = avatar.textures[0].id; // "0"

                avatar.layers.forEach(l => {
                    // If layer references a non-existent texture, assume it belongs to the default atlas
                    if (!availableTextureIds.has(l.textureID)) {
                        l.textureID = defaultTextureId!;
                    }
                });
            }

            // Load blobs
            for (const path of texturePaths) {
                const file = content.file(path);
                if (file) {
                    const blob = await file.async('blob');
                    const url = URL.createObjectURL(blob);
                    assets.set(path, url);
                } else {
                    console.error(`Asset missing: ${path}`);
                }
            }

            return { avatar, states, assets, mapping };

        } catch (e) {
            console.error('Failed to load project:', e);
            throw e;
        }
    }

    private generateDefaultStates(): EmgStates {
        // Create 4 default states as requested
        const createVariant = () => ({
            tags: {},
            overrides: {}
        });

        return {
            version: '0.1.0',
            defaultState: 'neutral',
            states: [
                {
                    name: 'neutral',
                    variants: [createVariant()],
                    trigger: { type: 'key', key: '1', mode: 'toggle' }
                },
                {
                    name: 'joy',
                    variants: [createVariant()],
                    trigger: { type: 'key', key: '2', mode: 'toggle' }
                },
                {
                    name: 'angry',
                    variants: [createVariant()],
                    trigger: { type: 'key', key: '3', mode: 'toggle' }
                },
                {
                    name: 'sorrow',
                    variants: [createVariant()],
                    trigger: { type: 'key', key: '4', mode: 'toggle' }
                }
            ]
        };
    }

    clone(project: LoadedProject): LoadedProject {
        if (!project) return project;
        return {
            avatar: JSON.parse(JSON.stringify(project.avatar)), // Deep clone avatar
            states: JSON.parse(JSON.stringify(project.states)), // Deep clone states
            assets: new Map(project.assets), // Shallow clone map (values are strings/urls, so safe)
            mapping: project.mapping ? JSON.parse(JSON.stringify(project.mapping)) : undefined
        };
    }

    createEmptyProject(): LoadedProject {
        return {
            avatar: {
                version: '0.1.0',
                name: 'New Project',
                width: 1024,
                height: 1024,
                parts: [],
                layers: [],
                textures: [],
                sprites: []
            },
            states: this.generateDefaultStates(),
            assets: new Map(),
            mapping: undefined
        };
    }
}

export const projectLoader = new ProjectLoader();
