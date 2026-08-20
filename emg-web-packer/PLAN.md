# emg-web-packer 実装計画

**状態: 未着手（このファイルのみ）**
最終更新: 2026-08-20

ブラウザだけで PSD → `.emg` に変換する Web ツール。「PSD をアップロードすると `.emg` が
降ってくるだけ」の軽量版で、`emg-packer`（Electron アプリ）のインストールを不要にする。

---

## 前提（調査で確定済み・この計画の土台）

`emg-packer/src/renderer/services/` の変換ロジック（`PsdLoader` / `TexturePacker` /
`EmgGenerator` / `MappingGenerator`）は **Electron にも Node API にも一切依存していない**。
`grep` で確認済みで、使っているのは:

- npm パッケージ: `ag-psd`、`jszip`（どちらもブラウザ対応）
- ブラウザ標準 API: `document` / `canvas` / `Blob` / `URL.createObjectURL`

さらに `emg-packer/src/renderer/hooks/useEmgPacker.ts` は既に

- `recalculateMeta()` … PSD のルート直下がグループなら `switch` パーツ、単独レイヤーなら
  `static` パーツ、という**自動判定**を行っている
- `handleExport()` … `<a download>` でブラウザにダウンロードさせている
  （Electron のネイティブ保存ダイアログは使っていない）

つまり **変換パイプラインは既に全自動かつブラウザ互換**で、新しく書く必要があるのは UI だけ。
サーバー処理も不要なので、GitHub Pages に静的配信できる。

---

## UI

1ページのみ。状態は「未読み込み」→「PSD読み込み済み」の2つだけ。

```
┌──────────────────────────────────┐
│  EMG Web Packer                   │
│  ┌────────────────────────────┐  │
│  │   PSD をドロップ            │  │  ← ドロップ＋クリックで選択
│  │   またはクリックして選択     │  │
│  └────────────────────────────┘  │
│                                   │
│  ── 読み込み後に表示 ──           │
│  ベース（常時表示）にするレイヤー: │
│   ☑ 体          ← 自動判定で初期値 │
│   ☐ 目                            │
│   ☐ 口                            │
│   ☐ 眉                            │
│                                   │
│  [ .emg をダウンロード ]          │
└──────────────────────────────────┘
```

- **ベース選択**: PSD のルート直下の項目一覧をチェックボックスで表示する。チェックしたものが
  `type: "static"`（常時表示）、それ以外が `type: "switch"`（差分切り替え）になる。
  初期値は既存の `recalculateMeta()` と同じ自動判定を入れておき、違うときだけ直せばよい形にする。
- 変換中はプログレス表示（大きな PSD は数秒かかる）。
- 変換完了で自動ダウンロード。

---

## 実装

新規ディレクトリ `emg-web-packer/`（Vite + React + TypeScript。既存の `emg-web-runtime` と同構成）。

### 変換ロジックの共有方法

コピーはせず、`emg-packer` のサービス層を **Vite の `resolve.alias` で直接参照**する:

```ts
// vite.config.ts
resolve: {
  alias: { '@packer': path.resolve(__dirname, '../emg-packer/src/renderer/services') }
}
```

ロジックが1箇所に保たれ、`emg-packer` 側の修正が自動で反映される。同一リポジトリ内なので
参照が壊れる心配もない。`ag-psd` / `jszip` は `emg-web-packer/package.json` 側にも依存として入れる。

> **制約**: `emg-packer/src/renderer/services/` は今後も **Electron/Node 非依存を保つこと**。
> ネイティブ保存ダイアログ対応などを入れる場合は `services/` の外に置く。

### 主なファイル

| ファイル | 役割 |
|---|---|
| `src/App.tsx` | 2状態（未読込／読込済）の画面遷移だけを持つルート |
| `src/components/DropZone.tsx` | ドラッグ&ドロップ + ファイル選択 |
| `src/components/BaseLayerSelector.tsx` | ルート直下項目のチェックボックス一覧 |
| `src/services/convert.ts` | `useEmgPacker.handleExport()` 相当を、React フックではなく純粋関数として再構成 |

`convert.ts` の処理順（`useEmgPacker.ts` の `handleExport` を移植）:

1. PSD を走査して `canvas` を持つ可視レイヤーを集める
2. `TexturePacker.pack(packItems)` でアトラス生成
3. `ExportItem[]` を構築。**`zIndex` は `totalLayers - 1 - index`**（先頭＝最前面）
4. `EmgGenerator.generate(...)` → `Blob`
5. `<a download>` でダウンロード

引数（PSD・ベース指定）と戻り値（Blob）が明確な関数として書き直す。

### 既知の注意点

- **アトラス上限**: `TexturePacker.pack(items, startSize = 2048, maxSize = 8192)`。
  8192 に収まらない巨大 PSD はレイヤーがスキップされる可能性があるため、**入りきらなかった場合は
  エラーとして画面に出す**（黙って欠けた `.emg` を配らない）。
- **メモリ**: PSD 全レイヤーを canvas に展開するため、巨大ファイルではブラウザが重くなる。
  ファイルサイズの目安を UI に添える。
- `MappingGenerator.generateDraftMapping()` は既に `EmgGenerator.generate()` の中で呼ばれており、
  条件を満たせば `mapping.json` が同梱される。Web 版でも自動的にこの恩恵を受ける。

### 公開（実装後に必要な作業）

現在 `.github/workflows/github-pages.yml` は「準備中」ページのみを配信している
（本来のビルドステップはコメントアウトで残してある）。公開を再開するときは、
そのコメントを外したうえで `packer/` にビルド成果物を置くステップを追加する:

```
/          → emg-cdn（リファレンスプレイヤー + デモ）
/runtime/  → emg-web-runtime
/packer/   → emg-web-packer
```

Vite の `base` は `'./'`（相対パス）にすること。サブディレクトリ配信で必要。

---

## 検証

- `npm run dev` で起動し、`emg-packer/asset/himari.psd`（手元にある実 PSD）を読み込ませて
  `.emg` がダウンロードされることを確認
- 生成された `.emg` を既存の3系統でクロス検証:
  - `emg-cdn/index.html`（リファレンスプレイヤー）
  - YMM4 の `EmgTachiePlugin`
  - Node スクリプトで `data.json` を展開し `emg-json-spec.md` v0.3.0 スキーマに沿うか確認
- ベース選択を変えると `parts[].type` が `static`/`switch` で切り替わることを、生成 JSON で確認
- `npm run build` が通り、`dist/` が静的ファイルだけで完結していることを確認

## スコープ外

- レイヤーごとの partID 手動編集・プレビュー・JSON ビューア（必要なら Electron 版 `emg-packer` を使う）
- サーバーサイド処理（全てブラウザ内で完結させる）
- `.kra` 対応（`KraLoader` は存在するが、まず PSD のみ）
