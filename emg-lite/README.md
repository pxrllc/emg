# EMG-lite

## 概要
EMG-lite (Expression / Motion / Gesture - lite) は、アバターの状態を表現するための内部共通規格（Internal Representation / IR）です。
特定の描画方式（Live2D, VRM, PNG, etc.）に依存せず、アバターが「どのような状態にあるか」を抽象化して定義します。

## 設計思想
- **Internal Representation**: 外部仕様ではなく内部仕様として扱います。
- **Render Agnostic**: 描画層（Adapter）がこの状態を受け取り、実際の表現（画像切り替え、モーション再生）を行います。
- **Minimal**: 複雑なボーン操作や物理演算定義は含まず、「感情」「話しているか」などの高レベルな状態に注目します。

## 構造
`EMGLiteState` インターフェースにより定義されます。
詳細は `types.ts` を参照してください。

## 拡張
将来的にユーザー定義のステートや、より詳細な強度パラメータを追加可能です。
