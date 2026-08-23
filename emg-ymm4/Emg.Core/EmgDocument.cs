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

    /// <summary>
    /// v0.4.0 §2。このファイルを正しく表示するために実装が理解している必要がある機能識別子。
    /// 未知の識別子が含まれる場合、読み込みは拒否される（EmgCompat.Validate）。
    /// </summary>
    [JsonPropertyName("requiredExtensions")]
    public List<string> RequiredExtensions { get; set; } = new();
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

    /// <summary>
    /// v0.4.0 §1.2 F2。未知の <see cref="Type"/> は、<c>default</c> を持つなら switch、
    /// 持たないなら static として扱う。描画・解決はすべてこちらを見ること
    /// （生の Type を見ると、未知の値でパーツが丸ごと消える）。
    /// </summary>
    [JsonIgnore]
    public string ResolvedType =>
        Type is "static" or "switch" ? Type : (Default is not null ? "switch" : "static");
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

    /// <summary>
    /// v0.4.0 §3。回転・拡縮の中心（キャンバス座標）。不在時は BasePositionX と同値。
    /// v0.4.0 に座標変換は存在しないため描画には影響しないが、内部モデルには保持する。
    /// </summary>
    [JsonPropertyName("anchor_x")]
    public double? AnchorX { get; set; }

    [JsonPropertyName("anchor_y")]
    public double? AnchorY { get; set; }

    /// <summary>不在時の既定値を解決したアンカー（v0.4.0 §3.1）。</summary>
    [JsonIgnore]
    public double ResolvedAnchorX => AnchorX ?? BasePositionX;

    [JsonIgnore]
    public double ResolvedAnchorY => AnchorY ?? BasePositionY;

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

    /// <summary>v0.4.0 §1.2 F3。未知の値は ordered として扱う。</summary>
    [JsonIgnore]
    public string ResolvedType => Type is "ordered" or "random_hold" ? Type : "ordered";

    [JsonPropertyName("frames")]
    public List<string> Frames { get; set; } = new();
}

public sealed class EmgTrigger
{
    // "auto_loop" | "random_interval" | "external"
    [JsonPropertyName("type")]
    public string Type { get; set; } = "external";

    /// <summary>
    /// v0.4.0 §1.2 F4。未知の値は external（自律発火しない）として扱う。
    /// 未知のトリガーで勝手に animation が走るより、静止するほうが安全。
    /// </summary>
    [JsonIgnore]
    public string ResolvedType =>
        Type is "auto_loop" or "random_interval" or "external" ? Type : "external";

    [JsonPropertyName("intervalMin")]
    public double? IntervalMin { get; set; }

    [JsonPropertyName("intervalMax")]
    public double? IntervalMax { get; set; }
}
