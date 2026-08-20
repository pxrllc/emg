using System.Text.Json.Serialization;

namespace Emg.Core;

// mapping.json のルートオブジェクト。emg-mapping-spec.md (v0.3.0) に準拠。
// "expressions" は表情名をキーとする動的キーオブジェクトだが、System.Text.Json は
// Dictionary<string, T> をネイティブにデシリアライズできるため、
// emg-unity-importer（JsonUtility）で必要だった自前JSON分割ユーティリティは不要。
public sealed class EmgMapping
{
    [JsonPropertyName("avatarId")]
    public string AvatarId { get; set; } = "";

    [JsonPropertyName("baseMapping")]
    public EmgBaseMapping? BaseMapping { get; set; }

    [JsonPropertyName("expressions")]
    public Dictionary<string, EmgExpression> Expressions { get; set; } = new();
}

public sealed class EmgBaseMapping
{
    [JsonPropertyName("blinkPartKey")]
    public string? BlinkPartKey { get; set; }

    [JsonPropertyName("blinkParts")]
    public EmgBlinkTextures? BlinkParts { get; set; }

    [JsonPropertyName("blink")]
    public EmgBlinkTextures? Blink { get; set; }

    [JsonPropertyName("lipSyncPartKey")]
    public string? LipSyncPartKey { get; set; }

    [JsonPropertyName("lipSyncParts")]
    public EmgLipSyncTextures? LipSyncParts { get; set; }

    [JsonPropertyName("lipSync")]
    public EmgLipSyncTextures? LipSync { get; set; }
}

// blink.{open,half,closed} / blinkParts.{open,half,closed} 共通の形。
// blinkParts の場合はテクスチャIDではなく partID が入る。
public sealed class EmgBlinkTextures
{
    [JsonPropertyName("open")]
    public string? Open { get; set; }

    [JsonPropertyName("half")]
    public string? Half { get; set; }

    [JsonPropertyName("closed")]
    public string? Closed { get; set; }
}

// lipSync.{open,a,i,u,e,o,n} / lipSyncParts.{a,i,u,e,o,n} 共通の形
// （lipSyncParts に open は存在しないが null のまま無視されるだけなので共用して問題ない）。
public sealed class EmgLipSyncTextures
{
    [JsonPropertyName("open")]
    public string? Open { get; set; }

    [JsonPropertyName("a")]
    public string? A { get; set; }

    [JsonPropertyName("i")]
    public string? I { get; set; }

    [JsonPropertyName("u")]
    public string? U { get; set; }

    [JsonPropertyName("e")]
    public string? E { get; set; }

    [JsonPropertyName("o")]
    public string? O { get; set; }

    [JsonPropertyName("n")]
    public string? N { get; set; }

    public string? Get(string vowel) => vowel switch
    {
        "a" => A,
        "i" => I,
        "u" => U,
        "e" => E,
        "o" => O,
        "n" => N,
        _ => null,
    };
}

public sealed class EmgExpression
{
    // partID（または mappingKey） -> 有効化するレイヤーIDの配列
    [JsonPropertyName("parts")]
    public Dictionary<string, List<string>>? Parts { get; set; }

    [JsonPropertyName("eyebrow")]
    public string? Eyebrow { get; set; }

    [JsonPropertyName("other")]
    public List<string>? Other { get; set; }

    [JsonPropertyName("overrides")]
    public EmgExpressionOverrides? Overrides { get; set; }
}

public sealed class EmgExpressionOverrides
{
    [JsonPropertyName("blink")]
    public EmgBlinkTextures? Blink { get; set; }

    [JsonPropertyName("lipSync")]
    public EmgLipSyncTextures? LipSync { get; set; }
}
