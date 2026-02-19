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
                if (emgData.textures != null)
                {
                    foreach (var texInfo in emgData.textures)
                    {
                        // v0.2.2: Use textureFile directly
                        string texFileName = texInfo.textureFile;
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
                                
                                ctx.AddObjectToAsset(texFileName, tex);
                                textures[texFileName] = tex;
                            }
                        }
                        else
                        {
                             Debug.LogWarning($"[EmgImporter] Texture {texFileName} not found.");
                        }
                    }
                }

                // 3. Create Material (Simple unlit/sprite material)
                var material = new Material(Shader.Find("Sprites/Default"));
                material.name = "EmgMaterial";
                ctx.AddObjectToAsset("material", material);

                // 4. Create GameObject Hierarchy
                var rootGo = new GameObject(Path.GetFileNameWithoutExtension(ctx.assetPath));
                
                if (emgData.parts != null)
                {
                    foreach (var part in emgData.parts)
                    {
                        if (part.layers == null) continue;

                        GameObject partGo;
                        
                        // Sort layers by textureZIndex (ascending)
                        part.layers.Sort((a, b) => a.textureZIndex.CompareTo(b.textureZIndex));

                        if (part.type == "switch")
                        {
                             // Container for Switch parts
                             partGo = new GameObject(part.partID);
                             partGo.transform.SetParent(rootGo.transform, false);
                        }
                        else // static
                        {
                             // Static parts usually have 1 layer, the object IS the layer
                             // But to keep logic simple and uniform: Create Part object, put layer inside?
                             // Or direct? 
                             // EmgImporter v0.1 strategy: "Single layer -> direct".
                             // Let's stick to Container strategy for consistency if helpful, OR direct.
                             // V0.2.2 spec implies "static" is simple.
                             // Let's make "static" a container too, usually with 1 child. 
                             // OR: If static, create GO named partID, add renderer.
                             // BUT static parts might technically have multiple layers in some complex PSD setups? 
                             // Spec says "type: static". 
                             // Let's treat valid static part as simple container for safety.
                             partGo = new GameObject(part.partID);
                             partGo.transform.SetParent(rootGo.transform, false);
                        }

                        // Create Layers
                        foreach (var layer in part.layers)
                        {
                            // Update opacity if close to 0 (fixing field initialization issues)
                            if (layer.opacity <= 0.001f) layer.opacity = 1.0f;
                            
                            // Debug.Log($"LayerOp: {layer.textureID} = {layer.opacity}");

                            if (string.IsNullOrEmpty(layer.textureFile) || !textures.ContainsKey(layer.textureFile)) 
                            {
                                // Fallback: try to find any texture if textureFile missing?
                                // v0.2.2 spec requires textureFile.
                                continue; 
                            }

                            var layerGo = new GameObject($"{part.partID}_{layer.textureID}");
                            layerGo.transform.SetParent(partGo.transform, false);
                            
                            // Visibility / Active State
                            if (part.type == "switch")
                            {
                                // Only default is active
                                layerGo.SetActive(layer.textureID == part.@default);
                            }
                            else
                            {
                                layerGo.SetActive(true);
                            }

                            // --- Position Calculation ---
                            // 1. Calculate center of the layer in Canvas coordinates
                            // v0.2.2: basePosition is Top-Left of the layer on Canvas
                            float layerCenterX = layer.basePosition_x + layer.width / 2f;
                            float layerCenterY = layer.basePosition_y + layer.height / 2f;

                            // 2. Calculate center of the Canvas
                            float canvasCenterX = emgData.baseCanvasWidth / 2f;
                            float canvasCenterY = emgData.baseCanvasHeight / 2f;

                            // 3. Calculate offset from Canvas Center
                            float offsetX = layerCenterX - canvasCenterX;
                            float offsetY = layerCenterY - canvasCenterY;

                            // 4. Convert to Unity Units and Coordinates (Flip Y)
                            float unityX = offsetX / pixelsPerUnit;
                            float unityY = -offsetY / pixelsPerUnit;

                            // Apply position (Local to Parent, but Parent is at 0,0 relative to Root)
                            layerGo.transform.localPosition = new Vector3(unityX, unityY, 0);

                            // --- SpriteRenderer ---
                            var renderer = layerGo.AddComponent<SpriteRenderer>();
                            renderer.sharedMaterial = material;
                            renderer.sortingOrder = layer.textureZIndex;
                            
                            // Opacity
                            Color color = Color.white;
                            color.a = layer.opacity;
                            renderer.color = color;

                            // --- Sprite Creation ---
                            Texture2D tex = textures[layer.textureFile];
                            
                            // Rect from Pixel Coords (Atlas)
                            // Unity Rect Origin is Bottom-Left. Atlas is Top-Left.
                            float rectX = layer.x;
                            float rectY = tex.height - (layer.y + layer.height); // Flip Y
                            float rectW = layer.width;
                            float rectH = layer.height;
                            
                            if (rectW > 0 && rectH > 0)
                            {
                                var sprite = Sprite.Create(tex, new Rect(rectX, rectY, rectW, rectH), new Vector2(0.5f, 0.5f), pixelsPerUnit);
                                sprite.name = $"{layer.textureID}_sprite";
                                
                                ctx.AddObjectToAsset($"sprite_{part.partID}_{layer.textureID}", sprite);
                                renderer.sprite = sprite;
                            }
                        }
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
