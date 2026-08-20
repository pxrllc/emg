using System.Collections.Immutable;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using EmgTachiePlugin.Editors;
using YukkuriMovieMaker.Commons;
using YukkuriMovieMaker.Controls;
using YukkuriMovieMaker.Plugin.Tachie;
using YukkuriMovieMaker.Settings;

namespace EmgTachiePlugin;

// TachieCharacterParameterBase はプロパティを持たない空のマーカー基底クラス
// （doc/emg-ymm4-plugin-verification.md の調査結果より）。継承先で自由にプロパティを定義できる。
// YMM4公式サンプル（SampleTachieCharacterParameter.cs）に倣い [Display] を付与し、
// Set(ref field, value) で変更通知する（基底クラスが INotifyPropertyChanged 相当を提供している前提）。
public sealed class EmgCharacterParameter : TachieCharacterParameterBase
{
    // ファイル選択UI: YMM4標準の YukkuriMovieMaker.Controls.FileSelectorAttribute をそのまま使う
    // （F:\YukkuriMovieMaker_v4\YukkuriMovieMaker.Plugin.dll をリフレクション/逆コンパイルで実際に確認済み）。
    // 標準の .psd 立ち絵プラグイン（PsdTachieCharacterParameter.FilePath）が全く同じパターンで
    // FileGroupType.None + FileType.None + CustomFilterName/CustomFilterValue によるカスタム拡張子
    // フィルタを使っていたため、それに倣って "*.emg" 用に指定する。
    [Display(Name = ".emg ファイル", Description = "読み込む EMG (v0.3.0) ファイルのフルパス", Order = 1)]
    [FileSelector(FileGroupType.None, FileType = FileType.None, CustomFilterName = "EMGファイル", CustomFilterValue = "*.emg")]
    public string? EmgFilePath
    {
        get => emgFilePath;
        set => Set(ref emgFilePath, value);
    }
    private string? emgFilePath;

    // 以下は口パク・まばたきの調整用。EMG は mapping.json / レイヤー名から自動セットアップされるため
    // 通常は触る必要がないが、PSD 立ち絵プラグインと同等の手動調整手段として用意している。

    [Display(Name = "口パク感度", Description = "音量ベースの口パクの感度。母音リップシンクが有効な場合は使われません", Order = 2)]
    [TextBoxSlider("F1", "%", 0.0, 100.0)]
    [Range(0.0, 100000.0)]
    [DefaultValue(100.0)]
    public double MouthSensitivity
    {
        get => mouthSensitivity;
        set => Set(ref mouthSensitivity, value);
    }
    private double mouthSensitivity = 100.0;

    [Display(Name = "まばたき開始位置", Description = "最初のまばたきまでの待ち時間。0 なら .emg ファイルごとに自動（0〜まばたき間隔）", Order = 3)]
    [TextBoxSlider("F2", "秒", 0.0, 30.0)]
    [Range(0.0, 100000.0)]
    public double BlinkOffset
    {
        get => blinkOffset;
        set => Set(ref blinkOffset, value);
    }
    private double blinkOffset;

    [Display(Name = "まばたき間隔", Description = "0 なら .emg ファイルごとに自動（5〜10秒）", Order = 4)]
    [TextBoxSlider("F2", "秒", 0.0, 30.0)]
    [Range(0.0, 100000.0)]
    public double BlinkInterval
    {
        get => blinkInterval;
        set => Set(ref blinkInterval, value);
    }
    private double blinkInterval;

    // 以下2つは、mapping.json を持たない .emg（textureID が "14"/"24" のような数字だけのファイル等）
    // でも YMM4 上だけでまばたき・口パクを設定できるようにするためのもの。
    // 中身の差し替えで変更通知が飛ぶよう ImmutableList を使う（Dictionary だと中身を書き換えても
    // 通知されず、プレビューが更新されない）。

    [Display(Name = "まばたきレイヤー", Description = "開いた状態→閉じた状態の順。未設定なら mapping.json / レイヤー名から自動設定されます", Order = 5)]
    [EmgLayerEditor(EmgLayerEditorMode.Blink, PropertyEditorSize = PropertyEditorSize.FullWidth)]
    public ImmutableList<string> BlinkLayers
    {
        get => blinkLayers;
        set { if (!blinkLayers.SequenceEqual(value)) Set(ref blinkLayers, value); }
    }
    private ImmutableList<string> blinkLayers = ImmutableList<string>.Empty;

    [Display(Name = "口パクレイヤー（母音）", Description = "あ/い/う/え/お/ん に対応する口のレイヤー。未設定なら mapping.json / レイヤー名から自動設定されます", Order = 6)]
    [EmgLayerEditor(EmgLayerEditorMode.Vowel, PropertyEditorSize = PropertyEditorSize.FullWidth)]
    public ImmutableList<string> VowelLayers
    {
        get => vowelLayers;
        set { if (!vowelLayers.SequenceEqual(value)) Set(ref vowelLayers, value); }
    }
    private ImmutableList<string> vowelLayers = ImmutableList<string>.Empty;
}
