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
    /**
     * 明示的な `textureZIndex`。不在なら**ツリーの走査順**から決める。
     *
     * PSD / 画像 / GIF / シートから作った場合は不在で、今までどおり走査順が z になる。
     * `.emg` を読み込んだ場合だけ、ファイルの値をここに持つ。
     *
     * これが要るのは、`.emg` の z が**パーツをまたいで入れ子にならないことがある**ため。
     * 仕様 0.5 の `frameName` の例がまさにそれで（上着 z=20 / 体 z=10 / スカート z=5）、
     * z が非連続な組を扱えることがあの機構の存在理由になっている。
     * ツリーはパーツごとの塊なので、走査順からはこの並びを再現できない。
     */
    zIndex?: number;
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

/**
 * 状態の組（`presets[]`）の編集状態。
 *
 * **差分として記録します。** 仕様 0.5 §5.2 が「プリセットに現れない partID の
 * 状態は変更しない」と定めているため、既定と違うものだけを持ちます。
 * 全パーツを列挙すると、
 *   - プリセット同士を重ねられなくなる（表情と衣装が衝突する）
 *   - パーツを 1 つ足すたびに全プリセットの意味が変わる
 */
export interface AvatarPreset {
    /** 参照キー。ファイル内で一意。 */
    presetID: string;
    /** UI に出す名前。 */
    label: string;
    /** switch パーツ → フレーム識別子。 */
    parts: Record<string, string>;
    /** パーツ → 表示するか。 */
    toggles: Record<string, boolean>;
}

/**
 * 表情（`mapping.json` の `expressions`）の編集状態。
 *
 * **構造はプリセットが持ち、表情はそれを参照して目・口だけを足します。**
 * これは仕様上の制約から来る役割分担です — 表情の `parts` に目や口を書いても、
 * 解決の順序（`parts` を適用 → blink / lipSync が自分のパーツを上書き）により
 * **黙って無効になります**。したがって目・口は `overrides` でしか指定できません。
 *
 * `parts` をここで編集させないのは、プリセット側で表現できるためです。
 * 2 か所で同じことができると、どちらに書いたかで挙動が変わる罠になります。
 */
export interface AvatarExpression {
    /** `expressions` のキー。利用者が決める名前。 */
    name: string;
    /** 参照するプリセット。空なら参照しない。 */
    presetID: string;
    /** この表情のときのまばたき。1 つでも埋まっていれば出力する（部分指定も可）。 */
    blink: { open: string; half: string; closed: string };
    /** この表情のときの口。同上。 */
    lipSync: { a: string; i: string; u: string; e: string; o: string; n: string };
}

export function emptyExpression(name: string): AvatarExpression {
    return {
        name,
        presetID: '',
        blink: { open: '', half: '', closed: '' },
        lipSync: { a: '', i: '', u: '', e: '', o: '', n: '' },
    };
}

/**
 * `mapping.json` の編集状態。
 *
 * `data.json` が構造を定めるのに対し、`mapping.json` は意味を与える —
 * 「どのパーツが目か」「どのフレームが閉じ目か」。存在しなくても `.emg` は有効。
 *
 * 値が空文字列のものは**未割り当て**。書き出し前に利用者へ知らせる。
 * 埋まっていない mapping を書き出すと、まばたきも口パクも無反応になる。
 */
export interface AvatarMapping {
    /** 識別用のラベル。解決には使わない（仕様 0.5.2 §10.10）。 */
    avatarId: string;
    /** まばたきを担当する partID。空なら blink を出力しない。 */
    blinkPartId: string;
    blink: { open: string; half: string; closed: string };
    /** 口パクを担当する partID。空なら lipSync を出力しない。 */
    lipSyncPartId: string;
    lipSync: { a: string; i: string; u: string; e: string; o: string; n: string; open: string };
}

/** `blink` の割り当て先。キーは仕様で固定されており、利用者は変更できない。 */
export const BLINK_SLOTS = [
    { key: 'open', label: '開' },
    { key: 'half', label: '半開' },
    { key: 'closed', label: '閉' },
] as const;

/** `lipSync` の割り当て先。同じくキーは固定。 */
export const LIPSYNC_SLOTS = [
    { key: 'a', label: 'あ' },
    { key: 'i', label: 'い' },
    { key: 'u', label: 'う' },
    { key: 'e', label: 'え' },
    { key: 'o', label: 'お' },
    { key: 'n', label: 'ん（閉）' },
    { key: 'open', label: '開（任意）' },
] as const;

export function emptyMapping(): AvatarMapping {
    return {
        avatarId: 'avatar',
        blinkPartId: '',
        blink: { open: '', half: '', closed: '' },
        lipSyncPartId: '',
        lipSync: { a: '', i: '', u: '', e: '', o: '', n: '', open: '' },
    };
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
