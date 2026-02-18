# EMG Player JavaScript ドキュメント

## 概要
`emg-player.0.2.2.js` は、EMG (easy Movable Graphic) フォーマットのアセットをロードし、Webブラウザ上で再生するためのライブラリです。
最新の **EMG v0.2.2** 仕様（Parts構造、Textureメタデータ、Sprite Trigger等）に対応しています。

## 主要機能
- ZIP形式（.emg）の展開とパース
- JSON定義（v0.2.2）に基づくレイヤー構築
- `static` / `switch` パーツ種別の制御
- `sequence` および `trigger` による自律アニメーション再生

## 使用方法

## Key Assignments

By default, EMG Web Runtime assigns states to number keys (1–4) for maximum compatibility with browsers and OBS.

- **1**: neutral (default)
- **2**: joy
- **3**: angry
- **4**: sorrow

Key assignments can be customized by editing the EMG configuration (`trigger` property in `states.json`). Function keys and special keys are supported but not recommended in browser-based environments.

## Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

### 1. スクリプトのロード
```html
<!-- JSZip (必須依存) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js"></script>
<!-- EMG Player -->
<script src="https://cdn.example.com/emg-player.0.2.2.js"></script>
```

### 2. EMGデータの読み込み
```javascript
// URLからロードして指定のコンテナに展開
window.EMGPlayer.loadEmgFromCDN('https://example.com/character.emg', 'layerContainer');
```

## JSON 仕様 (v0.2.2)

詳細は `emg-json-spec.md` を参照してください。

### ルートオブジェクト
- `version`: "0.2.2"
- `baseCanvasWidth`, `baseCanvasHeight`: キャンバスサイズ
- `textures`: テクスチャアトラスの定義リスト `{ textureFile, width, height }`
- `parts`: パーツ定義リスト `{ partID, type, layers, default? }`
- `sprites`: アニメーション定義リスト `{ spriteID, targetPartID, sequence, trigger? }`

### Parts
パーツは `type` により挙動が異なります。
- `static`: 常時表示（体、背景など）
- `switch`: レイヤーのうち1つだけを表示（目、口など）。`default` で初期表示を指定。

### Sprites & Triggers
アニメーションは `sequence` でフレーム順序を定義し、`trigger` で再生タイミングを制御します。
- `sequence.type`: `"ordered"` (順次再生), `"random_hold"` (ランダム選択)
- `trigger.type`: `"auto_loop"` (ループ), `"random_interval"` (ランダム間隔で発火), `"external"` (外部制御)

## 依存ライブラリ
- `JSZip`: .emg (ZIP) ファイルの解凍に使用

## ライセンス
このスクリプトはオープンソースとして提供されています。

---

# EMG Web Runtime (v0.1)

⚠️ **Work In Progress (WIP)** ⚠️
Some features are currently under development.
- Performance Tuning (WIP)
- Error Handling (WIP)
- Unity Importer (WIP)

## 概要
EMG (Extended Model Graph) アバターをブラウザ上で再生・確認・簡易編集するためのランタイム環境。
OBS などのブラウザソースとして利用することを想定。仕様やドキュメントについては、以下のリンクを参照してください。

-   **[EMG Lite ドキュメント (README)](./emg-lite/README.md)**
-   **[EMG Viewer ツール](./emg-lite/tools/emg-viewer/)**
