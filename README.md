# EMG Player JavaScript ドキュメント

## 概要
`emg-player.0.1.0.js` は、ZIP形式のアセットをロードし、JSONデータと画像を解析してレイヤーを描画し、スプライトアニメーションを制御する JavaScript モジュールです。本スクリプトは、CDN経由での動的ロードを前提としています。

## 主要機能
- ZIPファイルのダウンロード・展開
- JSON設定ファイルの解析
- スプライトレイヤーのレンダリング
- スプライトアニメーションの制御
- テクスチャの適用

## 使用方法
### 1. スクリプトのロード
```html
<script src="https://cdn.example.com/emg-player.0.1.0.js"></script>
```

### 2. EMGデータの読み込み
```javascript
window.EMGPlayer.loadEmgFromCDN('https://example.com/animation_data.zip', 'layerContainer');
```

`loadEmgFromCDN` 関数の引数:
- `url` (必須): ZIPファイルのURL
- `containerId` (オプション): アニメーションを描画するHTML要素のID (デフォルト: `layerContainer`)

## 内部処理
1. `loadEmgFromCDN(url, containerId)` を使用してZIPファイルをダウンロード
2. `JSZip` を利用してZIPを展開
3. JSONファイルを解析し、スプライトデータを取得
4. テクスチャ画像を適用し、レイヤーをHTML要素として配置
5. スプライトの `animID` に基づきアニメーションを実行

## JSON 仕様
- `baseCanvasWidth` / `baseCanvasHeight`: キャンバスのサイズ
- `layers`: レイヤー情報のリスト
  - `textureID`: レイヤーの一意なID
  - `imgType`: "Texture" または "Sprite"
  - `assignID`: スプライトの識別ID
  - `animID`: アニメーションID
  - `x`, `y`, `width`, `height`: テクスチャ内の座標
  - `basePosition_x`, `basePosition_y`: 描画位置
  - `textureZIndex`: レイヤーのZ-index
- `sprites`: スプライトアニメーション情報
  - `fps`: フレームレート
  - `loop`: ループタイプ (0:なし, 1:ループ, 2:ランダム, 3:タイムライン)
  - `useTex`: 使用するスプライトのリスト

## 依存ライブラリ
- `JSZip`: ZIPデータの展開用 (CDN経由で自動ロード)

## 今後の拡張
- 追加アニメーション制御の導入
- JSONのカスタマイズオプション追加
- ユーザーインターフェースの拡張


## ライセンス
このスクリプトはオープンソースとして提供されています。

---

# EMG Lite (次世代版)

EMG Lite は、よりモダンな設計に基づいた新しいアバター表現システムです。
詳細な仕様やドキュメントについては、以下のリンクを参照してください。

-   **[EMG Lite ドキュメント (README)](./emg-lite/README.md)**
-   **[EMG Viewer ツール](./emg-lite/tools/emg-viewer/)**

