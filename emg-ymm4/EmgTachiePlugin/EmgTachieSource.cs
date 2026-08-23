using System.Collections.Immutable;
using System.IO;
using System.Numerics;
using Emg.Core;
using Vortice.Direct2D1;
using Vortice.DXGI;
using Vortice.Mathematics;
using YukkuriMovieMaker.Commons;
using YukkuriMovieMaker.Player.Video;
using YukkuriMovieMaker.Plugin;
using YukkuriMovieMaker.Plugin.Tachie;
using YukkuriMovieMaker.Plugin.Voice;

namespace EmgTachiePlugin;

/// <summary>
/// ITachieSource 実装本体。毎フレーム Update() が呼ばれ、Output（ID2D1Image）を更新する。
///
/// 構造・Dispose順序は YukkuriMovieMaker4PluginSamples/YMM4SamplePlugin/Tachie/SampleTachieSource.cs
/// を実機で確認した上で踏襲している（using文・フィールド宣言・Dispose()の呼び出し順序は
/// そのサンプルと一致させてある）。ただし、そのサンプルは「1枚の画像ファイルをそのまま表示する」
/// だけの実装であるのに対し、EMGは「テクスチャアトラスから複数レイヤーを切り出して合成する」必要が
/// あるため、レンダーターゲットへの DrawBitmap ループによる合成部分は本プラグイン独自の実装であり、
/// このリポジトリ内の他の参照実装（emg-cdn/emg-player.0.3.0.js の renderLayers、
/// emg-unity-importer の EmgController 等）と同じ考え方を Direct2D 向けに書き直したもの。
///
/// F:\YukkuriMovieMaker_v4\ にインストールされた実際のYMM4アセンブリ（.NET 10 SDK導入後）に対して
/// `dotnet build` でコンパイル成功を確認済み（警告0・エラー0）。ただしこれはコンパイルが通る
/// ことの確認であり、YMM4上での実際の描画・動作（GetAnimatables()を空にしている影響で
/// Scale/OffsetX/OffsetY がキーフレームアニメーション非対応になっている点、Direct2Dの
/// レンダーターゲット再利用ロジックの実際の描画結果等）はYMM4を実際に起動しての確認が別途必要。
/// </summary>
public sealed class EmgTachieSource : ITachieSource, ITachieSource2
{
    private readonly IGraphicsDevicesAndContext devices;
    private readonly ID2D1Bitmap empty;
    private readonly Vortice.Direct2D1.Effects.AffineTransform2D transformEffect;
    private readonly ID2D1Image output;

    private string? loadedEmgPath;
    private EmgLoadResult? loaded;

    // .emg 読み込み時、および UI でのレイヤー割り当て変更時に決まる自動セットアップ結果
    // （まばたき用レイヤー列・母音マップ等）。
    private EmgAutoSetup? setup;
    private string? loadedOverridesKey;

    // IImageFileSource は .Output（ID2D1Bitmap）の生存期間を握っている。SampleTachieSource.cs の
    // `source` フィールドと同じく、使い終わるたびに Dispose するのではなくフィールドとして
    // 保持し続け、次のロード時・クラス自体の Dispose() でのみ破棄する。
    //
    // アトラスは複数枚になりうる（emg-json-spec.md 1.3）。レイヤーは textureFile で
    // どのアトラスを参照するかを個別に指定するため、textureFile をキーに保持する。
    private readonly Dictionary<string, IImageFileSource> atlasSources = new();
    private readonly Dictionary<string, ID2D1Bitmap> atlasBitmaps = new();
    /// <summary>textures[0]。レイヤーの textureFile が解決できなかった場合のフォールバック。</summary>
    private ID2D1Bitmap? primaryAtlas;

    private ID2D1BitmapRenderTarget? compositeTarget;
    private int compositeWidth;
    private int compositeHeight;

    // 状態キー（前回と同一ならUpdateをスキップして再合成コストを避ける。
    // SampleTachieSource.cs 相当のパターンは無いが、疑似コードとして
    // doc/emg-ymm4-plugin-verification.md の Update() 疑似コードにあった最適化を踏襲）。
    // 合成結果に影響する値は全てここに含めること（ReverseZIndex を入れ忘れて「チェックボックスを
    // 切り替えても絵が変わらない」不具合を起こした前例がある）。
    // Scale/OffsetX/OffsetY は ApplyTransform() で毎フレーム適用されるため含めなくてよい。
    private (string? path, string? expr, int blinkStep, string? mouthTex, bool reverseZ, bool hidden)? lastStateKey;

    // Update() は毎フレーム呼ばれるため、例外ログはスパム防止のため直前のメッセージと
    // 異なる場合のみ書き出す。
    private string? lastLoggedError;
    private string? lastLoggedBlinkTex;

    public EmgTachieSource(IGraphicsDevicesAndContext devices)
    {
        this.devices = devices;
        var dc = devices.DeviceContext;

        // 1x1の透明ビットマップ。何もロードできていない場合のフォールバック用
        // （SampleTachieSource.cs の `empty` フィールドと同じ役割）。
        var props = new BitmapProperties(
            new Vortice.DCommon.PixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied));
        empty = dc.CreateBitmap(new SizeI(1, 1), IntPtr.Zero, 0, props);

        transformEffect = new Vortice.Direct2D1.Effects.AffineTransform2D(dc);
        transformEffect.SetInput(0, empty, true);
        output = transformEffect.Output;
    }

    public ID2D1Image Output => output;

    public void Update(
        TimeSpan tachieTime,
        TimeSpan tachieLength,
        TimeSpan faceTime,
        TimeSpan faceLength,
        ITachieCharacterParameter characterParameter,
        ITachieItemParameter itemParameter,
        ITachieFaceParameter faceParameter,
        double kuchipaku)
    {
        // 「目パーツが複数重なって描画される」という実機不具合の原因調査のため、
        // Update() が複数スレッドから同時に呼ばれていないか（YMM4 の TimelineSource.Update は
        // Parallel.ForEach でアイテムを並行更新しているのを NRE のスタックトレースで確認済み）
        // 再入検出を入れる。Direct2D の compositeTarget/アトラスはスレッドセーフではないため、
        // もし同一インスタンスへの Update() が並行実行されていれば BeginDraw/DrawBitmap/EndDraw の
        // 競合により描画が壊れる可能性がある。
        if (System.Threading.Interlocked.CompareExchange(ref updateReentrancyGuard, 1, 0) != 0)
        {
            Log.Default.Write($"[EmgTachiePlugin] !!! Update() が再入されました（別スレッドから同時実行中）threadId={Environment.CurrentManagedThreadId}");
        }

        // 実機テストで NullReferenceException を確認済み: `characterParameter` 等が YMM4 側の
        // 都合で null（またはキャラクター初期化直後で EmgCharacterParameter 以外の状態）になり得る。
        // 直接キャストすると null がそのまま代入され、次行の `.EmgFilePath` アクセスで即NREになっていた。
        // `as` + null チェックに変更し、さらに Update 全体を try/catch で保護する
        // （プラグイン側の例外でホスト(YMM4)のプレビュー再生全体を落とさないようにするため）。
        try
        {
            var chara = characterParameter as EmgCharacterParameter;
            var item = itemParameter as EmgItemParameter;
            var face = faceParameter as EmgFaceParameter;

            if (chara is null) LogOnce("characterParameter が EmgCharacterParameter ではありません（立ち絵タイプがまだ反映されていない可能性）");
            else if (item is null) LogOnce("itemParameter が EmgItemParameter ではありません");
            else if (string.IsNullOrEmpty(chara.EmgFilePath)) LogOnce("EmgFilePath が未設定です。「.emg ファイル」欄でファイルを選択してください");

            // ITachieSource（8引数版）には母音の情報が無いため、音量ベースの口パクのみになる。
            UpdateCore(tachieTime, chara, item, face, kuchipaku, EmgMouthShape.Silent, hasVowelInfo: false);
        }
        catch (Exception ex)
        {
            LogOnce("Update() で例外が発生しました: " + ex);
            transformEffect.SetInput(0, empty, true);
        }
        finally
        {
            System.Threading.Interlocked.Exchange(ref updateReentrancyGuard, 0);
        }
    }

    /// <summary>
    /// ITachieSource2 版。YMM4 の新しい呼び出し口で、こちらは母音（MouthShape）と音量
    /// （VoiceVolume）が渡ってくる。標準の PSD 立ち絵プラグインもこちらを実装しており、
    /// 母音リップシンクを実現できるのはこの経路だけ。YMM4 は ITachieSource2 を実装していれば
    /// 優先して呼ぶため、実際にはほぼこちらが使われる。
    /// </summary>
    public void Update(TachieSourceDescription desc)
    {
        if (System.Threading.Interlocked.CompareExchange(ref updateReentrancyGuard, 1, 0) != 0)
        {
            Log.Default.Write($"[EmgTachiePlugin] !!! Update() が再入されました（別スレッドから同時実行中）threadId={Environment.CurrentManagedThreadId}");
        }

        try
        {
            var faceDesc = desc.Tachie.Faces.FirstOrDefault();
            var chara = desc.Tachie.CharacterParameter as EmgCharacterParameter;
            var item = desc.Tachie.ItemParameter as EmgItemParameter;
            var face = faceDesc?.FaceParameter as EmgFaceParameter;

            UpdateCore(
                desc.ItemPosition.Time, chara, item, face,
                desc.VoiceVolume, ToEmgMouthShape(desc.MouthShape), hasVowelInfo: true);
        }
        catch (Exception ex)
        {
            LogOnce("Update(desc) で例外が発生しました: " + ex);
            transformEffect.SetInput(0, empty, true);
        }
        finally
        {
            System.Threading.Interlocked.Exchange(ref updateReentrancyGuard, 0);
        }
    }

    private static EmgMouthShape ToEmgMouthShape(MouthShape shape) => shape switch
    {
        MouthShape.A => EmgMouthShape.A,
        MouthShape.I => EmgMouthShape.I,
        MouthShape.U => EmgMouthShape.U,
        MouthShape.E => EmgMouthShape.E,
        MouthShape.O => EmgMouthShape.O,
        _ => EmgMouthShape.Silent,
    };

    private int updateReentrancyGuard;

    private void LogOnce(string message)
    {
        if (message == lastLoggedError) return;
        lastLoggedError = message;
        Log.Default.Write("[EmgTachiePlugin] " + message);
    }

    private void UpdateCore(
        TimeSpan tachieTime, EmgCharacterParameter? chara, EmgItemParameter? item, EmgFaceParameter? face,
        double voiceVolume, EmgMouthShape mouthShape, bool hasVowelInfo)
    {
        EnsureLoaded(chara);

        if (loaded is null || chara is null || item is null || setup is null)
        {
            transformEffect.SetInput(0, empty, true);
            return;
        }

        var data = loaded.Data;
        var mapping = loaded.Mapping;

        // YMM4 は「この区間に音声が無い」ことを VoiceVolume == -1.0 で表す
        // （標準の PSD 立ち絵プラグインの実装で確認済み）。
        bool isSpeaking = voiceVolume >= 0.0;

        if (item.IsHiddenWhenNoSpeech && !isSpeaking)
        {
            lastStateKey = (chara.EmgFilePath, null, -1, null, item.ReverseZIndex, true);
            transformEffect.SetInput(0, empty, true);
            return;
        }

        // 1. まばたき: アイテム内相対時刻から決定論的に開き具合を求める
        //    （実時間や Random を使わないため、タイムラインをシークしても同じ時刻では必ず同じ絵になる）。
        var (blinkOffset, blinkInterval) = EmgAnimation.ResolveBlinkTiming(
            chara.EmgFilePath, chara.BlinkOffset, chara.BlinkInterval);
        double blinkOpenness = EmgAnimation.GetBlinkOpenness(tachieTime, blinkOffset, blinkInterval);

        // 2. 口パク: 音量から開き具合を求める（母音が使えない .emg 向けのフォールバック）。
        //    係数 10.0 と感度の扱いは PSD 立ち絵プラグインと同じ。
        double mouthOpenness = isSpeaking
            ? Math.Clamp(voiceVolume * 10.0 * chara.MouthSensitivity / 100.0, 0.0, 1.0)
            : 0.0;

        string expressionName = string.IsNullOrEmpty(face?.ExpressionName) ? "default" : face!.ExpressionName!;

        var state = new ResolverState
        {
            BlinkOpenness = blinkOpenness,
            MouthShape = hasVowelInfo ? mouthShape : EmgMouthShape.Silent,
            MouthOpenness = mouthOpenness,
            ExpressionName = expressionName,
            EyeMode = face?.EyeAnimation ?? EmgEyeAnimationMode.Default,
            // 母音情報が無い経路（ITachieSource 8引数版）では母音優先にしても意味がないため音量優先にする。
            MouthMode = !hasVowelInfo && (face?.MouthAnimation ?? EmgMouthAnimationMode.VowelPriority) == EmgMouthAnimationMode.VowelPriority
                ? EmgMouthAnimationMode.VolumePriority
                : face?.MouthAnimation ?? EmgMouthAnimationMode.VowelPriority,
        };

        // 3. 表示対象レイヤーの解決
        var activeTextures = EmgStateResolver.ResolveActiveTextures(data, mapping, setup, state);
        var expr = EmgStateResolver.ResolveExpression(mapping, expressionName);

        // 3b. UI で指定された表示レイヤーの上書き（立ち絵アイテム → 表情アイテムの順で、
        //     後に適用される表情アイテム側が優先される）。
        ApplyLayerOverrides(activeTextures, item.LayerOverrides, setup);
        ApplyLayerOverrides(activeTextures, face?.LayerOverrides, setup);

        // 4. 状態が前回と同一なら再合成をスキップ。まばたきは連続値なので、実際に選ばれた
        //    レイヤー（＝見た目が変わる単位）で比較する。
        string? blinkTex = setup.Roles.BlinkPartID is { } bp && activeTextures.TryGetValue(bp, out var bt) ? bt : null;
        string? mouthTex = setup.Roles.MouthPartID is { } mp && activeTextures.TryGetValue(mp, out var mt) ? mt : null;
        // 表示レイヤーの上書きが変わったときも再合成する必要があるため、解決後の全パーツの
        // 組み合わせをハッシュに含める。
        int layersHash = 0;
        foreach (var kv in activeTextures.OrderBy(kv => kv.Key, StringComparer.Ordinal))
            layersHash = HashCode.Combine(layersHash, kv.Key, kv.Value);
        // まばたきが実際に動いているかを診断できるよう、目のレイヤーが切り替わった瞬間だけログを出す
        // （毎フレーム出すとログが埋まるため）。ここに何も出ない場合は、まばたき用レイヤーが
        // 未設定か、そもそも Update が呼ばれていない。
        if (blinkTex != lastLoggedBlinkTex)
        {
            lastLoggedBlinkTex = blinkTex;
            Log.Default.Write(
                $"[EmgTachiePlugin] まばたき: t={tachieTime.TotalSeconds:F2}s openness={blinkOpenness:F2} " +
                $"part={setup.Roles.BlinkPartID ?? "(none)"} → {blinkTex ?? "(なし)"} " +
                $"(timing offset={blinkOffset:F2}s interval={blinkInterval:F2}s)");
        }

        var stateKey = (chara.EmgFilePath, expressionName, layersHash, mouthTex, item.ReverseZIndex, false);
        if (lastStateKey == stateKey)
        {
            ApplyTransform(item);
            return;
        }
        lastStateKey = stateKey;

        // 5. Direct2D合成
        Composite(data, activeTextures, expr, item);

        // compositeTarget を毎回作り直すのに合わせ、エフェクトの入力も一度 null にしてから
        // 新しいビットマップを設定することで、古い入力を確実に無効化する。
        transformEffect.SetInput(0, null, true);
        transformEffect.SetInput(0, compositeTarget?.Bitmap ?? empty, true);
        ApplyTransform(item);
    }

    private void ApplyTransform(EmgItemParameter item)
    {
        // 実機の標準 .psd 立ち絵プラグイン（PsdTachieSource、逆コンパイルで確認済み）は
        // 合成後ビットマップを Matrix3x2.CreateTranslation(-width/2, -height/2) で
        // 「中心が原点(0,0)に来る」よう平行移動してから YMM4 に渡している。
        // YMM4 側の配置システムはこの「原点=画像中心」を前提にしているため、これが無いと
        // 合成画像の左上が原点に来てしまい、プレビュー範囲外に大きくズレて何も見えなくなる。
        float halfW = compositeWidth / 2f;
        float halfH = compositeHeight / 2f;
        float scale = (float)item.Scale;
        transformEffect.TransformMatrix =
            Matrix3x2.CreateTranslation(-halfW, -halfH) *
            Matrix3x2.CreateScale(scale) *
            Matrix3x2.CreateTranslation((float)item.OffsetX, (float)item.OffsetY);
    }

    /// <summary>
    /// UI で指定された表示レイヤーを適用する。
    /// まばたき・口パクに使われているパーツへの上書きは無視する（毎フレーム上書きされると
    /// アニメーションが完全に潰れてしまうため）。
    /// </summary>
    private static void ApplyLayerOverrides(
        Dictionary<string, string> activeTextures, ImmutableList<string>? overrides, EmgAutoSetup setup)
    {
        if (overrides is null || overrides.Count == 0) return;

        foreach (var entry in overrides)
        {
            int sep = entry.IndexOf('=');
            if (sep <= 0) continue;

            string partID = entry[..sep];
            string textureID = entry[(sep + 1)..];
            if (string.IsNullOrEmpty(textureID)) continue;
            if (partID == setup.Roles.BlinkPartID || partID == setup.Roles.MouthPartID) continue;

            activeTextures[partID] = textureID;
        }
    }

    /// <summary>
    /// キャラクター設定の UI 値（ImmutableList&lt;string&gt;）を Emg.Core 側の DTO に変換する。
    /// </summary>
    private static EmgAnimationOverrides? BuildOverrides(EmgCharacterParameter chara)
    {
        // 保存形式は "Open=パーツID<TAB>textureID"。
        // EmgAnimation は「開いた状態→閉じた状態」の順に並んだ列を期待するので、
        // 設定されているものだけをこの順に詰め直す（半開きが未設定でも 開→閉 の2段で動く）。
        var blinkByKey = new Dictionary<string, string>();
        string? blinkPartID = null;
        foreach (var entry in chara.BlinkLayers)
        {
            int s = entry.IndexOf('=');
            if (s <= 0) continue;
            var (partID, textureID) = Editors.EmgLayerEditor.ParseValue(entry[(s + 1)..]);
            if (string.IsNullOrEmpty(textureID)) continue;
            blinkByKey[entry[..s]] = textureID;
            blinkPartID ??= partID;
        }
        var blink = Editors.EmgLayerEditor.BlinkKeys
            .Where(blinkByKey.ContainsKey)
            .Select(k => blinkByKey[k])
            .ToList();

        var vowels = new Dictionary<EmgMouthShape, string>();
        string? mouthPartID = null;
        foreach (var entry in chara.VowelLayers)
        {
            int sep = entry.IndexOf('=');
            if (sep <= 0) continue;
            if (!Enum.TryParse<EmgMouthShape>(entry[..sep], out var shape)) continue;
            var (partID, textureID) = Editors.EmgLayerEditor.ParseValue(entry[(sep + 1)..]);
            if (string.IsNullOrEmpty(textureID)) continue;
            vowels[shape] = textureID;
            mouthPartID ??= partID;
        }

        if (blink.Count == 0 && vowels.Count == 0) return null;
        return new EmgAnimationOverrides
        {
            BlinkPartID = blinkPartID,
            BlinkLayers = blink.Count > 0 ? blink : null,
            MouthPartID = mouthPartID,
            VowelLayers = vowels.Count > 0 ? vowels : null,
        };
    }

    private void EnsureLoaded(EmgCharacterParameter? chara)
    {
        var emgFilePath = chara?.EmgFilePath;
        if (string.IsNullOrEmpty(emgFilePath) || chara is null)
        {
            loaded = null;
            loadedEmgPath = null;
            loadedOverridesKey = null;
            setup = null;
            return;
        }

        // UI 上でまばたき／母音のレイヤー割り当てが変わったら、自動セットアップをやり直す必要がある。
        string overridesKey = string.Join("|", chara.BlinkLayers) + "##" + string.Join("|", chara.VowelLayers);
        if (emgFilePath == loadedEmgPath && loaded is not null && overridesKey == loadedOverridesKey) return;

        try
        {
            var cacheDir = Path.Combine(Path.GetTempPath(), "EmgTachiePlugin");
            // 同じ .emg のまま overrides だけ変わった場合は ZIP を読み直さない。
            if (emgFilePath != loadedEmgPath || loaded is null)
            {
                loaded = EmgFileLoader.Load(emgFilePath, cacheDir);
                loadedEmgPath = emgFilePath;
            }
            loadedOverridesKey = overridesKey;

            // UI 指定 → mapping.json → レイヤー名からの自動推定、の順でまばたき・口パクに使う
            // レイヤーを決める。PSD 立ち絵と違って、何も設定しなくても mapping.json さえあれば動く。
            setup = EmgAnimation.Create(loaded.Data, loaded.Mapping, BuildOverrides(chara));
            lastStateKey = null; // 強制再合成

            Log.Default.Write($"[EmgTachiePlugin] Loaded '{emgFilePath}': parts={loaded.Data.Parts.Count}, textures={loaded.Data.Textures.Count}, mapping={(loaded.Mapping is null ? "none" : "present")}");
            Log.Default.Write($"[EmgTachiePlugin] 自動セットアップ: {setup.Summary}");

            LoadAtlasBitmap();
        }
        catch (Exception ex)
        {
            // 壊れた/存在しない .emg はロード失敗として扱い、空表示にフォールバックする。
            Log.Default.Write($"[EmgTachiePlugin] Failed to load '{emgFilePath}'", ex);
            loaded = null;
            loadedEmgPath = null;
            setup = null;
        }
    }

    private void LoadAtlasBitmap()
    {
        // ID2D1Bitmap（.Output）は IImageFileSource が所有しているため、直接 Dispose せず
        // ソースごと破棄する（.Output だけを個別に Dispose すると二重解放になりうる）。
        foreach (var s in atlasSources.Values) s.Dispose();
        atlasSources.Clear();
        atlasBitmaps.Clear();
        primaryAtlas = null;

        if (loaded is null) return;

        if (loaded.Data.Textures.Count == 0)
        {
            Log.Default.Write("[EmgTachiePlugin] data.json に textures[] が1件もありません。アトラス読み込みをスキップします。");
            return;
        }

        foreach (var texture in loaded.Data.Textures)
        {
            if (!loaded.TextureFilePaths.TryGetValue(texture.TextureFile, out var path))
            {
                Log.Default.Write($"[EmgTachiePlugin] textureFile '{texture.TextureFile}' が .emg アーカイブ内に見つかりませんでした。展開済みファイル一覧: [{string.Join(", ", loaded.TextureFilePaths.Keys)}]");
                continue;
            }

            // ImageFileSourceFactory.Create(IGraphicsDevices, string) -> IImageFileSource
            // （実DLLをリフレクションで確認済み）。IImageFileSource.Output が ID2D1Bitmap を返す。
            // ここでは「1枚の画像をそのまま表示する」用途ではなく「アトラスとして保持し、
            // DrawBitmap の src矩形で切り出す」用途なので、返された ID2D1Bitmap をそのまま保持する。
            // imageSource 自体を（using で即破棄せず）フィールドとして生かしておく必要がある —
            // .Output はこのオブジェクトが所有しているため。
            var source = ImageFileSourceFactory.Create(devices, path);
            if (source is null)
            {
                Log.Default.Write($"[EmgTachiePlugin] ImageFileSourceFactory.Create が null を返しました。path='{path}'");
                continue;
            }

            atlasSources[texture.TextureFile] = source;
            atlasBitmaps[texture.TextureFile] = source.Output;
            primaryAtlas ??= source.Output;
            Log.Default.Write($"[EmgTachiePlugin] アトラス読み込み成功: {path} ({source.Output.PixelSize.Width}x{source.Output.PixelSize.Height})");
        }

        if (atlasBitmaps.Count > 1)
            Log.Default.Write($"[EmgTachiePlugin] 複数アトラス: {atlasBitmaps.Count} 枚 [{string.Join(", ", atlasBitmaps.Keys)}]");
    }

    /// <summary>
    /// レイヤーが参照するアトラスを返す。textureFile が解決できない場合は textures[0] に倒す
    /// （単一アトラスのファイルで textureFile の表記ゆれがあっても描画できるようにするため）。
    /// </summary>
    private ID2D1Bitmap? ResolveAtlas(EmgLayer layer)
    {
        if (!string.IsNullOrEmpty(layer.TextureFile)
            && atlasBitmaps.TryGetValue(layer.TextureFile!, out var bmp))
        {
            return bmp;
        }
        return primaryAtlas;
    }

    private void Composite(EmgData data, Dictionary<string, string> activeTextures, EmgExpression? expr, EmgItemParameter item)
    {
        if (primaryAtlas is null)
        {
            LogOnce("Composite: アトラスが未ロードのため合成をスキップします");
            return;
        }

        int width = Math.Max(1, (int)data.BaseCanvasWidth);
        int height = Math.Max(1, (int)data.BaseCanvasHeight);

        // 実機テストで判明: レンダーターゲットをサイズが同じ限り使い回す実装だと、GDI+で全く同じ
        // 座標・Z順を手動合成した結果（正しい）と、実際にYMM4上で見える結果（顔パーツが崩れる）が
        // 一致しないという再現性のある問題があった。C#側のデータ・アルゴリズムはGDI+再現で
        // 正しいと確認済みのため、Direct2D側のレンダーターゲット再利用に起因するキャッシュ/無効化の
        // 問題を疑い、毎回（サイズが同じでも）レンダーターゲットを作り直すことで確実に前回の
        // 内容を引きずらないようにする。
        compositeTarget?.Dispose();
        // 実機テストで判明: デスクトップ環境（Microsoft Remote Display Adapter 等）によっては
        // desiredFormat 省略時に継承されるピクセル形式が CreateCompatibleRenderTarget に
        // 「サポートされていません」(HRESULT 0x88982F80) と拒否されるケースがある。
        // empty ビットマップと同じ B8G8R8A8_UNorm + Premultiplied を明示することで回避する。
        var pixelFormat = new Vortice.DCommon.PixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied);
        compositeTarget = devices.DeviceContext.CreateCompatibleRenderTarget(
            new Vortice.Mathematics.Size(width, height),
            new SizeI(width, height),
            pixelFormat);
        compositeWidth = width;
        compositeHeight = height;

        var target = compositeTarget!;
        target.BeginDraw();
        target.Clear(null);

        // textureZIndex はパーツをまたいで全レイヤー共通の重なり順（前面ほど大きい値）。
        // パーツ単位でグルーピングして描画すると、パーツをまたいだ重なり順が壊れるため、
        // 「このフレームで表示すべきレイヤー」を一旦フラットに集めてから、
        // textureZIndex でソートした1本のリストとして描画する。
        var layersToDraw = new List<EmgLayer>();

        foreach (var part in data.Parts)
        {
            if (part.ResolvedType == "static")
            {
                layersToDraw.AddRange(part.Layers);
                continue;
            }

            // switch パーツ: expr.Parts で複数レイヤー同時表示が指定されていればそれを優先、
            // 無ければ activeTextures で解決された単一レイヤーのみ表示する。
            if (expr?.Parts is not null && expr.Parts.TryGetValue(part.PartID, out var visibleIDs))
            {
                layersToDraw.AddRange(part.Layers.Where(l => visibleIDs.Contains(l.TextureID)));
                continue;
            }

            if (activeTextures.TryGetValue(part.PartID, out var activeID))
            {
                var layer = part.Layers.FirstOrDefault(l => l.TextureID == activeID);
                if (layer is not null) layersToDraw.Add(layer);
            }
        }

        LogOnce($"Composite: {layersToDraw.Count}枚のレイヤーを描画します（canvas={width}x{height}, reverseZIndex={item.ReverseZIndex}, activeTextures=[{string.Join(", ", activeTextures.Select(kv => kv.Key + "=" + kv.Value))}]）");
        LogOnce("DrawLayers: " + string.Join(" | ", layersToDraw.Select(l =>
            $"tex={l.TextureID} z={l.TextureZIndex} src=({l.X},{l.Y},{l.Width}x{l.Height}) dst=({l.BasePositionX},{l.BasePositionY})")));

        // 既知の emg-packer z-index バグ（本来背面のパーツが最前面の値を持つ等）を持つ実データの
        // 回避策として、EmgItemParameter.ReverseZIndex がオンなら降順（本来と逆順）で描画する。
        var orderedLayers = item.ReverseZIndex
            ? layersToDraw.OrderByDescending(l => l.TextureZIndex)
            : layersToDraw.OrderBy(l => l.TextureZIndex);

        foreach (var layer in orderedLayers)
        {
            DrawLayer(target, layer);
        }

        target.EndDraw();
    }

    private void DrawLayer(ID2D1BitmapRenderTarget target, EmgLayer layer)
    {
        // アトラスはレイヤーごとに異なりうる（emg-json-spec.md 1.3）。
        // 常に1枚目から切り出すと、分割されたファイルで無関係な領域を描いてしまう。
        var atlas = ResolveAtlas(layer);
        if (atlas is null) return;

        // 実DLLをリフレクションで確認: Vortice.Mathematics.Rect の4引数コンストラクタは
        // (x, y, width, height) であり (left, top, right, bottom) ではない。
        // これまで (x, y, x+width, y+height) を渡しており、width/height が実質2倍近くに
        // 膨張し、意図しない隣接アトラス領域まで巻き込んで描画されていた
        // （「額に目が複数滲み出る」実機不具合の直接の原因）。
        var srcRect = new Vortice.Mathematics.Rect(
            (float)layer.X, (float)layer.Y,
            (float)layer.Width, (float)layer.Height);
        var dstRect = new Vortice.Mathematics.Rect(
            (float)layer.BasePositionX, (float)layer.BasePositionY,
            (float)layer.Width, (float)layer.Height);

        float opacity = (float)(layer.Opacity ?? 1.0);

        target.DrawBitmap(atlas, dstRect, opacity, BitmapInterpolationMode.Linear, srcRect);
    }

    public void Dispose()
    {
        // SampleTachieSource.cs と同じ順序: エフェクトの入力を切ってから、
        // 出力→エフェクト本体→自前で保持しているリソースの順に破棄する
        // （Direct2Dのエフェクト出力は自動解放されないため明示的なDisposeが必須）。
        transformEffect.SetInput(0, null, true);
        output.Dispose();
        transformEffect.Dispose();
        empty.Dispose();
        compositeTarget?.Dispose();
        // .Output（ID2D1Bitmap）は IImageFileSource が所有しているので個別 Dispose しない
        foreach (var src in atlasSources.Values) src.Dispose();
        atlasSources.Clear();
        atlasBitmaps.Clear();
    }
}
