# EMG-lite Issue List (Draft)

Milestone: **Avatar v0.1**
Labels: `emg-lite`, `avatar`, `integration`

## Issues

### 1. [emg-lite] 基盤構築
- **タイトル**: EMG-lite ディレクトリと型定義の作成
- **内容**:
  - `emg-lite/` ディレクトリ作成
  - `types.ts` に `EMGLiteState` 定義
  - `README.md` 作成
- **Status**: Done

### 2. [avatar] PNG Avatar Adapter 実装
- **タイトル**: PNG Avatar Adapter のプロトタイプ実装
- **内容**:
  - `EmgLitePngAdapter` クラスの実装
  - 画像パスの解決ロジック (emotion + speaking)
  - 描画またはパス返却機能
- **Status**: In Progress

### 3. [integration] 動作検証
- **タイトル**: サンプルHTMLでの動作確認
- **内容**:
  - 簡易な HTML/JS で Adapter をインスタンス化
  - ボタン操作で `EMGLiteState` を変更し、画像が切り替わるか確認
- **Status**: Todo

### 4. [emg-lite] ドキュメント公開
- **タイトル**: EMG-lite 仕様公開
- **内容**:
  - 外部開発者向け（将来用）のドキュメント整備
- **Status**: Todo

### 5. [emg-lite] 拡張ステート対応のプレイヤー実装
- **タイトル**: sleep/blinking/mouthShape/overlays のプレイヤー実装
- **内容**:
  - `EMGLiteState` に追加された `sleep`, `blinking`, `mouthShape`, `overlays` を Viewer/Adapter に反映
  - `mouthShape_*` スロットの解決と `speaking` フォールバック
  - オーバーレイ辞書の描画順合成
- **Status**: Todo

### 6. [emg-lite] 可変スロットと未知キーの安全な無視実装
- **タイトル**: AssetGroup の拡張スロット対応
- **内容**:
  - 5スロット以外の任意キーを安全に無視するガード
  - 実装済みアダプタで未知キーがあってもクラッシュしないことの確認
- **Status**: Todo

### 7. [emg-lite] schemaVersion の解釈と互換ポリシー実装
- **タイトル**: schemaVersion を用いた互換管理
- **内容**:
  - `model.json` の `schemaVersion` を読み取り、未知フィールドを無視する後方互換ポリシーを実装
  - バージョンミスマッチ時の警告表示（ロギング）を追加
- **Status**: Todo
