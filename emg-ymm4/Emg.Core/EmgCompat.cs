namespace Emg.Core;

/// <summary>
/// EMG v0.4.0 の互換性規則（emg-json-spec-0.4.0.md 1〜2 章）。
///
/// 未知の値の扱いは <see cref="EmgPart.ResolvedType"/> 等のプロパティ側に置いてあるため、
/// ここが担うのは requiredExtensions の検証のみ。
/// </summary>
public static class EmgCompat
{
    /// <summary>
    /// この実装が理解する機能識別子（emg-extensions-registry.md）。
    /// EMG_frame_name:  v0.5.0 §2 の frameName に対応済み。
    /// EMG_switch_none: v0.5.0 §4.3 の「switch を初期状態で非表示」に対応済み。
    ///
    /// EMG_layer_transform（0.5.3 §7.4.1）を載せているのは、**このプラグインが §7 の
    /// トランスフォームを一切適用していない**ため。適用しない実装にとって targetLayer の
    /// 無視は「アニメーションしない」に留まり、絵は正しいまま静止する。登録簿 §2.2 は
    /// この劣化に対する宣言を禁じている（不必要に実装を締め出すため）。
    ///
    /// **§7 を実装する者への条件:** そのとき <see cref="EmgSprite.TargetLayer"/> で対象
    /// レイヤーを絞らなければ、この行は嘘になる（パーツ全体が動き「別の絵」になる）。
    /// 絞れないなら、同時にこの識別子をここから外すこと。
    /// </summary>
    public static readonly IReadOnlySet<string> SupportedExtensions =
        new HashSet<string> { "EMG_frame_name", "EMG_switch_none", "EMG_layer_transform" };

    /// <summary>
    /// v0.4.0 §2.2。未知の識別子が 1 つでもあれば例外を投げる。
    /// 理解できない拡張を黙って無視すると誤った絵を描くため、明示的に失敗させる。
    /// </summary>
    public static void Validate(EmgData data)
    {
        var unknown = data.RequiredExtensions
            .Where(e => !SupportedExtensions.Contains(e))
            .ToList();

        if (unknown.Count > 0)
        {
            throw new NotSupportedException(
                $"この .emg は未対応の機能を要求しています: {string.Join(", ", unknown)}。" +
                "プラグインの更新が必要です。");
        }
    }
}
