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

        private void Awake()
        {
            BuildPartMap();
        }

        private void Start()
        {
            if (!playOnAwake || assetData == null || assetData.spriteDefinitions == null)
                return;

            foreach (var def in assetData.spriteDefinitions)
            {
                if (!def.hasTrigger) continue;
                if (def.triggerType == TriggerType.auto_loop || def.triggerType == TriggerType.random_interval)
                    Play(def.spriteID);
            }
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
        /// 現在アクティブな差分の textureID を返します。
        /// </summary>
        public string GetCurrentTextureID(string partID)
        {
            if (!_partMap.TryGetValue(partID, out var layerMap)) return null;
            foreach (var kv in layerMap)
                if (kv.Value.activeSelf) return kv.Key;
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
