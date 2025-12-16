# EMG Player Specification

This document describes the behavior and features of the EMG-Lite Viewer application.

## Core State
The viewer is driven by the `EMGLiteState` object:

```typescript
interface EMGLiteState {
    emotion: string;    // e.g., 'neutral', 'joy'
    activity: string;   // e.g., 'idle', 'wave'
    speaking: boolean;  // true = mouth open, false = mouth closed
    intensity: number;  // 0.0 to 1.0 (Reserved for future interpolation)
}
```

## Features

### 1. Demo Mode
-   **Purpose**: Autonomous preview of model assets.
-   **Behavior**:
    -   **Pose Change**: Every ~2.5 seconds, randomly selects a valid `Activity.Emotion` combination from the loaded model.
    -   **Mouth Animation ("Pakupaku")**:
        -   In each pose, there is a 50% chance the character enters "Chattering Mode".
        -   If Chattering, `speaking` state toggles Open/Closed every **150ms** to simulate talking interaction.

### 2. Audio Lip Sync
-   **Purpose**: Drive character mouth movement using real-time microphone input.
-   **Controls**:
    -   **Device Selection**: Choose input microphone.
    -   **Threshold**: Volume level (0.0 - 1.0) required to trigger "Open Mouth" state.
-   **Logic**:
    -   Audio is analyzed using Web Audio API (`AnalyserNode`).
    -   If RMS Volume > Threshold -> `state.speaking = true`.
    -   Else -> `state.speaking = false`.
    -   This overrides manual Speaking checkbox while active.

### 3. Asset Resolution
The player resolves the final image path by combining:
1.  **Assets Root**: Defined in the loaded JSON Model.
2.  **Resolved Slot**: The filename chosen by the 5-Slot Priority Logic (see [Model Spec](./model_spec.md)).

Example: `assetsRoot: "/assets/char/"` + `mouthOpen: "talk.png"` -> Result: `/assets/char/talk.png`.
