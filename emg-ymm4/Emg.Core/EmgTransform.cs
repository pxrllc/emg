using System.Text.Json.Serialization;

namespace Emg.Core;

/// <summary>
/// v0.5.0 §7.3。レイヤーに適用する座標変換。
/// 対象プロパティはこの 6 種のみで、メッシュ変形や色調補正は範囲外。
/// この集合に限ることで CSS transform / OS コンポジタ / GPU / CPU 合成の
/// いずれの経路でも実現できる。
/// </summary>
public readonly struct EmgTransform
{
    public double TranslateX { get; init; }
    public double TranslateY { get; init; }
    /// <summary>度。時計回りが正。</summary>
    public double Rotation { get; init; }
    public double ScaleX { get; init; }
    public double ScaleY { get; init; }
    public double Opacity { get; init; }

    public static readonly EmgTransform Identity = new()
    {
        TranslateX = 0, TranslateY = 0, Rotation = 0, ScaleX = 1, ScaleY = 1, Opacity = 1,
    };

    /// <summary>恒等変換か（描画側が変換処理を丸ごと省略できる）。</summary>
    public bool IsIdentity =>
        TranslateX == 0 && TranslateY == 0 && Rotation == 0
        && ScaleX == 1 && ScaleY == 1 && Opacity == 1;
}

/// <summary>v0.5.0 §7.2。トラックの 1 キー。</summary>
public sealed class EmgTrackKey
{
    /// <summary>再生開始からの秒数。</summary>
    [JsonPropertyName("t")]
    public double T { get; set; }

    [JsonPropertyName("v")]
    public double V { get; set; }
}

/// <summary>v0.5.0 §7.2。1 プロパティ分のキーフレーム列。</summary>
public sealed class EmgTrack
{
    /// <summary>translate_x | translate_y | rotation | scale_x | scale_y | opacity</summary>
    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    [JsonPropertyName("keys")]
    public List<EmgTrackKey> Keys { get; set; } = new();

    [JsonPropertyName("interpolation")]
    public string? Interpolation { get; set; }

    /// <summary>v0.5.0 §7.2。不在時は linear。未知の値も linear に倒す（v0.4.0 F1 と同じ考え方）。</summary>
    [JsonIgnore]
    public string ResolvedInterpolation =>
        Interpolation is "step" or "linear" or "cubic" ? Interpolation : "linear";

    /// <summary>
    /// 時刻 t（秒）における値。キーは t の昇順であることが要件。
    /// 範囲外は端のキーの値を保持する。
    /// </summary>
    public double ValueAt(double t)
    {
        if (Keys.Count == 0) return 0;
        if (Keys.Count == 1 || t <= Keys[0].T) return Keys[0].V;
        if (t >= Keys[^1].T) return Keys[^1].V;

        // t を挟む区間 [i, i+1] を探す
        int i = 0;
        while (i < Keys.Count - 2 && Keys[i + 1].T <= t) i++;

        var k0 = Keys[i];
        var k1 = Keys[i + 1];
        var span = k1.T - k0.T;
        var u = span <= 0 ? 0 : (t - k0.T) / span;

        return ResolvedInterpolation switch
        {
            "step" => k0.V,
            "cubic" => CatmullRom(
                Keys[Math.Max(i - 1, 0)].V, k0.V, k1.V, Keys[Math.Min(i + 2, Keys.Count - 1)].V, u),
            _ => k0.V + (k1.V - k0.V) * u,
        };
    }

    /// <summary>
    /// v0.5.0 §7.5。cubic は Catmull-Rom に固定する。制御点を持たないため
    /// 追加のデータが不要で、実装間で結果が一意に定まる。
    /// 端点は最初／最後のキーを複製して計算する。
    /// </summary>
    private static double CatmullRom(double p0, double p1, double p2, double p3, double u)
    {
        var u2 = u * u;
        var u3 = u2 * u;
        return 0.5 * (
            2 * p1
            + (-p0 + p2) * u
            + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
            + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    }
}
