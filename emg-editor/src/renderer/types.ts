export interface LayerMeta {
    id: number;
    partId: string;
    type: 'static' | 'switch';
    isDefault?: boolean; // For switch parts, indicates if this layer is the default one
    /**
     * v0.5.0 §2。このレイヤーが属するフレームの名前。
     * PSD で「@」始まりのグループに入っているレイヤーに付く（下の traverse を参照）。
     * 未設定なら textureID がそのままフレーム識別子になる。
     */
    frameName?: string;
    /**
     * v0.5.0 §4。static パーツの初期表示状態。
     * PSD で非表示だったグループを「消す」のではなく「初期非表示のトグル」として
     * 書き出すために使う。`visible`（書き出しに含めるか＝UI のチェック）とは別物。
     */
    defaultVisible?: boolean;
    visible: boolean;
    opacity: number;    // 0.0 - 1.0
    blendMode: string;  // 'normal' | 'multiply' | 'screen' | etc.
}

/**
 * 1 パーツ分のアニメーション設定（`sprites[]` の元になる編集状態）。
 *
 * `sprites[].targetPartID` のパーツは **`switch` でなければならない**
 * （emg-json-spec.md 7 章）ため、switch パーツにのみ持たせる。
 *
 * `frames` はフレーム識別子（`frameName ?? textureID`）の再生順。
 * パーツ内のフレームを何度でも参照してよい（まばたきの 01→03→04→03→01 など）。
 */
export interface PartAnimation {
    /** 書き出しに含めるか。false なら `sprites[]` に出さない。 */
    enabled: boolean;
    /** `sprites[].spriteID`。外部から再生を指示するときのキー。 */
    spriteID: string;
    /** 再生順のフレーム識別子。 */
    frames: string[];
    /**
     * 等間隔（`fps` + `frames`）か、フレームごとに時間を持つか（v0.5.0 6 章の `keys`）。
     * GIF のように遅延がフレームごとに違うものは `keys` でしか表現できない。
     */
    timing: 'fps' | 'keys';
    fps: number;
    /** `timing === 'keys'` のときの各フレームの表示秒数。`frames` と同じ長さ。 */
    durations: number[];
    /** 再生順の種別（7.1）。`random_hold` は 1 つを選んで保持する。 */
    sequenceType: 'ordered' | 'random_hold';
    /** 発火タイミング（7.2）。 */
    triggerType: 'auto_loop' | 'random_interval' | 'external';
    intervalMin: number;
    intervalMax: number;
}

/** パーツにアニメーションを付けるときの初期値。 */
export function defaultPartAnimation(partId: string, frames: string[]): PartAnimation {
    return {
        enabled: true,
        spriteID: partId,
        frames: [...frames],
        timing: 'fps',
        fps: 12,
        durations: frames.map(() => 0.1),
        sequenceType: 'ordered',
        triggerType: 'auto_loop',
        intervalMin: 3,
        intervalMax: 8,
    };
}
