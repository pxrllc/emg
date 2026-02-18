using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using UnityEditor.AssetImporters;
using UnityEngine;
using Emg.Runtime;
using UnityEditor;

[ScriptedImporter(1, "emg")]
public class EmgImporter : ScriptedImporter
{
    [SerializeField] public float pixelsPerUnit = 100f;

    public override void OnImportAsset(AssetImportContext ctx)
    {
        try
        {
            // Read .emg file as ZIP
            using (var stream = new FileStream(ctx.assetPath, FileMode.Open, FileAccess.Read))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                // 1. Parse data.json
                var dataEntry = archive.GetEntry("data.json");
                if (dataEntry == null)
                {
                    Debug.LogError($"[EmgImporter] data.json not found in {ctx.assetPath}");
                    return;
                }

                EmgData emgData = null;
                using (var reader = new StreamReader(dataEntry.Open()))
                {
                    string json = reader.ReadToEnd();
                    emgData = JsonUtility.FromJson<EmgData>(json);
                }

                if (emgData == null)
                {
                    Debug.LogError($"[EmgImporter] Failed to parse data.json in {ctx.assetPath}");
                    return;
                }

                // 2. Load Textures
                var textures = new Dictionary<string, Texture2D>();
                foreach (var texInfo in emgData.textures)
                {
                    // Filename expectation: "texture_{id}.png"
                    string texFileName = $"texture_{texInfo.id}.png";
                    var texEntry = archive.GetEntry(texFileName);
                    
                    if (texEntry != null)
                    {
                        using (var memStream = new MemoryStream())
                        {
                            texEntry.Open().CopyTo(memStream);
                            // Disable MipChain for Sprites
                            var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                            tex.LoadImage(memStream.ToArray());
                            tex.name = texFileName;
                            
                            // Texture Settings
                            tex.filterMode = FilterMode.Bilinear;
                            tex.wrapMode = TextureWrapMode.Clamp;
                            tex.alphaIsTransparency = true;
                            
                            ctx.AddObjectToAsset($"texture_{texInfo.id}", tex);
                            textures[texInfo.id] = tex;
                        }
                    }
                    else
                    {
                         Debug.LogWarning($"[EmgImporter] Texture {texFileName} not found.");
                    }
                }

                // 3. Create Material (Simple unlit/sprite material)
                var material = new Material(Shader.Find("Sprites/Default"));
                material.name = "EmgMaterial";
                ctx.AddObjectToAsset("material", material);

                // 4. Create GameObject Hierarchy
                var rootGo = new GameObject(Path.GetFileNameWithoutExtension(ctx.assetPath));
                
                // Sort layers by zIndex (ascending order for Painter's algo, but Unity SortingOrder handles it)
                // We'll still sort to keep Hierarchy clean
                emgData.layers.Sort((a, b) => a.zIndex.CompareTo(b.zIndex));

                // Dictionary to hold part parents
                var partParents = new Dictionary<string, GameObject>();
                // Count layers per part to decide hierarchy structure
                var partLayerCounts = new Dictionary<string, int>();
                foreach (var layer in emgData.layers)
                {
                    if (!partLayerCounts.ContainsKey(layer.partID)) partLayerCounts[layer.partID] = 0;
                    partLayerCounts[layer.partID]++;
                }

                foreach (var layer in emgData.layers)
                {
                    // Update opacity if 0 (fixing issue where default might be loaded as 0)
                    if (layer.opacity == 0f) layer.opacity = 1.0f;

                    if (!textures.ContainsKey(layer.textureID)) continue;

                    GameObject targetGo;
                    bool isContainer = false;

                    // --- Parent / Object Creation ---
                    if (partLayerCounts[layer.partID] == 1)
                    {
                        // Single layer part: The part object IS the layer object
                        if (!partParents.TryGetValue(layer.partID, out targetGo))
                        {
                            targetGo = new GameObject(layer.partID);
                            targetGo.transform.SetParent(rootGo.transform, false);
                            targetGo.SetActive(layer.visible);
                            partParents[layer.partID] = targetGo;
                        }
                    }
                    else
                    {
                        // Multi-layer part: Create container if needed, then child
                        GameObject partParent;
                        if (!partParents.TryGetValue(layer.partID, out partParent))
                        {
                            partParent = new GameObject(layer.partID);
                            partParent.transform.SetParent(rootGo.transform, false);
                            // Container remains active, children control visibility
                            partParents[layer.partID] = partParent;
                        }
                        isContainer = true;

                        // Create child object for the layer
                        targetGo = new GameObject($"{layer.partID}_{layer.layerID}");
                        targetGo.transform.SetParent(partParent.transform, false);
                        targetGo.SetActive(layer.visible);
                    }

                    // --- Position Calculation ---
                    // 1. Calculate center of the layer in Canvas coordinates
                    float layerCenterX = layer.x + layer.width / 2f;
                    float layerCenterY = layer.y + layer.height / 2f;

                    // 2. Calculate center of the Canvas
                    float canvasCenterX = emgData.width / 2f;
                    float canvasCenterY = emgData.height / 2f;

                    // 3. Calculate offset from Canvas Center
                    float offsetX = layerCenterX - canvasCenterX;
                    float offsetY = layerCenterY - canvasCenterY;

                    // 4. Convert to Unity Units and Coordinates (Flip Y)
                    float unityX = offsetX / pixelsPerUnit;
                    float unityY = -offsetY / pixelsPerUnit;

                    // Apply position
                    // If grouped (isContainer), parent is at (0,0), so child sets localPosition.
                    // If single (merged), targetGo is at root (0,0), so we set localPosition relative to root.
                    targetGo.transform.localPosition = new Vector3(unityX, unityY, 0);

                    // --- SpriteRenderer ---
                    var renderer = targetGo.AddComponent<SpriteRenderer>();
                    renderer.sharedMaterial = material;
                    renderer.sortingOrder = layer.zIndex;
                    
                    // Opacity
                    Color color = Color.white;
                    color.a = layer.opacity;
                    renderer.color = color;

                    // --- Sprite Creation ---
                    Texture2D tex = textures[layer.textureID];
                    
                    float rectX = layer.uv.u * tex.width;
                    float rectY = (1.0f - (layer.uv.v + layer.uv.h)) * tex.height;
                    float rectW = layer.uv.w * tex.width;
                    float rectH = layer.uv.h * tex.height;
                    
                    rectX = Mathf.Max(0, rectX);
                    rectY = Mathf.Max(0, rectY);
                    rectW = Mathf.Min(tex.width - rectX, rectW);
                    rectH = Mathf.Min(tex.height - rectY, rectH);

                    if (rectW > 0 && rectH > 0)
                    {
                        var sprite = Sprite.Create(tex, new Rect(rectX, rectY, rectW, rectH), new Vector2(0.5f, 0.5f), pixelsPerUnit);
                        sprite.name = $"{layer.partID}_sprite";
                        
                        ctx.AddObjectToAsset($"sprite_{layer.layerID}", sprite);
                        renderer.sprite = sprite;
                    }
                }

                ctx.AddObjectToAsset("root", rootGo);
                ctx.SetMainObject(rootGo);
            }
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[EmgImporter] Error importing {ctx.assetPath}: {e}");
        }
    }
}
