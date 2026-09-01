// EMG v0.5.0 §7 のトランスフォーム評価。
// Emg.Core / emg-cdn プレイヤーと同じ規則を実装する（食い違うと同じファイルが
// 実装ごとに違う動きになるため）。

export interface EmgTransformValue {
    translate_x: number;
    translate_y: number;
    /** 度。時計回りが正。 */
    rotation: number;
    scale_x: number;
    scale_y: number;
    opacity: number;
}

export interface EmgTrackKey { t: number; v: number; }
export interface EmgTrack {
    path: string;
    keys: EmgTrackKey[];
    interpolation?: 'step' | 'linear' | 'cubic';
}
export interface EmgTransformSprite {
    targetPartID: string;
    /**
     * §7.4.1: 変換の対象をパーツ内の 1 フレーム識別子に絞る（0.5.3）。
     * 不在ならパーツの全レイヤーが対象。値は frameName ?? textureID。
     */
    targetLayer?: string;
    tracks?: EmgTrack[];
    duration?: number;
    loop?: 'once' | 'loop' | 'pingpong';
    phaseOffset?: number;
}

export const IDENTITY: EmgTransformValue = {
    translate_x: 0, translate_y: 0, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
};

/** §7.5: cubic は Catmull-Rom に固定（制御点を持たない）。 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
    const u2 = u * u, u3 = u2 * u;
    return 0.5 * (2 * p1 + (-p0 + p2) * u
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** §7.2: 時刻 t（秒）における値。範囲外は端のキーの値を保持する。 */
export function trackValueAt(track: EmgTrack, t: number): number {
    const keys = track.keys ?? [];
    if (keys.length === 0) return 0;
    if (keys.length === 1 || t <= keys[0].t) return keys[0].v;
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;

    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    const span = k1.t - k0.t;
    const u = span <= 0 ? 0 : (t - k0.t) / span;

    const interp = track.interpolation === 'step' || track.interpolation === 'cubic'
        ? track.interpolation : 'linear';
    if (interp === 'step') return k0.v;
    if (interp === 'cubic') {
        return catmullRom(
            keys[Math.max(i - 1, 0)].v, k0.v, k1.v,
            keys[Math.min(i + 2, keys.length - 1)].v, u);
    }
    return k0.v + (k1.v - k0.v) * u;
}

/** §7.6 / §7.7: loop / pingpong / phaseOffset を解決して全トラックを評価する。 */
export function resolveTransformAt(sprite: EmgTransformSprite, time: number): EmgTransformValue {
    const tracks = sprite.tracks ?? [];
    const r: EmgTransformValue = { ...IDENTITY };
    if (tracks.length === 0) return r;

    let duration = sprite.duration ?? 0;
    if (duration <= 0) {
        for (const tr of tracks) for (const k of tr.keys ?? []) duration = Math.max(duration, k.t);
    }

    const local = Math.max(0, time - (sprite.phaseOffset ?? 0));
    let t = 0;
    if (duration > 0) {
        const loop = sprite.loop === 'once' || sprite.loop === 'pingpong' ? sprite.loop : 'loop';
        if (loop === 'once') t = Math.min(local, duration);
        else if (loop === 'pingpong') {
            const cycle = local % (2 * duration);
            t = cycle <= duration ? cycle : 2 * duration - cycle;
        } else t = local % duration;
    }

    for (const track of tracks) {
        if (track.path in r) (r as any)[track.path] = trackValueAt(track, t);
    }
    return r;
}
