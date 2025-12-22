/**
 * EMG-lite State Definition
 * アバターの現在の状態を表す内部表現
 */
export interface EMGLiteState {
    /**
     * 感情状態
     * @example 'neutral', 'joy', 'angry', 'sorrow', 'fun'
     */
    emotion: string;

    /**
     * 現在のアクティビティ
     * @example 'idle', 'working', 'gaming'
     */
    activity: string;

    /**
     * 発話中かどうか
     * リップシンクの簡易制御に使用
     */
    speaking: boolean;

    /**
     * 睡眠状態
     * trueの場合、優先的に睡眠表現（または閉眼）を使用
     */
    sleep?: boolean;

    /**
     * 感情や動作の強度 (0.0 - 1.0)
     * 表現の深さを制御するために予約
     */
    intensity: number;

    /**
     * まばたき状態 (Runtime only)
     */
    eyesClosed?: boolean;
}

/**
 * デフォルトの初期状態
 */
export const INITIAL_EMG_LITE_STATE: EMGLiteState = {
    emotion: 'neutral',
    activity: 'idle',
    speaking: false,
    sleep: false,
    intensity: 0.0,
};

export const EMG_ACTIVITY_PRESETS = [
    'idle',
    'talking',
    'working',
    'gaming',
    'smile',
    'eyes_closed_mouth_closed'
];

export const EMG_EMOTION_PRESETS = [
    'neutral',
    'joy',
    'angry',
    'sorrow',
    'fun'
];

/**
 * 画像アセットの定義セット
 */
export interface EMGVariantAssets {
    /** 基本画像 (目開け・口閉じ) - Fallback */
    base?: string;
    /** 口開け画像 (Speaking=true) */
    mouthOpen?: string;
    /** 口閉じ画像 (Speaking=false) - Explicit */
    mouthClosed?: string;
    /** 目閉じ画像 (Blinking=true) */
    eyesClosed?: string;
    /** 目開け画像 (Blinking=false) - Explicit */
    eyesOpen?: string;

    /** 目開け画像 (Blinking=false) - Explicit */
    eyesOpen?: string;

    /** 睡眠状態として使用するフラグ */
    isSleep?: boolean;

    /** 自動まばたき有効フラグ */
    autoBlink?: boolean;
    /** 音声リップシンク有効フラグ */
    lipSync?: boolean;

    /** 画像ごとの設定 (Task 39) */
    imageConfig?: {
        [slotId: string]: {
            useForBlink?: boolean;
            useForLipSync?: boolean;
        }
    };
}

/**
 * EMG Model Definition
 * アバターの全状態に対する画像パスのマッピング
 */
export interface EMGModelDefinition {
    /** アセットのルートパス (相対または絶対) */
    assetsRoot: string;

    /** Canvas Width / Base Image Width */
    width?: number;
    /** Canvas Height / Base Image Height */
    height?: number;
    /** License Information */
    license?: string;
    /** Pivot X (0.0 - 1.0) Default: 0.5 */
    anchorX?: number;
    /** Pivot Y (0.0 - 1.0) Default: 0.5 */
    anchorY?: number;
    /**
     * マッピング定義
     * key: `${activity}.${emotion}` (例: "idle.joy", "working.neutral")
     * value: 画像セット
     */
    mapping: Record<string, EMGVariantAssets>;
}

export const INITIAL_MODEL_DEFINITION: EMGModelDefinition = {
    assetsRoot: '/assets',
    mapping: {}
};
