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
   * 感情や動作の強度 (0.0 - 1.0)
   * 「どのくらい強く表情/ポーズを出すか」のヒント値
   * 0.0 は静止、1.0 は最大の強度を想定
   */
  intensity: number;

  /**
   * 睡眠/待機状態
   * sleep=true の場合、sleep スロットを優先的に使用する
   */
  sleep?: boolean;

  /**
   * 瞬き状態
   * blinking=true の場合、eyesClosed スロットを優先的に使用する
   */
  blinking?: boolean;

  /**
   * 口形状 (音素やviseme名)
   * 例: 'a' | 'i' | 'u' | 'e' | 'o' | 'rest'
   * 未指定の場合は speaking の真偽値でフォールバックする
   */
  mouthShape?: string;

  /**
   * 一時的なオーバーレイ差分（汗・傷・エフェクト等）の識別子
   * 表示する順序で配列を並べる（後ろの要素ほど上に重ねる）
   */
  overlays?: string[];

  /**
   * 任意メタデータ（実装依存）。伺かサーフィス番号などを格納し、
   * アダプタ層で activity/emotion やスロットにマッピングさせる用途を想定
   */
  context?: Record<string, unknown>;
}

/**
 * デフォルトの初期状態
 */
export const INITIAL_EMG_LITE_STATE: EMGLiteState = {
  emotion: 'neutral',
  activity: 'idle',
  speaking: false,
  intensity: 0.0,
  sleep: false,
  blinking: false,
  mouthShape: undefined,
  overlays: [],
  context: {},
};
