
import { useState, useCallback } from 'react';

interface HistoryState<T> {
    past: T[];
    present: T | null;
    future: T[];
}

export function useUndo<T>(initialState: T | null) {
    const [state, setState] = useState<HistoryState<T>>({
        past: [],
        present: initialState,
        future: []
    });

    const set = useCallback((newPresent: T) => {
        setState(curr => {
            const { past, present } = curr;
            // Limit history
            const newPast = [...past, present as T];
            if (newPast.length > 50) newPast.shift();

            return {
                past: newPast,
                present: newPresent,
                future: []
            };
        });
    }, []);

    const undo = useCallback(() => {
        setState(curr => {
            const { past, present, future } = curr;
            if (past.length === 0) return curr;

            const previous = past[past.length - 1];
            const newPast = past.slice(0, past.length - 1);

            return {
                past: newPast,
                present: previous,
                future: [present as T, ...future]
            };
        });
    }, []);

    const redo = useCallback(() => {
        setState(curr => {
            const { past, present, future } = curr;
            if (future.length === 0) return curr;

            const next = future[0];
            const newFuture = future.slice(1);

            return {
                past: [...past, present as T],
                present: next,
                future: newFuture
            };
        });
    }, []);

    const canUndo = state.past.length > 0;
    const canRedo = state.future.length > 0;

    return [state.present, set, undo, redo, canUndo, canRedo] as const;
}
