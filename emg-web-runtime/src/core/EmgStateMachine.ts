
import type { EmgStates, EmgState, EmgVariant } from '../types/schema';

interface StateContext {
    currentStateName: string;
    currentTags: { [key: string]: string }; // "mouth": "open", "eyes": "blink"
}

export class EmgStateMachine {
    private states: Map<string, EmgState> = new Map();
    private defaultStateName: string = 'neutral';

    private context: StateContext = {
        currentStateName: 'neutral',
        currentTags: {}
    };

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

    // --- Variant Selection Logic (Selector) ---

    /**
     * Finds the best matching variant for the current state and tags.
     */
    resolveVariant(): EmgVariant | null {
        const state = this.getCurrentState();
        if (!state) return null;

        // 1. Exact Match
        const exactMatch = state.variants.find(v => this.isMatch(v.tags, this.context.currentTags));
        if (exactMatch) return exactMatch;

        // 2. Fallback Rules
        // Priority: Mouth > Eyes (as per requirement)
        // If "mouth" is crucial, try to match mouth first, ignoring eyes.

        // Try strict match on "mouth" (if present in variant), ignore others
        if (this.context.currentTags['mouth']) {
            const mouthMatch = state.variants.find(v =>
                v.tags['mouth'] === this.context.currentTags['mouth']
                // And ideally ignoring others, or minimizing mismatch distance?
                // Requirement says: "Partial Match (ignore eyes) -> Use"
            );
            if (mouthMatch) return mouthMatch;
        }

        // Try strict match on "eyes" (if present in variant), ignore others
        if (this.context.currentTags['eyes']) {
            const eyesMatch = state.variants.find(v =>
                v.tags['eyes'] === this.context.currentTags['eyes']
            );
            if (eyesMatch) return eyesMatch;
        }

        // 3. Default (No tags / Empty tags variant)
        const defaultVariant = state.variants.find(v => Object.keys(v.tags).length === 0);
        if (defaultVariant) return defaultVariant;

        // 4. Any variant (First one)
        if (state.variants.length > 0) return state.variants[0];

        return null;
    }

    private isMatch(variantTags: { [key: string]: string }, currentTags: { [key: string]: string }): boolean {
        for (const key in variantTags) {
            if (variantTags[key] !== currentTags[key]) return false;
        }
        return true;
    }
}
