# emg-ymm4

YMM4（ゆっくりムービーメーカー4）向けの、EMG (v0.3.0) を立ち絵として読み込むプラグイン。

`.emg`（`data.json` + 任意の `mapping.json` + テクスチャアトラス）を直接読み込み、
`parts[]` の static/switch 制御、`mapping.json` によるまばたき・母音リップシンク・表情切り替えを
YMM4 のタイムライン上で再現する。

**利用者向けの導入手順と使い方は `package/README.md`**（配布 ZIP に同梱されるもの）を参照。
このファイルは開発用。

## 構成

| | |
|---|---|
| `Emg.Core/` | YMM4 に依存しない `.emg`/`mapping.json` パーサーと状態解決ロジック（`System.Text.Json` のみ）。`EmgFileLoader`（ZIP 読み込み）、`EmgStateResolver`（パーツ役割判定・blink/viseme/expression 解決・`sprites[]` 共存ルール）、`EmgAnimation`（まばたきタイミング、自動セットアップ） |
| `EmgTachiePlugin/` | YMM4 プラグイン本体。`EmgTachieSource` が Direct2D での合成描画を担当。`Editors/` にレイヤー選択 UI |
| `package/` | 配布 ZIP に同梱する利用者向け README |
| `package.ps1` | Release ビルド → `dist/EmgTachiePlugin-<version>.zip` を作成 |

## ビルド

.NET 10 SDK と、ローカルの YMM4 インストールが必要（YMM4 の DLL を直接参照するため）。

```bash
cp Directory.Build.props.sample Directory.Build.props   # YMM4DirPath を自分の環境に書き換える
dotnet build emg-ymm4.slnx
```

ビルド後、`EmgTachiePlugin.dll` と `Emg.Core.dll` が
`$(YMM4DirPath)user\plugin\EmgTachiePlugin\` に自動配置される。

**YMM4 起動中は DLL がロックされ、この配置が MSB3027 で失敗する。** YMM4 を終了してから
ビルドすること。配置が不要なとき（配布 ZIP を作るだけのとき）は
`-p:SkipYmm4Deploy=true` でスキップできる。

### 配布パッケージ

```powershell
.\package.ps1              # Release、dist\EmgTachiePlugin-<version>.zip を出力
.\package.ps1 -Configuration Debug
```

ZIP は `user\plugin\` にフォルダごと展開する構成（`EmgTachiePlugin\` の中に DLL 2つ、
`README.md`、`LICENSE.md`）。バージョンは `EmgTachiePlugin.csproj` の `<Version>` が唯一の情報源で、
ZIP 名は DLL から読み取る。`package.ps1` は `-p:SkipYmm4Deploy=true` 付きでビルドするため、
YMM4 を起動したままでも実行できる。

> `package.ps1` は **UTF-8 BOM 付き**で保存すること。Windows PowerShell 5.1 は BOM の無い
> `.ps1` を ANSI として読むため、日本語コメントが壊れて構文エラーになる。

## テスト方法

`Emg.Core` は YMM4 の型に一切依存しないので、**YMM4 を起動せずコンソールアプリから検証できる。**
実機で確認する前にこちらで確かめるのが速い。

`Emg.Core` を `ProjectReference` するだけの使い捨てコンソールプロジェクトを作り、

- `EmgAnimation.Create(data, mapping).Summary`
- `EmgStateResolver.ResolveActiveTextures(...)` を blink 開度・母音・表情を変えながら

出力させれば、`mapping.json` を拾えているか、blink/mouth の役がどのパーツに付いたか、
z 順が「Z-Index反転」を必要とするか、時間経過でまばたきが実際に切り替わるかまで確認できる。

`.emg` の描画結果そのものを見たい場合は、ZIP を展開して任意の 2D ライブラリで
レイヤーを合成するほうが速い（`textureZIndex` 昇順＝奥から手前）。

## YMM4 プラグイン API について

**YMM4 のプラグイン API はドキュメントが無い。推測で書かず、実 DLL を逆コンパイルして確認すること。**

```bash
dotnet tool install -g ilspycmd
ilspycmd -t "YukkuriMovieMaker.Plugin.Tachie.Psd.PsdTachieSource" \
  "F:/YukkuriMovieMaker_v4/YukkuriMovieMaker.Plugin.Tachie.Psd.dll"
```

同梱の PSD 立ち絵プラグインが最良の参考実装。以下はいずれも推測で間違え、逆コンパイルして
初めて確定した点：

- **`ITachieSource2` を実装すること。** `Update(TachieSourceDescription desc)` が
  `desc.MouthShape`（`Silent/A/I/U/E/O`）と `desc.VoiceVolume`（`-1.0` は「発話なし」）を渡してくる。
  旧 `ITachieSource.Update`（8引数）では `kuchipaku` という double が1つ来るだけで、
  **母音リップシンクは実現できない**（`doc/emg-ymm4-plugin-verification.md` が
  「母音リップシンクは不可能」と結論しているのは、これを見落としたため。誤り）
- **`Vortice.Mathematics.Rect(x, y, width, height)`** — `(left, top, right, bottom)` ではない。
  `x + width` を渡すと矩形が膨らみ、アトラス上の隣接領域が混ざって描画される
- **出力は中央寄せが必須**: `TransformMatrix = CreateTranslation(-w/2, -h/2) * …`。
  YMM4 は画像中心を基準に配置するため、これが無いと画面外に出る
- `CreateCompatibleRenderTarget` には `B8G8R8A8_UNorm` + `Premultiplied` のピクセル形式を
  明示しないと、環境によって `0x88982F80` で落ちる
- `IImageFileSource` のビットマップは `.Bitmap` ではなく **`.Output`**
- `Vortice.Direct2D1.BitmapProperties`（`BitmapProperties1` ではない）
- `IGraphicsDevicesAndContext.DeviceContext` の型は `ID2D1DeviceContext6`
- `TachieItemParameterBase`/`TachieFaceParameterBase` は `Animatable` 継承なので
  `protected override IEnumerable<IAnimatable> GetAnimatables()` の実装が必須
  （`TachieCharacterParameterBase` は `UndoRedoable` 直継承のため不要）
- `IPlugin.Details` は `string` ではなく `PluginDetailsAttribute` 型で、既定実装を持つ。
  オーバーライドせずクラスに `[PluginDetails(AuthorName = "...")]` を付ける
- プロパティエディタ: `bool` には `[ToggleSlider]`、enum には `[EnumComboBox]` が必要。
  `[Display]` だけでは UI に何も出ない。カスタムエディタは `PropertyEditorAttribute` +
  `IPropertyEditorForTachieParameterAttribute` を実装すると YMM4 が `CharacterParameter` を
  注入してくれるので、そこから `.emg` のパスに辿り着ける（`Editors/EmgLayerEditorAttribute.cs`）

## 設計上の注意

- **まばたきのシーク耐性**: まばたきのタイミングは `tachieTime`（アイテム内相対時刻）だけから
  決める。`Random` も実時刻も使わないので、タイムラインのどこにシークしても同じ絵になる。
  `string.GetHashCode()` は **プロセスごとにランダム化される**ため、シードに使うと
  書き出すたびに結果が変わる。`Emg.Core` の FNV-1a 安定ハッシュを使うこと
- **合成結果のキャッシュキーには入力を全部入れる。** 1つでも漏らすと絵が固まる
  （「Z-Index反転をオンにしても何も変わらない」不具合はこれが原因だった）
- **レイヤー参照は `(partID, textureID)` の組で持つ。** `textureID` はパーツ間で重複するため、
  `textureID` だけを保存すると先に列挙されたパーツが選ばれる
  （「眉がまばたきしてしまう」不具合の原因）
- **表情から目・口のパーツは直接指定できない。** `ResolveActiveTextures` は
  `expressions[].parts` を適用したあとに blink / lipSync が自分のパーツを上書きするため、
  `parts` に `Eyes` を書いても無視される。目の差し替えは `overrides.blink`、
  口は `overrides.lipSync` を使う。リファレンス実装（`emg-cdn/emg-player.0.3.0.js`）も同じ挙動
- **`sprites[]` との共存**: `mapping.json` が明示的に blink/mouth 対象に指定したパーツへの
  `sprites[]` 自律発火は抑制する（`emg-mapping-spec.md` の MUST NOT ルール）

## 未実装・スコープ外

- 複数テクスチャアトラス（`texture_0.png`, `texture_1.png`, …）— 現状は単一アトラスのみ
- `CreateExoItems`（AviUtl `.exo` 互換出力）— 空実装
- `CreateScriptFile` — 未実装
- 表情名のコンボボックス化（現状は文字列直接入力。`mapping.json` の `expressions` キーから
  候補を出せるはず）
