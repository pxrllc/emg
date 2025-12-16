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
