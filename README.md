# EMG (easy Movable Graphic)

EMG は、パーツ分割された 2D 素材を「軽量かつ汎用的に動かせる状態」で配布・利用するためのフォーマットです。動画編集ソフトやゲームエンジン（Unity, Web 等）など特定のツールに依存せず、どこでも同じように表示・制御できることを目指しています。`.emg` ファイルの実体は ZIP アーカイブで、メタデータ（`data.json`）とテクスチャアトラス画像を含みます。

扱えるのはキャラクターだけではありません。背景、小物、UI パーツ、シーン切り替え、エフェクトのコマ送りなど、**「重ねて描くレイヤー」と「差し替えるコマ」で表せるものは同じ仕組みで扱えます**。キャラクターは最も作り込まれた用途というだけです（まばたきや口パクの意味づけを与える `mapping.json` は、その用途のための任意の追加ファイルです）。

設計意図の詳細は [`emg-spec-intent.md`](./emg-spec-intent.md) を参照してください。

> **EMG-lite（`.emgl`）は別フォーマットです。** 本リポジトリには、EMG-lite という名前は似ているが構造の異なる、より単純な5スロット式のアバター内部表現（`emg-lite/`、[README](./emg-lite/README.md)）も同居しています。`emg-packer` / `emg-web-runtime` / Unity Importer / Ren'Py Loader が扱う本体の EMG（本ドキュメント）とは別物なので、混同しないよう注意してください。

## 仕様書

**バージョン：** 0.3.0（Draft）

| ドキュメント | 内容 |
|---|---|
| [`emg-json-spec.md`](./emg-json-spec.md) | EMG フォーマット JSON 仕様書（`data.json` 本体：`parts[]` / `textures[]` / `sprites[]`） |
| [`emg-mapping-spec.md`](./emg-mapping-spec.md) | `mapping.json` 仕様書（v0.3.0〜、任意のコンパニオンファイル：表情・まばたき・リップシンクの意味づけ） |
| [`emg-spec-intent.md`](./emg-spec-intent.md) | 設計意図・コンセプト |

```
*.emg（ZIP）
├── data.json        ← メタデータ・レイヤー・パーツ・アニメーション定義
├── mapping.json      ← [任意] 表情/まばたき/リップシンクの意味づけ（v0.3.0〜）
└── texture.png       ← テクスチャアトラス
```

## リポジトリ構成

| ディレクトリ | 内容 |
|---|---|
| [`emg-packer/`](./emg-packer/) | PSD から `.emg` を生成する Electron 製パッカー。`mapping.json` の下書き自動生成に対応 |
| [`emg-editor/`](./emg-editor/) | `emg-packer` v0.1.5 から分岐した編集アプリ。パーツ単位の編集・仕様準拠プレビューを持ち、今後の開発はこちらで進む |
| [`emg-web-runtime/`](./emg-web-runtime/) | ブラウザ上で `.emg` を再生・確認するランタイム（WIP） |
| [`emg-cdn/`](./emg-cdn/) | リファレンスプレイヤー（`emg-player.0.3.0.js` 等）とデモページ。GitHub Pages で配信 |
| [`emg-unity-importer/`](./emg-unity-importer/) | Unity 向け `.emg` インポーター（WIP） |
| [`emg-renpy/`](./emg-renpy/) | Ren'Py 向け `.emg` ローダー |
| [`emg-lite/`](./emg-lite/) | EMG-lite（別フォーマット）の仕様・アダプター・ツール |
| [`aviutl-for-egml/`](./aviutl-for-egml/) | EMG-lite 素材を AviUtl プロジェクトに変換するツール |
| [`doc/`](./doc/) | 各ツールの詳細仕様書 |
| [`samples/`](./samples/) | サンプルデータ |

## EMG Player（リファレンス実装）

`emg-cdn/emg-player.0.3.0.js` は、`.emg`（および任意で `mapping.json`）を読み込み、Web ブラウザ上で再生するためのライブラリです。

### 主要機能
- ZIP形式（.emg）の展開とパース
- JSON定義（v0.3.0）に基づくレイヤー構築
- `static` / `switch` パーツ種別の制御
- `sequence` および `trigger` による自律アニメーション再生
- `mapping.json` による表情・まばたき・リップシンクの外部制御（`setBlinkState` / `setViseme` / `setExpression`）

### 使い方

```html
<!-- JSZip (必須依存) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js"></script>
<!-- EMG Player -->
<script src="./emg-player.0.3.0.js"></script>
```

```javascript
// URLからロードして指定のコンテナに展開
window.EMGPlayer.loadEmgFromCDN('https://example.com/character.emg', 'layerContainer');

// mapping.json が同梱されている場合、外部から状態を制御できる
window.EMGPlayer.setBlinkState('closed');   // 'open' | 'half' | 'closed'
window.EMGPlayer.setViseme('a');            // 'a' | 'i' | 'u' | 'e' | 'o' | 'n'
window.EMGPlayer.setExpression('happy');
```

`mapping.json` が存在しない、または対象パーツを解決できない場合、これらの呼び出しは何もせず安全に無視されます（`emg-mapping-spec.md` 参照）。

### 依存ライブラリ
- `JSZip`: .emg (ZIP) ファイルの解凍に使用

## JSON 仕様の要約 (v0.3.0)

詳細は [`emg-json-spec.md`](./emg-json-spec.md) / [`emg-mapping-spec.md`](./emg-mapping-spec.md) を参照してください。

### ルートオブジェクト（`data.json`）
- `version`: "0.3.0"
- `baseCanvasWidth`, `baseCanvasHeight`: キャンバスサイズ
- `textures`: テクスチャアトラスの定義リスト `{ textureFile, width, height }`
- `parts`: パーツ定義リスト `{ partID, type, layers, default? }`
- `sprites`: アニメーション定義リスト `{ spriteID, targetPartID, sequence, trigger? }`

### Parts
パーツは `type` により挙動が異なります。
- `static`: レイヤーを重ねて描く（体、背景、部屋の壁など）
- `switch`: レイヤーのうち1つだけを表示（目、口、看板の表示内容、エフェクトのコマなど）。`default` で初期表示を指定。

### Sprites & Triggers
アニメーションは `sequence` でフレーム順序を定義し、`trigger` で再生タイミングを制御します。
- `sequence.type`: `"ordered"` (順次再生), `"random_hold"` (ランダム選択)
- `trigger.type`: `"auto_loop"` (ループ), `"random_interval"` (ランダム間隔で発火), `"external"` (外部制御)

### mapping.json（v0.3.0〜、任意）
表情・まばたき・リップシンクの意味づけを追加するコンパニオンファイル。存在しなくても `.emg` として有効です。詳細は [`emg-mapping-spec.md`](./emg-mapping-spec.md) を参照してください。

## EMG Web Runtime (v0.1)

⚠️ **Work In Progress (WIP)** ⚠️
Some features are currently under development.
- Performance Tuning (WIP)
- Error Handling (WIP)
- Unity Importer (WIP)

`.emg` をブラウザ上で再生・確認・簡易編集するためのランタイム環境です。OBS などのブラウザソースとして利用することを想定しています。本体の EMG（本ドキュメント上部・[`emg-json-spec.md`](./emg-json-spec.md)）を扱うツールであり、EMG-lite（[`emg-lite/`](./emg-lite/)）とは別物です。

### Development

```bash
cd emg-web-runtime
npm install
npm run dev      # vite dev server
npm run build    # tsc && vite build
```

### Key Assignments

By default, EMG Web Runtime assigns states to number keys (1–4) for maximum compatibility with browsers and OBS.

- **1**: neutral (default)
- **2**: joy
- **3**: angry
- **4**: sorrow

Key assignments can be customized by editing the EMG configuration (`trigger` property in `states.json`). Function keys and special keys are supported but not recommended in browser-based environments.

## ライセンス

Apache License 2.0（[`LICENSE.md`](./LICENSE.md)）。サードパーティライブラリのライセンスは各プロジェクトの `NOTICE.md` を参照してください。
