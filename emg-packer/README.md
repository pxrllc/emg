# EMG Packer

PSD / KRA を読み込み、テクスチャアトラスにパッキングして `.emg` を書き出すツールです。

Electron + Vite (electron-vite) + React + TypeScript。

---

## emg-editor との関係

**v0.1.5 の時点で `emg-editor` が分岐しました。**

| | `emg-packer`（本プロジェクト） | `emg-editor` |
|---|---|---|
| 位置づけ | PSD → `.emg` の変換ツール | パーツを組み立てる編集ツール |
| 状態 | 現行維持 | ここから発展させる |
| ブラウザ版 | **`emg-web-packer`**（`services/` を alias で共有） | なし |

`emg-web-packer` は `src/renderer/services/` を Vite alias（`@packer`）で直接参照しています。
**この参照先は本プロジェクトのままです。**

> **注意:** 分岐により `services/` が 2 系統になりました。
> EMG 仕様の変更（新しいフィールド、`requiredExtensions` の追加など）や、
> `TexturePacker` / `EmgGenerator` のバグ修正は、
> **`emg-packer` と `emg-editor` の両方に反映する必要があります。**
> 片方だけ直すと、同じ PSD から違う `.emg` が出ます。

### `src/renderer/services/` に Electron 固有のコードを入れないこと

`emg-web-packer` がこのディレクトリをそのままブラウザで読み込みます。
ag-psd / jszip / ブラウザ標準 API のみで完結させてください。
Electron 依存を入れると `emg-web-packer` のビルドが壊れます。

---

## 開発

```bash
npm install

npm run dev          # electron-vite dev — Electron アプリとして起動
npm run dev:web      # Vite のみ。ブラウザで renderer を開く（http://localhost:5273）
npm run build        # electron-vite build
npm run electron:build   # インストーラを作る（electron-builder）
```

`asset/` は gitignore されています。手元の PSD を置くと、
dev サーバから `/asset/<name>.psd` として取得できます。

---

## 出力する形式

EMG v0.5.0（`emg-json-spec.md` / `emg-json-spec-0.5.0.md`）。

- トップレベルのグループが 1 パーツ。種別は中身の可視状態から推定
- `@` で始まるグループは 1 つの差分（`frameName`）としてまとまる
- アトラスは 1 枚に詰め、8192 に収まらないときだけ複数枚に分割する

---

## 既知の制約

- **`.clip` は未対応**です。Clip Studio から PSD で書き出してください
- テストスイートはありません。`npm run dev:web` での手動確認が検証手段です

---

## ライセンス

Apache 2.0（リポジトリルートの `LICENSE.md`）。
