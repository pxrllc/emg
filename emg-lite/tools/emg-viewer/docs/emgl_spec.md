# .emgl Specification (EMG Lite Archive)

An `.emgl` file is a portable archive format for EMG-Lite models. It allows sharing a model definition (`model.json`) and all its associated assets (images) as a single file, rather than requiring a folder structure.

## 1. File Format

-   **Container**: Standard ZIP Archive (`PK` header).
-   **Extension**: `.emgl` (or `.zip` is also supported).
-   **Compression**: Default ZIP deflation.

## 2. Internal Structure

The archive must contain at least one JSON file at the root level, which serves as the entry point.

### Recommended Layout
```text
my_model.emgl
├── model.json            // [Required] The Model Definition
├── assets/               // [Recommended] Folder for consistency
│   ├── base.png
│   ├── eye_close.png
│   └── mouth_open.png
└── license.txt           // [Optional] Metadata
```
> **Note**: The `base` image (defined in `model.json`) is used as the **thumbnail** for the model.

### License
While a `license.txt` file is optional, it is recommended to also specify the license in the `model.json` `license` field for better visibility in tools.

### Path Resolution
-   **Assets Root**: The viewer overrides `assetsRoot` to `./` internally when loading from an `.emgl` file.
-   **Flat vs Nested**:
    -   You can place images at the root or in subfolders.
    -   The `mapping` in `model.json` must match the relative paths inside the ZIP.
    -   *Example*: If `mapping` points to `assets/base.png`, the ZIP must contain a folder `assets` with `base.png`.

## 3. Usage

### Importing (Loading)
Use the **"Load Model / .emgl"** button in the EMG Viewer.
-   **Extension Support**: Accepts `.emgl`, `.zip`, and `.json`.
-   **Behavior**:
    1.  Unpacks the ZIP in memory.
    2.  Locates the first `.json` file in the root of the archive.
    3.  Loads all images into browser `Blob` objects.
    4.  Updates the viewer to use these Blob URLs instead of local file paths.

### Exporting
Use the **"Export .emgl (ZIP)"** button in the sidebar.
-   **Behavior**:
    1.  Generates a new `model.json` based on the current configuration.
    2.  Sets `assetsRoot` to `./` for portability.
    3.  Bundles the JSON and all currently loaded images (from Blob or Fetch) into a ZIP.
    4.  Downloads the file as `[ModelName].emgl`.

## 4. Implementation Details

### Viewer Handling
The Viewer (`editor.ts`) handles `.emgl` files using the `jszip` library.

1.  **Detection**: Checks file extension or magic bytes (implied by success).
2.  **Unpacking**:
    -   Iterates through all files in the ZIP.
    -   Extracts image files (`.png`, `.jpg`) as `Blob`.
    -   Creates `Blob URL` (e.g., `blob:http://localhost:5176/...`) for each image.
3.  **Mapping Fix**:
    -   The viewer creates a look-up map: `blobAssets[filename] = blobUrl`.
    -   **Important**: Logic uses the **filename** (e.g., `base.png`) as the key, ignoring directory structure for simplicity in the current adapter. Ensure unique filenames if possible.
4.  **JSON Adjustment**:
    -   Sets `modelDef.assetsRoot = '/assets'` (virtual root) or handles relative resolution dynamically.

### Limitations
-   **Filename Collisions**: Since the Blob Map currently keys by filename (e.g., `img.png`), having two files `a/img.png` and `b/img.png` in the same archive may cause conflicts. It is recommended to use unique filenames for all assets.

---

# 日本語訳 (Japanese Translation)

## .emgl 仕様 (EMG Lite Archive)

`.emgl` ファイルは、EMG-Liteモデルのためのポータブルなアーカイブ形式です。
モデル定義ファイルである `model.json` と、それに関連する全てのアセット（画像ファイル）を1つのファイルとしてまとめることができ、フォルダ構造を維持したまま簡単に共有することが可能です。

## 1. ファイル形式

-   **コンテナ**: 標準的な ZIP アーカイブ (`PK` ヘッダ)。
-   **拡張子**: `.emgl` (または `.zip` もサポート)。
-   **圧縮**: 標準の ZIP 圧縮。

## 2. 内部構造

アーカイブのルートレベル（直下）に、少なくとも1つの JSON ファイルを含める必要があります。これがエントリーポイント（読み込みの起点）となります。

### 推奨構成
```text
my_model.emgl
├── model.json            // [必須] モデル定義ファイル
├── assets/               // [推奨] 画像などを格納するフォルダ
│   ├── base.png
│   ├── eye_close.png
│   └── mouth_open.png
└── license.txt           // [任意] メタデータやライセンス
```

### パス解決
-   **Assets Root**: Viewer は `.emgl` ファイルから読み込む際、内部的に `assetsRoot` を `./` (カレント) にオーバーライドします。
-   **階層構造**:
    -   画像をルートに置くことも、サブフォルダに置くことも可能です。
    -   `model.json` 内の `mapping` パスは、ZIP内の相対パスと一致している必要があります。
    -   例: `mapping` で `assets/base.png` を指定している場合、ZIP内には `assets` フォルダと、その中に `base.png` が存在する必要があります。

## 3. 使用方法

### インポート (読み込み)
EMG Viewer の **"Load Model / .emgl"** ボタンを使用します。
-   **対応形式**: `.emgl`, `.zip`, および `.json`。
-   **挙動**:
    1.  メモリ上で ZIP を展開します。
    2.  アーカイブのルートにある最初の `.json` ファイルを探します。
    3.  全ての画像をブラウザの `Blob` オブジェクトとして読み込みます。
    4.  ローカルパスの代わりに、生成した Blob URL を使用するよう Viewer を更新します。

### エクスポート
サイドバーの **"Export .emgl (ZIP)"** ボタンを使用します。
-   **挙動**:
    1.  現在の設定に基づいて新しい `model.json` を生成します。
    2.  ポータビリティのため、`assetsRoot` を `./` に設定します。
    3.  JSON と、現在読み込まれている全ての画像（Blob または Fetch 経由）を ZIP にまとめます。
    4.  `[ModelName].emgl` という名前でダウンロードします。

## 4. 実装の詳細

### Viewer での処理
Viewer (`editor.ts`) は `jszip` ライブラリを使用して `.emgl` ファイルを処理します。

1.  **検出**: ファイル拡張子、または展開の成功可否で判断します。
2.  **展開**:
    -   ZIP 内の全てのファイルを走査します。
    -   画像ファイル (`.png`, `.jpg`) を `Blob` として抽出します。
    -   各画像に対して `Blob URL` (例: `blob:http://localhost:5176/...`) を生成します。
3.  **マッピング処理**:
    -   `blobAssets[filename] = blobUrl` という形式のルックアップマップを作成します。
    -   **重要**: 現在のアダプターの実装上の制約により、ディレクトリ構造を無視し、**ファイル名** (例: `base.png`) のみをキーとして使用します。そのため、アセット名はユニーク（一意）にすることを推奨します。
4.  **JSON 調整**:
    -   `modelDef.assetsRoot` を `/assets` (仮想ルート) に設定するか、相対パス解決を動的に行います。

### 制限事項
-   **ファイル名の衝突**: Blob マップがファイル名をキーとしているため、同じアーカイブ内に `a/img.png` と `b/img.png` のように同名のファイルが存在すると、正しくマッピングされない可能性があります。全てのアセットには異なる名前を付けることを推奨します。
