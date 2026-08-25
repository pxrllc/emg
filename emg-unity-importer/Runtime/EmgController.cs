using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Emg.Runtime
{
    /// <summary>
    /// EMG キャラクターの switch パーツ切り替えとアニメーション再生を管理するコンポーネント。
    /// インポートされた .emg Prefab のルート GameObject にアタッチされます。
    /// </summary>
    public class EmgController : MonoBehaviour
    {
        [SerializeField] public EmgAssetData assetData;
        [Tooltip("Start() 時に auto_loop / random_interval トリガーを自動再生する")]
        [SerializeField] public bool playOnAwake = true;
        [Tooltip("アニメーション全体の再生速度倍率")]
        [SerializeField] public float globalTimeScale = 1f;

        // partID -> { textureID -> GameObject }
        private Dictionary<string, Dictionary<string, GameObject>> _partMap;
        private Dictionary<string, Coroutine> _runningCoroutines;

        // mapping.json (v0.3.0+) パーツ役割解決結果。emg-mapping-spec.md 参照。
        private static readonly string[] BlinkKeywords = { "eye", "eyes", "eyelid", "blink", "目" };
        private static readonly string[] MouthKeywords = { "mouth", "lip", "viseme", "口" };

        private string _blinkPartID;
        private bool _blinkExplicit;
        private string _mouthPartID;
        private bool _mouthExplicit;
        private string _currentExpression = "default";
        private EmgBlinkTextures _activeBlinkOverride;
        private EmgLipSyncTextures _activeLipSyncOverride;

        private void Awake()
        {
            BuildPartMap();
            ResolvePartRoles();
        }

        private void Start()
        {
            if (!playOnAwake || assetData == null || assetData.spriteDefinitions == null)
                return;

            foreach (var def in assetData.spriteDefinitions)
            {
                if (!def.hasTrigger) continue;
                if (def.triggerType != TriggerType.auto_loop && def.triggerType != TriggerType.random_interval)
                    continue;

                // sprites[] との共存ルール (emg-mapping-spec.md): mapping.json で明示的に
                // blink/lipSync 対象指定されたパーツは、sprites[] 側の自律発火を行ってはならない。
                if ((def.targetPartID == _blinkPartID && _blinkExplicit) ||
                    (def.targetPartID == _mouthPartID && _mouthExplicit))
                    continue;

                Play(def.spriteID);
            }
        }

        // -------------------------
        // mapping.json: パーツ役割解決
        // -------------------------

        private void ResolvePartRoles()
        {
            _blinkPartID = null;
            _blinkExplicit = false;
            _mouthPartID = null;
            _mouthExplicit = false;

            var partMetas = assetData?.partMetas;
            if (partMetas == null) return;

            var baseMap = assetData.semanticMapping?.baseMapping;

            string blinkPartID = null;
            bool blinkExplicit = false;
            string mouthPartID = null;
            bool mouthExplicit = false;

            if (baseMap != null)
            {
                if (baseMap.blinkParts != null)
                {
                    var targets = new HashSet<string>();
                    AddIfNotEmpty(targets, baseMap.blinkParts.open);
                    AddIfNotEmpty(targets, baseMap.blinkParts.half);
                    AddIfNotEmpty(targets, baseMap.blinkParts.closed);
                    var found = System.Array.Find(partMetas, p => targets.Contains(p.partID));
                    if (found != null) { blinkPartID = found.partID; blinkExplicit = true; }
                }
                if (blinkPartID == null && !string.IsNullOrEmpty(baseMap.blinkPartKey))
                {
                    var found = System.Array.Find(partMetas, p => p.partID == baseMap.blinkPartKey);
                    if (found != null) { blinkPartID = found.partID; blinkExplicit = true; }
                }

                if (baseMap.lipSyncParts != null)
                {
                    var targets = new HashSet<string>();
                    AddIfNotEmpty(targets, baseMap.lipSyncParts.a);
                    AddIfNotEmpty(targets, baseMap.lipSyncParts.i);
                    AddIfNotEmpty(targets, baseMap.lipSyncParts.u);
                    AddIfNotEmpty(targets, baseMap.lipSyncParts.e);
                    AddIfNotEmpty(targets, baseMap.lipSyncParts.o);
                    AddIfNotEmpty(targets, baseMap.lipSyncParts.n);
                    var found = System.Array.Find(partMetas, p => targets.Contains(p.partID));
                    if (found != null) { mouthPartID = found.partID; mouthExplicit = true; }
                }
                if (mouthPartID == null && !string.IsNullOrEmpty(baseMap.lipSyncPartKey))
                {
                    var found = System.Array.Find(partMetas, p => p.partID == baseMap.lipSyncPartKey);
                    if (found != null) { mouthPartID = found.partID; mouthExplicit = true; }
                }
            }

            if (blinkPartID == null)
            {
                var found = FindPartByKeyword(partMetas, BlinkKeywords);
                if (found != null) blinkPartID = found.partID;
            }
            if (mouthPartID == null)
            {
                var found = FindPartByKeyword(partMetas, MouthKeywords);
                if (found != null) mouthPartID = found.partID;
            }

            // blink役とmouth役の両方に該当する場合は mouth を優先
            if (blinkPartID != null && blinkPartID == mouthPartID)
            {
                blinkPartID = null;
                blinkExplicit = false;
            }

            _blinkPartID = blinkPartID;
            _blinkExplicit = blinkExplicit;
            _mouthPartID = mouthPartID;
            _mouthExplicit = mouthExplicit;
        }

        private static void AddIfNotEmpty(HashSet<string> set, string v)
        {
            if (!string.IsNullOrEmpty(v)) set.Add(v);
        }

        private static EmgPartMeta FindPartByKeyword(EmgPartMeta[] parts, string[] keywords)
        {
            foreach (var p in parts)
            {
                if (p.type != "switch") continue;
                string lower = p.partID.ToLowerInvariant();
                foreach (var kw in keywords)
                    if (lower.Contains(kw.ToLowerInvariant())) return p;
            }
            return null;
        }

        private EmgPartMeta FindPartMeta(string partID)
        {
            var metas = assetData?.partMetas;
            if (metas == null || partID == null) return null;
            return System.Array.Find(metas, p => p.partID == partID);
        }

        /// <summary>
        /// Hierarchy を走査して partID -> layerGO 辞書を構築する。
        /// ヒエラルキー構造: Root > [partID] > [partID_textureID]
        /// </summary>
        private void BuildPartMap()
        {
            _partMap = new Dictionary<string, Dictionary<string, GameObject>>();
            _runningCoroutines = new Dictionary<string, Coroutine>();

            foreach (Transform partTransform in transform)
            {
                string partID = partTransform.gameObject.name;
                string prefix = partID + "_";
                var layerMap = new Dictionary<string, GameObject>();

                foreach (Transform layerTransform in partTransform)
                {
                    string goName = layerTransform.gameObject.name;
                    if (goName.StartsWith(prefix))
                    {
                        string textureID = goName.Substring(prefix.Length);
                        layerMap[textureID] = layerTransform.gameObject;
                    }
                }

                if (layerMap.Count > 0)
                    _partMap[partID] = layerMap;
            }
        }

        // -------------------------
        // Public API
        // -------------------------

        /// <summary>
        /// switch パーツの表示差分を即時切り替えます。UnityEvent からも呼び出し可能。
        /// </summary>
        public void SetPart(string partID, string textureID)
        {
            if (!_partMap.TryGetValue(partID, out var layerMap)) return;
            foreach (var kv in layerMap)
                kv.Value.SetActive(kv.Key == textureID);
        }

        /// <summary>
        /// switch パーツを未選択（どのフレームも表示しない）にします。
        /// v0.5.0 §4.3.3。defaultVisible: false のパーツが始まる状態でもあります。
        /// </summary>
        public void ClearPart(string partID) => SetPart(partID, null);

        /// <summary>
        /// 現在アクティブな差分の textureID を返します。
        /// </summary>
        public string GetCurrentTextureID(string partID)
        {
            if (!_partMap.TryGetValue(partID, out var layerMap)) return null;
            foreach (var kv in layerMap)
                if (kv.Value.activeSelf) return kv.Key;
            return null;
        }

        // -------------------------
        // mapping.json: 外部制御API
        // -------------------------

        /// <summary>
        /// blink パーツの状態 ("open" | "half" | "closed") を反映します。
        /// mapping.json が無い、または blink 役のパーツが解決できない場合は何もしません。
        /// </summary>
        public void SetBlinkState(string state)
        {
            var baseMap = assetData?.semanticMapping?.baseMapping;
            if (baseMap == null || _blinkPartID == null) return;

            var partMeta = FindPartMeta(_blinkPartID);
            string textureID = null;

            string overrideValue = _activeBlinkOverride != null ? GetBlinkTexture(_activeBlinkOverride, state) : null;
            if (!string.IsNullOrEmpty(overrideValue))
            {
                textureID = overrideValue;
            }
            else if (baseMap.blinkParts != null)
            {
                // フラットモード: 状態に対応するパーツ自体を表示/非表示
                string targetPartID = GetBlinkTexture(baseMap.blinkParts, state);
                if (!string.IsNullOrEmpty(targetPartID))
                {
                    SetPartActive(baseMap.blinkParts.open, baseMap.blinkParts.open == targetPartID);
                    SetPartActive(baseMap.blinkParts.half, baseMap.blinkParts.half == targetPartID);
                    SetPartActive(baseMap.blinkParts.closed, baseMap.blinkParts.closed == targetPartID);
                }
                return;
            }
            else if (baseMap.blink != null)
            {
                string v = GetBlinkTexture(baseMap.blink, state);
                if (!string.IsNullOrEmpty(v)) textureID = v;
            }

            if (textureID == null && partMeta?.layerTextureIDs != null && partMeta.layerTextureIDs.Length == 3)
            {
                // 既知の制限: 位置的フォールバックは3レイヤー構成のパーツにのみ適用
                int idx = state == "open" ? 0 : state == "half" ? 1 : state == "closed" ? 2 : -1;
                if (idx >= 0) textureID = partMeta.layerTextureIDs[idx];
            }

            if (!string.IsNullOrEmpty(textureID)) SetPart(_blinkPartID, textureID);
        }

        /// <summary>
        /// リップシンクの母音状態 ("a" | "i" | "u" | "e" | "o" | "n") を反映します。
        /// mapping.json が無い、または mouth 役のパーツが解決できない場合は何もしません。
        /// </summary>
        public void SetViseme(string vowel)
        {
            var baseMap = assetData?.semanticMapping?.baseMapping;
            if (baseMap == null || _mouthPartID == null) return;

            var partMeta = FindPartMeta(_mouthPartID);

            string overrideValue = _activeLipSyncOverride != null ? GetLipSyncTexture(_activeLipSyncOverride, vowel) : null;
            if (!string.IsNullOrEmpty(overrideValue))
            {
                SetPart(_mouthPartID, overrideValue);
                return;
            }

            if (baseMap.lipSyncParts != null)
            {
                string targetPartID = GetLipSyncTexture(baseMap.lipSyncParts, vowel);
                if (!string.IsNullOrEmpty(targetPartID))
                {
                    SetPartActive(baseMap.lipSyncParts.a, baseMap.lipSyncParts.a == targetPartID);
                    SetPartActive(baseMap.lipSyncParts.i, baseMap.lipSyncParts.i == targetPartID);
                    SetPartActive(baseMap.lipSyncParts.u, baseMap.lipSyncParts.u == targetPartID);
                    SetPartActive(baseMap.lipSyncParts.e, baseMap.lipSyncParts.e == targetPartID);
                    SetPartActive(baseMap.lipSyncParts.o, baseMap.lipSyncParts.o == targetPartID);
                    SetPartActive(baseMap.lipSyncParts.n, baseMap.lipSyncParts.n == targetPartID);
                }
                return;
            }

            string textureID = null;
            if (baseMap.lipSync != null)
            {
                textureID = GetLipSyncTexture(baseMap.lipSync, vowel);
                if (string.IsNullOrEmpty(textureID)) textureID = baseMap.lipSync.open;
            }

            if (string.IsNullOrEmpty(textureID) && partMeta?.layerTextureIDs != null)
            {
                string lowerVowel = vowel.ToLowerInvariant();
                foreach (var lid in partMeta.layerTextureIDs)
                {
                    if (lid != null && lid.ToLowerInvariant().Contains(lowerVowel)) { textureID = lid; break; }
                }
            }

            if (string.IsNullOrEmpty(textureID) && partMeta != null)
            {
                textureID = !string.IsNullOrEmpty(partMeta.defaultTextureID)
                    ? partMeta.defaultTextureID
                    : (partMeta.layerTextureIDs != null && partMeta.layerTextureIDs.Length > 0 ? partMeta.layerTextureIDs[0] : null);
            }

            if (!string.IsNullOrEmpty(textureID)) SetPart(_mouthPartID, textureID);
        }

        /// <summary>
        /// 表情 (mapping.json の expressions キー) を反映します。存在しない名前は "default" にフォールバックします。
        /// この表情専用の blink/lipSync overrides があれば、以後の SetBlinkState/SetViseme に適用されます。
        /// </summary>
        public void SetExpression(string name)
        {
            var mapping = assetData?.semanticMapping;
            if (mapping == null) return;

            var entry = mapping.FindExpression(name) ?? mapping.FindExpression("default");
            _currentExpression = mapping.FindExpression(name) != null ? name : "default";

            var expr = entry?.value;
            if (expr == null)
            {
                _activeBlinkOverride = null;
                _activeLipSyncOverride = null;
                return;
            }

            if (expr.partsList != null)
            {
                foreach (var pl in expr.partsList)
                {
                    if (pl.layerIDs == null || pl.layerIDs.Length == 0) continue;
                    SetPartLayers(pl.partID, pl.layerIDs);
                }
            }

            // eyebrow: partID "eyebrow" を持つパーツへの単一レイヤー指定として扱う
            if (!string.IsNullOrEmpty(expr.eyebrow))
                SetPart("eyebrow", expr.eyebrow);

            // other: 個々のレイヤーIDを直接表示（それが属するパーツの他レイヤーは非表示にする）
            if (expr.other != null)
            {
                foreach (var layerID in expr.other)
                {
                    string owningPart = FindPartIDForLayer(layerID);
                    if (owningPart != null) SetPart(owningPart, layerID);
                }
            }

            _activeBlinkOverride = expr.overrides?.blink;
            _activeLipSyncOverride = expr.overrides?.lipSync;
        }

        private static string GetBlinkTexture(EmgBlinkTextures t, string state)
        {
            switch (state)
            {
                case "open": return t.open;
                case "half": return t.half;
                case "closed": return t.closed;
                default: return null;
            }
        }

        private static string GetLipSyncTexture(EmgLipSyncTextures t, string vowel)
        {
            switch (vowel)
            {
                case "a": return t.a;
                case "i": return t.i;
                case "u": return t.u;
                case "e": return t.e;
                case "o": return t.o;
                case "n": return t.n;
                default: return null;
            }
        }

        /// <summary>
        /// フラットモード（1パーツ=1レイヤー）用: 指定パーツ全体の表示/非表示を切り替えます。
        /// </summary>
        private void SetPartActive(string partID, bool active)
        {
            if (string.IsNullOrEmpty(partID)) return;
            var t = transform.Find(partID);
            if (t != null) t.gameObject.SetActive(active);
        }

        /// <summary>
        /// SetPart と異なり、指定したレイヤーID群を同時に有効化します（expressions[].parts 用）。
        /// </summary>
        private void SetPartLayers(string partID, string[] layerIDs)
        {
            if (!_partMap.TryGetValue(partID, out var layerMap)) return;
            var set = new HashSet<string>(layerIDs);
            foreach (var kv in layerMap)
                kv.Value.SetActive(set.Contains(kv.Key));
        }

        private string FindPartIDForLayer(string layerID)
        {
            foreach (var kv in _partMap)
                if (kv.Value.ContainsKey(layerID)) return kv.Key;
            return null;
        }

        /// <summary>
        /// spriteID のアニメーションを再生します。既に再生中の場合は再起動します。
        /// </summary>
        public void Play(string spriteID)
        {
            if (assetData == null || assetData.spriteDefinitions == null) return;
            var def = System.Array.Find(assetData.spriteDefinitions, d => d.spriteID == spriteID);
            if (def == null) return;

            Stop(spriteID);
            _runningCoroutines[spriteID] = StartCoroutine(PlayCoroutine(def));
        }

        /// <summary>
        /// 指定 spriteID のアニメーションを停止します。
        /// </summary>
        public void Stop(string spriteID)
        {
            if (_runningCoroutines.TryGetValue(spriteID, out var c) && c != null)
                StopCoroutine(c);
            _runningCoroutines.Remove(spriteID);
        }

        /// <summary>
        /// すべてのアニメーションを停止します。
        /// </summary>
        public void StopAll()
        {
            foreach (var kv in _runningCoroutines)
                if (kv.Value != null) StopCoroutine(kv.Value);
            _runningCoroutines.Clear();
        }

        // -------------------------
        // Coroutines
        // -------------------------

        private IEnumerator PlayCoroutine(EmgSpriteDefinition def)
        {
            if (!def.hasTrigger || def.triggerType == TriggerType.external)
            {
                yield return PlaySequenceOnce(def);
                _runningCoroutines.Remove(def.spriteID);
                yield break;
            }

            if (def.triggerType == TriggerType.auto_loop)
            {
                while (true)
                    yield return PlaySequenceOnce(def);
            }
            else // random_interval
            {
                while (true)
                {
                    float wait = Random.Range(def.intervalMin, def.intervalMax);
                    yield return new WaitForSeconds(wait / Mathf.Max(globalTimeScale, 0.001f));
                    yield return PlaySequenceOnce(def);
                }
            }
        }

        private IEnumerator PlaySequenceOnce(EmgSpriteDefinition def)
        {
            if (def.frames == null || def.frames.Length == 0) yield break;
            float interval = (def.fps > 0f)
                ? 1f / def.fps / Mathf.Max(globalTimeScale, 0.001f)
                : 0.1f;

            if (def.sequenceType == SequenceType.ordered)
            {
                foreach (var frame in def.frames)
                {
                    SetPart(def.targetPartID, frame);
                    yield return new WaitForSeconds(interval);
                }
            }
            else // random_hold
            {
                string frame = def.frames[Random.Range(0, def.frames.Length)];
                SetPart(def.targetPartID, frame);
            }
        }
    }
}
