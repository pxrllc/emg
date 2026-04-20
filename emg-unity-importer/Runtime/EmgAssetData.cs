using System;
using UnityEngine;

namespace Emg.Runtime
{
    public class EmgAssetData : ScriptableObject
    {
        public int baseCanvasWidth;
        public int baseCanvasHeight;
        public EmgSpriteDefinition[] spriteDefinitions;
    }

    [Serializable]
    public class EmgSpriteDefinition
    {
        public string spriteID;
        public string targetPartID;
        public float fps;
        public SequenceType sequenceType;
        public string[] frames;
        // Trigger (none = external-only)
        public bool hasTrigger;
        public TriggerType triggerType;
        public float intervalMin;
        public float intervalMax;
    }

    public enum SequenceType { ordered, random_hold }
    public enum TriggerType { auto_loop, random_interval, external }
}
