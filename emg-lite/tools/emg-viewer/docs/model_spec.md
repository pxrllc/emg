# EMG Model Specification

This document describes the structure of the JSON model definition used by EMG-Lite.

## JSON Structure

The model is defined by a single JSON object with the following top-level properties:

```json
{
  "assetsRoot": "./",           // Path to assets directory (relative to JSON or absolute)
  "mapping": { ... }           // Dictionary of State-to-Assets mappings
}
```

### 1. Assets Root (`assetsRoot`)
-   **Type**: `string`
-   **Default**: `./`
-   **Description**: The base path where image files are located.
    -   If the JSON and images are in the same folder, use `./`.
    -   If images are in a subdirectory, use `/assets/character_name/`.
    -   The application resolves image paths by prepending this root to the filenames defined in `mapping`.

### 2. Mapping (`mapping`)
-   **Type**: `Object<string, AssetGroup>`
-   **Key Format**: `[Activity].[Emotion]` (e.g., `idle.neutral`, `talking.joy`)
    -   **Activity**: Top-level state (e.g., `idle`, `pointing`).
    -   **Emotion**: Facial expression (e.g., `neutral`, `happy`, `sad`).

#### AssetGroup Structure (5-Slot System)
Each mapping key points to an object defining up to 5 image slots for granular control:

```json
{
  "base": "base.png",                   // [Required] Fallback / Default Body
  "mouthOpen": "mouth_open.png",        // [Optional] Used when speaking=true
  "mouthClosed": "mouth_closed.png",    // [Optional] Used when speaking=false (Explicit override)
  "eyesOpen": "eyes_open.png",          // [Optional] Used when blinking=false (Explicit override)
  "eyesClosed": "eyes_closed.png",      // [Optional] Used when blinking=true
  "mouthOpenEyesClosed": "combo.png",   // [Optional] Composite for Speaking + Blinking simultaneously
  "imageConfig": { ... }                // [Optional] Behavior flags
}
```

-   **Priority Logic**:
    1.  **Composite**: If `speaking` AND `blinking` AND `mouthOpenEyesClosed` is defined -> Use Composite.
    2.  **Blinking**: If `blinking` AND `eyesClosed` defined -> Use `eyesClosed`.
    3.  **Speaking**: If `speaking` AND `mouthOpen` defined -> Use `mouthOpen`.
    4.  **Defined Idle**: If `!speaking` AND `mouthClosed` defined -> Use `mouthClosed`.
    5.  **Fallback**: Use `base`.

### 3. Image Configuration (`imageConfig`)
Allows disabling specific automatic behaviors for certain slots.

```json
"imageConfig": {
  "mouthOpen": {
    "useForLipSync": true,  // Default: true. If false, this image won't be triggered by LipSync.
    "useForBlink": true     // Default: true. If false, blinking won't happen while this image is active.
  }
}
```
