using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Emg.Core;

namespace EmgTachiePlugin.Editors;

/// <summary>レイヤー選択 UI に出す1件分の選択肢。</summary>
public sealed class EmgLayerChoice
{
    public required string PartID { get; init; }
    public required string TextureID { get; init; }
    public ImageSource? Thumbnail { get; init; }

    /// <summary>「(なし)」「(変更しない)」のような、実レイヤーを指さない特殊項目かどうか。</summary>
    public bool IsNone { get; init; }

    public string Display => IsNone ? TextureID : $"{PartID} / {TextureID}";
}

/// <summary>
/// .emg からパーツ・レイヤー一覧とサムネイルを供給する。
/// エディタを開くたびに数MBのZIPを展開し直さないよう、ファイルパス単位でキャッシュする。
/// </summary>
public static class EmgLayerCatalog
{
    private sealed class Entry
    {
        public required EmgData Data { get; init; }
        public required List<EmgLayerChoice> Choices { get; init; }
        public DateTime LastWriteTime { get; init; }
    }

    private static readonly Dictionary<string, Entry> cache = new();
    private static readonly object gate = new();

    public static EmgData? GetData(string? emgFilePath) => Load(emgFilePath)?.Data;

    /// <summary>全 switch パーツの全レイヤーを、サムネイル付きの選択肢として返す。</summary>
    public static IReadOnlyList<EmgLayerChoice> GetChoices(string? emgFilePath) =>
        Load(emgFilePath)?.Choices ?? new List<EmgLayerChoice>();

    private static Entry? Load(string? emgFilePath)
    {
        if (string.IsNullOrEmpty(emgFilePath) || !File.Exists(emgFilePath)) return null;

        lock (gate)
        {
            var lastWrite = File.GetLastWriteTimeUtc(emgFilePath);
            if (cache.TryGetValue(emgFilePath, out var cached) && cached.LastWriteTime == lastWrite)
                return cached;

            try
            {
                var cacheDir = Path.Combine(Path.GetTempPath(), "EmgTachiePlugin");
                var loaded = EmgFileLoader.Load(emgFilePath, cacheDir);
                var entry = new Entry
                {
                    Data = loaded.Data,
                    Choices = BuildChoices(loaded),
                    LastWriteTime = lastWrite,
                };
                cache[emgFilePath] = entry;
                return entry;
            }
            catch (Exception)
            {
                // UI 側は選択肢が空になるだけで、プレビュー描画側とは独立して失敗できる。
                return null;
            }
        }
    }

    private static List<EmgLayerChoice> BuildChoices(EmgLoadResult loaded)
    {
        var atlases = new Dictionary<string, BitmapSource>();
        foreach (var (textureFile, path) in loaded.TextureFilePaths)
        {
            var bitmap = LoadBitmap(path);
            if (bitmap is not null) atlases[textureFile] = bitmap;
        }

        var choices = new List<EmgLayerChoice>();
        foreach (var part in loaded.Data.Parts)
        {
            // static パーツは常に全レイヤーが描画されるので、選択肢に出しても意味がない。
            if (part.Type != "switch") continue;

            foreach (var layer in part.Layers)
            {
                choices.Add(new EmgLayerChoice
                {
                    PartID = part.PartID,
                    TextureID = layer.TextureID,
                    Thumbnail = CreateThumbnail(atlases, loaded.Data, layer),
                });
            }
        }
        return choices;
    }

    private static BitmapSource? LoadBitmap(string path)
    {
        try
        {
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.UriSource = new Uri(path);
            bitmap.CacheOption = BitmapCacheOption.OnLoad;   // ファイルを掴みっぱなしにしない
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// アトラスから1レイヤー分を切り出したサムネイルを作る。
    /// textureID が "14" のような数字だけの .emg でも、絵を見て選べるようにするのが目的。
    /// CroppedBitmap は元のビットマップを共有するので、レイヤーが何十枚あってもメモリはアトラス1枚分。
    /// </summary>
    private static ImageSource? CreateThumbnail(
        Dictionary<string, BitmapSource> atlases, EmgData data, EmgLayer layer)
    {
        var textureFile = !string.IsNullOrEmpty(layer.TextureFile)
            ? layer.TextureFile
            : data.Textures.FirstOrDefault()?.TextureFile;
        if (textureFile is null || !atlases.TryGetValue(textureFile, out var atlas)) return null;

        int x = (int)layer.X, y = (int)layer.Y, w = (int)layer.Width, h = (int)layer.Height;
        if (w <= 0 || h <= 0) return null;
        // アトラス外を指す不正な座標で CroppedBitmap が例外を投げないようにクランプする。
        if (x < 0 || y < 0 || x + w > atlas.PixelWidth || y + h > atlas.PixelHeight) return null;

        try
        {
            var cropped = new CroppedBitmap(atlas, new System.Windows.Int32Rect(x, y, w, h));
            cropped.Freeze();
            return cropped;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
