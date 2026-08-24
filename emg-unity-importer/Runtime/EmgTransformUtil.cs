using System;
using UnityEngine;

namespace Emg.Runtime
{
    /// <summary>
    /// v0.5.0 §7.3。レイヤーに適用する座標変換。
    /// 対象はこの 6 種のみで、メッシュ変形や色調補正は範囲外。
    /// </summary>
    public struct EmgTransformValue
    {
        public float translateX;
        public float translateY;
        /// <summary>度。時計回りが正。</summary>
        public float rotation;
        public float scaleX;
        public float scaleY;
        public float opacity;

        public static EmgTransformValue Identity => new EmgTransformValue
        {
            translateX = 0f, translateY = 0f, rotation = 0f,
            scaleX = 1f, scaleY = 1f, opacity = 1f,
        };

        public bool IsIdentity =>
            translateX == 0f && translateY == 0f && rotation == 0f
            && scaleX == 1f && scaleY == 1f && opacity == 1f;
    }

    /// <summary>
    /// v0.5.0 §7 のトランスフォーム評価。Emg.Core の同名ロジックと同じ規則を実装する
    /// （両者が食い違うと同じファイルが実装ごとに違う動きになるため）。
    /// </summary>
    public static class EmgTransformUtil
    {
        /// <summary>
        /// §7.5。cubic は Catmull-Rom に固定。制御点を持たないため追加データが不要で、
        /// 実装間で結果が一意に定まる。
        /// </summary>
        private static float CatmullRom(float p0, float p1, float p2, float p3, float u)
        {
            float u2 = u * u;
            float u3 = u2 * u;
            return 0.5f * (2f * p1
                + (-p0 + p2) * u
                + (2f * p0 - 5f * p1 + 4f * p2 - p3) * u2
                + (-p0 + 3f * p1 - 3f * p2 + p3) * u3);
        }

        /// <summary>
        /// §7.2。時刻 t（秒）における値。キーは t の昇順であることが要件。
        /// 範囲外は端のキーの値を保持する。
        /// </summary>
        public static float ValueAt(EmgTrack track, float t)
        {
            var keys = track?.keys;
            if (keys == null || keys.Length == 0) return 0f;
            if (keys.Length == 1 || t <= keys[0].t) return keys[0].v;
            if (t >= keys[keys.Length - 1].t) return keys[keys.Length - 1].v;

            int i = 0;
            while (i < keys.Length - 2 && keys[i + 1].t <= t) i++;

            var k0 = keys[i];
            var k1 = keys[i + 1];
            float span = k1.t - k0.t;
            float u = span <= 0f ? 0f : (t - k0.t) / span;

            string interp = track.interpolation;
            if (interp != "step" && interp != "linear" && interp != "cubic") interp = "linear";

            if (interp == "step") return k0.v;
            if (interp == "cubic")
            {
                return CatmullRom(
                    keys[Mathf.Max(i - 1, 0)].v, k0.v, k1.v,
                    keys[Mathf.Min(i + 2, keys.Length - 1)].v, u);
            }
            return k0.v + (k1.v - k0.v) * u;
        }

        /// <summary>
        /// §7.6 / §7.7。loop / pingpong / phaseOffset を解決したうえで全トラックを評価する。
        /// 呼び出し側は生の時刻を渡せばよい。
        /// </summary>
        public static EmgTransformValue ResolveAt(EmgSprite sprite, float time)
        {
            var r = EmgTransformValue.Identity;
            var tracks = sprite?.tracks;
            if (tracks == null || tracks.Length == 0) return r;

            float duration = sprite.duration;
            if (duration <= 0f)
            {
                foreach (var tr in tracks)
                {
                    if (tr?.keys == null) continue;
                    foreach (var k in tr.keys) duration = Mathf.Max(duration, k.t);
                }
            }

            float local = Mathf.Max(0f, time - sprite.phaseOffset);
            float t = 0f;
            if (duration > 0f)
            {
                string loop = sprite.loop;
                if (loop != "once" && loop != "loop" && loop != "pingpong") loop = "loop";

                if (loop == "once") t = Mathf.Min(local, duration);
                else if (loop == "pingpong")
                {
                    float cycle = local % (2f * duration);
                    t = cycle <= duration ? cycle : 2f * duration - cycle;
                }
                else t = local % duration;
            }

            foreach (var track in tracks)
            {
                if (track == null) continue;
                float v = ValueAt(track, t);
                switch (track.path)
                {
                    case "translate_x": r.translateX = v; break;
                    case "translate_y": r.translateY = v; break;
                    case "rotation": r.rotation = v; break;
                    case "scale_x": r.scaleX = v; break;
                    case "scale_y": r.scaleY = v; break;
                    case "opacity": r.opacity = v; break;
                    // 未知の path は無視する（v0.4.0 F1）
                }
            }
            return r;
        }
    }
}
