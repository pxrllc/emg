using System.Reflection;
using System.Windows;
using YukkuriMovieMaker.Commons;

namespace EmgTachiePlugin.Editors;

public enum EmgLayerEditorMode
{
    /// <summary>パーツごとに表示するレイヤーを選ぶ（表情・衣装差分の切り替え）。</summary>
    Display,

    /// <summary>まばたきに使うレイヤー（開／半開／閉）を選ぶ。</summary>
    Blink,

    /// <summary>母音（あ/い/う/え/お/ん）ごとの口レイヤーを選ぶ。</summary>
    Vowel,
}

/// <summary>
/// .emg のレイヤーをサムネイル付きで選ぶプロパティエディタ。
///
/// 実装形式は YMM4 標準の PSD 立ち絵プラグイン（PsdLayerEditorAttribute、逆コンパイルで確認済み）
/// と同じ:
///   - PropertyEditorAttribute を継承し Create()/SetBindings()/ClearBindings() を実装する
///   - IPropertyEditorForTachieParameterAttribute を実装すると、YMM4 の CharacterEditorViewModel が
///     CharacterParameter（＝EmgCharacterParameter、.emg のパスを持つ）を自動で注入してくれる。
///     表情アイテム／立ち絵アイテムのプロパティを編集しているときでも、どの .emg のレイヤーを
///     選ばせればよいかはキャラクター側にしか無いため、この注入が必須。
/// </summary>
public class EmgLayerEditorAttribute : PropertyEditorAttribute, IPropertyEditorForTachieParameterAttribute
{
    public EmgLayerEditorMode Mode { get; }

    public object? CharacterParameter
    {
        get => characterParameter;
        set => Set(ref characterParameter, value);
    }
    private object? characterParameter;

    public EmgLayerEditorAttribute(EmgLayerEditorMode mode)
    {
        Mode = mode;
    }

    public override FrameworkElement Create() => new EmgLayerEditor();

    public override void SetBindings(FrameworkElement control, object item, object propertyOwner, PropertyInfo propertyInfo)
    {
        if (control is not EmgLayerEditor editor) return;
        editor.Initialize(Mode, CharacterParameter as EmgCharacterParameter, propertyOwner, propertyInfo);
    }

    public override void ClearBindings(FrameworkElement control)
    {
        (control as EmgLayerEditor)?.Cleanup();
    }
}
