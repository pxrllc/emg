# EMG Loader for Godot

A runtime loader that lets Godot 4.x projects load and play `.emg` files directly, without any conversion step.

`.emg` を変換なしで直接読み込み、再生できる Godot 4.x 用のランタイムローダーです。

## Setup / セットアップ

1. Copy `emg_avatar.gd` into your project (e.g. `res://addons/emg/emg_avatar.gd` or anywhere under `res://`).
2. Place your `.emg` files somewhere accessible at runtime, e.g. `res://assets/` or `user://`.

1. `emg_avatar.gd` をプロジェクト内の任意の場所（例: `res://addons/emg/emg_avatar.gd`）にコピーします。
2. `.emg` ファイルを `res://assets/` や `user://` など、実行時にアクセス可能な場所に配置します。

Because the script declares `class_name EmgAvatar`, it is globally available as a type in the editor and in code — you don't need to `preload()` it.

## Usage / 使い方

### Attach to a node

Add a `Node2D` to your scene and attach `emg_avatar.gd` to it, or create one from code:

```gdscript
extends Node2D

func _ready() -> void:
    var avatar := EmgAvatar.new()
    add_child(avatar)

    if not avatar.load_from_path("res://assets/zunda.emg"):
        push_error("Failed to load avatar")
        return

    # Explicit mapping.json-driven control (no-ops if mapping.json is absent
    # or the avatar has no resolvable blink/mouth part).
    avatar.set_blink_state("open")
    avatar.set_expression("happy")
    avatar.set_viseme("a")
```

### Playing sprites[] animations manually

Sprites with `trigger.type == "auto_loop"` or `"random_interval"` start playing automatically as soon as `load_from_path()` returns. Sprites with `trigger.type == "external"` (or no `trigger` at all) must be triggered explicitly:

```gdscript
avatar.play_sprite("mouth_talk")
```

### Switching a layer directly

```gdscript
avatar.switch_texture("mouth", "mouth_a")
```

## Public API

| Method | Description |
|---|---|
| `load_from_path(path: String) -> bool` | Loads a `.emg` ZIP archive, builds the sprite hierarchy as children of this node, resolves `mapping.json` part roles (if present), and starts autonomous `sprites[]` playback. Returns `false` on fatal errors (missing/corrupt `data.json`). |
| `switch_texture(part_id: String, texture_id: String) -> void` | Shows the layer with `texture_id` within `part_id`'s layer group and hides its siblings. |
| `play_sprite(sprite_id: String) -> void` | Explicitly plays a `sprites[]` entry once, regardless of its `trigger` (intended for `"external"`-triggered or trigger-less sprites). |
| `set_blink_state(state: String) -> void` | `mapping.json`-driven blink control. `state` is `"open"` \| `"half"` \| `"closed"`. No-op without `mapping.json` or a resolvable blink part. |
| `set_viseme(vowel: String) -> void` | `mapping.json`-driven lip-sync control. `vowel` is `"a"` \| `"i"` \| `"u"` \| `"e"` \| `"o"` \| `"n"`. No-op without `mapping.json` or a resolvable mouth part. |
| `set_expression(name: String) -> void` | Applies `mapping.json`'s `expressions[name]` (falling back to `expressions["default"]`), including any `blink`/`lipSync` overrides for that expression. |
| `get_sprite_for_texture(texture_id: String) -> Sprite2D` | Flat lookup of the `Sprite2D` node rendering a given `textureID`, e.g. to attach an effect to a specific layer. |

## Notes / 注意事項

- **Part role resolution and the `sprites[]` coexistence rule** follow `emg-mapping-spec.md`: if a `partID` is explicitly claimed by `mapping.json`'s `blinkParts`/`blinkPartKey` or `lipSyncParts`/`lipSyncPartKey`, any `sprites[]` entry targeting that same part is suppressed and will not auto-play — `mapping.json` control takes priority. Parts found only via the keyword heuristic (`eye`, `mouth`, etc.) are **not** considered "explicit," so their `sprites[]` entries still auto-play alongside `mapping.json` control.
- **Coordinate system**: `Sprite2D` nodes are created with `centered = false` so that `position` matches EMG's top-left-origin `basePosition_x`/`basePosition_y` semantics (equivalent to CSS `left`/`top` in the browser reference player).
- **Blink/lipSync positional fallback** (`layers[0]` = open, `[1]` = half, `[2]` = closed) is only applied when the target part has exactly 3 layers, per the "known limitations" section of `emg-mapping-spec.md`. For parts that don't fit that shape, use `blinkParts`/`lipSyncParts` in `mapping.json` instead.
- `mapping.json` is fully optional. If it is missing or fails to parse, the avatar still loads and displays each part's `default` texture; `set_blink_state()`/`set_viseme()`/`set_expression()` simply become no-ops.

## Requirements / 要件

- Godot 4.x (uses `ZIPReader`, `Image.load_png_from_buffer`, `ImageTexture.create_from_image`, typed GDScript)
- EMG v0.2.2+ formatted `data.json`; `mapping.json` requires EMG v0.3.0+
