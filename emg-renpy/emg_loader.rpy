init python:
    import zipfile
    import json
    import io

    def load_emg(emg_path, base_name=None):
        """
        Loads an EMG file (v0.2.2) and registers images in Ren'Py.
        
        Args:
            emg_path (str): Path to the .emg file (relative to game/ folder).
            base_name (str, optional): Prefix for image names.
                                       If "hinano", registers "image hinano body".
                                       If None, registers "image body".
        """
        # Load the ZIP file from Ren'Py's loader (supports archives)
        file_handle = renpy.loader.load(emg_path)
        
        with zipfile.ZipFile(file_handle) as archive:
            # 1. Parse data.json
            try:
                with archive.open("data.json") as f:
                    data = json.loads(f.read().decode("utf-8"))
            except KeyError:
                renpy.error(f"EMG Loader: 'data.json' not found in {emg_path}")
                return

            canvas_w = data.get("baseCanvasWidth", 0)
            canvas_h = data.get("baseCanvasHeight", 0)

            # 2. Load Textures
            tex_map = _load_textures(archive, data.get("textures", []))

            # 3. Register Parts
            for part in data.get("parts", []):
                part_type = part.get("type", "static")
                
                if part_type == "static":
                    _register_static_part(part, tex_map, canvas_w, canvas_h, base_name)
                elif part_type == "switch":
                    _register_switch_part(part, tex_map, canvas_w, canvas_h, base_name)

        # Notify development mode
        if config.developer:
            print(f"EMG Loaded: {emg_path}")

    def _load_textures(archive, textures_meta):
        """
        Extracts textures from ZIP and creates im.Data objects.
        """
        tex_map = {}
        for tex in textures_meta:
            fname = tex["textureFile"]
            try:
                with archive.open(fname) as entry:
                    data = entry.read()
                    # im.Data creates a displayable from bytes
                    tex_map[fname] = im.Data(data, fname)
            except KeyError:
                renpy.error(f"EMG Loader: Texture '{fname}' not found in ZIP.")
        return tex_map

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
            
            pos = (layer.get("basePosition_x", 0), layer.get("basePosition_y", 0))
            args.append(pos)
            args.append(cropped)
            
        if not args:
            return None
            
        return im.Composite((canvas_w, canvas_h), *args)

# Transforms
transform halfsize:
    zoom 0.5
