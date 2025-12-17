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

---

# 日本語訳 (Japanese Translation)

## EMG モデル仕様書

このドキュメントでは、EMG-Lite で使用される JSON モデル定義の構造について説明します。

## JSON 構造

モデルは、以下のトップレベルプロパティを持つ単一の JSON オブジェクトとして定義されます。

```json
{
  "assetsRoot": "./",           // アセットディレクトリのパス (JSONからの相対パス、または絶対パス)
  "mapping": { ... }           // 状態(State)とアセット(Assets)のマッピング辞書
}
```

### 1. アセットルート (`assetsRoot`)
-   **型**: `string`
-   **デフォルト**: `./`
-   **説明**: 画像ファイルが配置されているベースパスです。
    -   JSON と画像が同じフォルダにある場合は `./` を使用します。
    -   画像がサブディレクトリにある場合は `/assets/character_name/` のように指定します。
    -   アプリケーションは、`mapping` で定義されたファイル名にこのルートパスを結合して画像を読み込みます。

### 2. マッピング (`mapping`)
-   **型**: `Object<string, AssetGroup>`
-   **キー形式**: `[Activity].[Emotion]` (例: `idle.neutral`, `talking.joy`)
    -   **Activity**: 行動・動作 (例: `idle`=待機, `pointing`=指差し)。
    -   **Emotion**: 表情・感情 (例: `neutral`=通常, `happy`=笑顔, `sad`=悲しみ)。

#### アセットグループ構造 (5スロットシステム)
各マッピングキーは、きめ細かな制御のために最大5つの画像スロットを定義するオブジェクトを指します。

```json
{
  "base": "base.png",                   // [必須] フォールバック用 / 基本ボディ
  "mouthOpen": "mouth_open.png",        // [任意] speaking=true の時に使用 (開口)
  "mouthClosed": "mouth_closed.png",    // [任意] speaking=false の時に使用 (閉口・明示的指定)
  "eyesOpen": "eyes_open.png",          // [任意] blinking=false の時に使用 (開眼・明示的指定)
  "eyesClosed": "eyes_closed.png",      // [任意] blinking=true の時に使用 (閉眼)
  "mouthOpenEyesClosed": "combo.png",   // [任意] 話しながら瞬きした時の複合画像
  "imageConfig": { ... }                // [任意] 挙動制御フラグ
}
```

-   **優先順位ロジック (Priority Logic)**:
    1.  **複合 (Composite)**: `speaking` かつ `blinking` で、`mouthOpenEyesClosed` が定義されている場合 -> これを使用。
    2.  **瞬き (Blinking)**: `blinking` で、`eyesClosed` が定義されている場合 -> これを使用。
    3.  **発話 (Speaking)**: `speaking` で、`mouthOpen` が定義されている場合 -> これを使用。
    4.  **待機指定 (Defined Idle)**: `!speaking` で、`mouthClosed` が定義されている場合 -> これを使用。
    5.  **基本 (Fallback)**: 上記以外は `base` を使用。

### 3. 画像設定 (`imageConfig`)
特定のスロットに対して、自動的な挙動（リップシンクや瞬き）を無効化するために使用します。

```json
"imageConfig": {
  "mouthOpen": {
    "useForLipSync": true,  // デフォルト: true。falseの場合、マイク入力(LipSync)でこの画像には切り替わりません。
    "useForBlink": true     // デフォルト: true。falseの場合、この画像が表示されている間は自動瞬きが発生しません。
  }
}
```
