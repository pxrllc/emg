using System;
using System.Collections.Generic;
using UnityEngine;

namespace Emg.Runtime
{
    [Serializable]
    public class EmgData
    {
        public string version;
        public int width;
        public int height;
        public List<EmgTexture> textures;
        public List<EmgLayer> layers;
    }

    [Serializable]
    public class EmgTexture
    {
        public string id;
        public int width;
        public int height;
    }

    [Serializable]
    public class EmgLayer
    {
        public string layerID;
        public string partID;
        public string textureID;
        public int x;
        public int y;
        public int width;
        public int height;
        public EmgUv uv;
        public float opacity = 1.0f;
        public string blendMode = "normal";
        public bool visible = true;
        public int zIndex;
    }

    [Serializable]
    public class EmgUv
    {
        public float u;
        public float v;
        public float w;
        public float h;
    }
}
