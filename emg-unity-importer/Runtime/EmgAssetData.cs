using System;
using UnityEngine;

namespace Emg.Runtime
{
    public class EmgAssetData : ScriptableObject
    {
        public int baseCanvasWidth;
        public int baseCanvasHeight;
        public EmgSpriteDefinition[] spriteDefinitions;

        // mapping.json (v0.3.0+) から読み込んだ意味づけ情報。無ければ null。
        public EmgMapping semanticMapping;

        // parts[] の役割解決（blink/mouth ヒューリスティック・位置的フォールバック）に必要な
        // 静的メタデータ。GameObject 階層には type/default/レイヤー順序が残らないためここに保持する。
        public EmgPartMeta[] partMetas;
    }

    [Serializable]
    public class EmgPartMeta
    {
        public string partID;
        public string type; // "static" or "switch"
        public string defaultTextureID;
        public string[] layerTextureIDs; // data.json 記載順（textureZIndex ソート前）
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
