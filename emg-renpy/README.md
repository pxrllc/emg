# EMG Loader for Ren'Py

A runtime loader that allows Ren'Py games to directly load and use `.emg` files without conversion.

`.emg` を変換なしで直接読み込み、使用できる Ren'Py 用のランタイムローダーです。

## Setup / セットアップ

1. Copy `emg_loader.rpy` into your project's `game/` folder (or a subfolder).
2. Place your `.emg` files in `game/assets/` (or any folder accessible to Ren'Py).

1. `emg_loader.rpy` をプロジェクトの `game/` フォルダ（またはそのサブフォルダ）にコピーします。
2. `.emg` ファイルを `game/assets/` など、Ren'Py からアクセス可能な場所に配置します。

## Usage / 使い方

In your `script.rpy` or any `init python` block, call `load_emg` to register the images.

`script.rpy` または `init python` ブロック内で、`load_emg` 関数を呼び出して画像を登録します。

```renpy
init python:
    # Load the .emg file (path relative to game/)
    # `.emg` を読み込みます（game/ からの相対パス）
    load_emg("assets/zunda.emg")

label start:
    # Display the character using the Part IDs defined in the EMG file
    # EMGファイル内で定義された Part ID を使ってキャラクターを表示します
    
    # 1. Show the static body
    # 静的なボディパーツを表示
    show body
    
    # 2. Show switch parts (Expressions)
    # 差分パーツ（表情など）を表示
    # 2. Show switch parts (Expressions)
    # 差分パーツ（表情など）を表示
    # Syntax: show {partID} {textureID}
    # OR:     show {partID} {partID}_{textureID} (Alias)
    show eye eye_open
    # show eye eye_eye_open  <-- Also works / これも動作します
    
    show mouth mouth_close
    
    "Hello!"
    "こんにちは！"
    
    # Change expressions
    # 表情を変更
    show eye eye_close
    # show mouth mouth_a
    
    "..."

    # Resize (e.g. 50%)
    # サイズ変更（例：50%）
    show body 私服 at halfsize
    # OR / または
    show body 私服:
        zoom 0.5

    # Standard Positions
    # 標準の位置指定
    show body at center
    show body at right
    show body at left

    # Transitions
    # トランジション
    show body 私服 with dissolve
```

## Multiple Characters / 複数キャラクターの表示

To display multiple characters, provide a `base_name` (namespace) when loading.
複数のキャラクターを表示する場合、読み込み時に `base_name`（名前空間）を指定します。

```renpy
init python:
    # "hinano" will be the prefix for all parts
    # "hinano" が全てのパーツの接頭辞になります
    load_emg("assets/hinano_4.emg", base_name="hinano")
    
    # Another character
    # 別のキャラクター
    load_emg("assets/zunda.emg", base_name="zunda")

label start:
    # Show hinano
    show hinano body at left
    show hinano face smile

    # Show zunda
    show zunda body at right
    show zunda face smile
```

## Ren'Py Standard Features / Ren'Py標準機能の利用

Because EMG parts are registered as standard Ren'Py images, you can use all standard Ren'Py image features.
EMGパーツは標準的なRen'Py画像として登録されるため、Ren'Pyの全ての標準画像機能が利用可能です。

- **Position (`at`)**: `left`, `right`, `center`, `truecenter`, etc.
- **Transition (`with`)**: `dissolve`, `fade`, `pixellate`, etc.
- **ATL Transforms**: `zoom`, `alpha`, `rotate`, `xoffset`, `yoffset`, etc. (via block syntax or custom transforms)
- **Z-Order (`zorder`)**: `show body zorder 10`

**Note on `halfsize` / `halfsize` について**
`halfsize` is not a standard Ren'Py transform. It is a custom transform included in `emg_loader.rpy` for convenience.
`halfsize` はRen'Pyの標準機能ではなく、利便性のために `emg_loader.rpy` に含めたカスタム変換定義です。

## Features / 機能

- **Direct Loading**: Reads `.emg` (ZIP) files directly.
  - `.emg` (ZIP) ファイルを直接読み込みます。
- **Dynamic Composition**: Uses `im.Composite` and `im.Crop` to construct characters from the texture atlas at runtime.
  - 実行時に `im.Composite` と `im.Crop` を使用してテクスチャアトラスから絵を構築します。
- **Memory Efficient**: Loads the texture atlas once and shares it across all parts.
  - テクスチャアトラスを一度だけ読み込み、全パーツで共有するためメモリ効率が良いです。

## Requirements / 要件

- Ren'Py 7.4+ (Support for `im.Data` and modern Python)
- EMG v0.2.2+ formatted files
