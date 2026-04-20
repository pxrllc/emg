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
                var dataEntry = archive.GetEntry("data.json");
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

                // 2. Load Textures (shared)
                var textures = LoadTextures(archive, emgData, ctx);

                // 3. Create Sprites (shared: Sprite.Create is same for both modes)
                var sprites = CreateSprites(emgData, textures);

                // 4. Create EmgAssetData ScriptableObject
                var assetData = BuildAssetData(emgData);
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

        private static Dictionary<string, Texture2D> LoadTextures(
            ZipArchive archive, EmgData emgData, AssetImportContext ctx)
        {
            var textures = new Dictionary<string, Texture2D>();
            if (emgData.textures == null) return textures;

            foreach (var texInfo in emgData.textures)
            {
                var texEntry = archive.GetEntry(texInfo.textureFile);
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
                    layerGo.SetActive(part.type == "switch"
                        ? layer.textureID == part.@default
                        : true);

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
                    layerGo.SetActive(part.type == "switch"
                        ? layer.textureID == part.@default
                        : true);

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

        private static EmgAssetData BuildAssetData(EmgData emgData)
        {
            var assetData = ScriptableObject.CreateInstance<EmgAssetData>();
            assetData.name = "EmgAssetData";
            assetData.baseCanvasWidth = emgData.baseCanvasWidth;
            assetData.baseCanvasHeight = emgData.baseCanvasHeight;

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
