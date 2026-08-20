using System.Text.Json.Serialization;

namespace Emg.Core;

// data.json のルートオブジェクト。emg-json-spec.md (v0.3.0) に準拠。
// JSON キーは partID/textureID のような略語キャピタライズと basePosition_x のような
// snake_case が混在しているため、System.Text.Json の命名ポリシーには頼らず
// 全プロパティに [JsonPropertyName] を明示する。
public sealed class EmgData
{
    [JsonPropertyName("version")]
    public string Version { get; set; } = "";

    [JsonPropertyName("baseCanvasWidth")]
    public double BaseCanvasWidth { get; set; }

    [JsonPropertyName("baseCanvasHeight")]
    public double BaseCanvasHeight { get; set; }

    [JsonPropertyName("textures")]
    public List<EmgTexture> Textures { get; set; } = new();

    [JsonPropertyName("parts")]
    public List<EmgPart> Parts { get; set; } = new();

    [JsonPropertyName("sprites")]
    public List<EmgSprite> Sprites { get; set; } = new();
}

public sealed class EmgTexture
{
    [JsonPropertyName("textureFile")]
    public string TextureFile { get; set; } = "";

    [JsonPropertyName("width")]
    public double Width { get; set; }

    [JsonPropertyName("height")]
    public double Height { get; set; }
}

public sealed class EmgPart
{
    [JsonPropertyName("partID")]
    public string PartID { get; set; } = "";

    // "static" | "switch"
    [JsonPropertyName("type")]
    public string Type { get; set; } = "static";

    [JsonPropertyName("default")]
    public string? Default { get; set; }

    [JsonPropertyName("layers")]
    public List<EmgLayer> Layers { get; set; } = new();
}

public sealed class EmgLayer
{
    [JsonPropertyName("textureID")]
    public string TextureID { get; set; } = "";

    [JsonPropertyName("textureFile")]
    public string TextureFile { get; set; } = "";

    // アトラス内のピクセル座標（切り出し元）
    [JsonPropertyName("x")]
    public double X { get; set; }

    [JsonPropertyName("y")]
    public double Y { get; set; }

    [JsonPropertyName("width")]
    public double Width { get; set; }

    [JsonPropertyName("height")]
    public double Height { get; set; }

    // キャンバス上の描画先座標
    [JsonPropertyName("basePosition_x")]
    public double BasePositionX { get; set; }

    [JsonPropertyName("basePosition_y")]
    public double BasePositionY { get; set; }

    [JsonPropertyName("textureZIndex")]
    public int TextureZIndex { get; set; }

    [JsonPropertyName("opacity")]
    public double? Opacity { get; set; }

    [JsonPropertyName("blendMode")]
    public string? BlendMode { get; set; }
}

public sealed class EmgSprite
{
    [JsonPropertyName("spriteID")]
    public string SpriteID { get; set; } = "";

    [JsonPropertyName("targetPartID")]
    public string TargetPartID { get; set; } = "";

    [JsonPropertyName("fps")]
    public double Fps { get; set; } = 12;

    [JsonPropertyName("sequence")]
    public EmgSequence Sequence { get; set; } = new();

    [JsonPropertyName("trigger")]
    public EmgTrigger? Trigger { get; set; }
}

public sealed class EmgSequence
{
    // "ordered" | "random_hold"
    [JsonPropertyName("type")]
    public string Type { get; set; } = "ordered";

    [JsonPropertyName("frames")]
    public List<string> Frames { get; set; } = new();
}

public sealed class EmgTrigger
{
    // "auto_loop" | "random_interval" | "external"
    [JsonPropertyName("type")]
    public string Type { get; set; } = "external";

    [JsonPropertyName("intervalMin")]
    public double? IntervalMin { get; set; }

    [JsonPropertyName("intervalMax")]
    public double? IntervalMax { get; set; }
}
