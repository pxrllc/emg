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

---

# 日本語訳 (Japanese Translation)

## EMG プレイヤー仕様書

このドキュメントでは、EMG-Lite Viewer アプリケーションの挙動と機能について説明します。

## コアステート (Core State)
Viewer は `EMGLiteState` オブジェクトによって駆動されます。

```typescript
interface EMGLiteState {
    emotion: string;    // 感情 (例: 'neutral', 'joy')
    activity: string;   // 行動 (例: 'idle', 'wave')
    speaking: boolean;  // 発話状態 (true = 開口, false = 閉口)
    intensity: number;  // 強度 0.0 ～ 1.0 (将来的な補間用に予約)
}
```

## 機能

### 1. デモモード (Demo Mode)
-   **目的**: モデルアセットの自動プレビュー。
-   **挙動**:
    -   **ポーズ変更**: 約 2.5 秒ごとに、ロードされたモデルから有効な `Activity.Emotion` の組み合わせをランダムに選択して切り替えます。
    -   **口パクアニメーション ("Pakupaku")**:
        -   各ポーズ変更時に、50% の確率で「おしゃべりモード」に入ります。
        -   おしゃべりモード中は、会話をシミュレートするために `speaking` ステートが **150ms** ごとに Open/Closed を繰り返します。

### 2. オーディオリップシンク (Audio Lip Sync)
-   **目的**: リアルタイムのマイク入力を使用してキャラクターの口の動きを制御します。
-   **コントロール**:
    -   **デバイス選択 (Device Selection)**: 入力マイクを選択します。
    -   **閾値 (Threshold)**: 「開口」状態をトリガーするために必要な音量レベル (0.0 - 1.0)。
-   **ロジック**:
    -   Web Audio API (`AnalyserNode`) を使用して音声を解析します。
    -   RMS音量 > 閾値 の場合 -> `state.speaking = true`。
    -   それ以外 -> `state.speaking = false`。
    -   この機能が有効な間は、手動の Speaking チェックボックスの設定よりもマイク入力が優先されます。

### 3. アセット解決 (Asset Resolution)
プレイヤーは以下の要素を組み合わせて最終的な画像パスを決定します。

1.  **Assets Root**: ロードされた JSON モデルで定義されたルートパス。
2.  **Resolved Slot**: 5スロット優先順位ロジック（[モデル仕様書](./model_spec.md)参照）によって選択されたファイル名。

例: `assetsRoot: "/assets/char/"` + `mouthOpen: "talk.png"` -> 結果: `/assets/char/talk.png`
