namespace Emg.Core;

// パーツ役割の解決結果。emg-mapping-spec.md の「パーツの役割判定」節の出力に対応する。
// BlinkExplicit/MouthExplicit は blinkParts/blinkPartKey 等で明示指定された場合のみ true。
// キーワードフォールバックのみで解決した場合は false（sprites[] 共存ルールの適用条件）。
public sealed class PartRoles
{
    public string? BlinkPartID { get; init; }
    public bool BlinkExplicit { get; init; }
    public string? MouthPartID { get; init; }
    public bool MouthExplicit { get; init; }
}

// 1フレーム分の外部入力状態。EmgTachieSource.Update() がここを埋めて ResolveActiveTextures に渡す。
public sealed class ResolverState
{
    /// <summary>目の開き具合。1.0=完全に開、0.0=完全に閉。</summary>
    public double BlinkOpenness { get; set; } = 1.0;

    /// <summary>YMM4 から渡される母音（ITachieSource2 経由でのみ得られる）。</summary>
    public EmgMouthShape MouthShape { get; set; } = EmgMouthShape.Silent;

    /// <summary>音声の大きさから求めた口の開き具合。1.0=大きく開、0.0=閉。</summary>
    public double MouthOpenness { get; set; }

    public string ExpressionName { get; set; } = "default";

    public EmgEyeAnimationMode EyeMode { get; set; } = EmgEyeAnimationMode.Default;

    public EmgMouthAnimationMode MouthMode { get; set; } = EmgMouthAnimationMode.VowelPriority;
}

/// <summary>
/// mapping.json のパーツ役割判定・blink/viseme/expression 解決ロジック。
/// emg-mapping-spec.md の規範ロジック、および emg-cdn/emg-player.0.3.0.js の
/// resolvePartRoles/applyBlinkState/applyViseme/applyExpression を C# に移植したもの。
/// Direct2D や YMM4 API には一切依存しない純粋ロジック。
/// </summary>
public static class EmgStateResolver
{
    private static readonly string[] BlinkKeywords = { "eye", "eyes", "eyelid", "blink", "目" };
    private static readonly string[] MouthKeywords = { "mouth", "lip", "viseme", "口" };

    public static PartRoles ResolvePartRoles(EmgData data, EmgMapping? mapping)
    {
        string? blinkPartID = null;
        bool blinkExplicit = false;
        string? mouthPartID = null;
        bool mouthExplicit = false;

        var baseMapping = mapping?.BaseMapping;
        if (baseMapping is not null)
        {
            // 1. blinkParts（フラットモード）のいずれかの値と一致するパーツ
            if (baseMapping.BlinkParts is { } bp)
            {
                var targets = new[] { bp.Open, bp.Half, bp.Closed }.Where(v => v is not null).ToHashSet();
                var found = data.Parts.FirstOrDefault(p => targets.Contains(p.PartID));
                if (found is not null) { blinkPartID = found.PartID; blinkExplicit = true; }
            }
            // 2. blinkPartKey と一致するパーツ
            if (blinkPartID is null && baseMapping.BlinkPartKey is { } bpk)
            {
                var found = data.Parts.FirstOrDefault(p => p.PartID == bpk);
                if (found is not null) { blinkPartID = found.PartID; blinkExplicit = true; }
            }

            if (baseMapping.LipSyncParts is { } lp)
            {
                var targets = new[] { lp.A, lp.I, lp.U, lp.E, lp.O, lp.N }.Where(v => v is not null).ToHashSet();
                var found = data.Parts.FirstOrDefault(p => targets.Contains(p.PartID));
                if (found is not null) { mouthPartID = found.PartID; mouthExplicit = true; }
            }
            if (mouthPartID is null && baseMapping.LipSyncPartKey is { } lpk)
            {
                var found = data.Parts.FirstOrDefault(p => p.PartID == lpk);
                if (found is not null) { mouthPartID = found.PartID; mouthExplicit = true; }
            }
        }

        // 3/4. ヒューリスティックキーワードによるフォールバック（Explicitフラグは立てない）
        if (blinkPartID is null)
        {
            var found = FindPartByKeyword(data.Parts, BlinkKeywords);
            if (found is not null) blinkPartID = found.PartID;
        }
        if (mouthPartID is null)
        {
            var found = FindPartByKeyword(data.Parts, MouthKeywords);
            if (found is not null) mouthPartID = found.PartID;
        }

        // 5. blink役とmouth役の両方に該当する場合は mouth を優先
        if (blinkPartID is not null && blinkPartID == mouthPartID)
        {
            blinkPartID = null;
            blinkExplicit = false;
        }

        return new PartRoles
        {
            BlinkPartID = blinkPartID,
            BlinkExplicit = blinkExplicit,
            MouthPartID = mouthPartID,
            MouthExplicit = mouthExplicit,
        };
    }

    private static EmgPart? FindPartByKeyword(List<EmgPart> parts, string[] keywords) =>
        parts.FirstOrDefault(p =>
            p.ResolvedType == "switch" &&
            keywords.Any(kw => p.PartID.Contains(kw, StringComparison.OrdinalIgnoreCase)));

    /// <summary>
    /// 1フレーム分の「switchパーツごとに表示すべきtextureID」を解決する。
    /// static パーツはここには含まれない（呼び出し側は常に全レイヤーを描画してよい）。
    /// キーは partID。
    /// </summary>
    public static Dictionary<string, string> ResolveActiveTextures(
        EmgData data, EmgMapping? mapping, EmgAutoSetup setup, ResolverState state)
    {
        var result = new Dictionary<string, string>();

        // 1. 各 switch パーツを default で初期化
        foreach (var part in data.Parts.Where(p => p.ResolvedType == "switch"))
        {
            if (part.Default is not null) result[part.PartID] = part.Default;
        }

        // 2. 表情の解決（.parts / .eyebrow / .other を適用）。overrides があれば blink/lipSync 解決に使う。
        //    mapping.json が無い .emg でも 3./4. の自動セットアップによるアニメーションは動くため、
        //    ここで早期 return してはいけない（旧実装は mapping が無いと一切動かなかった）。
        var expr = ResolveExpression(mapping, state.ExpressionName);
        EmgBlinkTextures? blinkOverride = null;
        EmgLipSyncTextures? lipSyncOverride = null;
        if (expr is not null)
        {
            // v0.5.0 §5.3: presetID を先に適用する。expr.Parts は後から上書きするため優先される。
            ApplyPresetParts(data, expr.PresetID, result);
            ApplyExpressionParts(data, expr, result);
            blinkOverride = expr.Overrides?.Blink;
            lipSyncOverride = expr.Overrides?.LipSync;
        }

        // 3. blink 解決
        ApplyBlink(setup, state, blinkOverride, result);

        // 4. lipSync 解決
        ApplyLipSync(setup, state, lipSyncOverride, result);

        return result;
    }

    /// <summary>
    /// v0.5.0 §5。プリセットの parts を適用する。指定されていない partID は変更しない（§5.2）。
    /// </summary>
    private static void ApplyPresetParts(EmgData data, string? presetID, Dictionary<string, string> result)
    {
        if (string.IsNullOrEmpty(presetID)) return;
        var preset = data.Presets.FirstOrDefault(p => p.PresetID == presetID);
        if (preset?.Parts is null) return;

        foreach (var (partID, frameID) in preset.Parts)
        {
            var part = data.Parts.FirstOrDefault(p => p.PartID == partID);
            if (part is null || !part.Layers.Any(l => l.FrameID == frameID)) continue;
            result[partID] = frameID;
        }
    }

    /// <summary>
    /// v0.5.0 §4。このフレームで非表示にすべき partID を返す。
    ///
    /// 起点は parts[].defaultVisible。表情が presetID を持つ場合、そのプリセットの
    /// toggles が上書きする。プリセットに現れない partID は変更しない（§5.2）。
    /// </summary>
    public static HashSet<string> ResolveHiddenParts(EmgData data, EmgMapping? mapping, ResolverState state)
    {
        var hidden = new HashSet<string>();
        foreach (var part in data.Parts)
        {
            if (!part.ResolvedDefaultVisible) hidden.Add(part.PartID);
        }

        var expr = ResolveExpression(mapping, state.ExpressionName);
        if (expr?.PresetID is { } pid)
        {
            var preset = data.Presets.FirstOrDefault(p => p.PresetID == pid);
            if (preset?.Toggles is not null)
            {
                foreach (var (partID, visible) in preset.Toggles)
                {
                    if (!data.Parts.Any(p => p.PartID == partID)) continue;
                    if (visible) hidden.Remove(partID);
                    else hidden.Add(partID);
                }
            }
        }
        return hidden;
    }

    public static EmgExpression? ResolveExpression(EmgMapping? mapping, string? expressionName)
    {
        if (mapping is null) return null;
        if (expressionName is not null && mapping.Expressions.TryGetValue(expressionName, out var e)) return e;
        if (mapping.Expressions.TryGetValue("default", out var def)) return def;
        return null;
    }

    private static void ApplyExpressionParts(EmgData data, EmgExpression expr, Dictionary<string, string> result)
    {
        if (expr.Parts is not null)
        {
            foreach (var (partID, layerIDs) in expr.Parts)
            {
                if (layerIDs.Count == 0) continue;
                // 複数レイヤー同時表示は Direct2D 描画側で「partIDに属し、layerIDsに含まれる全レイヤーを描画」
                // として扱う想定。ここでは代表として先頭を active texture として記録しておく
                // （EmgTachieSource 側は expr.Parts を直接参照して複数枚描画すること）。
                result[partID] = layerIDs[0];
            }
        }

        if (expr.Eyebrow is { } eyebrow)
        {
            // JS版リファレンス実装と同じ仕様: partID "eyebrow" を持つパーツへの単一レイヤー指定として扱う。
            result["eyebrow"] = eyebrow;
        }

        if (expr.Other is { } other)
        {
            foreach (var layerID in other)
            {
                var owner = data.Parts.FirstOrDefault(p => p.Layers.Any(l => l.FrameID == layerID));
                if (owner is not null) result[owner.PartID] = layerID;
            }
        }
    }

    /// <summary>
    /// まばたきの適用。EmgAutoSetup が決めた「開→閉」のレイヤー列から、
    /// 現在の開き具合(0..1)に対応する1枚を選ぶ（枚数は2枚でも25枚でも可）。
    /// </summary>
    private static void ApplyBlink(
        EmgAutoSetup setup, ResolverState state, EmgBlinkTextures? activeOverride, Dictionary<string, string> result)
    {
        var partID = setup.Roles.BlinkPartID;
        if (partID is null) return;

        // 表情ごとの override があればそちらのレイヤー列を優先する。
        var layers = setup.BlinkLayers;
        if (activeOverride is not null)
        {
            var overrideLayers = new[] { activeOverride.Open, activeOverride.Half, activeOverride.Closed }
                .Where(v => !string.IsNullOrEmpty(v)).Select(v => v!).ToList();
            if (overrideLayers.Count >= 2) layers = overrideLayers;
        }

        if (layers is null || layers.Count == 0) return;

        double openness = state.EyeMode switch
        {
            EmgEyeAnimationMode.AlwaysOpen => 1.0,
            EmgEyeAnimationMode.AlwaysClose => 0.0,
            _ => state.BlinkOpenness,
        };

        var textureID = EmgAnimation.SelectByOpenness(layers, openness);
        if (textureID is not null) result[partID] = textureID;
    }

    /// <summary>
    /// リップシンクの適用。母音（ITachieSource2 経由で YMM4 から渡る MouthShape）を優先し、
    /// 母音レイヤーが揃っていない .emg では音量ベースにフォールバックする。
    /// </summary>
    private static void ApplyLipSync(
        EmgAutoSetup setup, ResolverState state, EmgLipSyncTextures? activeOverride, Dictionary<string, string> result)
    {
        var partID = setup.Roles.MouthPartID;
        if (partID is null) return;

        // 表情ごとの override があればそちらの母音マップを優先する。
        var vowels = setup.VowelLayers;
        if (activeOverride is not null)
        {
            var overrideVowels = new Dictionary<EmgMouthShape, string>();
            if (!string.IsNullOrEmpty(activeOverride.A)) overrideVowels[EmgMouthShape.A] = activeOverride.A!;
            if (!string.IsNullOrEmpty(activeOverride.I)) overrideVowels[EmgMouthShape.I] = activeOverride.I!;
            if (!string.IsNullOrEmpty(activeOverride.U)) overrideVowels[EmgMouthShape.U] = activeOverride.U!;
            if (!string.IsNullOrEmpty(activeOverride.E)) overrideVowels[EmgMouthShape.E] = activeOverride.E!;
            if (!string.IsNullOrEmpty(activeOverride.O)) overrideVowels[EmgMouthShape.O] = activeOverride.O!;
            if (!string.IsNullOrEmpty(activeOverride.N)) overrideVowels[EmgMouthShape.Silent] = activeOverride.N!;
            if (overrideVowels.Count >= 2) vowels = overrideVowels;
        }

        var volumeLayers = setup.MouthVolumeLayers;

        string? textureID = state.MouthMode switch
        {
            EmgMouthAnimationMode.AlwaysClose =>
                PickVowel(vowels, EmgMouthShape.Silent) ?? PickByVolume(volumeLayers, 0.0),

            EmgMouthAnimationMode.AlwaysOpen =>
                PickVowel(vowels, EmgMouthShape.A) ?? PickByVolume(volumeLayers, 1.0),

            EmgMouthAnimationMode.VolumePriority =>
                PickByVolume(volumeLayers, state.MouthOpenness) ?? PickVowel(vowels, state.MouthShape),

            // 既定は母音優先（YMM4 の PSD 立ち絵の既定 VowelLipSyncPriority と同じ）
            _ => PickVowel(vowels, state.MouthShape) ?? PickByVolume(volumeLayers, state.MouthOpenness),
        };

        if (textureID is not null) result[partID] = textureID;
    }

    private static string? PickVowel(Dictionary<EmgMouthShape, string>? vowels, EmgMouthShape shape)
    {
        if (vowels is null) return null;
        if (vowels.TryGetValue(shape, out var exact)) return exact;
        // 目的の母音が定義されていない場合、A（最も口が開く形）で代用する。
        if (shape != EmgMouthShape.Silent && vowels.TryGetValue(EmgMouthShape.A, out var fallback)) return fallback;
        return null;
    }

    private static string? PickByVolume(List<string>? volumeLayers, double openness)
    {
        if (volumeLayers is null || volumeLayers.Count == 0) return null;
        // volumeLayers は「閉→開」の順。SelectByOpenness は「開→閉」を前提とするため反転して渡す。
        int index = Math.Clamp((int)(volumeLayers.Count * openness), 0, volumeLayers.Count - 1);
        return volumeLayers[index];
    }

    /// <summary>
    /// sprites[] と mapping.json の共存ルール（MUST NOT trigger）。
    /// mapping.json で明示的（Explicit）にblink/mouth対象指定されたpartIDへの自律発火は抑制する。
    /// </summary>
    public static bool ShouldSuppressSprite(EmgSprite sprite, PartRoles roles) =>
        (sprite.TargetPartID == roles.BlinkPartID && roles.BlinkExplicit) ||
        (sprite.TargetPartID == roles.MouthPartID && roles.MouthExplicit);
}
