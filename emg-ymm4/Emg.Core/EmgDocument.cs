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

    /// <summary>v0.5.0 §5。パーツ状態の組み合わせ。</summary>
    [JsonPropertyName("presets")]
    public List<EmgPreset> Presets { get; set; } = new();
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

    /// <summary>
    /// v0.5.0 §3。このパーツを切り替える主体。"animated"（既定）| "user"。
    /// **制約ではなくヒント**であり、実装は無視してよい（§3.2）。主な用途は UI の出し分け。
    /// </summary>
    [JsonPropertyName("control")]
    public string? Control { get; set; }

    /// <summary>
    /// v0.5.0 §4。初期状態で表示するか。不在時は true。
    /// static パーツにのみ意味を持ち、switch パーツでは無視する（§4.1）。
    /// </summary>
    [JsonPropertyName("defaultVisible")]
    public bool? DefaultVisible { get; set; }

    /// <summary>不在時の既定を解決した初期可視性。switch パーツは常に true。</summary>
    [JsonIgnore]
    public bool ResolvedDefaultVisible => ResolvedType != "static" || (DefaultVisible ?? true);

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
    /// <summary>
    /// v0.5.0 §2。このレイヤーが属するフレームの名前。不在時は TextureID と同値。
    /// 参照の突き合わせには TextureID ではなく <see cref="FrameID"/> を使うこと。
    /// </summary>
    [JsonPropertyName("frameName")]
    public string? FrameName { get; set; }

    /// <summary>
    /// v0.5.0 §1.1 フレーム識別子。switch パーツの表示単位はレイヤー 1 枚ではなく
    /// この識別子 1 つで、同じ識別子を持つレイヤーはすべて同時に表示される。
    /// frameName を持たないファイルでは TextureID と同一なので、解決結果は変わらない。
    /// </summary>
    [JsonIgnore]
    public string FrameID => FrameName ?? TextureID;

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

    // ---- v0.5.0 §7: トランスフォーム ----

    /// <summary>v0.5.0 §7.2。座標変換のキーフレーム列。</summary>
    [JsonPropertyName("tracks")]
    public List<EmgTrack>? Tracks { get; set; }

    /// <summary>v0.5.0 §7.2。尺（秒）。tracks を持つ場合は必須。</summary>
    [JsonPropertyName("duration")]
    public double? Duration { get; set; }

    /// <summary>once | loop | pingpong。不在時は loop。</summary>
    [JsonPropertyName("loop")]
    public string? Loop { get; set; }

    /// <summary>v0.5.0 §7.7。再生開始位置のずれ（秒）。不在時 0。</summary>
    [JsonPropertyName("phaseOffset")]
    public double? PhaseOffset { get; set; }

    [JsonIgnore]
    public string ResolvedLoop =>
        Loop is "once" or "loop" or "pingpong" ? Loop : "loop";

    /// <summary>tracks の尺。明示が無ければ最後のキーの t から求める。</summary>
    [JsonIgnore]
    public double ResolvedTrackDuration
    {
        get
        {
            if (Duration is { } d && d > 0) return d;
            var last = Tracks?.SelectMany(tr => tr.Keys).Select(k => k.T).DefaultIfEmpty(0).Max() ?? 0;
            return last;
        }
    }

    /// <summary>
    /// v0.5.0 §7.6 / §7.7。時刻 time（秒・アイテム内相対）における変換を求める。
    /// loop / pingpong / phaseOffset をここで解決するため、呼び出し側は生の時刻を渡せばよい。
    /// </summary>
    public EmgTransform ResolveTransformAt(double time)
    {
        if (Tracks is not { Count: > 0 }) return EmgTransform.Identity;

        var duration = ResolvedTrackDuration;
        var local = time - (PhaseOffset ?? 0);
        if (local < 0) local = 0;

        double t;
        if (duration <= 0)
        {
            t = 0;
        }
        else
        {
            switch (ResolvedLoop)
            {
                case "once":
                    t = Math.Min(local, duration);
                    break;
                case "pingpong":
                    var cycle = local % (2 * duration);
                    t = cycle <= duration ? cycle : 2 * duration - cycle;
                    break;
                default:   // loop
                    t = local % duration;
                    break;
            }
        }

        var r = EmgTransform.Identity;
        foreach (var track in Tracks)
        {
            var v = track.ValueAt(t);
            r = track.Path switch
            {
                "translate_x" => r with { TranslateX = v },
                "translate_y" => r with { TranslateY = v },
                "rotation" => r with { Rotation = v },
                "scale_x" => r with { ScaleX = v },
                "scale_y" => r with { ScaleY = v },
                "opacity" => r with { Opacity = v },
                _ => r,   // 未知の path は無視する（v0.4.0 F1）
            };
        }
        return r;
    }
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

    /// <summary>
    /// v0.5.0 §6。不等間隔のフレーム列。<see cref="Frames"/> と排他。
    /// これを使う場合 fps は不要（尺は最後のキーの t）。
    /// </summary>
    [JsonPropertyName("keys")]
    public List<EmgSequenceKey>? Keys { get; set; }

    /// <summary>
    /// v0.5.0 §6.2。時刻 t（秒）に表示すべきフレーム識別子。
    /// 規則は「key.t &lt;= t を満たす最後のキー」。step 補間として一意に定まる。
    ///
    /// keys が無い場合は fps + frames による等間隔として解決するため、
    /// 呼び出し側は両形式を区別せずに扱える。
    /// </summary>
    public string? ResolveFrameAt(double t, double fps)
    {
        if (Keys is { Count: > 0 })
        {
            string? found = null;
            foreach (var k in Keys)
            {
                if (k.T <= t) found = k.Frame;
                else break;   // キーは t の昇順であることが要件
            }
            // 最初のキーより前の時刻は先頭のフレームとして扱う
            return found ?? Keys[0].Frame;
        }

        if (Frames.Count == 0) return null;
        if (fps <= 0) fps = 12;
        var index = (int)Math.Floor(t * fps);
        return Frames[Math.Clamp(index, 0, Frames.Count - 1)];
    }

    /// <summary>v0.5.0 §6.4。この sequence の尺（秒）。</summary>
    public double ResolveDuration(double fps)
    {
        if (Keys is { Count: > 0 }) return Keys[^1].T;
        if (Frames.Count == 0) return 0;
        return Frames.Count / (fps <= 0 ? 12 : fps);
    }
}

/// <summary>v0.5.0 §6.1。不等間隔シーケンスの 1 キー。</summary>
public sealed class EmgSequenceKey
{
    /// <summary>再生開始からの秒数。</summary>
    [JsonPropertyName("t")]
    public double T { get; set; }

    /// <summary>表示するフレーム識別子。</summary>
    [JsonPropertyName("frame")]
    public string Frame { get; set; } = "";
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

/// <summary>v0.5.0 §5.1。複数パーツの状態をまとめて指定する。</summary>
public sealed class EmgPreset
{
    [JsonPropertyName("presetID")]
    public string PresetID { get; set; } = "";

    [JsonPropertyName("label")]
    public string? Label { get; set; }

    /// <summary>partID -> フレーム識別子。対象は switch パーツ。</summary>
    [JsonPropertyName("parts")]
    public Dictionary<string, string>? Parts { get; set; }

    /// <summary>partID -> 表示するか。対象は defaultVisible を持つ static パーツ。</summary>
    [JsonPropertyName("toggles")]
    public Dictionary<string, bool>? Toggles { get; set; }
}
