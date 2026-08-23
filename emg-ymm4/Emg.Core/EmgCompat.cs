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
    /// v0.4.0 の範囲では 1 つも実装していないため空。v0.5.0 の機能を実装した時点で
    /// 対応する識別子をここへ追加する。
    /// </summary>
    public static readonly IReadOnlySet<string> SupportedExtensions = new HashSet<string>();

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
