
import type { EmgStates, EmgState, EmgVariant, EmgSemanticMapping, EmgPart } from '../types/schema';
import { resolvePartType, frameId } from './EmgCompat';

interface StateContext {
    currentStateName: string;
    currentTags: { [key: string]: string }; // "mouth": "open", "eyes": "blink"
}

// mapping.json (v0.3.0+) role/state resolution keywords. See emg-mapping-spec.md.
const BLINK_KEYWORDS = ['eye', 'eyes', 'eyelid', 'blink', '目'];
const MOUTH_KEYWORDS = ['mouth', 'lip', 'viseme', '口'];

type BlinkState = 'open' | 'half' | 'closed';
type Viseme = 'a' | 'i' | 'u' | 'e' | 'o' | 'n';

interface MappingRuntimeState {
    blinkPartID: string | null;
    blinkExplicit: boolean;
    mouthPartID: string | null;
    mouthExplicit: boolean;
    currentExpression: string;
    activeBlinkOverride: { open: string; half: string; closed: string } | null;
    activeLipSyncOverride: { a: string; i: string; u: string; e: string; o: string; n: string } | null;
    blinkState: BlinkState | null;
    viseme: Viseme | null;
}

export class EmgStateMachine {
    private states: Map<string, EmgState> = new Map();
    private defaultStateName: string = 'neutral';

    private context: StateContext = {
        currentStateName: 'neutral',
        currentTags: {}
    };

    // --- mapping.json (v0.3.0+) support ---
    private mapping: EmgSemanticMapping | undefined;
    private parts: EmgPart[] = [];
    private mappingRuntime: MappingRuntimeState = {
        blinkPartID: null,
        blinkExplicit: false,
        mouthPartID: null,
        mouthExplicit: false,
        currentExpression: 'default',
        activeBlinkOverride: null,
        activeLipSyncOverride: null,
        blinkState: null,
        viseme: null
    };
    private mappingOverrides: { [partID: string]: string } = {};

    constructor(data: EmgStates) {
        this.load(data);
    }

    load(data: EmgStates) {
        this.states.clear();
        data.states.forEach(s => this.states.set(s.name, s));
        this.defaultStateName = data.defaultState || 'neutral';
        this.context.currentStateName = this.defaultStateName;
    }

    // --- State Management ---

    transition(stateName: string) {
        if (this.states.has(stateName)) {
            this.context.currentStateName = stateName;
            // Handle `restartOnStateEnter` here if needed? Or just let renderer handle it.
        } else {
            console.warn(`State not found: ${stateName}`);
        }
    }

    getCurrentState(): EmgState | undefined {
        return this.states.get(this.context.currentStateName);
    }

    // --- Input Handling ---

    updateTags(tags: { [key: string]: string }) {
        // Merge tags
        this.context.currentTags = { ...this.context.currentTags, ...tags };
    }

    // --- mapping.json (v0.3.0+) API ---
    // Ports the resolution logic of emg-cdn/emg-player.0.3.0.js (resolvePartRoles / applyBlinkState /
    // applyViseme / applyExpression) onto this app's overrides[partID] = layerID model, so resolveVariant()
    // transparently reflects mapping-driven state without new rendering paths in EmgCanvas.

    loadMapping(mapping: EmgSemanticMapping | undefined, parts: EmgPart[] = []) {
        this.mapping = mapping;
        this.parts = parts;
        this.mappingRuntime.currentExpression = 'default';
        this.mappingRuntime.activeBlinkOverride = null;
        this.mappingRuntime.activeLipSyncOverride = null;
        this.mappingRuntime.blinkState = null;
        this.mappingRuntime.viseme = null;
        this.resolvePartRoles();
        this.recomputeMappingOverrides();
    }

    setBlinkState(state: BlinkState) {
        this.mappingRuntime.blinkState = state;
        this.recomputeMappingOverrides();
    }

    setViseme(vowel: Viseme) {
        this.mappingRuntime.viseme = vowel;
        this.recomputeMappingOverrides();
    }

    setExpression(name: string) {
        const expressions = this.mapping?.expressions || {};
        this.mappingRuntime.currentExpression = expressions[name] ? name : 'default';
        const expr = expressions[this.mappingRuntime.currentExpression] || {};
        this.mappingRuntime.activeBlinkOverride = expr.overrides?.blink || null;
        this.mappingRuntime.activeLipSyncOverride = expr.overrides?.lipSync || null;
        this.recomputeMappingOverrides();
    }

    private findPartByKeyword(keywords: string[]): EmgPart | undefined {
        return this.parts.find(part =>
            resolvePartType(part) === 'switch' &&
            keywords.some(kw => part.partID.toLowerCase().includes(kw.toLowerCase()))
        );
    }

    private findPart(partID: string): EmgPart | undefined {
        return this.parts.find(p => p.partID === partID);
    }

    // Resolves a blink/lipSync/expression id to the frame identifier that EmgCanvas
    // expects in overrides[partID].
    //
    // v0.5.0 §1.2: mapping.json の参照はフレーム識別子で解決される。frameName を
    // 持たないファイルでは textureID と同一なので、従来の値もそのまま通る。
    // layerID での一致も許すのは、UI が保存した値が渡ってくる経路があるため。
    private resolveLayerId(partID: string, idValue: string): string {
        const part = this.findPart(partID);
        const layer = part?.layers?.find(l =>
            frameId(l) === idValue || l.layerID === idValue || l.textureID === idValue);
        return layer ? frameId(layer) : idValue;
    }

    private resolvePartRoles() {
        let blinkPartID: string | null = null;
        let blinkExplicit = false;
        let mouthPartID: string | null = null;
        let mouthExplicit = false;

        const base = this.mapping?.baseMapping;
        if (base) {
            // 1. blinkParts (flat mode)
            if (base.blinkParts) {
                const targets = Object.values(base.blinkParts).filter(Boolean) as string[];
                const found = this.parts.find(p => targets.includes(p.partID));
                if (found) { blinkPartID = found.partID; blinkExplicit = true; }
            }
            // 2. blinkPartKey
            if (!blinkPartID && base.blinkPartKey) {
                const found = this.parts.find(p => p.partID === base.blinkPartKey);
                if (found) { blinkPartID = found.partID; blinkExplicit = true; }
            }

            if (base.lipSyncParts) {
                const targets = Object.values(base.lipSyncParts).filter(Boolean) as string[];
                const found = this.parts.find(p => targets.includes(p.partID));
                if (found) { mouthPartID = found.partID; mouthExplicit = true; }
            }
            if (!mouthPartID && base.lipSyncPartKey) {
                const found = this.parts.find(p => p.partID === base.lipSyncPartKey);
                if (found) { mouthPartID = found.partID; mouthExplicit = true; }
            }
        }

        // 3/4. Heuristic keyword fallback (not explicit)
        if (!blinkPartID) {
            const found = this.findPartByKeyword(BLINK_KEYWORDS);
            if (found) blinkPartID = found.partID;
        }
        if (!mouthPartID) {
            const found = this.findPartByKeyword(MOUTH_KEYWORDS);
            if (found) mouthPartID = found.partID;
        }

        // 5. Mouth wins if both roles resolved to the same part
        if (blinkPartID && blinkPartID === mouthPartID) {
            blinkPartID = null;
            blinkExplicit = false;
        }

        this.mappingRuntime.blinkPartID = blinkPartID;
        this.mappingRuntime.blinkExplicit = blinkExplicit;
        this.mappingRuntime.mouthPartID = mouthPartID;
        this.mappingRuntime.mouthExplicit = mouthExplicit;
    }

    private applyBlinkOverrides(overrides: { [partID: string]: string }) {
        const base = this.mapping?.baseMapping;
        const partID = this.mappingRuntime.blinkPartID;
        const state = this.mappingRuntime.blinkState;
        if (!base || !partID || !state) return;

        const part = this.findPart(partID);

        // Expression-specific override takes priority
        const override = this.mappingRuntime.activeBlinkOverride;
        if (override && override[state]) {
            overrides[partID] = this.resolveLayerId(partID, override[state]);
            return;
        }

        if (base.blinkParts) {
            // Flat mode: show only the part matching the current state, hide the others
            const targetPartID = base.blinkParts[state];
            Object.values(base.blinkParts).filter(Boolean).forEach(pid => {
                if (pid !== targetPartID) overrides[pid as string] = '__HIDDEN__';
            });
            return;
        }

        if (base.blink && base.blink[state]) {
            overrides[partID] = this.resolveLayerId(partID, base.blink[state]);
            return;
        }

        // Known limitation: positional fallback only makes sense for exactly 3-layer parts
        if (part && part.layers && part.layers.length === 3) {
            const order: Record<BlinkState, number> = { open: 0, half: 1, closed: 2 };
            const layer = part.layers[order[state]];
            if (layer) overrides[partID] = layer.layerID || layer.textureID;
        }
    }

    private applyLipSyncOverrides(overrides: { [partID: string]: string }) {
        const base = this.mapping?.baseMapping;
        const partID = this.mappingRuntime.mouthPartID;
        const vowel = this.mappingRuntime.viseme;
        if (!base || !partID || !vowel) return;

        const part = this.findPart(partID);

        const override = this.mappingRuntime.activeLipSyncOverride;
        if (override && override[vowel]) {
            overrides[partID] = this.resolveLayerId(partID, override[vowel]);
            return;
        }

        if (base.lipSyncParts) {
            const targetPartID = base.lipSyncParts[vowel];
            Object.values(base.lipSyncParts).filter(Boolean).forEach(pid => {
                if (pid !== targetPartID) overrides[pid as string] = '__HIDDEN__';
            });
            return;
        }

        let textureID = base.lipSync?.[vowel] || base.lipSync?.open || null;

        if (!textureID && part?.layers) {
            const found = part.layers.find(l => l.textureID.toLowerCase().includes(vowel));
            if (found) textureID = found.textureID;
        }
        if (!textureID && part) {
            textureID = part.default || part.layers?.[0]?.textureID || null;
        }

        if (textureID) overrides[partID] = this.resolveLayerId(partID, textureID);
    }

    private applyExpressionOverrides(overrides: { [partID: string]: string }) {
        const expressions = this.mapping?.expressions || {};
        const expr = expressions[this.mappingRuntime.currentExpression] || expressions['default'] || {};

        if (expr.parts) {
            Object.entries(expr.parts).forEach(([partID, layerIDs]) => {
                if (!Array.isArray(layerIDs) || layerIDs.length === 0) return;
                // Known limitation: this app's switch-part model only supports a single active
                // layer per part, so only the first entry of a multi-layer expression is used.
                overrides[partID] = this.resolveLayerId(partID, layerIDs[0]);
            });
        }

        if (expr.eyebrow) {
            overrides['eyebrow'] = this.resolveLayerId('eyebrow', expr.eyebrow);
        }

        if (Array.isArray(expr.other)) {
            expr.other.forEach(layerID => {
                const part = this.parts.find(p => p.layers?.some(l => l.layerID === layerID || l.textureID === layerID));
                if (part) overrides[part.partID] = this.resolveLayerId(part.partID, layerID);
            });
        }
    }

    private recomputeMappingOverrides() {
        const overrides: { [partID: string]: string } = {};
        if (this.mapping) {
            this.applyExpressionOverrides(overrides);
            this.applyBlinkOverrides(overrides);
            this.applyLipSyncOverrides(overrides);
        }
        this.mappingOverrides = overrides;

        // NOTE: sprites[] auto-play is not implemented in emg-web-runtime yet. If/when it is,
        // it must not auto-trigger a sprites[] entry whose targetPartID equals blinkPartID/mouthPartID
        // while blinkExplicit/mouthExplicit is true, per the mapping.json/sprites[] coexistence rule
        // in emg-mapping-spec.md.
    }

    private mergeMappingOverrides(variant: EmgVariant): EmgVariant {
        if (Object.keys(this.mappingOverrides).length === 0) return variant;
        return {
            tags: variant.tags,
            overrides: { ...variant.overrides, ...this.mappingOverrides }
        };
    }

    // --- Variant Selection Logic (Selector) ---

    /**
     * Finds the best matching variant for the current state and tags.
     */
    resolveVariant(): EmgVariant | null {
        const state = this.getCurrentState();
        if (!state) return null;

        let variant: EmgVariant | undefined;

        // 1. Exact Match
        variant = state.variants.find(v => this.isMatch(v.tags, this.context.currentTags));

        // 2. Fallback Rules
        // Priority: Mouth > Eyes (as per requirement)
        // If "mouth" is crucial, try to match mouth first, ignoring eyes.

        // Try strict match on "mouth" (if present in variant), ignore others
        if (!variant && this.context.currentTags['mouth']) {
            variant = state.variants.find(v =>
                v.tags['mouth'] === this.context.currentTags['mouth']
                // And ideally ignoring others, or minimizing mismatch distance?
                // Requirement says: "Partial Match (ignore eyes) -> Use"
            );
        }

        // Try strict match on "eyes" (if present in variant), ignore others
        if (!variant && this.context.currentTags['eyes']) {
            variant = state.variants.find(v =>
                v.tags['eyes'] === this.context.currentTags['eyes']
            );
        }

        // 3. Default (No tags / Empty tags variant)
        if (!variant) {
            variant = state.variants.find(v => Object.keys(v.tags).length === 0);
        }

        // 4. Any variant (First one)
        if (!variant && state.variants.length > 0) {
            variant = state.variants[0];
        }

        if (!variant) return null;
        return this.mergeMappingOverrides(variant);
    }

    private isMatch(variantTags: { [key: string]: string }, currentTags: { [key: string]: string }): boolean {
        for (const key in variantTags) {
            if (variantTags[key] !== currentTags[key]) return false;
        }
        return true;
    }
}
