using System;
using System.Collections.Generic;
using UnityEngine;

namespace Emg.Runtime
{
    [Serializable]
    public class EmgData
    {
        public string version;

        /// <summary>
        /// v0.4.0 §2。理解できない識別子が含まれる .emg は読み込みを拒否する。
        /// </summary>
        public string[] requiredExtensions;

        /// <summary>v0.5.0 §5。パーツ状態の組み合わせ。</summary>
        public EmgPreset[] presets;
        public int baseCanvasWidth;
        public int baseCanvasHeight;
        public List<EmgTexture> textures;
        public List<EmgPart> parts;
        public List<EmgSprite> sprites;
    }

    [Serializable]
    public class EmgTexture
    {
        public string textureFile;
        public int width;
        public int height;
    }

    [Serializable]
    public class EmgPart
    {
        /// <summary>
        /// v0.4.0 §1.2 F2。未知の type は default を持つなら switch、持たないなら static。
        /// 生の type で分岐すると、未知の値で全レイヤーが重なって表示される。
        /// </summary>
        /// <summary>v0.5.0 §3。切り替える主体のヒント。制約ではない（§3.2）。</summary>
        public string control;

        /// <summary>v0.5.0 §4。初期状態で表示するか。JsonUtility は bool? を扱えないため既定 true。</summary>
        public bool defaultVisible = true;

        public string ResolvedType =>
            type == "static" || type == "switch"
                ? type
                : (!string.IsNullOrEmpty(@default) ? "switch" : "static");

        public string partID;
        public string type; // "static" or "switch"
        public string @default; // default textureID (for switch)
        public List<EmgLayer> layers;
    }

    [Serializable]
    public class EmgLayer
    {
        // V0.2.2: Layer is now nested under Part
        public string textureID; // Used for switching
        public string textureFile;
        
        // Atlas Coordinates (Pixel)
        public int x;
        public int y;
        public int width;
        public int height;
        
        // Canvas Coordinates (Pixel, Top-Left based)
        public int basePosition_x;
        public int basePosition_y;
        
        public int textureZIndex;
        public float opacity = 1.0f;

        /// <summary>v0.5.0 §2。このレイヤーが属するフレームの名前。空なら textureID と同値。</summary>
        public string frameName;

        /// <summary>
        /// v0.5.0 §1.1 フレーム識別子。参照の突き合わせは textureID ではなくこちらで行う。
        /// </summary>
        public string FrameID => string.IsNullOrEmpty(frameName) ? textureID : frameName;
        public string blendMode = "normal";
        
        // "visible" is no longer primary for switch parts (controlled by default), but kept for static?
        // Actually spec says static parts have 1 layer. Switch parts toggle layers.
    }

    [Serializable]
    public class EmgSprite
    {
        public string spriteID;
        public string targetPartID;
        public float fps;
        public EmgSequence sequence;
        public EmgTrigger trigger;

        // ---- v0.5.0 §7: トランスフォーム ----
        public EmgTrack[] tracks;
        public float duration;
        public string loop;
        public float phaseOffset;
    }

    [Serializable]
    public class EmgSequence
    {
        public string type; // "ordered" | "random_hold"
        public List<string> frames;
    }

    [Serializable]
    public class EmgTrigger
    {
        public string type; // "auto_loop" | "random_interval" | "external"
        public float intervalMin;
        public float intervalMax;
    }
}

namespace Emg.Runtime
{
    /// <summary>v0.5.0 §7.2。トラックの 1 キー。</summary>
    [System.Serializable]
    public class EmgTrackKey
    {
        public float t;
        public float v;
    }

    /// <summary>v0.5.0 §7.2。1 プロパティ分のキーフレーム列。</summary>
    [System.Serializable]
    public class EmgTrack
    {
        /// <summary>translate_x | translate_y | rotation | scale_x | scale_y | opacity</summary>
        public string path;
        public EmgTrackKey[] keys;
        public string interpolation;
    }

    /// <summary>v0.5.0 §5.1。複数パーツの状態をまとめて指定する。</summary>
    [System.Serializable]
    public class EmgPreset
    {
        public string presetID;
        public string label;
        // JsonUtility は Dictionary を扱えないため、キーと値を並列配列で持つ。
        // EmgMappingJsonUtil と同じ方針。
        public string[] partIDs;
        public string[] frameIDs;
        public string[] toggleIDs;
        public bool[] toggleValues;
    }
}
