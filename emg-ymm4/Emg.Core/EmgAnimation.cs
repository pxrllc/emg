using System.ComponentModel.DataAnnotations;

namespace Emg.Core;

/// <summary>
/// 口の形（母音）。YMM4 の YukkuriMovieMaker.Plugin.Voice.MouthShape と同じ並び・意味だが、
/// Emg.Core を YMM4 非依存に保つため独自に定義している（Godot/Unity 実装からも再利用できる）。
/// EMG の mapping.json 側の lipSync.n が Silent に対応する。
/// </summary>
public enum EmgMouthShape { Silent, A, I, U, E, O }

/// <summary>まばたきの強制モード。YMM4 の AnimationMode 相当。</summary>
public enum EmgEyeAnimationMode
{
    [Display(Name = "自動（まばたきする）")] Default,
    [Display(Name = "常に開く")] AlwaysOpen,
    [Display(Name = "常に閉じる")] AlwaysClose,
}

/// <summary>口パクの解決方式。YMM4 の MouthAnimationMode 相当。</summary>
public enum EmgMouthAnimationMode
{
    [Display(Name = "母音優先")] VowelPriority,
    [Display(Name = "音量優先")] VolumePriority,
    [Display(Name = "常に開く")] AlwaysOpen,
    [Display(Name = "常に閉じる")] AlwaysClose,
}

/// <summary>
/// .emg を読み込んだ時点で確定する「自動セットアップ」の結果。
///
/// PSD 立ち絵プラグインは、まばたきに使うレイヤー群・母音ごとの口レイヤーを
/// ユーザーが UI で手動設定し、PSD とは別の外部 JSON ファイル
/// （PsdFileSettings.LoadFromPsdFilePath が読む sidecar）に保存する必要がある。
/// EMG は mapping.json（あれば）と partID/textureID の命名から、それらを
/// 読み込み時に自動で決定する。これが EMG が PSD より扱いやすい理由。
/// </summary>
public sealed class EmgAutoSetup
{
    public required PartRoles Roles { get; init; }

    /// <summary>まばたき用レイヤー列。開いた状態→閉じた状態の順。null ならまばたき無効。</summary>
    public List<string>? BlinkLayers { get; init; }

    /// <summary>母音→textureID。null なら母音リップシンク無効（音量ベースにフォールバック）。</summary>
    public Dictionary<EmgMouthShape, string>? VowelLayers { get; init; }

    /// <summary>音量ベース口パク用レイヤー列。閉じた状態→開いた状態の順。null なら音量ベース無効。</summary>
    public List<string>? MouthVolumeLayers { get; init; }

    /// <summary>ユーザー向けの自動セットアップ結果サマリ（ログ出力用）。</summary>
    public required string Summary { get; init; }
}

/// <summary>
/// ユーザーが UI 上で明示的に指定したレイヤー割り当て。mapping.json や命名からの自動推定より優先される。
/// UI を持たない環境（Godot/Unity 実装など）では単に null を渡せばよいよう、
/// YMM4 の型には一切依存しない素の DTO にしてある。
/// </summary>
public sealed class EmgAnimationOverrides
{
    /// <summary>
    /// まばたきに使うパーツ。複数パーツが同じ textureID を持つ .emg があるため
    /// （himari3.emg では "9" が 口 と 目 の両方に存在する）、レイヤーIDだけでは
    /// パーツを一意に決められない。UI はここにパーツを明示する。
    /// </summary>
    public string? BlinkPartID { get; init; }

    /// <summary>まばたき用レイヤー列（開いた状態→閉じた状態の順）。</summary>
    public List<string>? BlinkLayers { get; init; }

    /// <summary>リップシンクに使うパーツ。BlinkPartID と同じ理由で必要。</summary>
    public string? MouthPartID { get; init; }

    /// <summary>母音ごとの口レイヤー。</summary>
    public Dictionary<EmgMouthShape, string>? VowelLayers { get; init; }

    public bool IsEmpty =>
        (BlinkLayers is null || BlinkLayers.Count == 0) &&
        (VowelLayers is null || VowelLayers.Count == 0);
}

public static class EmgAnimation
{
    // まばたき1回に要する秒数。YMM4 の PsdTachieSource.GetMabataki と同じ値。
    private const double BlinkDurationSeconds = 0.3;

    private static readonly string[] ClosedKeywords = { "close", "closed", "閉", "tojiru", "shut" };
    private static readonly string[] HalfKeywords = { "half", "semi", "半", "中" };
    private static readonly string[] OpenKeywords = { "open", "開" };

    /// <summary>
    /// 目の開き具合（1.0=完全に開、0.0=完全に閉）を、アイテム内相対時刻から決定論的に求める。
    /// YMM4 の PsdTachieSource.GetMabataki を移植したもの。実時間や Random を使わないため、
    /// タイムラインを任意の位置にシークしても同じ時刻には必ず同じ結果になる。
    /// </summary>
    public static double GetBlinkOpenness(TimeSpan tachieTime, double offset, double interval)
    {
        double cycle = BlinkDurationSeconds + interval;
        if (cycle <= 0) return 1.0;

        double phase = (tachieTime.TotalSeconds - offset) % cycle / BlinkDurationSeconds;
        if (phase >= 0.0 && phase <= 0.5) return 1.0 - phase * 2.0;   // 開 → 閉
        if (phase >= 0.5 && phase <= 1.0) return (phase - 0.5) * 2.0; // 閉 → 開
        return 1.0;                                                    // 開いたまま
    }

    /// <summary>
    /// 開き具合(0..1) から、レイヤー列のどれを表示するかを選ぶ。
    /// layers は「開いた状態→閉じた状態」の順に並んでいる前提。
    /// YMM4 の PsdTachieSource のレイヤー選択式と同じ（枚数は3枚に限らず任意）。
    /// </summary>
    public static string? SelectByOpenness(IReadOnlyList<string> layers, double openness)
    {
        if (layers.Count == 0) return null;
        int index = Math.Clamp((int)(layers.Count * (1.0 - openness)), 0, layers.Count - 1);
        return layers[index];
    }

    /// <summary>
    /// まばたきの offset / interval が未指定(0)のとき、YMM4 の PSD 立ち絵と同じく
    /// 5〜10秒の範囲でファイルごとに決定論的に決める。
    /// </summary>
    public static (double offset, double interval) ResolveBlinkTiming(
        string? emgFilePath, double configuredOffset, double configuredInterval)
    {
        // string.GetHashCode() は .NET Core 以降プロセスごとにランダム化されるため、
        // それをシードにすると YMM4 を起動し直すたびにまばたきのタイミングが変わってしまう
        // （＝同じプロジェクトを書き出し直すと違う動画になる）。安定ハッシュを自前で計算する。
        long seed = StableHash(emgFilePath);

        double interval = configuredInterval != 0.0 ? configuredInterval : 5.0 + StatelessRandom(seed, 1) * 5.0;

        // offset は「最初のまばたきまでの待ち時間」。YMM4 の PSD 立ち絵は interval と無関係に
        // 5〜10秒を入れているが、それだとユーザーが間隔を1秒に縮めても最初の約9秒はまばたきせず
        // 「機能していない」ように見える。ここでは 0〜interval の範囲に収め、
        // 「キャラクターごとにまばたきのタイミングをずらす」という本来の目的は保ちつつ、
        // 設定した間隔どおりの周期で必ず最初のまばたきが来るようにする。
        double offset = configuredOffset != 0.0 ? configuredOffset : StatelessRandom(seed, 0) * interval;

        return (offset, interval);
    }

    /// <summary>プロセスをまたいでも同じ値になる文字列ハッシュ（FNV-1a 64bit）。</summary>
    public static long StableHash(string? value)
    {
        if (string.IsNullOrEmpty(value)) return 0;
        unchecked
        {
            ulong hash = 14695981039346656037UL;
            foreach (char c in value)
            {
                hash ^= c;
                hash *= 1099511628211UL;
            }
            return (long)hash;
        }
    }

    /// <summary>
    /// ステートレス（状態を持たない）疑似乱数。同じ key からは常に同じ値が返る。
    /// YMM4 の YukkuriMovieMaker.Commons.StatelessRandom と同じアルゴリズム（SplitMix64系）を
    /// 移植したもの。Emg.Core を YMM4 非依存に保つため自前で持つ。
    /// </summary>
    public static double StatelessRandom(params long[] keys)
    {
        ulong state = 11400714819323198485UL;
        foreach (long key in keys)
        {
            state = Mix(state ^ (ulong)key);
        }
        return (state >> 11) * 1.1102230246251565E-16;
    }

    private static ulong Mix(ulong x)
    {
        unchecked
        {
            x ^= x >> 27;
            x *= 4357703544722667091UL;
            x ^= x >> 33;
            x *= 2047365380309298741UL;
            x ^= x >> 27;
            return x;
        }
    }

    /// <summary>
    /// mapping.json と partID/textureID の命名から、まばたき・リップシンクに使うレイヤーを自動決定する。
    /// .emg を読み込んだ直後に一度だけ呼ぶ。
    /// </summary>
    public static EmgAutoSetup Create(EmgData data, EmgMapping? mapping, EmgAnimationOverrides? overrides = null)
    {
        var roles = EmgStateResolver.ResolvePartRoles(data, mapping);
        var notes = new List<string>();

        // UI で明示的にレイヤーが指定されている場合、それがどのパーツのものかを役割として採用する
        // （mapping.json も命名も無い .emg で、ユーザーが UI から目/口パーツを決められるようにするため）。
        roles = ApplyOverrideRoles(data, roles, overrides);

        var blinkPart = FindPart(data, roles.BlinkPartID);
        var mouthPart = FindPart(data, roles.MouthPartID);

        var blinkLayers = ResolveOverrideBlinkLayers(overrides, blinkPart, notes)
            ?? ResolveBlinkLayers(mapping, blinkPart, notes);
        var vowelLayers = ResolveOverrideVowelLayers(overrides, mouthPart, notes)
            ?? ResolveVowelLayers(mapping, mouthPart, notes);
        var mouthVolumeLayers = ResolveMouthVolumeLayers(mouthPart, vowelLayers, notes);

        string summary =
            $"blinkPart={roles.BlinkPartID ?? "(none)"} mouthPart={roles.MouthPartID ?? "(none)"} | " +
            $"blinkLayers={FormatList(blinkLayers)} | " +
            $"vowels={(vowelLayers is null ? "(none)" : string.Join(",", vowelLayers.Select(kv => kv.Key + "=" + kv.Value)))} | " +
            $"mouthVolumeLayers={FormatList(mouthVolumeLayers)}" +
            (notes.Count > 0 ? " | " + string.Join(" / ", notes) : "");

        return new EmgAutoSetup
        {
            Roles = roles,
            BlinkLayers = blinkLayers,
            VowelLayers = vowelLayers,
            MouthVolumeLayers = mouthVolumeLayers,
            Summary = summary,
        };
    }

    private static string FormatList(List<string>? list) =>
        list is null ? "(none)" : "[" + string.Join(" → ", list) + "]";

    private static EmgPart? FindPart(EmgData data, string? partID) =>
        partID is null ? null : data.Parts.FirstOrDefault(p => p.PartID == partID);

    /// <summary>
    /// UI 指定のレイヤーが属するパーツを、blink/mouth の役割として採用する。
    /// mapping.json も命名ヒューリスティックも当たらない .emg（textureID が数字だけ等）でも、
    /// ユーザーが UI でレイヤーを選べば正しいパーツが役割として確定する。
    /// </summary>
    private static PartRoles ApplyOverrideRoles(EmgData data, PartRoles roles, EmgAnimationOverrides? overrides)
    {
        if (overrides is null || overrides.IsEmpty) return roles;

        string? blinkPartID = roles.BlinkPartID;
        string? mouthPartID = roles.MouthPartID;

        if (overrides.BlinkLayers is { Count: > 0 } bl)
        {
            // UI がパーツを明示していればそれを使う。古い設定（レイヤーIDのみ）の場合だけ、
            // レイヤーIDから所属パーツを推測する。
            var owner = ValidPart(data, overrides.BlinkPartID) ?? FindOwnerPart(data, bl);
            if (owner is not null) blinkPartID = owner;
        }
        if (overrides.VowelLayers is { Count: > 0 } vl)
        {
            var owner = ValidPart(data, overrides.MouthPartID) ?? FindOwnerPart(data, vl.Values);
            if (owner is not null) mouthPartID = owner;
        }

        return new PartRoles
        {
            BlinkPartID = blinkPartID,
            BlinkExplicit = roles.BlinkExplicit || overrides.BlinkLayers is { Count: > 0 },
            MouthPartID = mouthPartID,
            MouthExplicit = roles.MouthExplicit || overrides.VowelLayers is { Count: > 0 },
        };
    }

    /// <summary>指定された partID が実在すればそれを返す。</summary>
    private static string? ValidPart(EmgData data, string? partID) =>
        !string.IsNullOrEmpty(partID) && data.Parts.Any(p => p.PartID == partID) ? partID : null;

    /// <summary>指定された textureID 群を最も多く含むパーツを返す。</summary>
    private static string? FindOwnerPart(EmgData data, IEnumerable<string> textureIDs)
    {
        var ids = textureIDs.Where(v => !string.IsNullOrEmpty(v)).ToHashSet();
        if (ids.Count == 0) return null;

        return data.Parts
            .Select(p => (p.PartID, Hits: p.Layers.Count(l => ids.Contains(l.TextureID))))
            .Where(x => x.Hits > 0)
            .OrderByDescending(x => x.Hits)
            .Select(x => x.PartID)
            .FirstOrDefault();
    }

    private static List<string>? ResolveOverrideBlinkLayers(
        EmgAnimationOverrides? overrides, EmgPart? blinkPart, List<string> notes)
    {
        if (overrides?.BlinkLayers is not { Count: > 0 } layers || blinkPart is null) return null;

        var valid = layers.Where(id => blinkPart.Layers.Any(l => l.TextureID == id)).ToList();
        if (valid.Count < 2) return null;

        notes.Add("blink: UI の設定を使用");
        return valid;
    }

    private static Dictionary<EmgMouthShape, string>? ResolveOverrideVowelLayers(
        EmgAnimationOverrides? overrides, EmgPart? mouthPart, List<string> notes)
    {
        if (overrides?.VowelLayers is not { Count: > 0 } vowels || mouthPart is null) return null;

        var valid = vowels
            .Where(kv => !string.IsNullOrEmpty(kv.Value) && mouthPart.Layers.Any(l => l.TextureID == kv.Value))
            .ToDictionary(kv => kv.Key, kv => kv.Value);
        if (valid.Count < 2) return null;

        notes.Add("lipSync: UI の設定を使用");
        return valid;
    }

    /// <summary>
    /// まばたき用レイヤー列（開→閉の順）を決める。
    /// 1. mapping.json の blink.{open,half,closed}
    /// 2. textureID の命名から推定（open系 / half系 / close系）
    /// どちらも決まらなければ null（＝まばたき無効）。レイヤー配列順で機械的に選ぶことはしない
    /// （himari3.emg のように1つの switch パーツに表情差分が数十枚入っている実データがあり、
    ///  順番に選ぶと無関係な表情が「まばたき」として再生されてしまうため、安全側に倒す）。
    /// </summary>
    private static List<string>? ResolveBlinkLayers(EmgMapping? mapping, EmgPart? blinkPart, List<string> notes)
    {
        if (blinkPart is null) return null;

        var blink = mapping?.BaseMapping?.Blink;
        if (blink is not null)
        {
            var fromMapping = new[] { blink.Open, blink.Half, blink.Closed }
                .Where(v => !string.IsNullOrEmpty(v))
                .Select(v => v!)
                .Where(v => blinkPart.Layers.Any(l => l.TextureID == v))
                .ToList();
            if (fromMapping.Count >= 2)
            {
                notes.Add("blink: mapping.json から取得");
                return fromMapping;
            }
        }

        // 命名からの自動推定。open(=default) → half → closed の順に並べる。
        string? open = blinkPart.Default
            ?? FindLayerByKeywords(blinkPart, OpenKeywords)
            ?? blinkPart.Layers.FirstOrDefault()?.TextureID;
        string? half = FindLayerByKeywords(blinkPart, HalfKeywords);
        string? closed = FindLayerByKeywords(blinkPart, ClosedKeywords);

        if (open is null || closed is null)
        {
            notes.Add($"blink: 自動検出できず無効（パーツ '{blinkPart.PartID}' に閉じ目を示すレイヤー名が見つからない）");
            return null;
        }

        var layers = new List<string> { open };
        if (half is not null && half != open && half != closed) layers.Add(half);
        layers.Add(closed);
        notes.Add("blink: textureID の命名から自動推定");
        return layers;
    }

    /// <summary>
    /// 母音→textureID のマップを決める。
    /// 1. mapping.json の lipSync.{a,i,u,e,o,n}
    /// 2. textureID の命名から推定
    /// </summary>
    private static Dictionary<EmgMouthShape, string>? ResolveVowelLayers(
        EmgMapping? mapping, EmgPart? mouthPart, List<string> notes)
    {
        if (mouthPart is null) return null;

        var lipSync = mapping?.BaseMapping?.LipSync;
        if (lipSync is not null)
        {
            var map = new Dictionary<EmgMouthShape, string>();
            AddIfValid(map, EmgMouthShape.A, lipSync.A, mouthPart);
            AddIfValid(map, EmgMouthShape.I, lipSync.I, mouthPart);
            AddIfValid(map, EmgMouthShape.U, lipSync.U, mouthPart);
            AddIfValid(map, EmgMouthShape.E, lipSync.E, mouthPart);
            AddIfValid(map, EmgMouthShape.O, lipSync.O, mouthPart);
            AddIfValid(map, EmgMouthShape.Silent, lipSync.N, mouthPart);
            if (map.Count >= 2)
            {
                notes.Add("lipSync: mapping.json から取得");
                return map;
            }
        }

        // 命名からの自動推定。"mouth_a" / "口_あ" / "a" のような textureID を母音に割り当てる。
        var guessed = new Dictionary<EmgMouthShape, string>();
        TryGuessVowel(guessed, mouthPart, EmgMouthShape.A, "a", "あ", "ア");
        TryGuessVowel(guessed, mouthPart, EmgMouthShape.I, "i", "い", "イ");
        TryGuessVowel(guessed, mouthPart, EmgMouthShape.U, "u", "う", "ウ");
        TryGuessVowel(guessed, mouthPart, EmgMouthShape.E, "e", "え", "エ");
        TryGuessVowel(guessed, mouthPart, EmgMouthShape.O, "o", "お", "オ");

        string? silent = FindLayerByKeywords(mouthPart, ClosedKeywords) ?? mouthPart.Default;
        if (silent is not null) guessed[EmgMouthShape.Silent] = silent;

        // 母音が2つ以上取れて初めて「母音リップシンクができる」とみなす
        // （Silent だけ取れても母音別再生にはならないため）。
        if (guessed.Count(kv => kv.Key != EmgMouthShape.Silent) >= 2)
        {
            notes.Add("lipSync: textureID の命名から母音を自動推定");
            return guessed;
        }

        notes.Add($"lipSync: 母音の自動検出できず（パーツ '{mouthPart.PartID}' のレイヤー名が母音を示していない）");
        return null;
    }

    private static void AddIfValid(
        Dictionary<EmgMouthShape, string> map, EmgMouthShape shape, string? textureID, EmgPart part)
    {
        if (string.IsNullOrEmpty(textureID)) return;
        if (!part.Layers.Any(l => l.TextureID == textureID)) return;
        map[shape] = textureID!;
    }

    private static void TryGuessVowel(
        Dictionary<EmgMouthShape, string> map, EmgPart part, EmgMouthShape shape, params string[] tokens)
    {
        foreach (var layer in part.Layers)
        {
            string id = layer.TextureID;
            foreach (var token in tokens)
            {
                // "mouth_a" / "口_あ" のような区切り付き、または textureID 全体が母音そのもの、
                // または末尾が母音、というパターンだけを拾う（"close" の 'o' を誤検出しないため、
                // 単純な部分一致はしない）。
                if (id.Equals(token, StringComparison.OrdinalIgnoreCase) ||
                    id.EndsWith("_" + token, StringComparison.OrdinalIgnoreCase) ||
                    id.EndsWith("-" + token, StringComparison.OrdinalIgnoreCase) ||
                    id.EndsWith(token, StringComparison.Ordinal) && token.Length > 1)
                {
                    map[shape] = id;
                    return;
                }
            }
        }
    }

    /// <summary>
    /// 音量ベース口パク用のレイヤー列（閉→開の順）。母音が取れている場合は不要。
    /// </summary>
    private static List<string>? ResolveMouthVolumeLayers(
        EmgPart? mouthPart, Dictionary<EmgMouthShape, string>? vowelLayers, List<string> notes)
    {
        if (mouthPart is null) return null;

        // 母音が取れていれば Silent(閉) と A(開) を使って音量ベースも成立させる
        if (vowelLayers is not null &&
            vowelLayers.TryGetValue(EmgMouthShape.Silent, out var silentId) &&
            vowelLayers.TryGetValue(EmgMouthShape.A, out var aId))
        {
            return new List<string> { silentId, aId };
        }

        string? closed = FindLayerByKeywords(mouthPart, ClosedKeywords) ?? mouthPart.Default;
        string? open = FindLayerByKeywords(mouthPart, OpenKeywords);
        if (closed is not null && open is not null && closed != open)
        {
            notes.Add("mouth(volume): textureID の命名から開閉を自動推定");
            return new List<string> { closed, open };
        }

        notes.Add($"mouth(volume): 自動検出できず無効（パーツ '{mouthPart.PartID}' に開閉を示すレイヤー名が見つからない）");
        return null;
    }

    private static string? FindLayerByKeywords(EmgPart part, string[] keywords) =>
        part.Layers.FirstOrDefault(l =>
            keywords.Any(kw => l.TextureID.Contains(kw, StringComparison.OrdinalIgnoreCase)))?.TextureID;
}
