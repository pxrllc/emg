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
        public EmgTrigger trigger; // nullable: null means external-only control
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
