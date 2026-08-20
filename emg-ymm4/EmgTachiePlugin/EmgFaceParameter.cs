using System.Collections.Immutable;
using System.ComponentModel.DataAnnotations;
using Emg.Core;
using EmgTachiePlugin.Editors;
using YukkuriMovieMaker.Commons;
using YukkuriMovieMaker.Controls;
using YukkuriMovieMaker.Plugin.Tachie;

namespace EmgTachiePlugin;

// 表情アイテムのパラメータ。mapping.json の expressions キー名を選ぶ想定。
// TODO: expressions のキー一覧からコンボボックスを生成するUI（doc/emg-ymm4-plugin-verification.md の
// 提案）は、対応する属性/コントロールの実物が未確認のため、まずは文字列直接入力にしている。
public sealed class EmgFaceParameter : TachieFaceParameterBase
{
    // TachieFaceParameterBase も Animatable 継承（実DLLで確認済み）。ExpressionName は
    // アニメーション対象ではない文字列プロパティのため空を返す。
    protected override IEnumerable<IAnimatable> GetAnimatables() => [];

    [Display(Name = "表情名", Description = "mapping.json の expressions キー名（空欄で \"default\"）", Order = 1)]
    public string? ExpressionName
    {
        get => expressionName;
        set => Set(ref expressionName, value);
    }
    private string? expressionName = "default";

    [Display(Name = "まばたき", Description = "まばたきの動作。既定では自動でまばたきします", Order = 2)]
    [EnumComboBox]
    public EmgEyeAnimationMode EyeAnimation
    {
        get => eyeAnimation;
        set => Set(ref eyeAnimation, value);
    }
    private EmgEyeAnimationMode eyeAnimation = EmgEyeAnimationMode.Default;

    [Display(Name = "口パク", Description = "既定では母音（あいうえお）に合わせて口を動かし、母音が定義されていない .emg では音量ベースに切り替わります", Order = 3)]
    [EnumComboBox]
    public EmgMouthAnimationMode MouthAnimation
    {
        get => mouthAnimation;
        set => Set(ref mouthAnimation, value);
    }
    private EmgMouthAnimationMode mouthAnimation = EmgMouthAnimationMode.VowelPriority;

    [Display(Name = "表示レイヤー", Description = "この表情アイテムの区間で表示するレイヤー。まばたき・口パクに使われているパーツは対象外です", Order = 4)]
    [EmgLayerEditor(EmgLayerEditorMode.Display, PropertyEditorSize = PropertyEditorSize.FullWidth)]
    public ImmutableList<string> LayerOverrides
    {
        get => layerOverrides;
        set { if (!layerOverrides.SequenceEqual(value)) Set(ref layerOverrides, value); }
    }
    private ImmutableList<string> layerOverrides = ImmutableList<string>.Empty;
}
