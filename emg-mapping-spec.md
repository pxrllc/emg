# EMG Mapping 仕様書（`mapping.json`）

**対象フォーマット：** EMG v0.3.0 〜 v0.5.0（Draft）
**更新日：** 2026-08-24
**ステータス：** Draft

> **バージョンの扱い:** `mapping.json` はファイル内にバージョンフィールドを持ちません。本書は EMG 本体の複数バージョンを 1 冊で扱い、バージョン間で挙動が異なる箇所にのみ「（v0.5.0〜）」のように対象を明記します。本体と別立てのバージョン番号は振りません。

---

## 概要

`mapping.json` は、`.emg` アーカイブ（ZIP）内に置かれる**オプショナルなコンパニオンファイル**です。パーツ・レイヤーの物理的な構造を定義する `data.json`（本体、`emg-json-spec.md` 参照）とは別ファイルとして、ZIP のルートに配置します。

`mapping.json` は、`data.json` が持つ「どのパーツにどのレイヤーがあるか」という静的な構造情報に対して、**「どのパーツがまばたき役か」「どのレイヤーが表情『笑顔』に対応するか」といった意味づけ（セマンティクス）**を追加するためのものです。

```
*.emg（ZIP）
├── data.json        ← メタデータ・レイヤー・パーツ・アニメーション定義
├── mapping.json      ← [任意] 表情/まばたき/リップシンクの意味づけ（v0.3.0〜）
└── texture.png       ← テクスチャアトラス
```

### 後方互換性

- `mapping.json` が存在しない場合、プレイヤーは `parts[].default` の指定のみで基本表示を行います。blink / lipSync / expression の自動制御は行われませんが、静止画としては正しく表示されます。
- `mapping.json` に対応しないプレイヤー実装は、本ファイルを単純に無視して構いません（`data.json` 本体のルートスキーマに破壊的変更はありません）。

### レイヤーの参照方法（v0.5.0〜で意味が拡張）

本書がレイヤーを指す値（`blink.{open,half,closed}`、`lipSync.{a,i,u,e,o,n,open}`、`expressions[].parts` の値、`expressions[].other[]`、`expressions[].eyebrow`、`overrides` 内の各値）は、**フレーム識別子**として解決します。

フレーム識別子は `emg-json-spec-0.5.0.md` 1 章の定義に従い、

1. 対象レイヤーが `frameName` を持つならその値
2. 持たないなら `textureID`

となります。**`frameName` を持たないファイル（v0.4.0 以前のすべてのファイル）では `textureID` と同一**であり、解決結果は変わりません。

この定義により、`data.json` 側で `frameName` を導入しても本書の記述を書き換える必要がありません。

> 値そのものの書き方は従来どおりです。`frameName` を使うパーツを対象にする場合のみ、`textureID` ではなくフレーム名を書くことになります。

---

## スキーマ定義

```ts
interface EmgSemanticMapping {
  avatarId: string;
  baseMapping: {
    // まばたき対象パーツの指定方法（2方式、両対応可）
    blinkPartKey?: string;    // 方式1: 対象パーツをキー文字列で指定（複数レイヤー方式のパーツ用）
    blinkParts?: {             // 方式2（フラットモード）: 状態ごとに個別の1パーツ=1レイヤーを割り当て
      open?: string;
      half?: string;
      closed?: string;
    };
    blink: {                   // 方式1で使う、レイヤーの textureID
      open: string;
      half: string;
      closed: string;
    };

    // リップシンクも同様に2方式
    lipSyncPartKey?: string;
    lipSyncParts?: {
      a?: string; i?: string; u?: string; e?: string; o?: string; n?: string;
    };
    lipSync: {
      open?: string;   // 汎用の「発話中」フォールバック（母音不問）
      a: string; i: string; u: string; e: string; o: string; n: string;
    };
  };
  expressions: {
    [expressionName: string]: {
      presetID?: string;                    // v0.5.0〜: data.json の presets[] を参照する
      parts?: Record<string, string[]>;   // partID（または mappingKey）→ 有効化するレイヤーIDの配列
      eyebrow?: string;                     // 眉パーツの直接指定（特別扱い）
      other?: string[];                     // その他有効化するレイヤーIDリスト
      overrides?: {                         // この表情専用の blink / lipSync 差し替え
        blink?: { open: string; half: string; closed: string };
        lipSync?: { a: string; i: string; u: string; e: string; o: string; n: string };
      };
    };
  };
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `avatarId` | string | ✅ | このマッピングが対象とするアバターの識別子 |
| `baseMapping.blinkPartKey` / `blinkParts` | string / object | どちらか一方 | まばたき対象パーツの指定（後述） |
| `baseMapping.blink` | object | ✅（方式1使用時） | blink 状態ごとの `textureID` |
| `baseMapping.lipSyncPartKey` / `lipSyncParts` | string / object | どちらか一方 | リップシンク対象パーツの指定（後述） |
| `baseMapping.lipSync` | object | ✅（方式1使用時） | 母音ごとの `textureID` |
| `expressions` | object | ✅（空オブジェクト可） | 表情名 → 有効化するレイヤー構成のマップ。`"default"` は基本表情として扱われる |
| `expressions[].presetID` | string | ❌（v0.5.0〜） | `data.json` の `presets[]` を参照する。パーツ状態を本書に重複して書かずに済む |

### `presetID`（v0.5.0〜）

表情はパーツ状態を直接書く代わりに、`data.json` の `presets[]` を参照できます。

```json
"expressions": {
  "formal": { "presetID": "school" }
}
```

役割は次のように分かれます。パーツ状態の記述が `data.json` に集約され、本書は意味づけのみを担当します。

| | 担当 | 置き場所 |
|---|---|---|
| `presets[]` | パーツ状態の組み合わせ（衣装・髪型・小物） | `data.json`（構造） |
| `expressions` | 意味づけ（joy / angry と、それが指す状態） | `mapping.json`（意味） |

`presetID` と `parts` の両方が指定された場合、**`parts` が優先します**。`presetID` を理解しない実装は当該フィールドを無視し、`parts` のみで解決します（`parts` も無い場合、その表情はパーツ状態を変更しません）。

---

## 解決ロジック（規範的）

以下は、`mapping.json` を持つ EMG アバターを再生するプレイヤー実装が **MUST / SHOULD** で満たすべき挙動です。

### パーツの役割判定（switch パーツごとに1回）

1. `blinkParts`（フラットモード）が設定されていれば、そのパーツが `blinkParts` の値のいずれかに一致するか確認する → 一致すれば blink 役
2. なければ `blinkPartKey` との一致を確認する → 一致すれば blink 役
3. どちらも無ければ、`partID` にヒューリスティックキーワード（`eye` / `eyes` / `eyelid` / `blink` / `目`）が含まれるか判定する → blink 役（フォールバック）
4. 口についても同様（`lipSyncParts` / `lipSyncPartKey` / `mouth`, `lip`, `viseme`, `口`）
5. blink 役と mouth 役の両方に該当する場合は mouth 役を優先しなければならない（`isBlinkPart = isBlinkPartRaw && !isMouthPart`）

### 表情パーツ（`expressions[name].parts`）の解決優先順位

高い方が勝つ：

1. 対象表情のカスタムマッピング（エディタでのプレビュー編集中データ）
2. 対象表情のベースマッピング（保存済み `mapping.json`）
3. `default` 表情のカスタムマッピング
4. `default` 表情のベースマッピング

### blink 解決（フラットモードの場合）

現在の blink 状態（open / half / closed）に対応する `blinkParts.{state}` が、このパーツの mappingKey と一致する場合のみ表示する。一致しなければ非表示にする。

多レイヤーモードの場合は `blink.{state}` の `textureID` を使用する。無ければレイヤー配列の位置的フォールバック（`layers[0]`=open, `layers[1]`=half, `layers[2]`=closed）を用いてよい。ただし「既知の制限」を参照。

### リップシンク解決（フラットモードの場合）

現在の母音（a/i/u/e/o/n）に対応する `lipSyncParts.{vowel}` が一致する場合のみ表示する。

多レイヤーモードの場合は `lipSync.{vowel}` の `textureID`、無ければ `lipSync.open`、それも無ければ `textureID` に母音名を含むレイヤーを検索、それも無ければ `part.default`、それも無ければ先頭レイヤーの優先順位で解決する。

---

## 既知の制限（非規範的）

blink / lipSync の**位置的フォールバック**（`layers[0]`=open, `layers[1]`=half, `layers[2]`=closed）は、対象の `switch` パーツがちょうど3レイヤー（open/half/closed）で構成されている場合にのみ意味を持ちます。

実際に `emg-packer` で書き出された EMG ファイルでは、1つの `switch` パーツが数十枚のレイヤー（表情差分・パーツ差分の寄せ集め）を持つケースや、逆に全パーツが単一の `switch` パーツにまとめられているケース（`partID` によるパーツ分割が行われていない）が存在します。このようなパーツに対して位置的フォールバックを機械的に適用すると、意図しないレイヤーが blink/lipSync 状態として解決されます。

このため、3レイヤー構成に一致しない `switch` パーツに対して blink/lipSync の意味づけを行いたい場合は、位置的フォールバックに頼らず **`blinkParts` / `lipSyncParts`（フラットモード）で対象パーツを明示的に指定すること**を強く推奨します（SHOULD）。位置的フォールバックはあくまで、シンプルな3値構成のパーツに対する簡易対応として提供されています。

---

## 自動生成ヒューリスティック（非規範的・推奨アルゴリズム）

`mapping.json` が存在しない `.emg` ファイルを読み込んだ際、`partID` のキーワードから最小限の `mapping.json` を自動生成するための、実装者向けの推奨アルゴリズムです。MUST 要件ではありません。

- `partID` に `eye` / `eyes` / `blink` / `瞳` / `目` のいずれかを含む `switch` パーツ → blink 候補として登録
- `partID` に `mouth` / `lip` / `口` のいずれかを含む `switch` パーツ → lipSync 候補として登録

パッカー／ビューア実装者は、このヒューリスティックをパッキング時点で適用することで、書き出し時点で `mapping.json` の下書きを提供できます（「既知の制限」に該当するパーツでは検出できない場合があります）。

---

## `sprites[]` との共存ルール

`sprites[]`（自律ループアニメーション、`emg-json-spec.md` 参照）と `mapping.json`（外部状態駆動の意味づけ）は**役割が異なり、どちらかを廃止する必要はありません**。

| 機構 | 制御方式 | 用途例 |
|---|---|---|
| `sprites[]` | プレイヤーが自律的にタイミングを判断して再生（`trigger` の `auto_loop` / `random_interval`）、または `external` で外部から `spriteID` 指定で再生 | 装飾的なループアニメ、常時ループするエフェクト |
| `mapping.json` | 外部状態（発話中 / 瞬きタイマー / 現在の表情 / 現在の母音）に応じてプレイヤーが毎フレーム解決 | 会話に連動するリップシンク、感情表現としての瞬き・表情 |

**同一パーツへの二重制御を防ぐルール（規範的）：**

`mapping.json` の `baseMapping.blinkPartKey` / `blinkParts` または `lipSyncPartKey` / `lipSyncParts` で明示的に対象指定されている `partID` について、対応する `sprites[]` エントリ（`targetPartID` が同一のもの）が存在する場合、プレイヤーは `mapping.json` による制御を優先し、当該 `sprites[]` エントリの自律再生（`trigger`）を**発火してはならない（MUST NOT trigger）**。これにより同一パーツへの二重制御による表示の競合を防ぎます。

上記に該当しない `partID`（`mapping.json` が関与しないパーツ）については、`sprites[]` は通常通り独立して動作してよい（MAY）。

これにより、例えば「目のパーツは `mapping.json` の blink 制御下に置きつつ、別の装飾パーツ（きらめきエフェクト等）は `sprites[]` の `auto_loop` で独立して動かす」という組み合わせが仕様上明確になります。

---

## JSON 例

```json
{
  "avatarId": "senti02",
  "baseMapping": {
    "blinkPartKey": "eye",
    "blink": { "open": "eye_open", "half": "eye_half", "closed": "eye_close" },
    "lipSyncPartKey": "mouth",
    "lipSync": {
      "open": "mouth_a",
      "a": "mouth_a", "i": "mouth_i", "u": "mouth_u",
      "e": "mouth_e", "o": "mouth_o", "n": "mouth_close"
    }
  },
  "expressions": {
    "default": {},
    "happy": {
      "parts": { "eyebrow": ["eyebrow_up"] },
      "eyebrow": "eyebrow_up"
    },
    "sad": {
      "overrides": {
        "blink": { "open": "eye_sad", "half": "eye_sad_half", "closed": "eye_close" }
      }
    }
  }
}
```

---

## 参照ドキュメント

- `emg-json-spec.md` — EMG フォーマット JSON 仕様書（`data.json` 本体、`parts[]` / `sprites[]` 定義）
- `emg-spec-intent.md` — EMG フォーマットの設計意図
