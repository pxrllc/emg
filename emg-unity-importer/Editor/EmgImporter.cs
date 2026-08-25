using System;
using System.Linq;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using UnityEditor.AssetImporters;
using UnityEngine;
using UnityEngine.UI;
using Emg.Runtime;
using UnityEditor;

namespace Emg.Editor
{
    public enum EmgRenderMode
    {
        SpriteRenderer,
        UIImage
    }

    [ScriptedImporter(1, "emg")]
    public class EmgImporter : ScriptedImporter
    {
        [SerializeField] public EmgRenderMode renderMode = EmgRenderMode.SpriteRenderer;
        [Tooltip("SpriteRenderer モード時の Pixels Per Unit")]
        [SerializeField] public float pixelsPerUnit = 100f;

        public override void OnImportAsset(AssetImportContext ctx)
        {
            try
            {
                using var stream = new FileStream(ctx.assetPath, FileMode.Open, FileAccess.Read);
                using var archive = new ZipArchive(stream, ZipArchiveMode.Read);

                // 1. Parse data.json
                // GetEntry() matches the full entry name exactly, so it misses both
                // model.json and any archive that nests its files in a folder
                // (zunda.emg stores "zunda/assigned_texture_data.json"). Use the same
                // fallback rule as the reference player and Emg.Core: prefer an entry
                // ending in "data.json", otherwise any .json that is not mapping.json.
                var dataEntry = FindDataEntry(archive);
                if (dataEntry == null)
                {
                    Debug.LogError($"[EmgImporter] data.json not found in {ctx.assetPath}");
                    return;
                }

                EmgData emgData;
                using (var reader = new StreamReader(dataEntry.Open()))
                    emgData = JsonUtility.FromJson<EmgData>(reader.ReadToEnd());

                if (emgData == null)
                {
                    Debug.LogError($"[EmgImporter] Failed to parse data.json in {ctx.assetPath}");
                    return;
                }

                // v0.4.0 §2.2: mapping.json やテクスチャより前に、未対応の要求機能を検出する。
                // 理解できない拡張を黙って無視すると誤った絵になるため、明示的に失敗させる。
                var unknownExt = (emgData.requiredExtensions ?? new string[0])
                    .Where(e => !SupportedExtensions.Contains(e)).ToArray();
                if (unknownExt.Length > 0)
                {
                    Debug.LogError($"[EmgImporter] この .emg は未対応の機能を要求しています: {string.Join(", ", unknownExt)}。インポーターの更新が必要です。({ctx.assetPath})");
                    return;
                }

                // 1.5 Parse mapping.json (optional companion file, v0.3.0+)
                EmgMapping emgMapping = null;
                var mappingEntry = FindEntry(archive, n => n.EndsWith("mapping.json", StringComparison.OrdinalIgnoreCase));
                if (mappingEntry != null)
                {
                    try
                    {
                        using var mReader = new StreamReader(mappingEntry.Open());
                        emgMapping = EmgMappingJsonUtil.ParseMapping(mReader.ReadToEnd());
                    }
                    catch (System.Exception e)
                    {
                        Debug.LogWarning($"[EmgImporter] Failed to parse mapping.json in {ctx.assetPath}: {e}");
                        emgMapping = null;
                    }
                }

                // 2. Load Textures (shared)
                var textures = LoadTextures(archive, emgData, ctx);

                // 3. Create Sprites (shared: Sprite.Create is same for both modes)
                var sprites = CreateSprites(emgData, textures);

                // 4. Create EmgAssetData ScriptableObject
                var assetData = BuildAssetData(emgData, emgMapping);
                ctx.AddObjectToAsset("emgAssetData", assetData);

                // 5. Build GameObject hierarchy
                var rootGo = new GameObject(Path.GetFileNameWithoutExtension(ctx.assetPath));

                if (renderMode == EmgRenderMode.UIImage)
                    BuildHierarchy_UIImage(rootGo, emgData, sprites, ctx);
                else
                    BuildHierarchy_SpriteRenderer(rootGo, emgData, sprites, textures, ctx);

                // 6. Attach EmgController
                var controller = rootGo.AddComponent<EmgController>();
                controller.assetData = assetData;

                ctx.AddObjectToAsset("root", rootGo);
                ctx.SetMainObject(rootGo);
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[EmgImporter] Error importing {ctx.assetPath}: {e}");
            }
        }

        // -------------------------
        // Texture Loading
        // -------------------------

        /// <summary>
        /// このインポーターが理解する機能識別子（emg-extensions-registry.md）。
        /// v0.4.0 の追加はいずれも無視しても表示が成立するため空。
        /// </summary>
        // EMG_frame_name:  v0.5.0 §2 の frameName に対応済み。
        // EMG_switch_none: v0.5.0 §4.3 の「switch を初期状態で非表示」に対応済み。
        private static readonly HashSet<string> SupportedExtensions =
            new HashSet<string> { "EMG_frame_name", "EMG_switch_none" };

        /// <summary>
        /// Finds the main JSON entry. Mirrors emg-cdn/emg-player.0.3.0.js and Emg.Core:
        /// prefer an entry whose name ends with "data.json", then fall back to any .json
        /// that is not the mapping.json companion. This is what makes both "data.json"
        /// and "model.json" work, and what tolerates entries nested in a folder.
        /// </summary>
        private static ZipArchiveEntry FindDataEntry(ZipArchive archive) =>
            FindEntry(archive, n => n.EndsWith("data.json", StringComparison.OrdinalIgnoreCase))
            ?? FindEntry(archive, n =>
                n.EndsWith(".json", StringComparison.OrdinalIgnoreCase) &&
                !n.EndsWith("mapping.json", StringComparison.OrdinalIgnoreCase));

        private static ZipArchiveEntry FindEntry(ZipArchive archive, Func<string, bool> predicate)
        {
            foreach (var entry in archive.Entries)
            {
                if (predicate(entry.FullName)) return entry;
            }
            return null;
        }

        private static Dictionary<string, Texture2D> LoadTextures(
            ZipArchive archive, EmgData emgData, AssetImportContext ctx)
        {
            var textures = new Dictionary<string, Texture2D>();
            if (emgData.textures == null) return textures;

            foreach (var texInfo in emgData.textures)
            {
                // Same reason as FindDataEntry: an exact-name lookup misses atlases
                // stored inside a folder within the archive.
                var texEntry = archive.GetEntry(texInfo.textureFile)
                    ?? FindEntry(archive, n => n.EndsWith(texInfo.textureFile, StringComparison.OrdinalIgnoreCase));
                if (texEntry == null)
                {
                    Debug.LogWarning($"[EmgImporter] Texture {texInfo.textureFile} not found.");
                    continue;
                }

                using var memStream = new MemoryStream();
                texEntry.Open().CopyTo(memStream);

                var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                tex.LoadImage(memStream.ToArray());
                tex.name = texInfo.textureFile;
                tex.filterMode = FilterMode.Bilinear;
                tex.wrapMode = TextureWrapMode.Clamp;
                tex.alphaIsTransparency = true;

                ctx.AddObjectToAsset(texInfo.textureFile, tex);
                textures[texInfo.textureFile] = tex;
            }

            return textures;
        }

        // -------------------------
        // Sprite Creation (shared)
        // -------------------------

        // key: "{partID}_{textureID}"
        private static Dictionary<string, Sprite> CreateSprites(
            EmgData emgData, Dictionary<string, Texture2D> textures)
        {
            var sprites = new Dictionary<string, Sprite>();
            if (emgData.parts == null) return sprites;

            foreach (var part in emgData.parts)
            {
                if (part.layers == null) continue;
                foreach (var layer in part.layers)
                {
                    if (string.IsNullOrEmpty(layer.textureFile) || !textures.ContainsKey(layer.textureFile))
                        continue;

                    var tex = textures[layer.textureFile];
                    float rectX = layer.x;
                    float rectY = tex.height - (layer.y + layer.height); // flip Y for Unity
                    float rectW = layer.width;
                    float rectH = layer.height;

                    if (rectW <= 0 || rectH <= 0) continue;

                    var sprite = Sprite.Create(
                        tex,
                        new Rect(rectX, rectY, rectW, rectH),
                        new Vector2(0.5f, 0.5f),
                        100f); // pixelsPerUnit fixed at 100 for sprite creation
                    sprite.name = $"{part.partID}_{layer.textureID}_sprite";
                    sprites[$"{part.partID}_{layer.textureID}"] = sprite;
                }
            }

            return sprites;
        }

        // -------------------------
        // SpriteRenderer Hierarchy
        // -------------------------

        private void BuildHierarchy_SpriteRenderer(
            GameObject rootGo, EmgData emgData,
            Dictionary<string, Sprite> sprites,
            Dictionary<string, Texture2D> textures,
            AssetImportContext ctx)
        {
            var material = new Material(Shader.Find("Sprites/Default"));
            material.name = "EmgMaterial";
            ctx.AddObjectToAsset("material", material);

            if (emgData.parts == null) return;

            foreach (var part in emgData.parts)
            {
                if (part.layers == null) continue;
                part.layers.Sort((a, b) => a.textureZIndex.CompareTo(b.textureZIndex));

                var partGo = new GameObject(part.partID);
                partGo.transform.SetParent(rootGo.transform, false);

                foreach (var layer in part.layers)
                {
                    if (layer.opacity <= 0.001f) layer.opacity = 1.0f;
                    if (string.IsNullOrEmpty(layer.textureFile) || !textures.ContainsKey(layer.textureFile))
                        continue;

                    var layerGo = new GameObject($"{part.partID}_{layer.textureID}");
                    layerGo.transform.SetParent(partGo.transform, false);
                    // v0.5.0 §2.2 / §4: 表示単位はフレーム識別子。defaultVisible は
                    // static / switch の両方に効く。switch で false のとき（§4.3）は
                    // どのフレームも出ない = 未選択状態で始まる。
                    layerGo.SetActive(part.defaultVisible && (part.ResolvedType == "switch"
                        ? layer.FrameID == part.@default
                        : true));

                    // Position
                    float cx = layer.basePosition_x + layer.width / 2f;
                    float cy = layer.basePosition_y + layer.height / 2f;
                    float unityX = (cx - emgData.baseCanvasWidth / 2f) / pixelsPerUnit;
                    float unityY = -((cy - emgData.baseCanvasHeight / 2f) / pixelsPerUnit);
                    layerGo.transform.localPosition = new Vector3(unityX, unityY, 0);

                    // SpriteRenderer
                    var sr = layerGo.AddComponent<SpriteRenderer>();
                    sr.sharedMaterial = material;
                    sr.sortingOrder = layer.textureZIndex;
                    sr.color = new Color(1, 1, 1, layer.opacity);

                    string key = $"{part.partID}_{layer.textureID}";
                    if (sprites.TryGetValue(key, out var sprite))
                    {
                        ctx.AddObjectToAsset($"sprite_{key}", sprite);
                        sr.sprite = sprite;
                    }
                }
            }
        }

        // -------------------------
        // UIImage Hierarchy
        // -------------------------

        private static void BuildHierarchy_UIImage(
            GameObject rootGo, EmgData emgData,
            Dictionary<string, Sprite> sprites,
            AssetImportContext ctx)
        {
            // Root RectTransform sized to canvas
            var rootRt = rootGo.AddComponent<RectTransform>();
            rootRt.anchorMin = new Vector2(0.5f, 0.5f);
            rootRt.anchorMax = new Vector2(0.5f, 0.5f);
            rootRt.sizeDelta = new Vector2(emgData.baseCanvasWidth, emgData.baseCanvasHeight);
            rootRt.anchoredPosition = Vector2.zero;

            if (emgData.parts == null) return;

            foreach (var part in emgData.parts)
            {
                if (part.layers == null) continue;
                part.layers.Sort((a, b) => a.textureZIndex.CompareTo(b.textureZIndex));

                var partGo = new GameObject(part.partID);
                var partRt = partGo.AddComponent<RectTransform>();
                partRt.anchorMin = new Vector2(0.5f, 0.5f);
                partRt.anchorMax = new Vector2(0.5f, 0.5f);
                partRt.sizeDelta = Vector2.zero;
                partRt.anchoredPosition = Vector2.zero;
                partGo.transform.SetParent(rootGo.transform, false);

                foreach (var layer in part.layers)
                {
                    if (layer.opacity <= 0.001f) layer.opacity = 1.0f;

                    var layerGo = new GameObject($"{part.partID}_{layer.textureID}");
                    layerGo.transform.SetParent(partGo.transform, false);
                    // v0.5.0 §2.2 / §4: 表示単位はフレーム識別子。defaultVisible は
                    // static / switch の両方に効く。switch で false のとき（§4.3）は
                    // どのフレームも出ない = 未選択状態で始まる。
                    layerGo.SetActive(part.defaultVisible && (part.ResolvedType == "switch"
                        ? layer.FrameID == part.@default
                        : true));

                    // RectTransform: anchor center, position/size in pixels
                    var rt = layerGo.AddComponent<RectTransform>();
                    rt.anchorMin = new Vector2(0.5f, 0.5f);
                    rt.anchorMax = new Vector2(0.5f, 0.5f);
                    rt.sizeDelta = new Vector2(layer.width, layer.height);

                    float cx = layer.basePosition_x + layer.width / 2f;
                    float cy = layer.basePosition_y + layer.height / 2f;
                    float anchoredX = cx - emgData.baseCanvasWidth / 2f;
                    float anchoredY = -((cy - emgData.baseCanvasHeight / 2f)); // flip Y
                    rt.anchoredPosition = new Vector2(anchoredX, anchoredY);

                    // Image
                    var img = layerGo.AddComponent<Image>();
                    img.raycastTarget = false;
                    img.color = new Color(1, 1, 1, layer.opacity);

                    string key = $"{part.partID}_{layer.textureID}";
                    if (sprites.TryGetValue(key, out var sprite))
                    {
                        ctx.AddObjectToAsset($"sprite_{key}", sprite);
                        img.sprite = sprite;
                        img.type = Image.Type.Simple;
                        img.preserveAspect = false;
                    }
                }
            }
        }

        // -------------------------
        // EmgAssetData Generation
        // -------------------------

        private static EmgAssetData BuildAssetData(EmgData emgData, EmgMapping emgMapping)
        {
            var assetData = ScriptableObject.CreateInstance<EmgAssetData>();
            assetData.name = "EmgAssetData";
            assetData.baseCanvasWidth = emgData.baseCanvasWidth;
            assetData.baseCanvasHeight = emgData.baseCanvasHeight;
            assetData.semanticMapping = emgMapping;

            // Note: captured before BuildHierarchy_* sorts part.layers by textureZIndex,
            // so layerTextureIDs preserves data.json's original array order (needed for the
            // blink/lipSync positional fallback in emg-mapping-spec.md, which indexes by
            // layers[0]/[1]/[2] as declared, not by render order).
            if (emgData.parts != null)
            {
                var metas = new List<EmgPartMeta>();
                foreach (var part in emgData.parts)
                {
                    metas.Add(new EmgPartMeta
                    {
                        partID = part.partID,
                        type = part.type,
                        defaultTextureID = part.@default,
                        layerTextureIDs = part.layers?.ConvertAll(l => l.textureID).ToArray() ?? new string[0]
                    });
                }
                assetData.partMetas = metas.ToArray();
            }
            else
            {
                assetData.partMetas = new EmgPartMeta[0];
            }

            if (emgData.sprites == null || emgData.sprites.Count == 0)
            {
                assetData.spriteDefinitions = new EmgSpriteDefinition[0];
                return assetData;
            }

            var defs = new List<EmgSpriteDefinition>();
            foreach (var sprite in emgData.sprites)
            {
                if (sprite.sequence == null) continue;

                var def = new EmgSpriteDefinition
                {
                    spriteID = sprite.spriteID,
                    targetPartID = sprite.targetPartID,
                    fps = sprite.fps,
                    sequenceType = sprite.sequence.type == "random_hold"
                        ? SequenceType.random_hold
                        : SequenceType.ordered,
                    frames = sprite.sequence.frames?.ToArray() ?? new string[0],
                    hasTrigger = sprite.trigger != null
                };

                if (sprite.trigger != null)
                {
                    def.triggerType = sprite.trigger.type switch
                    {
                        "auto_loop"       => TriggerType.auto_loop,
                        "random_interval" => TriggerType.random_interval,
                        _                 => TriggerType.external
                    };
                    def.intervalMin = sprite.trigger.intervalMin;
                    def.intervalMax = sprite.trigger.intervalMax;
                }

                defs.Add(def);
            }

            assetData.spriteDefinitions = defs.ToArray();
            return assetData;
        }
    }
}
