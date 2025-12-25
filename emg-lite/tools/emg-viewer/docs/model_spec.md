# EMG Model Specification

This document describes the structure of the JSON model definition used by EMG-Lite.

## JSON Structure

The model is defined by a single JSON object with the following top-level properties:

```json
{
  "schemaVersion": 1,          // [Optional] Schema/compatibility version
  "width": 1000,                // [Optional] Base Width (Canvas Size)
  "height": 1000,               // [Optional] Base Height (Canvas Size)
  "license": "CC0",             // [Optional] License Information
  "anchorX": 0.5,               // [Optional] Pivot X (0.0 - 1.0) Default: 0.5
  "anchorY": 0.5,               // [Optional] Pivot Y (0.0 - 1.0) Default: 0.5
  "assetsRoot": "./",           // Path to assets directory (relative to JSON or absolute)
  "mapping": { ... }           // Dictionary of State-to-Assets mappings
}
```

### 1. Global Properties
-   **width / height** (`number`):
    -   Optional. Represents the dimensions of the base image or intended canvas size.
    -   The `base` image size usually defines these values automatically if not set.
-   **license** (`string`):
    -   Optional. Text summarizing the license (e.g. "CC0", "MIT", "URL...").
-   **anchorX / anchorY** (`number`):
    -   Optional. Defaults to `0.5` (Center).
    -   Determines the pivot point for rendering and scaling. `(0,0)` is top-left, `(1,1)` is bottom-right.

### 2. Assets Root (`assetsRoot`)
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
    -   Implementations MAY ignore unknown activities/emotions; prefer a fallback entry like `idle.neutral`.

#### AssetGroup Structure (5-Slot System)
Each mapping key points to an object defining up to 5 image slots for granular control:

```json
{
  "base": "base.png",                   // [Required] Fallback / Default Body
  "mouthOpen": "mouth_open.png",        // [Optional] Used when speaking=true
  "mouthClosed": "mouth_closed.png",    // [Optional] Used when speaking=false (Explicit override)
  "eyesOpen": "eyes_open.png",          // [Optional] Used when blinking=false (Explicit override)
```json
{
  "base": "base.png",                   // [Required] Fallback / Default Body
  "mouthOpen": "mouth_open.png",        // [Optional] Used when speaking=true
  "mouthClosed": "mouth_closed.png",    // [Optional] Used when speaking=false (Explicit override)
  "eyesOpen": "eyes_open.png",          // [Optional] Used when blinking=false (Explicit override)
  "eyesClosed": "eyes_closed.png",      // [Optional] Used when blinking=true
  "isSleep": true,                      // [Optional] Mark this status as the "Sleep State"
  "imageConfig": { ... }                // [Optional] Behavior flags
}
```

-   **Priority Logic**:
    1.  **Sleep Mode**: If Viewer is in Sleep Mode (`state.sleep=true`), it looks for a mapping with `"isSleep": true` and uses that status.
    2.  **Blinking**: If `blinking` AND `eyesClosed` defined -> Use `eyesClosed`.
    3.  **Speaking**: If `speaking` AND `mouthOpen` defined -> Use `mouthOpen`.
    4.  **Defined Idle**: If `!speaking` AND `mouthClosed` defined -> Use `mouthClosed`.
    5.  **Fallback**: Use `base`.

#### Extended Slots (Optional, Backward-Compatible)
-   AssetGroup MAY contain additional slots beyond the 5 standard ones (e.g., `handPose`, `accessory`, `background`).
-   Unknown slot keys MUST be ignored safely by players that do not implement them.
-   A slot MAY carry viseme-specific filenames (e.g., `mouthShape_a`, `mouthShape_i`, ...). If none match, the standard `mouthOpen/mouthClosed` fallback applies.

#### Overlays
-   Each AssetGroup MAY define an `overlays` dictionary whose keys correspond to overlay IDs (strings) and values are filenames.
-   When `state.overlays` is present, the player resolves overlays in order and stacks them on top of the resolved base slot.

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
  "schemaVersion": 1,          // [任意] 互換性判定のためのスキーマバージョン
  "assetsRoot": "./",           // アセットディレクトリのパス (JSONからの相対パス、または絶対パス)
  "mapping": { ... }           // 状態(State)とアセット(Assets)のマッピング辞書
}
```

> **Note**: EMG-LiteのStatusは、主に表情差分を扱うことを想定しています。
> 衣装変更（着替え）を行いたい場合は、このJSON内で分岐させるのではなく、**別のEMGモデル（.emglファイル）を作成して切り替えること**を推奨します。

### 1. グローバルプロパティ (Global Properties)
-   **width / height** (`number`):
    -   任意。ベース画像の寸法、または意図するキャンバスサイズを表します。
    -   未設定の場合、通常は `base` 画像のサイズから自動的に決定されます。
-   **license** (`string`):
    -   任意。ライセンス情報のテキスト (例: "CC0", "MIT", "URL...")。
-   **anchorX / anchorY** (`number`):
    -   任意。デフォルトは `0.5` (中心) です。
    -   描画やスケーリングの基準点（ピボット）を決定します。`(0,0)` は左上、`(1,1)` は右下です。

### 2. アセットルート (`assetsRoot`)
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
    -   未知の activity/emotion は無視される可能性があるため、`idle.neutral` などのフォールバックを推奨。

#### アセットグループ構造 (5スロットシステム)
各マッピングキーは、きめ細かな制御のために最大5つの画像スロットを定義するオブジェクトを指します。

```json
{
  "base": "base.png",                   // [必須] フォールバック用 / 基本ボディ
  "mouthOpen": "mouth_open.png",        // [任意] speaking=true の時に使用 (開口)
  "mouthClosed": "mouth_closed.png",    // [任意] speaking=false の時に使用 (閉口・明示的指定)
  "eyesOpen": "eyes_open.png",          // [任意] blinking=false の時に使用 (開眼・明示的指定)
```json
{
  "base": "base.png",                   // [必須] フォールバック用 / 基本ボディ
  "mouthOpen": "mouth_open.png",        // [任意] speaking=true の時に使用 (開口)
  "mouthClosed": "mouth_closed.png",    // [任意] speaking=false の時に使用 (閉口・明示的指定)
  "eyesOpen": "eyes_open.png",          // [任意] blinking=false の時に使用 (開眼・明示的指定)
  "eyesClosed": "eyes_closed.png",      // [任意] blinking=true の時に使用 (閉眼)
  "isSleep": true,                      // [任意] このステートを「睡眠状態」としてマーク
  "imageConfig": { ... }                // [任意] 挙動制御フラグ
}
```

-   **優先順位ロジック (Priority Logic)**:
    1.  **睡眠 (Sleep Mode)**: ViewerがSleep Mode (`state.sleep=true`) の時、`"isSleep": true` となっているステートを検索して使用します。
    2.  **瞬き (Blinking)**: `blinking` で、`eyesClosed` が定義されている場合 -> これを使用。
    3.  **発話 (Speaking)**: `speaking` で、`mouthOpen` が定義されている場合 -> これを使用。
    4.  **待機指定 (Defined Idle)**: `!speaking` で、`mouthClosed` が定義されている場合 -> これを使用。
    5.  **基本 (Fallback)**: 上記以外は `base` を使用。

#### 拡張スロット（後方互換のオプション）
-   5スロット以外の任意キー（例: `handPose`, `accessory`, `background`）を追加可能。未対応プレイヤーは無視する。
-   音素別の口形状 (`mouthShape_a`, `mouthShape_i` など) を持たせてもよい。該当が無い場合は従来の `mouthOpen/mouthClosed` へフォールバック。

#### オーバーレイ
-   各 AssetGroup は `overlays` 辞書を持てる。キーはオーバーレイID（文字列）、値はファイル名。
-   `state.overlays` が与えられた場合、その順序でオーバーレイを解決し、基底スロットの上に合成する。

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
