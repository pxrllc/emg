// EMG v0.4.0 の互換性規則（emg-json-spec-0.4.0.md 1〜2 章）。
//
// 未知の値に遭遇したときの扱いを 1 箇所に集約する。呼び出し側が生の
// part.type で分岐すると、未知の値でパーツが消えたり全レイヤーが重なったりする。

/**
 * この実装が理解する機能識別子（emg-extensions-registry.md）。
 * v0.4.0 の追加はいずれも無視しても表示が成立するため空。
 */
// EMG_frame_name: v0.5.0 §2 の frameName に対応済み。
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set<string>(['EMG_frame_name']);

/**
 * F5: 未知の識別子が 1 つでもあれば読み込みを拒否する。
 * 理解できない拡張を黙って無視すると誤った絵になるため、明示的に失敗させる。
 */
export function checkRequiredExtensions(data: { requiredExtensions?: string[] }): void {
    const unknown = (data.requiredExtensions ?? []).filter(e => !SUPPORTED_EXTENSIONS.has(e));
    if (unknown.length > 0) {
        throw new Error(
            `この .emg は未対応の機能を要求しています: ${unknown.join(', ')}。ランタイムの更新が必要です。`
        );
    }
}

/**
 * F2: 未知の type は default を持つなら switch、持たないなら static として扱う。
 */
export function resolvePartType(part: { type?: string; default?: string }): 'static' | 'switch' {
    if (part.type === 'static' || part.type === 'switch') return part.type;
    return part.default != null ? 'switch' : 'static';
}

/**
 * v0.5.0 §1.1: レイヤーのフレーム識別子。frameName が無ければ textureID と同一。
 * switch パーツの表示単位はレイヤー 1 枚ではなくこの識別子 1 つで、
 * 同じ識別子を持つレイヤーはすべて同時に表示される。
 */
export function frameId(layer: { frameName?: string; textureID?: string }): string {
    return layer.frameName ?? layer.textureID ?? '';
}

/**
 * v0.5.0 §4: static パーツは defaultVisible で初期状態が決まる。
 * switch パーツでは無視する（§4.1）。
 */
export function isPartInitiallyVisible(part: { type?: string; defaultVisible?: boolean }): boolean {
    if (part.type === 'switch') return true;
    return part.defaultVisible !== false;
}
