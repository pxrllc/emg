# EMG フォーマット 仕様書

**バージョン:** 0.3.0
**更新日:** 2026-08-23
**対象:** `.emg` コンテナと `data.json` のルートスキーマ

コンパニオンファイル `mapping.json` の仕様は `emg-mapping-spec.md` を参照してください。
各フィールドが存在する理由（設計意図）は `emg-spec-intent.md` を参照してください。

---

## 0. この文書の読み方

### 0.1 要求水準

| 語 | 意味 |
|---|---|
| **しなければならない（MUST）** | 適合実装が満たす必要がある要件。満たさない場合、そのファイルは正しく描画されない |
| **すべきである（SHOULD）** | 正当な理由がない限り従う要件 |
| **してもよい（MAY）** | 実装の裁量 |

「**規範的**」と記した節は仕様の一部です。「**参考**」と記した節は実装の助けとなる情報であり、適合性の判定には用いません。

### 0.2 v0.3.0 の位置づけ

v0.3.0 は Draft です。v0.2.2 からの変更は `mapping.json` の追加のみで、**`data.json` のルートスキーマに破壊的変更はありません**。v0.2.2 のファイルは v0.3.0 として有効です。

本文書は、既存実装および実配布ファイルに対する検証を経て、v0.2.2 時点の仕様書に記載が漏れていた事項（`opacity` / `blendMode`、描画順序の解決、識別子の一意性、コンテナの詳細）を明文化したものです。**新しいフィールドの追加は行っていません。**

---

## 1. コンテナ（規範的）

`.emg` ファイルの実体は ZIP アーカイブです。

```
*.emg（ZIP）
├── data.json        必須  メタデータ・パーツ・レイヤー・アニメーション定義
├── texture.png      必須  テクスチャアトラス
├── mapping.json     任意  表情/まばたき/リップシンクの意味づけ
└── LICENSE.txt      任意  利用規約
```

### 1.1 エントリの探索

読み込み実装は、メイン JSON を次の順序で探さなければなりません。

1. エントリ名が `data.json` で**終わる**もの
2. 1 が無い場合、エントリ名が `.json` で終わり、かつ `mapping.json` で終わらない最初のもの

完全一致ではなく後方一致とするのは、次の実データに対応するためです。

- `model.json` という名前で格納されたもの（`samples/senti.emg`）
- フォルダ配下に格納されたもの（`emg-cdn/assets/zunda.emg` は `zunda/assigned_texture_data.json`）

`mapping.json` も同様に後方一致で探します。テクスチャは `Texture.textureFile` の値との後方一致で探すべきです。

### 1.2 圧縮方式

テクスチャ画像は**無圧縮（ZIP の STORE）で格納すべきです**。PNG は既に deflate 済みであり、再圧縮による削減は 1% 未満である一方、読み込みのたびに展開コストが発生します。

`data.json` / `mapping.json` の圧縮方式は問いません。

> **参考:** `emg-packer` の `EmgGenerator` は `zip.generateAsync({ type: 'blob' })` を圧縮オプション無しで呼んでおり、JSZip の既定である STORE が適用されます。手作業で `.emg` を組み立てる場合もこれに合わせてください。

### 1.3 テクスチャアトラスの分割（規範的）

EMG はすべてのパーツを 1 枚のテクスチャアトラスへパッキングします。1 枚に収まらない場合は**複数枚に分割します**。

#### 消費側の要件

**読み込み実装は複数枚のアトラスを扱えなければなりません。** `textures[]` は配列であり、各レイヤーは `Layer.textureFile` により**どのアトラスを参照するかを個別に指定します**。1 枚のみを保持する実装は、分割されたファイルを正しく描画できません。

#### 書き出し側の要件

- 1 枚あたりの寸法は、**幅・高さとも 8192px を超えてはなりません**
- 8192px に収まらない場合、**書き出しを失敗させるのではなく複数枚に分割しなければなりません**
- 各アトラスのファイル名は `textures[]` で宣言します。命名は `texture_0.png`, `texture_1.png` のような連番と**すべきです**が、規範ではありません（単一の場合は `texture.png`）

> **8192px の根拠:** GPU のテクスチャサイズ上限に由来します。Direct3D 11 の機能レベル 11 以上は 16384px を扱えますが、機能レベル 10 の世代、モバイル GPU、および一部の WebGL 実装では 8192px が上限です。より広い環境で追加のリサンプルなしに読めることを優先しています。

#### 寸法の制約

アトラスは**正方形である必要も、両辺が同一である必要もありません**。各辺は独立に 2 の冪へ切り上げられます（実例: `senti` のアトラスは 8192×4096）。

2 の冪であることは v0.3.0 では要求していません。既存の書き出し実装がそうしているというだけであり、消費側は `textures[]` が宣言する任意の寸法を受け入れるべきです。

> **参考:** `emg-packer` の `TexturePacker` は 2048px から開始し、収まらなければ 2 倍にして再試行します。8192px でも収まらない場合に限り複数枚へ分割します。**1 枚に収まる場合のファイル名は `texture.png` のまま**で、分割時のみ `texture_0.png` 以降になります（既存ファイルとの互換のため）。単体で 8192px を超えるレイヤーは分割しても救えないため、例外になります。

---

## 2. ルートオブジェクト（規範的）

```json
{
  "version": "0.3.0",
  "baseCanvasWidth": 1920,
  "baseCanvasHeight": 1080,
  "textures": [ /* Texture[] */ ],
  "parts":    [ /* Part[] */ ],
  "sprites":  [ /* Sprite[] */ ]
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `version` | string | ✅ | フォーマットバージョン |
| `baseCanvasWidth` | number | ✅ | キャンバス幅（px）。PSD のドキュメント幅に相当 |
| `baseCanvasHeight` | number | ✅ | キャンバス高さ（px）。PSD のドキュメント高さに相当 |
| `textures` | Texture[] | ✅ | テクスチャアトラスのメタデータ一覧 |
| `parts` | Part[] | ✅ | パーツ定義の配列 |
| `sprites` | Sprite[] | ✅ | アニメーション定義の配列。アニメーションが無い場合は空配列 |

### 2.1 `version` の信頼性

**`version` の値を解釈の分岐に用いるべきではありません。** 実配布ファイルに、`version` が実際の構造と一致しない例が存在します（`yuriko.emg` は `"0.2.2"` を名乗りながら v0.1.0 のフラットな `layers[]` 構造を持つ）。

構造の判定は**フィールドの有無**で行うべきです。例: ルートに `parts` があれば v0.2.0 以降、`layers` があれば v0.1.0。

---

## 3. Texture オブジェクト（規範的）

ZIP 内のテクスチャアトラスのメタデータです。

```json
{ "textureFile": "texture.png", "width": 8192, "height": 4096 }
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `textureFile` | string | ✅ | テクスチャファイル名。`Layer.textureFile` から参照されるキーを兼ねる |
| `width` | number | ✅ | テクスチャ画像の幅（px） |
| `height` | number | ✅ | テクスチャ画像の高さ（px） |

テクスチャが 1 枚の場合も `textures` 配列に含めなければなりません。実装がファイルを開かずに UV 計算（`x / width` 等）を行えるようにするためです。

### 3.1 画像形式とアルファ（規範的）

テクスチャは **PNG** でなければなりません。パーツの切り抜きにアルファチャンネルが必須であるためです。

> **参考:** 一部の実装は v0.1.0 互換のフォールバック経路で `.jpg` / `.jpeg` のエントリも受け付けますが、書き出し側がこれに依存してはなりません。

アルファは**ストレート（非乗算済み）**です。これは PNG 仕様が定める格納形式であり、EMG が独自に選択したものではありません。合成パイプライン内部での表現（乗算済みへの変換等）は実装の裁量であり、変換は実装の責任です。

ビット深度とカラープロファイルは v0.3.0 では規定していません（10.1 参照）。

---

## 4. Part オブジェクト（規範的）

パーツは、レイヤーをまとめる単位であり、**表示の解決単位**です。

```json
{
  "partID": "Mouth",
  "type": "switch",
  "default": "03",
  "layers": [ /* Layer[] */ ]
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `partID` | string | ✅ | パーツの識別 ID。ファイル内で一意でなければならない |
| `type` | `"static"` \| `"switch"` | ✅ | パーツの種別 |
| `default` | string | `switch` 時のみ必須 | 初期表示する `textureID` |
| `layers` | Layer[] | ✅ | このパーツに属するレイヤーの配列 |

### 4.1 `type` の意味

| 値 | 表示されるレイヤー |
|---|---|
| `static` | `layers` の**すべて**を常に表示する |
| `switch` | `layers` のうち**ちょうど 1 枚**を排他表示する |

この区別はすべての消費側実装で分岐に用いられる、load-bearing な情報です。

### 4.2 `switch` パーツの表示レイヤーの決定（規範的）

`switch` パーツで表示するレイヤーは、次の優先順位で決定しなければなりません。

1. 外部制御（ホストアプリケーションによる明示的な指定、`sprites[]` の再生中フレーム、`mapping.json` による blink / lipSync / 表情の解決結果）
2. `default` と一致する `textureID` を持つレイヤー
3. 上記いずれも解決できない場合、`layers` の先頭

`default` が `layers` 中のどの `textureID` とも一致しない場合、実装は 3 にフォールバックすべきです。

### 4.3 `partID` の由来

`partID` は PSD のレイヤー名から自動生成されるものではなく、パッキングツール上で利用者が割り当てます。配布素材のレイヤー命名規則に依存させないためです。

---

## 5. Layer オブジェクト（規範的）

テクスチャアトラス上の 1 パーツ分の画像情報と、キャンバス上での配置情報を持ちます。

```json
{
  "textureID": "01",
  "textureFile": "texture.png",
  "x": 5794, "y": 1989,
  "width": 178, "height": 145,
  "basePosition_x": 1358, "basePosition_y": 1759,
  "textureZIndex": 13,
  "opacity": 1,
  "blendMode": "normal"
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `textureID` | string | ✅ | レイヤーの識別子。`Part.default` および `Sequence.frames` から参照される |
| `textureFile` | string | ✅ | 参照するテクスチャファイル名。`Texture.textureFile` と一致すること |
| `x` | number | ✅ | **アトラス上**の切り出し左上 X 座標（px） |
| `y` | number | ✅ | **アトラス上**の切り出し左上 Y 座標（px） |
| `width` | number | ✅ | 切り出し幅（px）。描画先の幅でもある |
| `height` | number | ✅ | 切り出し高さ（px）。描画先の高さでもある |
| `basePosition_x` | number | ✅ | **キャンバス上**の描画先左上 X 座標（px） |
| `basePosition_y` | number | ✅ | **キャンバス上**の描画先左上 Y 座標（px） |
| `textureZIndex` | number | ✅ | 描画の重ね順。**値が大きいほど前面** |
| `opacity` | number | ❌ | レイヤー固有の不透明度。`0.0`〜`1.0`。不在時は `1.0` |
| `blendMode` | string | ❌ | 合成モード。不在時は `"normal"` |

### 5.1 座標系（規範的）

**位置情報は 2 つの異なる座標系で与えられます。混同してはなりません。**

| 組 | 座標系 | 意味 |
|---|---|---|
| `x` / `y` / `width` / `height` | アトラスピクセル座標 | テクスチャ画像の**どこから切り出すか** |
| `basePosition_x` / `basePosition_y` | キャンバス座標 | `baseCanvasWidth` × `baseCanvasHeight` の**どこへ描くか** |

描画サイズは切り出しサイズと同一です。v0.3.0 に拡縮・回転・アンカー点は存在せず、レイヤーは常に等倍・軸並行で描画されます。

```
src = (x, y, width, height)                              ← テクスチャから
dst = (basePosition_x, basePosition_y, width, height)    ← キャンバスへ
```

> **参考:** Direct2D の `Vortice.Mathematics.Rect` は `(x, y, width, height)` を取ります。`(left, top, right, bottom)` を期待して `x + width` を渡すと矩形が膨らみ、アトラス上の隣接領域が混入します。

### 5.2 `textureZIndex`（規範的）

`textureZIndex` は**すべてのパーツを横断する単一の重ね順**です。パーツ単位の相対順序ではありません。

**値が大きいほど前面**です。描画は `textureZIndex` の**昇順**（小さい値から）で行わなければなりません。

値の連続性・一意性は要求しません。同値のレイヤーが存在する場合の順序は未定義です（10.2 参照）。

### 5.3 `opacity` と `blendMode`（規範的）

`opacity` はレイヤー固有の不透明度であり、**表示・非表示の制御に用いてはなりません**。`switch` パーツの非選択レイヤーは、`opacity: 0` ではなく描画対象から除外することで隠さなければなりません。

`opacity` を可視性制御に流用すると、(a) レイヤー本来の不透明度が上書きされて反映されなくなり、(b) 非表示レイヤーが合成対象として残ります。

`blendMode` は v0.3.0 では値の集合を規定していません。実データでは `"normal"` 以外の使用例が確認されていません。`"normal"` 以外を解釈できない実装は、`"normal"` として扱ってもよいものとします。

---

## 6. 識別子の一意性（規範的）

| 識別子 | 一意性の範囲 |
|---|---|
| `partID` | **ファイル全体** |
| `spriteID` | **ファイル全体** |
| `textureFile` | ファイル全体 |
| `textureID` | **パーツ内のみ** |

**`textureID` はファイル全体では一意ではありません。** 実配布ファイルで重複が確認されています。

- `senti.emg`: `"01"` が `Mouth` / `Eyes` / `Eyebrows` に存在
- `himari3.emg`: `"1"`〜`"5"` が 眉 / 口 / 目 に、`"6"`〜`"14"` が 口 / 目 に存在

したがって、**レイヤーへの参照は `(partID, textureID)` の組で行わなければなりません。** `textureID` のみを保持すると、列挙順で先に現れた別パーツのレイヤーが解決されます。

この規則に違反した実装で、実際に「眉がまばたきの対象になる」「表情切り替えが別パーツに作用する」といった不具合が発生しています。

`Part.default` と `Sequence.frames` は、それが属するパーツの文脈内で解決されるため `textureID` のみで足ります。パーツ横断の参照（UI の保存値、外部 API）では組を用いてください。

---

## 7. Sprite オブジェクト（規範的）

`partID` 単位でフレームを切り替えるアニメーションの定義です。

```json
{
  "spriteID": "blink",
  "targetPartID": "Eyes",
  "fps": 12,
  "sequence": { "type": "ordered", "frames": ["01", "03", "04", "03", "01"] },
  "trigger": { "type": "random_interval", "intervalMin": 3.0, "intervalMax": 8.0 }
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `spriteID` | string | ✅ | アニメーションの識別 ID。外部から呼び出す際のキー |
| `targetPartID` | string | ✅ | 操作対象の `partID`。**対象パーツの `type` は `switch` でなければならない** |
| `fps` | number | ✅ | フレームレート |
| `sequence` | Sequence | ✅ | フレーム列と再生順 |
| `trigger` | Trigger | ❌ | 発火タイミング。**不在時、プレイヤーは自律再生を行ってはならない** |

`sprites[]` はフレームの差し替えのみを表現します。v0.3.0 に座標変換のアニメーションは存在しません。

フレームは `fps` により**等間隔**に配置されます。フレームごとの表示時間を個別に指定する手段はありません。

### 7.1 Sequence オブジェクト

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"ordered"` \| `"random_hold"` | ✅ | 再生順の種別 |
| `frames` | string[] | ✅ | `textureID` の配列。対象パーツ内で解決される |

| `type` | 挙動 |
|---|---|
| `ordered` | `frames` を先頭から 1 フレームずつ、`fps` の間隔で再生する |
| `random_hold` | `frames` から 1 つをランダムに選び表示し続ける。`trigger` が発火するたびに再抽選する |

`frames` の要素は、`targetPartID` のパーツに属する `textureID` でなければなりません。

### 7.2 Trigger オブジェクト

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"auto_loop"` \| `"random_interval"` \| `"external"` | ✅ | 発火タイミングの種別 |
| `intervalMin` | number | `random_interval` 時のみ必須 | 発火間隔の最小秒数 |
| `intervalMax` | number | `random_interval` 時のみ必須 | 発火間隔の最大秒数 |

| `type` | 挙動 |
|---|---|
| `auto_loop` | 再生終了後ただちに次の再生を開始する |
| `random_interval` | `intervalMin`〜`intervalMax` 秒のランダムな間隔で発火する |
| `external` | プレイヤーは自律発火しない。`spriteID` により外部から明示的に発火させる |

Unity のような外部ランタイム上では、`trigger` を無視し `spriteID` で任意のタイミングに再生してもよいものとします。

### 7.3 `mapping.json` との共存（規範的）

`mapping.json` により**明示的に**まばたき／リップシンクの対象として指定された `partID` について、同じ `targetPartID` を持つ `sprites[]` エントリは**自律発火してはなりません**。`mapping.json` 側の制御が当該パーツを掌握します。

「明示的」とは `blinkPartKey` / `blinkParts` / `lipSyncPartKey` / `lipSyncParts` による指定を指します。`partID` のキーワード一致（`eye` / `口` 等）によるフォールバックで解決された場合は該当しません。

詳細は `emg-mapping-spec.md` を参照してください。

---

## 8. 描画モデル（規範的）

1 フレーム分の描画は、次の手順で行わなければなりません。

### 手順

1. **描画対象のレイヤーを収集する。** `parts` を走査し、
   - `type: "static"` のパーツ → `layers` のすべてを対象に加える
   - `type: "switch"` のパーツ → 4.2 で解決した 1 枚のみを対象に加える
2. **`textureZIndex` の昇順に並べ替える。** これがパーツを横断した奥から手前への順序になる。
   パーツ単位でまとめて描画してはならない（パーツをまたぐ重なりが壊れる）
3. **順に描画する。** レイヤーごとに、
   - テクスチャの `(x, y, width, height)` を
   - キャンバスの `(basePosition_x, basePosition_y, width, height)` へ
   - `opacity` を乗じて合成する

### 疑似コード（参考）

```
draw = []
for part in data.parts:
    if part.type == "static":
        draw += part.layers
    else:
        tid = resolve_switch(part)        # 4.2
        draw += [l for l in part.layers if l.textureID == tid]

for layer in sorted(draw, key=lambda l: l.textureZIndex):
    blit(src=(layer.x, layer.y, layer.width, layer.height),
         dst=(layer.basePosition_x, layer.basePosition_y, layer.width, layer.height),
         alpha=layer.opacity)
```

### 背景

キャンバスの背景は透明です。`.emg` は背景色を持ちません。

---

## 9. `mapping.json` との関係

`mapping.json` は完全に任意のコンパニオンファイルです。存在しなくても `.emg` は有効であり、対応しない実装は**無視してよいものとします**。その場合、表示は `Part.default` と `sprites[]` のみで決まります。

`data.json` が構造（どのパーツにどのレイヤーがあるか）を、`mapping.json` が意味（どのレイヤーが「閉じた目」か）を担当します。

---

## 10. v0.3.0 で未定義の事項

適合実装の判断に委ねられている、または規定が存在しない事項です。**v0.4.0 以降で明文化する候補**であり、現時点では環境間で挙動が異なりうることを意味します。

### 10.1 明示的に未規定

| 事項 | 現状 |
|---|---|
| テクスチャのビット深度 | 8bit 前提だが規定なし |
| カラープロファイル | sRGB 前提だが規定なし。埋め込みの可否も未定義 |
| `blendMode` の値の集合 | `"normal"` 以外の実例なし |
| `textureZIndex` が同値の場合の順序 | 未定義 |
| キャンバス外へはみ出すレイヤーの扱い | 未定義（クリップするか否か） |

### 10.2 仕様と実装が乖離している箇所

| 事項 | 内容 |
|---|---|
| **アトラスの分割（1.3）** | 書き出し側・消費側とも対応済み（2026-08-24）。既知の未対応は無し |

### 10.3 前方互換の規定が存在しない

**v0.3.0 は、未知のフィールド・未知の列挙値に遭遇した実装がどう振る舞うべきかを規定していません。**

具体的には次が未定義です。

- 未知のルートキー、未知のオブジェクトフィールドを無視してよいか
- `Part.type` が `static` / `switch` 以外の値だった場合の扱い
- `Sequence.type` / `Trigger.type` が未知の値だった場合の扱い

このため、v0.3.0 に新しいフィールドを追加した将来のファイルを既存実装が読んだ場合の挙動は、実装ごとに異なります。**将来の拡張に先立って規定すべき最優先項目です。**

---

## 11. 実データにおける既知の逸脱（参考）

配布・検証に用いられている実ファイルには、本仕様に適合しないものがあります。新しい実装やヒューリスティックは、これらに対して安全に動作するか確認してください。

| 逸脱 | 該当ファイル | 内容 |
|---|---|---|
| **`textureZIndex` の反転** | `himari3.emg`, `senti_02.emg`, `senti_030.emg` | 重ね順が仕様と逆（値が大きいほど**奥**）。`emg-packer` が `ag-psd` の子要素順を「上から下」と誤認していたことによる。パッカーは修正済みで、修正前に書き出されたファイルは反転したまま |
| **階層の平坦化** | `senti.emg`（`emg-packer/asset/`） | PSD の入れ子グループが単一の `Character` パーツ（36 レイヤー）に潰れている。`recalculateMeta()` が `root.children` の 1 階層しか走査していなかったことによる。コミット `e4306a7` で修正済み |
| **`version` の不一致** | `yuriko.emg` | `"0.2.2"` を名乗るが v0.1.0 のフラット `layers[]` / `uv` 構造 |
| **`textureID` が番号のみ** | `himari3.emg`, `senti.emg` | `"14"` `"01"` `"15_1"` 等。レイヤー名から意味（母音・閉じ目）を推測できない。推測に基づくヒューリスティックは**無効化へフォールバックすべきであり、誤った推測を返してはならない** |
| **メイン JSON が `model.json`** | `samples/senti.emg` | 1.1 の後方一致で対応する |
| **エントリがフォルダ配下** | `emg-cdn/assets/zunda.emg` | `zunda/assigned_texture_data.json`。同上 |

---

## 12. 実装状況（参考）

本リポジトリ内の消費側実装が、本仕様のうち検証済みの項目にどう対応しているかです。2026-08-23 時点。

| 実装 | JSON 探索（1.1） | 複数アトラス（1.3） | `opacity`（5.3） | `(partID, textureID)`（6章） |
|---|---|---|---|---|
| `emg-cdn/emg-player.0.3.0.js` | 後方一致 ✅ | `textureFile` でキー管理 ✅ | 適用 ✅ | `data-part-id` + `data-texture-id` ✅ |
| `emg-ymm4`（`Emg.Core`） | 後方一致 ✅ | `textureFile` でキー管理 ✅ | 適用 ✅ | 保存形式が `partID<TAB>textureID` ✅ |
| `emg-unity-importer` | 後方一致 ✅ | `Dictionary<string, Texture2D>` ✅ | 適用 ✅ | キーが `{partID}_{textureID}` ✅ |
| `emg-godot` | 後方一致 ✅ | `textureFile -> ImageTexture` ✅ | 適用 ✅ | キーが `partID<TAB>textureID` ✅ |
| `emg-web-runtime` | 後方一致 ✅ | 未確認 | 適用 ✅ | 重複する `textureID` のみ `partID` で修飾 ✅ |
| `emg-renpy` | 後方一致 ✅ | `tex_map` 辞書 ✅ | 適用 ✅ | Ren'Py の `tag attribute` が本来 2 階層 ✅ |

書き出し側は `emg-packer` / `emg-web-packer` とも分割に対応済みです（1.3）。

エントリ探索は実ファイル 6 件（`data.json` / `model.json` / フォルダ配下の
`zunda/assigned_texture_data.json` / `room/room_texture.model.json`）で解決を確認しています。

### 12.1 実装ごとの既知の制限（参考）

| 実装 | 制限 |
|---|---|
| `emg-renpy` | パーツごとに独立した Ren'Py イメージとして登録するため、**パーツを横断した `textureZIndex` の順序は保持されない**。パーツ内の順序は保持される。表示順は呼び出し側が制御する |
| `emg-web-runtime` | `layerID` は `textureID` が他パーツと重複する場合のみ `partID/textureID` の形になる。重複しないファイルでは従来どおり `textureID` のままで、保存済みプロジェクトの互換を保つ |

---

## 13. PSD からの変換（参考）

| EMG フィールド | PSD の対応情報 | 備考 |
|---|---|---|
| `baseCanvasWidth` / `Height` | ドキュメントの幅・高さ | |
| `partID` | 利用者が手動で割り当て | レイヤー名から自動生成しない |
| `type` | 利用者が手動で割り当て | |
| `textureID` | レイヤー名 | パーツ内で重複する場合は連番サフィックスを付与 |
| `basePosition_x` / `_y` | レイヤーの `left` / `top` | |
| `width` / `height` | レイヤーの `width` / `height` | |
| `textureZIndex` | レイヤーのスタック順 | **`ag-psd` の `children` は下から上に並ぶ（index 0 が最背面）**。深さ優先の走査順がそのまま昇順の z になる |
| `x` / `y` | パッキング後に決定 | パッカーが自動計算 |
| `opacity` | レイヤーの不透明度（0〜255 を 0.0〜1.0 へ正規化） | |
| `blendMode` | レイヤーの合成モード | |

### 13.1 非表示レイヤーの扱い

PSD では差分グループのうち 1 枚だけが表示され、残りは非表示です。可視レイヤーのみを書き出すと、**`switch` パーツの差分がすべて失われます**（実測で 17 レイヤーが 3 レイヤーに欠落）。

パッカーは次の規則に従うべきです。

- `switch` パーツ: **非表示のものも含め全レイヤー**を書き出す。PSD で表示されていたものを `default` にする
- `static` パーツ: 表示されているレイヤーのみを書き出す

---

## 14. サンプル

```json
{
  "version": "0.3.0",
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
        { "textureID": "body_base", "textureFile": "texture.png",
          "x": 0, "y": 0, "width": 400, "height": 600,
          "basePosition_x": 440, "basePosition_y": 120,
          "textureZIndex": 0, "opacity": 1, "blendMode": "normal" }
      ]
    },
    {
      "partID": "eye",
      "type": "switch",
      "default": "eye_open",
      "layers": [
        { "textureID": "eye_open",  "textureFile": "texture.png",
          "x": 400, "y": 0, "width": 120, "height": 60,
          "basePosition_x": 560, "basePosition_y": 280,
          "textureZIndex": 10, "opacity": 1, "blendMode": "normal" },
        { "textureID": "eye_half",  "textureFile": "texture.png",
          "x": 520, "y": 0, "width": 120, "height": 60,
          "basePosition_x": 560, "basePosition_y": 280,
          "textureZIndex": 10, "opacity": 1, "blendMode": "normal" },
        { "textureID": "eye_close", "textureFile": "texture.png",
          "x": 640, "y": 0, "width": 120, "height": 60,
          "basePosition_x": 560, "basePosition_y": 280,
          "textureZIndex": 10, "opacity": 1, "blendMode": "normal" }
      ]
    },
    {
      "partID": "mouth",
      "type": "switch",
      "default": "mouth_close",
      "layers": [
        { "textureID": "mouth_close", "textureFile": "texture.png",
          "x": 760, "y": 0, "width": 80, "height": 40,
          "basePosition_x": 600, "basePosition_y": 380,
          "textureZIndex": 20, "opacity": 1, "blendMode": "normal" },
        { "textureID": "mouth_a", "textureFile": "texture.png",
          "x": 840, "y": 0, "width": 80, "height": 40,
          "basePosition_x": 600, "basePosition_y": 380,
          "textureZIndex": 20, "opacity": 1, "blendMode": "normal" }
      ]
    }
  ],
  "sprites": [
    {
      "spriteID": "blink",
      "targetPartID": "eye",
      "fps": 12,
      "sequence": { "type": "ordered",
                    "frames": ["eye_open", "eye_half", "eye_close", "eye_half", "eye_open"] },
      "trigger": { "type": "random_interval", "intervalMin": 3.0, "intervalMax": 8.0 }
    },
    {
      "spriteID": "mouth_talk",
      "targetPartID": "mouth",
      "fps": 8,
      "sequence": { "type": "ordered",
                    "frames": ["mouth_close", "mouth_a", "mouth_close", "mouth_a"] },
      "trigger": { "type": "external" }
    }
  ]
}
```

この例では `eye`（z=10）が `body`（z=0）より前面、`mouth`（z=20）がさらに前面に描画されます。

---

## 15. バージョン履歴

| バージョン | 変更内容 |
|---|---|
| 0.1.0 | 初期実装。ルート直下のフラットな `layers[]` と `sprites[]` |
| 0.2.0 (Draft) | `parts[]` によるグループ化を導入。`type: static/switch`、`default`、`partID` を追加。`textureFile` を追加（複数アトラス対応） |
| 0.2.1 (Draft) | `Sprite` を全面刷新。`loop` / `useTex` を廃止し、`targetPartID` / `sequence`（`type` + `frames`）/ `trigger`（任意）に変更 |
| 0.2.2 (Draft) | ルートに `textures[]` を追加。テクスチャのファイル名・サイズを一元管理 |
| 0.3.0 (Draft) | `mapping.json` を追加（`emg-mapping-spec.md`）。`data.json` のルートスキーマに破壊的変更なし |
| 0.3.0 (2026-08-23 改訂) | **スキーマ変更なし。** 記載漏れの明文化: `Layer.opacity` / `blendMode`、コンテナ仕様（1章）、**アトラスの分割規則と 8192px 上限（1.3）**、座標系（5.1）、`textureZIndex` の向きと解決（5.2 / 8章）、識別子の一意性（6章）、アルファ形式（3.1）、未定義事項と仕様・実装の乖離（10章）、実データの既知の逸脱（11章） |
