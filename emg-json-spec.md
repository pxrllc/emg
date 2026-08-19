# EMG フォーマット JSON 仕様書

**バージョン：** 0.3.0（Draft）  
**更新日：** 2026-08-19

---

## 概要

EMG（easy Movable Graphic）は、パーツ分割されたキャラクター素材を効率よく管理・再生するためのフォーマットです。  
`.emg` ファイルの実体は ZIP アーカイブであり、以下のファイルを含みます。

```
*.emg（ZIP）
├── data.json        ← メタデータ・レイヤー・パーツ・アニメーション定義
├── mapping.json      ← [任意] 表情/まばたき/リップシンクの意味づけ（v0.3.0〜、詳細は emg-mapping-spec.md）
└── texture.png       ← テクスチャアトラス（全パーツをパッキングした1枚の画像）
```

テクスチャアトラスは複数枚になる場合は `texture_0.png`, `texture_1.png` のように連番で持つことができます。

`mapping.json` は完全にオプショナルなコンパニオンファイルであり、存在しなくても `.emg` ファイルとして有効です。詳細は `emg-mapping-spec.md` を参照してください。

---

## ルートオブジェクト

```json
{
  "version": "0.2.2",
  "baseCanvasWidth": 1920,
  "baseCanvasHeight": 1080,
  "textures": [ /* Texture オブジェクトの配列 */ ],
  "parts": [ /* Part オブジェクトの配列 */ ],
  "sprites": [ /* Sprite オブジェクトの配列 */ ]
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `version` | string | ✅ | フォーマットバージョン |
| `baseCanvasWidth` | number | ✅ | キャンバス幅（px）。PSD の幅に相当 |
| `baseCanvasHeight` | number | ✅ | キャンバス高さ（px）。PSD の高さに相当 |
| `textures` | Texture[] | ✅ | テクスチャアトラスのメタデータ一覧 |
| `parts` | Part[] | ✅ | パーツ定義の配列 |
| `sprites` | Sprite[] | ✅ | アニメーション定義の配列（アニメなし時は空配列） |

---

## Texture オブジェクト

ZIP 内に含まれるテクスチャアトラスのメタデータです。`textureFile` の文字列がファイル名兼IDとして機能します。

```json
{
  "textureFile": "texture_0.png",
  "width": 2048,
  "height": 2048
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `textureFile` | string | ✅ | テクスチャファイル名。Layer の `textureFile` から参照されるキーでもある |
| `width` | number | ✅ | テクスチャ画像の幅（px） |
| `height` | number | ✅ | テクスチャ画像の高さ（px） |

> **設計ノート：** テクスチャが1枚の場合でも必ず `textures` 配列に含めます。Layer の UV 計算（`x / textureWidth` など）にサイズ情報が必要なため、実装側がファイルを開かずにサイズを参照できる形にしています。

---

## Part オブジェクト

パーツは「常時表示されるもの（static）」と「差分を切り替えるもの（switch）」の2種類があります。

```json
{
  "partID": "mouth",
  "type": "switch",
  "default": "mouth_close",
  "layers": [ /* Layer オブジェクトの配列 */ ]
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `partID` | string | ✅ | パーツの識別ID。パッキングツール上でユーザーがアサインする |
| `type` | `"static"` \| `"switch"` | ✅ | パーツの種別（後述） |
| `default` | string | `switch` 時のみ必須 | 初期表示する `textureID` |
| `layers` | Layer[] | ✅ | このパーツに属するレイヤーの配列 |

### type の種別

| 値 | 説明 | 用途例 |
|---|---|---|
| `static` | 常時1枚を表示する。差分なし | 体、背景、固定パーツ |
| `switch` | `layers` の中から1枚だけを排他表示する | 口の差分、目の差分、服の差分 |

> **設計ノート：** `partID` はPSDのレイヤー名から自動生成せず、パッキングツールのUI上でユーザーが手動でアサインします。これにより、配布素材のレイヤー命名規則に依存しない柔軟な運用が可能です。

---

## Layer オブジェクト

テクスチャアトラス上の1パーツ分の画像情報と、キャンバス上での配置情報を持ちます。

```json
{
  "textureID": "mouth_close",
  "textureFile": "texture.png",
  "x": 0,
  "y": 0,
  "width": 80,
  "height": 40,
  "basePosition_x": 600,
  "basePosition_y": 500,
  "textureZIndex": 3
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `textureID` | string | ✅ | レイヤーの一意なID。`Sprite.sequence.frames` から参照される |
| `textureFile` | string | ✅ | 参照するテクスチャファイル名（複数アトラス対応用） |
| `x` | number | ✅ | テクスチャアトラス上の切り出し左上 X 座標（px） |
| `y` | number | ✅ | テクスチャアトラス上の切り出し左上 Y 座標（px） |
| `width` | number | ✅ | テクスチャアトラス上の切り出し幅（px） |
| `height` | number | ✅ | テクスチャアトラス上の切り出し高さ（px） |
| `basePosition_x` | number | ✅ | キャンバス上の描画基準 X 座標（px）。PSD のレイヤー left に相当 |
| `basePosition_y` | number | ✅ | キャンバス上の描画基準 Y 座標（px）。PSD のレイヤー top に相当 |
| `textureZIndex` | number | ✅ | 描画の重ね順。数値が大きいほど前面。PSD のレイヤー順に相当 |

---

## Sprite オブジェクト

`partID` 単位でフレームを切り替えるアニメーションの定義です。  
`trigger` はオプションフィールドであり、省略した場合は EMG プレイヤーによる自律再生は行われません（Unity など外部ランタイムが完全に制御します）。

```json
{
  "spriteID": "blink",
  "targetPartID": "eye",
  "fps": 12,
  "sequence": {
    "type": "ordered",
    "frames": ["eye_open", "eye_half", "eye_close", "eye_half", "eye_open"]
  },
  "trigger": {
    "type": "random_interval",
    "intervalMin": 3.0,
    "intervalMax": 8.0
  }
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `spriteID` | string | ✅ | アニメーションの識別ID。外部から呼び出す際のキー |
| `targetPartID` | string | ✅ | 操作対象の `partID`。対象パーツの `type` は `switch` であること |
| `fps` | number | ✅ | フレームレート（frames per second） |
| `sequence` | Sequence | ✅ | フレーム列と再生順の定義（後述） |
| `trigger` | Trigger | ❌ | 発火タイミングの定義（後述）。省略時は外部制御のみ |

---

### Sequence オブジェクト

```json
{
  "type": "ordered",
  "frames": ["eye_open", "eye_half", "eye_close", "eye_half", "eye_open"]
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"ordered"` \| `"random_hold"` | ✅ | 再生順の種別（後述） |
| `frames` | string[] | ✅ | `textureID` の配列。`ordered` 時はフレーム順、`random_hold` 時は候補リスト |

#### sequence.type の種別

| 値 | 説明 | 用途例 |
|---|---|---|
| `ordered` | `frames` を先頭から順番に1フレームずつ再生する | 瞬きアニメ、口パクアニメ |
| `random_hold` | `frames` の中からランダムに1枚を選んで表示し続ける。`trigger` が発火するたびに再抽選 | 待機中の表情ランダム選択 |

> **保留：** 複数のシーケンス列を定義しておき、その中からランダムに1つを選んで再生する「シーケンスランダム選択」は現在設計中です。確定次第 `type: "random_sequence"` として追加予定。

---

### Trigger オブジェクト

EMG プレイヤーが自律的にアニメーションを発火させるタイミング定義です。  
**Unity 等の外部ランタイム上では `trigger` の値は無視してよく、`spriteID` を使って任意のタイミングで再生を呼び出します。**

```json
{ "type": "auto_loop" }
```

```json
{
  "type": "random_interval",
  "intervalMin": 3.0,
  "intervalMax": 8.0
}
```

```json
{ "type": "external" }
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"auto_loop"` \| `"random_interval"` \| `"external"` | ✅ | 発火タイミングの種別（後述） |
| `intervalMin` | number | `random_interval` 時のみ必須 | 発火間隔の最小秒数 |
| `intervalMax` | number | `random_interval` 時のみ必須 | 発火間隔の最大秒数 |

#### trigger.type の種別

| 値 | 説明 | 用途例 |
|---|---|---|
| `auto_loop` | 再生が終わったら即座に次の再生を開始する常時ループ | 常時ループするアニメ |
| `random_interval` | `intervalMin` ～ `intervalMax` 秒のランダムな間隔で発火する | 瞬き（3〜8秒ごとなど） |
| `external` | EMG プレイヤーは自律発火しない。`spriteID` で外部から明示的にトリガーする | 会話中の口パクなど |

> **`mapping.json` との共存について：** `mapping.json`（`emg-mapping-spec.md` 参照）で明示的にまばたき/リップシンク対象として指定された `partID` に対応する `sprites[]` エントリが存在する場合、プレイヤーは `mapping.json` 側の制御を優先し、当該エントリの自律発火（`trigger`）を行ってはなりません。詳細な共存ルールは `emg-mapping-spec.md` を参照してください。

---

## JSON 全体サンプル

ずんだもちキャラクターを例として、口・目の差分と瞬きアニメーションを持つ構成例です。

```json
{
  "version": "0.2.2",
  "baseCanvasWidth": 1280,
  "baseCanvasHeight": 720,
  "textures": [
    { "textureFile": "texture.png", "width": 2048, "height": 2048 }
  ],
  "parts": [
    {
      "partID": "body",
      "type": "static",
      "layers": [
        {
          "textureID": "body_base",
          "textureFile": "texture.png",
          "x": 0,
          "y": 0,
          "width": 400,
          "height": 600,
          "basePosition_x": 440,
          "basePosition_y": 120,
          "textureZIndex": 0
        }
      ]
    },
    {
      "partID": "eye",
      "type": "switch",
      "default": "eye_open",
      "layers": [
        {
          "textureID": "eye_open",
          "textureFile": "texture.png",
          "x": 400,
          "y": 0,
          "width": 120,
          "height": 60,
          "basePosition_x": 560,
          "basePosition_y": 280,
          "textureZIndex": 2
        },
        {
          "textureID": "eye_half",
          "textureFile": "texture.png",
          "x": 520,
          "y": 0,
          "width": 120,
          "height": 60,
          "basePosition_x": 560,
          "basePosition_y": 280,
          "textureZIndex": 2
        },
        {
          "textureID": "eye_close",
          "textureFile": "texture.png",
          "x": 640,
          "y": 0,
          "width": 120,
          "height": 60,
          "basePosition_x": 560,
          "basePosition_y": 280,
          "textureZIndex": 2
        }
      ]
    },
    {
      "partID": "mouth",
      "type": "switch",
      "default": "mouth_close",
      "layers": [
        {
          "textureID": "mouth_close",
          "textureFile": "texture.png",
          "x": 760,
          "y": 0,
          "width": 80,
          "height": 40,
          "basePosition_x": 600,
          "basePosition_y": 380,
          "textureZIndex": 2
        },
        {
          "textureID": "mouth_a",
          "textureFile": "texture.png",
          "x": 840,
          "y": 0,
          "width": 80,
          "height": 40,
          "basePosition_x": 600,
          "basePosition_y": 380,
          "textureZIndex": 2
        }
      ]
    }
  ],
  "sprites": [
    {
      "spriteID": "blink",
      "targetPartID": "eye",
      "fps": 12,
      "sequence": {
        "type": "ordered",
        "frames": ["eye_open", "eye_half", "eye_close", "eye_half", "eye_open"]
      },
      "trigger": {
        "type": "random_interval",
        "intervalMin": 3.0,
        "intervalMax": 8.0
      }
    },
    {
      "spriteID": "mouth_talk",
      "targetPartID": "mouth",
      "fps": 8,
      "sequence": {
        "type": "ordered",
        "frames": ["mouth_close", "mouth_a", "mouth_close", "mouth_a"]
      }
    }
  ]
}
```

---

## PSD からの変換マッピング

PSD を EMG にパッキングする際の各フィールドの対応表です。

| EMG フィールド | PSD の対応情報 | 備考 |
|---|---|---|
| `baseCanvasWidth` | ドキュメント幅 | |
| `baseCanvasHeight` | ドキュメント高さ | |
| `partID` | ユーザーが手動アサイン | レイヤー名から自動生成しない |
| `type` | ユーザーが手動アサイン | `switch` グループをUIで指定 |
| `textureID` | レイヤー名（自動生成）| 重複時は連番サフィックスを付与 |
| `basePosition_x` | レイヤーの `left`（バウンディングボックス左端） | |
| `basePosition_y` | レイヤーの `top`（バウンディングボックス上端） | |
| `width` | レイヤーの `width` | |
| `height` | レイヤーの `height` | |
| `textureZIndex` | レイヤーのスタック順（上が大きい値） | |
| `x`, `y` | テクスチャパッキング後に決定 | パッカーが自動計算 |

---

## バージョン履歴

| バージョン | 変更内容 |
|---|---|
| 0.1.0 | 初期実装。`layers[]` フラット構造、`sprites[]` |
| 0.2.0 (Draft) | `parts[]` によるグループ化導入。`type: static/switch`、`default`、`partID` を追加。`textureFile` フィールドを追加（複数アトラス対応） |
| 0.2.1 (Draft) | `Sprite` を全面刷新。`loop` / `useTex` を廃止し `targetPartID`、`sequence`（`type` + `frames`）、`trigger`（オプション）に変更 |
| 0.2.2 (Draft) | ルートに `textures[]` を追加。テクスチャファイル名・サイズを一元管理。`textureFile` 文字列がファイル名兼参照キーとして機能 |
| 0.3.0 (Draft) | `mapping.json`（コンパニオンファイル）を追加。表情/まばたき/リップシンクの意味づけレイヤーを定義。既存の `data.json` ルートスキーマへの破壊的変更は無し（詳細は `emg-mapping-spec.md`） |
