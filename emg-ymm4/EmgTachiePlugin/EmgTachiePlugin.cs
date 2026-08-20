using YukkuriMovieMaker.Commons;
using YukkuriMovieMaker.Plugin;
using YukkuriMovieMaker.Plugin.Tachie;

namespace EmgTachiePlugin;

// ITachiePlugin のエントリポイント実装。
// YukkuriMovieMaker4PluginSamples/YMM4SamplePlugin/Tachie/SampleTachiePlugin.cs と
// 同じ構造で実装している（メソッドの単純委譲パターンもそのまま踏襲）。
//
// IPlugin.Details / IPlugin.Updater は実DLL（YukkuriMovieMaker.Plugin.dll）をリフレクションで
// 確認した結果、abstract ではなく既定実装を持つプロパティだった（Details は
// [PluginDetails] 属性を読み取って返す実装と推測される）。そのため自前でオーバーライドせず、
// [PluginDetails] 属性で必要な情報だけを付与する。
[PluginDetails(AuthorName = "pxrllc")]
public sealed class EmgTachiePlugin : ITachiePlugin
{
    public string Name => "EMG 立ち絵プラグイン";

    public ITachieCharacterParameter CreateCharacterParameter() => new EmgCharacterParameter();

    public ITachieItemParameter CreateItemParameter() => new EmgItemParameter();

    public ITachieFaceParameter CreateFaceParameter() => new EmgFaceParameter();

    public ITachieSource CreateTachieSource(IGraphicsDevicesAndContext devices) => new EmgTachieSource(devices);

    // AviUtl(.exo) 互換出力。doc/emg-ymm4-plugin-verification.md で「詳細未検証」とされていた項目で、
    // 今回もスコープ外。空実装のまま（サンプルと同じ）。
    public IEnumerable<ExoItem> CreateExoItems(
        int FPS,
        IEnumerable<TachieItemExoDescription> tachieItemDescriptions,
        IEnumerable<TachieFaceItemExoDescription> faceItemDescriptions,
        IEnumerable<TachieVoiceItemExoDescription> voiceDescriptions)
    {
        return [];
    }

    public bool HasScriptFile => false;

    public void CreateScriptFile(string scriptDirectoryPath)
    {
        // スクリプト書き出し機能は未実装。
    }
}
