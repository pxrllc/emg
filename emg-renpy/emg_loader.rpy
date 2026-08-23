init python:
    import zipfile
    import json
    import io

    def load_emg(emg_path, base_name=None):
        """
        Loads an EMG file (v0.3.0) and registers images in Ren'Py.

        Note: EMG's textureZIndex is a single ordering across all parts, but each
        part is registered as its own Ren'Py image, so the caller controls the
        stacking order when showing them. Within a part the order is honoured.
        
        Args:
            emg_path (str): Path to the .emg file (relative to game/ folder).
            base_name (str, optional): Prefix for image names.
                                       If "hinano", registers "image hinano body".
                                       If None, registers "image body".
        """
        # Load the ZIP file from Ren'Py's loader (supports archives)
        file_handle = renpy.loader.load(emg_path)
        
        with zipfile.ZipFile(file_handle) as archive:
            # 1. Parse the main JSON.
            # Per emg-json-spec.md 1.1 the entry is matched by suffix, not by exact
            # name: shipped files store it as "model.json" (samples/senti.emg) or
            # nested in a folder ("zunda/assigned_texture_data.json").
            entry_name = _find_data_entry(archive)
            if entry_name is None:
                renpy.error(f"EMG Loader: main JSON not found in {emg_path}")
                return
            with archive.open(entry_name) as f:
                data = json.loads(f.read().decode("utf-8"))

            # v0.4.0 F5: テクスチャ展開より前に、未対応の要求機能があれば失敗させる。
            unknown = [e for e in data.get("requiredExtensions", []) if e not in SUPPORTED_EXTENSIONS]
            if unknown:
                renpy.error(
                    "EMG Loader: this .emg requires unsupported features: %s" % ", ".join(unknown))
                return

            canvas_w = data.get("baseCanvasWidth", 0)
            canvas_h = data.get("baseCanvasHeight", 0)

            # 2. Load Textures
            tex_map = _load_textures(archive, data.get("textures", []))

            # 3. Register Parts
            for part in data.get("parts", []):
                part_type = _resolve_part_type(part)

                if part_type == "static":
                    _register_static_part(part, tex_map, canvas_w, canvas_h, base_name)
                elif part_type == "switch":
                    _register_switch_part(part, tex_map, canvas_w, canvas_h, base_name)

        # Notify development mode
        if config.developer:
            print(f"EMG Loaded: {emg_path}")

    # ---------------------------------------------------------------
    # v0.4.0 互換性規則（emg-json-spec-0.4.0.md 1〜2 章）
    # ---------------------------------------------------------------

    # この実装が理解する機能識別子（emg-extensions-registry.md）。
    # v0.4.0 の追加はいずれも無視しても表示が成立するため空。
    SUPPORTED_EXTENSIONS = frozenset()

    def _resolve_part_type(part):
        """
        F2: 未知の type は default を持つなら switch、持たないなら static。
        生の type で分岐すると、未知の値のパーツが登録されず消える。
        """
        t = part.get("type", "static")
        if t in ("static", "switch"):
            return t
        return "switch" if part.get("default") is not None else "static"

    def _find_entry(archive, predicate):
        """Returns the first entry name satisfying predicate, or None."""
        for name in archive.namelist():
            if name.endswith("/"):
                continue
            if predicate(name):
                return name
        return None

    def _find_data_entry(archive):
        """
        Locates the main JSON. emg-json-spec.md 1.1:
          1. an entry whose name ends with "data.json"
          2. otherwise any ".json" that does not end with "mapping.json"
        """
        found = _find_entry(archive, lambda n: n.lower().endswith("data.json"))
        if found is not None:
            return found
        return _find_entry(
            archive,
            lambda n: n.lower().endswith(".json") and not n.lower().endswith("mapping.json"),
        )

    def _load_textures(archive, textures_meta):
        """
        Extracts textures from ZIP and creates im.Data objects.
        """
        tex_map = {}
        for tex in textures_meta:
            fname = tex["textureFile"]
            # Suffix match, for the same reason as _find_data_entry: the atlas may
            # sit inside a folder within the archive.
            entry_name = _find_entry(archive, lambda n, f=fname: n.endswith(f))
            if entry_name is None:
                renpy.error(f"EMG Loader: Texture '{fname}' not found in ZIP.")
                continue
            with archive.open(entry_name) as entry:
                data = entry.read()
                # im.Data creates a displayable from bytes
                tex_map[fname] = im.Data(data, fname)
        return tex_map

    def _apply_opacity(displayable, layer):
        """
        Applies the layer's own opacity (emg-json-spec.md 5.3). Visibility is a
        separate concern — opacity carries only data.json's layer.opacity.
        """
        op = layer.get("opacity", 1.0)
        if op is None or op >= 1.0:
            return displayable
        return im.MatrixColor(displayable, im.matrix.opacity(op))

    def _register_static_part(part, tex_map, canvas_w, canvas_h, base_name=None):
        """
        Registers a 'static' part as a single Ren'Py image.
        Format: image {partID}
        OR:     image {base_name} {partID}
        """
        layers = sorted(part.get("layers", []), key=lambda l: l.get("textureZIndex", 0))
        if not layers:
            return

        part_id = part["partID"]
        
        # Determine image tag
        if base_name:
            # e.g. "hinano_body"
            image_tag = f"{base_name}_{part_id}"
        else:
            image_tag = part_id

        # Option A: Single layer optimization
        if len(layers) == 1:
            layer = layers[0]
            if layer["textureFile"] not in tex_map: 
                return
            
            # Crop from atlas
            cropped = im.Crop(
                tex_map[layer["textureFile"]],
                layer["x"], layer["y"],
                layer["width"], layer["height"]
            )
            cropped = _apply_opacity(cropped, layer)

            # Position on canvas
            pos = (layer.get("basePosition_x", 0), layer.get("basePosition_y", 0))
            
            # Composite onto full canvas size
            composite = im.Composite(
                (canvas_w, canvas_h),
                pos, cropped
            )
            
            renpy.image(image_tag, composite)
            
            # Register aliases
            # 1. TextureID alias: "body 私服" or "hinano body 私服"
            image_name = f"{image_tag} {layer['textureID']}"
            renpy.image(image_name, composite)

            # 2. PartID_TextureID alias: "body body_私服" or "hinano body body_私服"
            image_name_alias = f"{image_tag} {part_id}_{layer['textureID']}"
            renpy.image(image_name_alias, composite)
        
        else:
            # Multi-layer static part (rare but possible)
            composite = _create_composite(layers, tex_map, canvas_w, canvas_h)
            if composite:
                renpy.image(image_tag, composite)

    def _register_switch_part(part, tex_map, canvas_w, canvas_h, base_name=None):
        """
        Registers a 'switch' part as multiple Ren'Py images.
        Format: image {partID} {textureID}
        OR:     image {base_name} {partID} {textureID}
        """
        part_id = part["partID"]

        # Determine image tag prefix
        if base_name:
            image_tag_prefix = f"{base_name}_{part_id}"
        else:
            image_tag_prefix = part_id
        
        # Group layers by textureID (though typically 1 layer per textureID in 'switch')
        # EMG Spec v0.2.2: "layers" is a flat list. 
        # For switch parts, each layer has a unique textureID generally.
        # But technically multiple layers COULD share a textureID? 
        # Spec implies: textureID is the differentiator.
        
        # We assume 1 layer per textureID for now, or we group them.
        # Let's group by textureID to be safe.
        layers_by_id = {}
        for layer in part.get("layers", []):
            tid = layer["textureID"]
            if tid not in layers_by_id:
                layers_by_id[tid] = []
            layers_by_id[tid].append(layer)
            
        for tid, layers in layers_by_id.items():
            layers = sorted(layers, key=lambda l: l.get("textureZIndex", 0))
            
            # Create composite
            composite = _create_composite(layers, tex_map, canvas_w, canvas_h)
            
            if composite:
                # Register: image {prefix} {textureID}
                image_name = f"{image_tag_prefix} {tid}"
                renpy.image(image_name, composite)

                # Register alias: image {prefix} {partID}_{textureID}
                image_name_alias = f"{image_tag_prefix} {part_id}_{tid}"
                renpy.image(image_name_alias, composite)

    def _create_composite(layers, tex_map, canvas_w, canvas_h):
        """
        Helper to create an im.Composite from a list of layers.
        """
        args = []
        for layer in layers:
            fname = layer["textureFile"]
            if fname not in tex_map:
                continue
                
            cropped = im.Crop(
                tex_map[fname],
                layer["x"], layer["y"],
                layer["width"], layer["height"]
            )
            cropped = _apply_opacity(cropped, layer)

            pos = (layer.get("basePosition_x", 0), layer.get("basePosition_y", 0))
            args.append(pos)
            args.append(cropped)
            
        if not args:
            return None
            
        return im.Composite((canvas_w, canvas_h), *args)

# Transforms
transform halfsize:
    zoom 0.5
