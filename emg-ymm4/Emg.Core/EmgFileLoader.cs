using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Emg.Core;

// .emg（ZIP）を読み込んだ結果。data.json は必須、mapping.json は任意（無ければ null）。
// texture.png 等のアトラス画像は ImageFileSourceFactory（YMM4提供、ファイルパスを要求する）で
// ロードする都合上、ZIP内から一時ディレクトリへ展開したファイルパスを保持する。
public sealed class EmgLoadResult
{
    public required EmgData Data { get; init; }
    public EmgMapping? Mapping { get; init; }

    // textureFile（例 "texture.png"）-> 展開済み一時ファイルの絶対パス
    public required Dictionary<string, string> TextureFilePaths { get; init; }
}

public static class EmgFileLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
    };

    /// <summary>
    /// .emg ファイルを読み込む。cacheRootDirectory 配下に .emg ファイルパスのハッシュを
    /// サブディレクトリ名としてテクスチャ画像を展開する（同一ファイルの再ロード時はキャッシュ流用可能）。
    /// </summary>
    public static EmgLoadResult Load(string emgFilePath, string cacheRootDirectory)
    {
        using var archive = ZipFile.OpenRead(emgFilePath);

        // data.json / model.json いずれの命名でも読めるよう、他プラットフォーム実装
        // （emg-player.0.3.0.js 等）と同じフォールバック方針を踏襲する：
        // 1. ファイル名が "data.json" で終わるものを優先
        // 2. 無ければ ".json" で終わり、かつ "mapping.json" では終わらない最初のもの
        var dataEntry =
            FindEntry(archive, e => e.FullName.EndsWith("data.json", StringComparison.OrdinalIgnoreCase)) ??
            FindEntry(archive, e =>
                e.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase) &&
                !e.FullName.EndsWith("mapping.json", StringComparison.OrdinalIgnoreCase));

        if (dataEntry is null)
            throw new InvalidDataException($"'{emgFilePath}' 内にメインの JSON（data.json）が見つかりません。");

        var data = ReadJson<EmgData>(dataEntry);

        // mapping.json は完全にオプショナルなコンパニオンファイル。無い/壊れていても
        // 全体のロードを失敗させない（emg-mapping-spec.md の後方互換方針）。
        EmgMapping? mapping = null;
        var mappingEntry = FindEntry(archive, e => e.FullName.EndsWith("mapping.json", StringComparison.OrdinalIgnoreCase));
        if (mappingEntry is not null)
        {
            try
            {
                mapping = ReadJson<EmgMapping>(mappingEntry);
            }
            catch (Exception)
            {
                // 壊れた mapping.json は無視して継続。data.json の parts[].default のみで
                // 静的表示させる（仕様上の想定挙動）。
                mapping = null;
            }
        }

        var cacheDir = Path.Combine(cacheRootDirectory, HashPath(emgFilePath));
        Directory.CreateDirectory(cacheDir);

        var textureFilePaths = new Dictionary<string, string>();
        foreach (var tex in data.Textures)
        {
            var entry = FindEntry(archive, e => e.FullName.EndsWith(tex.TextureFile, StringComparison.OrdinalIgnoreCase));
            if (entry is null) continue;

            var destPath = Path.Combine(cacheDir, SanitizeFileName(tex.TextureFile));
            // 既に同名で展開済みなら再展開しない（ZIPの更新日時までは見ない簡易キャッシュ）。
            if (!File.Exists(destPath))
            {
                entry.ExtractToFile(destPath, overwrite: true);
            }
            textureFilePaths[tex.TextureFile] = destPath;
        }

        return new EmgLoadResult
        {
            Data = data,
            Mapping = mapping,
            TextureFilePaths = textureFilePaths,
        };
    }

    private static T ReadJson<T>(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        var result = JsonSerializer.Deserialize<T>(stream, JsonOptions);
        return result ?? throw new InvalidDataException($"'{entry.FullName}' のパースに失敗しました。");
    }

    private static ZipArchiveEntry? FindEntry(ZipArchive archive, Func<ZipArchiveEntry, bool> predicate)
    {
        foreach (var entry in archive.Entries)
        {
            if (predicate(entry)) return entry;
        }
        return null;
    }

    private static string SanitizeFileName(string name)
    {
        var fileName = name.Replace('\\', '/').Split('/')[^1];
        foreach (var c in Path.GetInvalidFileNameChars())
        {
            fileName = fileName.Replace(c, '_');
        }
        return fileName;
    }

    private static string HashPath(string path)
    {
        var bytes = SHA1.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(path)));
        var sb = new StringBuilder();
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
