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
   * 表現の深さを制御するために予約
   */
  intensity: number;
}

/**
 * デフォルトの初期状態
 */
export const INITIAL_EMG_LITE_STATE: EMGLiteState = {
  emotion: 'neutral',
  activity: 'idle',
  speaking: false,
  intensity: 0.0,
};
