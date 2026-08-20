using System.Collections.Immutable;
using System.ComponentModel.DataAnnotations;
using EmgTachiePlugin.Editors;
using YukkuriMovieMaker.Commons;
using YukkuriMovieMaker.Controls;
using YukkuriMovieMaker.Plugin.Tachie;

namespace EmgTachiePlugin;

// アイテム単位のパラメータ（配置サイズ・オフセット等）。
// emg-ymm4-plugin-verification.md の「ギャップ3：キャンバスサイズの不一致」対策として、
// baseCanvasWidth/Height と YMM4側の配置サイズを合わせるための拡大率・オフセットを持たせる。
public sealed class EmgItemParameter : TachieItemParameterBase
{
    // TachieItemParameterBase は Animatable を継承しており GetAnimatables() の実装が必須
    // （実際に F:\YukkuriMovieMaker_v4\YukkuriMovieMaker.Plugin.dll をリフレクションで確認済み）。
    // Scale/OffsetX/OffsetY は素の double プロパティであり、YMM4のキーフレームアニメーション対象
    // （Animation<double> 等でラップされたプロパティ）にはなっていないため、空を返す。
    // キーフレーム対応させたい場合はプロパティの実装方式自体を見直す必要がある。
    protected override IEnumerable<IAnimatable> GetAnimatables() => [];

    [Display(Name = "拡大率", Description = "EMGのbaseCanvasサイズに対する表示倍率")]
    public double Scale
    {
        get => scale;
        set => Set(ref scale, value);
    }
    private double scale = 1.0;

    [Display(Name = "オフセットX")]
    public double OffsetX
    {
        get => offsetX;
        set => Set(ref offsetX, value);
    }
    private double offsetX;

    [Display(Name = "オフセットY")]
    public double OffsetY
    {
        get => offsetY;
        set => Set(ref offsetY, value);
    }
    private double offsetY;

    // himari3.emg のような、emg-packer の既知のz-index計算バグ（前面/背面が反転して
    // 書き出されたPSDのレイヤー順）を持つ実データに対する実用的な回避策。
    // ファイルを再書き出しせずにYMM4側で重なり順を補正できるようにする。
    // bool プロパティは [Display] だけでは property editor が生成されず UI に出てこない
    // （実DLL: YukkuriMovieMaker.Plugin.Tachie.Psd.PsdTachieItemParameter.IsHiddenWhenNoSpeech を
    // 逆コンパイルして確認済み。[ToggleSlider] が必須）。
    [Display(Name = "Z-Index反転", Description = "レイヤーの重なり順（textureZIndex）の昇順・降順を反転する")]
    [ToggleSlider]
    public bool ReverseZIndex
    {
        get => reverseZIndex;
        set => Set(ref reverseZIndex, value);
    }
    private bool reverseZIndex;

    [Display(Name = "セリフが無いときは非表示", Description = "この立ち絵アイテムの区間に音声が無い場合、立ち絵を表示しません")]
    [ToggleSlider]
    public bool IsHiddenWhenNoSpeech
    {
        get => isHiddenWhenNoSpeech;
        set => Set(ref isHiddenWhenNoSpeech, value);
    }
    private bool isHiddenWhenNoSpeech;

    [Display(Name = "表示レイヤー", Description = "この立ち絵アイテムの区間で表示するレイヤー。表情アイテム側の指定が優先されます")]
    [EmgLayerEditor(EmgLayerEditorMode.Display, PropertyEditorSize = PropertyEditorSize.FullWidth)]
    public ImmutableList<string> LayerOverrides
    {
        get => layerOverrides;
        set { if (!layerOverrides.SequenceEqual(value)) Set(ref layerOverrides, value); }
    }
    private ImmutableList<string> layerOverrides = ImmutableList<string>.Empty;
}
