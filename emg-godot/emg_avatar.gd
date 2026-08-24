class_name EmgAvatar
extends Node2D

## Loads and plays an .emg character file (EMG format v0.2.2 / v0.3.0 mapping.json).
## See emg-json-spec.md and emg-mapping-spec.md at the repository root for the
## normative format this loader implements.

const BLINK_KEYWORDS: Array[String] = ["eye", "eyes", "eyelid", "blink", "目"]
const MOUTH_KEYWORDS: Array[String] = ["mouth", "lip", "viseme", "口"]

var _data: Dictionary = {}
var _mapping = null # Dictionary | null

var _textures: Dictionary = {}       # textureFile -> ImageTexture
var _part_layers: Dictionary = {}    # partID -> { textureID -> Sprite2D }
var _texture_to_part: Dictionary = {}   # textureID -> partID
var _texture_to_sprite: Dictionary = {} # textureID -> Sprite2D (flat lookup)
var _part_type: Dictionary = {}      # partID -> "static" | "switch"
var _part_visible: Dictionary = {}   # partID -> bool（v0.5.0 §4）

var _blink_part_id: String = ""
var _blink_explicit: bool = false
var _mouth_part_id: String = ""
var _mouth_explicit: bool = false

var _current_expression: String = "default"
var _active_blink_override = null    # Dictionary | null
var _active_lipsync_override = null  # Dictionary | null


func load_from_path(path: String) -> bool:
	var reader := ZIPReader.new()
	var err := reader.open(path)
	if err != OK:
		push_error("EmgAvatar: failed to open '%s' (error %d)" % [path, err])
		return false

	var files: PackedStringArray = reader.get_files()

	var data_file := _find_data_file(files)
	if data_file == "":
		push_error("EmgAvatar: no data JSON found inside '%s'" % path)
		reader.close()
		return false

	var data_parsed = JSON.parse_string(reader.read_file(data_file).get_string_from_utf8())
	if typeof(data_parsed) != TYPE_DICTIONARY:
		push_error("EmgAvatar: failed to parse '%s' as JSON" % data_file)
		reader.close()
		return false
	_data = data_parsed

	# v0.4.0 F5: refuse before loading textures or mapping.json.
	var ext_error := _check_required_extensions(_data)
	if ext_error != "":
		push_error("EmgAvatar: %s" % ext_error)
		reader.close()
		return false

	_mapping = null
	var mapping_file := ""
	for f in files:
		if f.ends_with("mapping.json"):
			mapping_file = f
			break
	if mapping_file != "":
		var mapping_parsed = JSON.parse_string(reader.read_file(mapping_file).get_string_from_utf8())
		if typeof(mapping_parsed) == TYPE_DICTIONARY:
			_mapping = mapping_parsed
		else:
			push_warning("EmgAvatar: failed to parse '%s', ignoring mapping.json" % mapping_file)

	_load_textures(reader, files)
	_build_parts()
	reader.close()

	_resolve_part_roles()
	_start_animation()
	return true


func _find_data_file(files: PackedStringArray) -> String:
	for f in files:
		if f.ends_with("data.json"):
			return f
	for f in files:
		if f.ends_with(".json") and not f.ends_with("mapping.json"):
			return f
	return ""


func _load_textures(reader: ZIPReader, files: PackedStringArray) -> void:
	_textures.clear()
	for tex_meta in _data.get("textures", []):
		var file_name: String = tex_meta.get("textureFile", "")
		if file_name == "":
			continue
		var found := ""
		for f in files:
			if f.ends_with(file_name):
				found = f
				break
		if found == "":
			push_warning("EmgAvatar: texture file '%s' not found in archive" % file_name)
			continue

		var image := Image.new()
		var img_err := image.load_png_from_buffer(reader.read_file(found))
		if img_err != OK:
			push_warning("EmgAvatar: failed to decode PNG '%s' (error %d)" % [file_name, img_err])
			continue

		_textures[file_name] = ImageTexture.create_from_image(image)


func _build_parts() -> void:
	_part_layers.clear()
	_texture_to_part.clear()
	_texture_to_sprite.clear()
	_part_type.clear()
	_part_visible.clear()

	for part in _data.get("parts", []):
		var part_id: String = part.get("partID", "")
		var part_type: String = _resolve_part_type(part)
		var default_id: String = part.get("default", "")
		_part_type[part_id] = part_type
		# v0.5.0 §4: static パーツは defaultVisible で初期状態が決まる（switch では無視）
		var part_visible: bool = part_type != "static" or part.get("defaultVisible", true)
		_part_visible[part_id] = part_visible

		var layer_map: Dictionary = {}

		for layer in part.get("layers", []):
			var texture_id: String = layer.get("textureID", "")
			var texture_file: String = layer.get("textureFile", "")
			var atlas_tex = _textures.get(texture_file)
			if atlas_tex == null:
				push_warning("EmgAvatar: no loaded texture '%s' for layer '%s'" % [texture_file, texture_id])
				continue

			var atlas := AtlasTexture.new()
			atlas.atlas = atlas_tex
			atlas.region = Rect2(layer.get("x", 0), layer.get("y", 0), layer.get("width", 0), layer.get("height", 0))

			var sprite := Sprite2D.new()
			sprite.name = "%s__%s" % [part_id, texture_id]
			sprite.texture = atlas
			# EMG basePosition_x/y is a top-left origin (CSS left/top style),
			# Sprite2D is center-origin by default, so disable centering.
			sprite.centered = false
			sprite.position = Vector2(layer.get("basePosition_x", 0), layer.get("basePosition_y", 0))
			sprite.z_index = int(layer.get("textureZIndex", 0))
			# Per-layer opacity from data.json. Visibility is a separate channel
			# (sprite.visible), so modulate carries only the layer's own opacity.
			sprite.modulate.a = float(layer.get("opacity", 1.0))
			# v0.5.0 §2.2: switch の表示単位はフレーム識別子。同じ識別子のレイヤーは
			# すべて同時に表示される。frameName の無いファイルでは 1 枚しか一致しない。
			var fid := _frame_id(layer)
			sprite.visible = part_visible and (part_type != "switch" or fid == default_id)
			add_child(sprite)

			if not layer_map.has(fid):
				layer_map[fid] = []
			layer_map[fid].append(sprite)
			# textureID repeats across parts (senti has "01" in Mouth, Eyes and Eyebrows),
			# so a layer is only uniquely identified by (partID, textureID). Keying these
			# flat maps on textureID alone made a lookup resolve to whichever part was
			# enumerated first — that is how "the eyebrows blink" bugs happen.
			# A layer is only unique as (partID, frame identifier); see the note in
			# switch_texture(). Keyed on the frame identifier so v0.5.0 files resolve.
			var key := _layer_key(part_id, fid)
			_texture_to_part[key] = part_id
			_texture_to_sprite[key] = sprite
			# Bare-identifier fallback for callers that only know the frame name,
			# never overwriting an earlier part's entry.
			if not _texture_to_part.has(fid):
				_texture_to_part[fid] = part_id
				_texture_to_sprite[fid] = sprite

		_part_layers[part_id] = layer_map


## Shows only the layer matching texture_id within part_id's layer group, hides the rest.
func switch_texture(part_id: String, frame_id: String) -> void:
	if not _part_visible.get(part_id, true):
		return  # 非表示のパーツは切り替えても出さない（v0.5.0 §4）
	var layer_map: Dictionary = _part_layers.get(part_id, {})
	for fid in layer_map.keys():
		for sprite in layer_map[fid]:
			(sprite as Sprite2D).visible = (fid == frame_id)


func _set_part_visible(part_id: String, visible: bool) -> void:
	_part_visible[part_id] = visible
	var layer_map: Dictionary = _part_layers.get(part_id, {})
	for fid in layer_map.keys():
		for sprite in layer_map[fid]:
			(sprite as Sprite2D).visible = visible


## v0.5.0 §5.2: プリセットを適用する。指定されていない partID は変更しない。
func apply_preset(preset_id: String) -> void:
	for preset in _data.get("presets", []):
		if preset.get("presetID", "") != preset_id:
			continue
		for part_id in preset.get("parts", {}).keys():
			switch_texture(part_id, str(preset["parts"][part_id]))
		for part_id in preset.get("toggles", {}).keys():
			_set_part_visible(part_id, bool(preset["toggles"][part_id]))
		return
	push_warning("EmgAvatar: preset '%s' not found" % preset_id)


## Builds the key used by the flat layer lookups. A layer is only unique as
## (partID, textureID); see _build_parts().
func _layer_key(part_id: String, texture_id: String) -> String:
	return "%s\t%s" % [part_id, texture_id]


## Looks up a layer's sprite. Pass part_id whenever it is known — without it the
## lookup falls back to whichever part declared the textureID first.
func get_sprite_for_texture(texture_id: String, part_id: String = "") -> Sprite2D:
	if part_id != "":
		return _texture_to_sprite.get(_layer_key(part_id, texture_id), null)
	return _texture_to_sprite.get(texture_id, null)


# ---------------------------------------------------------------------------
# sprites[] playback (emg-json-spec.md, Sprite/Sequence/Trigger objects)
# ---------------------------------------------------------------------------

func _start_animation() -> void:
	for sprite in _data.get("sprites", []):
		var target_part_id: String = sprite.get("targetPartID", "")
		# mapping.json coexistence rule: parts explicitly claimed by blink/lipSync
		# mapping MUST NOT be auto-triggered by sprites[] (emg-mapping-spec.md).
		if (target_part_id == _blink_part_id and _blink_explicit) or (target_part_id == _mouth_part_id and _mouth_explicit):
			continue
		_handle_sprite(sprite)


func _handle_sprite(sprite: Dictionary) -> void:
	var target_part_id: String = sprite.get("targetPartID", "")
	var sequence = sprite.get("sequence")
	if target_part_id == "" or typeof(sequence) != TYPE_DICTIONARY:
		return

	var fps: float = sprite.get("fps", 12.0)
	if fps <= 0:
		fps = 12.0
	var frame_ms: float = 1000.0 / fps

	var trigger = sprite.get("trigger")
	if typeof(trigger) != TYPE_DICTIONARY:
		return # external / no trigger: only playable via play_sprite()

	var trigger_type: String = _resolve_trigger_type(trigger)
	if trigger_type == "auto_loop":
		var seq_type: String = _resolve_sequence_type(sequence)
		if seq_type == "ordered":
			if sequence.has("keys"):
				_play_keyed_sequence(target_part_id, sequence["keys"], true)
			else:
				_play_ordered_sequence(target_part_id, sequence.get("frames", []), frame_ms, true)
		else:
			# random_hold looped is effectively static: pick once, no repeat needed.
			_run_sequence_once(target_part_id, sequence, frame_ms)
	elif trigger_type == "random_interval":
		var interval_min: float = trigger.get("intervalMin", 1.0)
		var interval_max: float = trigger.get("intervalMax", 5.0)
		_schedule_random_interval(target_part_id, sequence, frame_ms, interval_min, interval_max)
	# trigger_type == "external": no autoplay, use play_sprite()


func _run_sequence_once(target_part_id: String, sequence: Dictionary, frame_ms: float) -> void:
	var seq_type: String = _resolve_sequence_type(sequence)
	# v0.5.0 §6.1: keys と frames は排他。keys があればそちらを使う。
	if sequence.has("keys"):
		if seq_type == "ordered":
			_play_keyed_sequence(target_part_id, sequence["keys"], false)
		else:
			var ks: Array = sequence["keys"]
			if not ks.is_empty():
				switch_texture(target_part_id, String((ks[randi() % ks.size()] as Dictionary).get("frame", "")))
		return

	var frames: Array = sequence.get("frames", [])
	if frames.is_empty():
		return
	if seq_type == "ordered":
		_play_ordered_sequence(target_part_id, frames, frame_ms, false)
	elif seq_type == "random_hold":
		switch_texture(target_part_id, String(frames[randi() % frames.size()]))


## v0.5.0 §6: 不等間隔のキー列を再生する。各キーの t（秒・再生開始からの絶対時刻）で
## フレームを切り替える。尺は最後のキーの t（§6.4）。
func _play_keyed_sequence(target_part_id: String, keys: Array, loop: bool) -> void:
	if keys.is_empty():
		return
	for k in keys:
		var key: Dictionary = k
		var t: float = float(key.get("t", 0.0))
		var frame: String = String(key.get("frame", ""))
		get_tree().create_timer(t).timeout.connect(
			func(): switch_texture(target_part_id, frame))
	if loop:
		var duration: float = float((keys[keys.size() - 1] as Dictionary).get("t", 0.0))
		get_tree().create_timer(duration).timeout.connect(
			func(): _play_keyed_sequence(target_part_id, keys, true))


func _play_ordered_sequence(target_part_id: String, frames: Array, frame_ms: float, loop: bool) -> void:
	if frames.is_empty():
		return

	var timer := Timer.new()
	timer.one_shot = true
	add_child(timer)

	var state := {"idx": 0}
	var advance := func():
		var idx: int = state["idx"]
		if idx >= frames.size():
			if loop:
				idx = 0
			else:
				timer.queue_free()
				return
		switch_texture(target_part_id, String(frames[idx]))
		state["idx"] = idx + 1
		timer.start(frame_ms / 1000.0)

	timer.timeout.connect(advance)
	advance.call()


func _schedule_random_interval(target_part_id: String, sequence: Dictionary, frame_ms: float, interval_min: float, interval_max: float) -> void:
	var timer := Timer.new()
	timer.one_shot = true
	add_child(timer)

	var tick := func():
		_run_sequence_once(target_part_id, sequence, frame_ms)
		timer.start(interval_min + randf() * (interval_max - interval_min))

	timer.timeout.connect(tick)
	timer.start(interval_min + randf() * (interval_max - interval_min))


## Explicit playback for sprites with trigger.type == "external" (or no trigger).
func play_sprite(sprite_id: String) -> void:
	for sprite in _data.get("sprites", []):
		if sprite.get("spriteID", "") != sprite_id:
			continue
		var target_part_id: String = sprite.get("targetPartID", "")
		var sequence = sprite.get("sequence")
		if target_part_id == "" or typeof(sequence) != TYPE_DICTIONARY:
			return
		var fps: float = sprite.get("fps", 12.0)
		if fps <= 0:
			fps = 12.0
		_run_sequence_once(target_part_id, sequence, 1000.0 / fps)
		return


# ---------------------------------------------------------------------------
# mapping.json resolution (emg-mapping-spec.md)
# ---------------------------------------------------------------------------

func _find_part(part_id: String) -> Dictionary:
	for part in _data.get("parts", []):
		if part.get("partID", "") == part_id:
			return part
	return {}


func _part_exists(part_id: String) -> bool:
	return not _find_part(part_id).is_empty()


func _find_part_by_keyword(keywords: Array[String]) -> String:
	for part in _data.get("parts", []):
		if _resolve_part_type(part) != "switch":
			continue
		var pid: String = part.get("partID", "")
		var pid_lower := pid.to_lower()
		for kw in keywords:
			if pid_lower.find(kw.to_lower()) != -1:
				return pid
	return ""


func _resolve_part_roles() -> void:
	_blink_part_id = ""
	_blink_explicit = false
	_mouth_part_id = ""
	_mouth_explicit = false

	if _data.get("parts", []).is_empty():
		return

	var base: Dictionary = {}
	if _mapping != null:
		base = _mapping.get("baseMapping", {})

	var blink_part_id := ""
	var blink_explicit := false
	var mouth_part_id := ""
	var mouth_explicit := false

	if not base.is_empty():
		if base.has("blinkParts"):
			var found := _first_part_matching_values(base["blinkParts"])
			if found != "":
				blink_part_id = found
				blink_explicit = true
		if blink_part_id == "" and base.has("blinkPartKey") and _part_exists(base["blinkPartKey"]):
			blink_part_id = base["blinkPartKey"]
			blink_explicit = true

		if base.has("lipSyncParts"):
			var found2 := _first_part_matching_values(base["lipSyncParts"])
			if found2 != "":
				mouth_part_id = found2
				mouth_explicit = true
		if mouth_part_id == "" and base.has("lipSyncPartKey") and _part_exists(base["lipSyncPartKey"]):
			mouth_part_id = base["lipSyncPartKey"]
			mouth_explicit = true

	# Heuristic keyword fallback (not "explicit" - only baseMapping references count as explicit).
	if blink_part_id == "":
		blink_part_id = _find_part_by_keyword(BLINK_KEYWORDS)
	if mouth_part_id == "":
		mouth_part_id = _find_part_by_keyword(MOUTH_KEYWORDS)

	# A part matching both roles is resolved as mouth (mouth wins).
	if blink_part_id != "" and blink_part_id == mouth_part_id:
		blink_part_id = ""
		blink_explicit = false

	_blink_part_id = blink_part_id
	_blink_explicit = blink_explicit
	_mouth_part_id = mouth_part_id
	_mouth_explicit = mouth_explicit


func _first_part_matching_values(role_parts: Dictionary) -> String:
	var targets: Array = []
	for v in role_parts.values():
		if v != null and String(v) != "":
			targets.append(String(v))
	for part in _data.get("parts", []):
		if targets.has(part.get("partID", "")):
			return part.get("partID", "")
	return ""


## state: "open" | "half" | "closed"
func set_blink_state(state: String) -> void:
	if _mapping == null or _blink_part_id == "":
		return
	var base: Dictionary = _mapping.get("baseMapping", {})
	if base.is_empty():
		return
	var part := _find_part(_blink_part_id)
	var texture_id := ""

	if _active_blink_override != null and String((_active_blink_override as Dictionary).get(state, "")) != "":
		texture_id = (_active_blink_override as Dictionary)[state]
	elif base.has("blinkParts"):
		var blink_parts: Dictionary = base["blinkParts"]
		var target_part_id: String = blink_parts.get(state, "")
		if target_part_id != "":
			for v in blink_parts.values():
				if v != null and String(v) != "":
					_set_part_visible(String(v), String(v) == target_part_id)
		return
	elif base.has("blink") and String((base["blink"] as Dictionary).get(state, "")) != "":
		texture_id = (base["blink"] as Dictionary)[state]
	elif not part.is_empty() and (part.get("layers", []) as Array).size() == 3:
		# Known limitation: positional fallback only valid for exactly-3-layer parts.
		var order := {"open": 0, "half": 1, "closed": 2}
		if order.has(state):
			texture_id = (part["layers"][order[state]] as Dictionary).get("textureID", "")

	if texture_id != "":
		switch_texture(_blink_part_id, texture_id)


## vowel: "a" | "i" | "u" | "e" | "o" | "n"
func set_viseme(vowel: String) -> void:
	if _mapping == null or _mouth_part_id == "":
		return
	var base: Dictionary = _mapping.get("baseMapping", {})
	if base.is_empty():
		return
	var part := _find_part(_mouth_part_id)

	if _active_lipsync_override != null and String((_active_lipsync_override as Dictionary).get(vowel, "")) != "":
		switch_texture(_mouth_part_id, (_active_lipsync_override as Dictionary)[vowel])
		return

	if base.has("lipSyncParts"):
		var lipsync_parts: Dictionary = base["lipSyncParts"]
		var target_part_id: String = lipsync_parts.get(vowel, "")
		if target_part_id != "":
			for v in lipsync_parts.values():
				if v != null and String(v) != "":
					_set_part_visible(String(v), String(v) == target_part_id)
		return

	var texture_id := ""
	if base.has("lipSync"):
		var lip_sync: Dictionary = base["lipSync"]
		texture_id = String(lip_sync.get(vowel, ""))
		if texture_id == "":
			texture_id = String(lip_sync.get("open", ""))

	if texture_id == "" and not part.is_empty():
		for layer in (part.get("layers", []) as Array):
			var tid: String = _frame_id(layer as Dictionary)
			if tid.to_lower().find(vowel.to_lower()) != -1:
				texture_id = tid
				break

	if texture_id == "" and not part.is_empty():
		texture_id = part.get("default", "")
		if texture_id == "":
			var layers: Array = part.get("layers", [])
			if not layers.is_empty():
				texture_id = _frame_id(layers[0] as Dictionary)

	if texture_id != "":
		switch_texture(_mouth_part_id, texture_id)


func set_expression(name: String) -> void:
	var expressions: Dictionary = {}
	if _mapping != null:
		expressions = _mapping.get("expressions", {})

	var expr: Dictionary = {}
	if expressions.has(name):
		expr = expressions[name]
		_current_expression = name
	elif expressions.has("default"):
		expr = expressions["default"]
		_current_expression = "default"
	else:
		_current_expression = "default"

	# v0.5.0 §5.3: presetID を先に適用する。expr.parts が後から上書きするため優先される。
	if expr.has("presetID"):
		apply_preset(String(expr["presetID"]))

	if expr.has("parts"):
		var parts_map: Dictionary = expr["parts"]
		for part_id in parts_map.keys():
			var layer_ids: Array = parts_map[part_id]
			if layer_ids.is_empty():
				continue
			var layer_map: Dictionary = _part_layers.get(part_id, {})
			for tid in layer_map.keys():
				(layer_map[tid] as Sprite2D).visible = layer_ids.has(tid)

	if expr.has("eyebrow") and String(expr["eyebrow"]) != "":
		switch_texture("eyebrow", expr["eyebrow"])

	if expr.has("other"):
		for layer_id in (expr["other"] as Array):
			var lid := String(layer_id)
			if _texture_to_part.has(lid):
				switch_texture(_texture_to_part[lid], lid)

	var overrides: Dictionary = expr.get("overrides", {})
	_active_blink_override = overrides.get("blink", null)
	_active_lipsync_override = overrides.get("lipSync", null)


# ---------------------------------------------------------------------------
# v0.4.0 compatibility rules (emg-json-spec-0.4.0.md 1-2)
# ---------------------------------------------------------------------------

## Feature identifiers this implementation understands (emg-extensions-registry.md).
## Empty for v0.4.0: none of its additions change what gets drawn.
## EMG_frame_name: v0.5.0 §2 の frameName に対応済み。
const SUPPORTED_EXTENSIONS: Array[String] = ["EMG_frame_name"]


## v0.5.0 §1.1: レイヤーのフレーム識別子。frameName が無ければ textureID と同一。
## 参照の突き合わせは textureID ではなく必ずこちらで行う。
func _frame_id(layer: Dictionary) -> String:
	var fn = layer.get("frameName", null)
	return str(fn) if fn != null else str(layer.get("textureID", ""))


## F5: refuse the file when it requires something we do not implement. Silently
## ignoring such a file draws a wrong picture, which is worse than failing.
## Returns an error string, or "" when the file is acceptable.
func _check_required_extensions(data: Dictionary) -> String:
	var required = data.get("requiredExtensions", [])
	var unknown: Array[String] = []
	for e in required:
		if not SUPPORTED_EXTENSIONS.has(e):
			unknown.append(str(e))
	if unknown.is_empty():
		return ""
	return "This .emg requires unsupported features: %s" % ", ".join(unknown)


## F2: an unknown type resolves by whether the part carries a default —
## switch if it does, static if it does not. Branching on the raw value made
## unknown types show every layer at once.
func _resolve_part_type(part: Dictionary) -> String:
	var t: String = part.get("type", "static")
	if t == "static" or t == "switch":
		return t
	return "switch" if part.has("default") else "static"


## F3 / F4: unknown enum values fall back to the safe default. For triggers that
## is "external" — nothing fires on its own.
func _resolve_sequence_type(sequence: Dictionary) -> String:
	var t: String = sequence.get("type", "ordered")
	return t if (t == "ordered" or t == "random_hold") else "ordered"


func _resolve_trigger_type(trigger: Dictionary) -> String:
	var t: String = trigger.get("type", "external")
	return t if (t == "auto_loop" or t == "random_interval" or t == "external") else "external"


## 4.2: fps became optional in v0.4.0; absent means 12.
func _resolve_fps(sprite: Dictionary) -> float:
	var f = sprite.get("fps", 0.0)
	return float(f) if float(f) > 0.0 else 12.0
