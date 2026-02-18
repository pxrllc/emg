
import JSZip from 'jszip';
import type { EmgAvatar, EmgStates } from '../types/schema';

export interface LoadedProject {
    avatar: EmgAvatar;
    states: EmgStates;
    assets: Map<string, string>; // path -> blobUrl
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

            // Force visibility and opacity for Web Runtime (User Request)
            if (avatar.layers) {
                avatar.layers.forEach(layer => {
                    layer.visible = true;
                    layer.opacity = 1.0;
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

            // 3. Load Assets (Textures)
            const assets = new Map<string, string>();
            // Collect all texture paths
            // From avatar.textures
            const texturePaths = new Set<string>();
            if (avatar.textures) {
                avatar.textures.forEach(t => texturePaths.add(t.src));
            }
            // Also check old schema if textures array missing? v0.2.2 has it.

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

            return { avatar, states, assets };

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
            assets: new Map(project.assets) // Shallow clone map (values are strings/urls, so safe)
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
            assets: new Map()
        };
    }
}

export const projectLoader = new ProjectLoader();
