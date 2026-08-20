# emg-web-packer

ブラウザだけで PSD（および `.kra`）を `.emg` に変換する Web ツール。
`emg-packer`（Electron アプリ）をインストールせずに、ドロップして落とすだけで `.emg` が得られる。

変換はすべてブラウザ内で完結し、ファイルはどこにもアップロードされない。
そのため静的ホスティング（GitHub Pages 等）に置ける。

## 使い方

```bash
npm install
npm run dev      # http://localhost:5173/
npm run build    # tsc && vite build → dist/
```

1. PSD をドロップ（またはクリックして選択）
2. パーツごとに「ベース（常時表示）」かどうかをチェック
3. 「.emg をダウンロード」

## 変換ロジックは emg-packer と共有している

このプロジェクトは変換処理を**自前で持たない**。`emg-packer/src/renderer/services/`
（`PsdLoader` / `TexturePacker` / `EmgGenerator` / `MappingGenerator`）を
Vite の `resolve.alias`（`@packer`）で直接参照している。ロジックを1箇所に保ち、
`emg-packer` 側の修正がそのまま反映されるようにするため。

> **`emg-packer/src/renderer/services/` は Electron/Node 非依存を保つこと。**
> 現状 `ag-psd` / `jszip` とブラウザ標準 API しか使っておらず、それがこの共有を成立させている。
> ネイティブ保存ダイアログのような Electron 固有の処理を足す場合は `services/` の外に置く。

`ag-psd` と `jszip` は `emg-packer` 側の `node_modules` にも存在するため、
解決先を当プロジェクトに固定していない と TypeScript が同じ型を別物として扱いエラーになる
（`vite.config.ts` と `tsconfig.json` の両方で alias / paths を指定している）。

## パーツ種別と書き出しの扱い

「ベース」チェックの単位は PSD のルート直下の項目ではなく、**実際に生成される `partID`** にしている。
`partID` はグループに入るたび内側のグループ名で上書きされるため、
ルート直下の名前とは一致しないことがあるため（例: `表情/目/…` → `partID` は `目`）。

書き出すレイヤーの決め方:

| パーツ種別 | 書き出すレイヤー | 理由 |
|---|---|---|
| `switch`（差分） | **非表示のものも含めて全部** | PSD では差分は1枚だけ表示され残りは非表示。除外すると切り替え先が無くなる |
| `static`（ベース） | 表示されているものだけ | 常時表示されるため、非表示のレイヤーを入れると意図しない重なりになる |

PSD で表示されていたレイヤーが `part.default`（初期表示）になる。

## 制限

- アトラスの上限は 8192×8192。収まらない PSD は変換時にエラーを表示する（黙って欠けることはない）
- Clip Studio（`.clip`）は非対応。PSD で書き出してから読み込む
- レイヤー単位の `partID` 編集やプレビューは持たない。必要なら Electron 版 `emg-packer` を使う
