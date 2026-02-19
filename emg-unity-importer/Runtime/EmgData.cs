using System;
using System.Collections.Generic;
using UnityEngine;

namespace Emg.Runtime
{
    [Serializable]
    public class EmgData
    {
        public string version;
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
        // Simplified for now, just to allow deserialization without error
    }
}
