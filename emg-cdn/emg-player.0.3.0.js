(function () {
    // グローバル変数の定義
    window.jsonData = null;
    window.emgMapping = null; // mapping.json (v0.3.0+, optional)
    window.emgVersion = null;
    window.isAnimationRunning = true;
    window.animationIntervals = []; // 複数のタイマー管理用
    window.timeouts = [];

    // mapping.json 由来のランタイム状態（emg-mapping-spec.md の解決ロジックが参照する）
    const mappingState = {
        blinkPartID: null,
        blinkExplicit: false,
        mouthPartID: null,
        mouthExplicit: false,
        currentExpression: 'default',
        activeBlinkOverride: null,  // { open, half, closed } | null
        activeLipSyncOverride: null // { a, i, u, e, o, n } | null
    };

    const BLINK_KEYWORDS = ['eye', 'eyes', 'eyelid', 'blink', '目'];
    const MOUTH_KEYWORDS = ['mouth', 'lip', 'viseme', '口'];

    // JSZip のロードチェック
    if (typeof JSZip === 'undefined') {
        const jsZipScript = document.createElement('script');
        jsZipScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js";
        document.head.appendChild(jsZipScript);
        jsZipScript.onload = function () {
            console.log("JSZip loaded via dynamic script");
            initPlayer();
        };
    } else {
        initPlayer();
    }

    function initPlayer() {
        // 公開関数
        window.EMGPlayer = {
            loadEmgFromCDN: loadEmgFromCDN,
            toggleAnimation: toggleAnimation,
            resetAnimation: resetAnimation,
            // v0.3.0: mapping.json による外部制御API
            setBlinkState: applyBlinkState,
            setViseme: applyViseme,
            setExpression: applyExpression,
            // v0.5.0: プリセット適用
            setPreset: applyPreset
        };
    }

    async function loadEmgFromCDN(url, containerId = "layerContainer") {
        try {
            console.log(`Loading EMG from: ${url}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const blob = await response.blob();

            const zip = new JSZip();
            const zipContent = await zip.loadAsync(blob);

            // data.json を探す (ルートにあると仮定、あるいは .json で終わるファイル)
            const jsonFile = Object.keys(zipContent.files).find(name => name.endsWith("data.json")) ||
                Object.keys(zipContent.files).find(name => name.endsWith(".json") && !name.endsWith("mapping.json"));

            if (!jsonFile) {
                console.error("EMGファイル内に JSON が見つかりません！");
                return;
            }

            const jsonText = await zipContent.files[jsonFile].async("text");
            window.jsonData = JSON.parse(jsonText);
            window.emgVersion = window.jsonData.version || "0.1.0";

            console.log(`EMG Version: ${window.emgVersion}`);

            // v0.4.0 §2.2: mapping やテクスチャの展開より前に判定する
            checkRequiredExtensions(window.jsonData);

            // mapping.json (任意のコンパニオンファイル。無ければ無視する)
            const mappingFile = Object.keys(zipContent.files).find(name => name.endsWith("mapping.json"));
            if (mappingFile) {
                try {
                    const mappingText = await zipContent.files[mappingFile].async("text");
                    window.emgMapping = JSON.parse(mappingText);
                    console.log("mapping.json loaded:", window.emgMapping.avatarId);
                } catch (e) {
                    console.warn("Failed to parse mapping.json, ignoring:", e);
                    window.emgMapping = null;
                }
            } else {
                window.emgMapping = null;
            }

            // テクスチャ読み込み
            // v0.2.2: textures 配列からファイル名を取得
            // v0.1.0: ファイル検索で画像を探す
            const textureBlobs = {};

            if (window.jsonData.textures && Array.isArray(window.jsonData.textures)) {
                for (const texMeta of window.jsonData.textures) {
                    const fileName = texMeta.textureFile;
                    const fileInZip = Object.keys(zipContent.files).find(name => name.endsWith(fileName));
                    if (fileInZip) {
                        const blob = await zipContent.files[fileInZip].async("blob");
                        textureBlobs[fileName] = URL.createObjectURL(blob);
                    }
                }
            } else {
                // Fallback for v0.1.0 or simple structure
                const textureFiles = Object.keys(zipContent.files).filter(name => /\.(png|jpg|jpeg)$/i.test(name));
                for (const tf of textureFiles) {
                    const blob = await zipContent.files[tf].async("blob");
                    // パス区切り除去してファイル名だけにする簡易処理
                    const fileName = tf.split('/').pop();
                    textureBlobs[fileName] = URL.createObjectURL(blob);
                    // 0.1.0互換のため、デフォルトキーとしても登録
                    textureBlobs["default"] = textureBlobs[fileName];
                }
            }

            renderLayers(window.jsonData, textureBlobs, containerId);

            // mapping.json のパーツ役割解決（mapping が無ければ両方 null のまま）
            resolvePartRoles();

            startAnimation();

        } catch (error) {
            console.error("Failed to load EMG from CDN:", error);
        }
    }

    // ------------------------------------------------------------------
    // v0.4.0 互換性規則（emg-json-spec-0.4.0.md 1〜2 章）
    // ------------------------------------------------------------------

    // この実装が理解する機能識別子（emg-extensions-registry.md）。
    // v0.4.0 の範囲では 1 つも実装していないため空。
    // EMG_frame_name: v0.5.0 §2 の frameName に対応済み。
    const SUPPORTED_EXTENSIONS = new Set(['EMG_frame_name']);

    // v0.5.0 §1.1: レイヤーのフレーム識別子。frameName が無ければ textureID と同一なので、
    // 従来のファイルでは解決結果が変わらない。
    // 参照の突き合わせは textureID ではなく必ずこちらで行う。
    function frameId(layer) {
        return layer.frameName != null ? layer.frameName : layer.textureID;
    }

    // F5: 未知の識別子が 1 つでもあれば読み込みを拒否する。
    // 理解できない拡張を黙って無視すると誤った絵になるため、明示的に失敗させる。
    function checkRequiredExtensions(jsonData) {
        const required = Array.isArray(jsonData.requiredExtensions) ? jsonData.requiredExtensions : [];
        const unknown = required.filter(e => !SUPPORTED_EXTENSIONS.has(e));
        if (unknown.length > 0) {
            throw new Error(
                `この .emg は未対応の機能を要求しています: ${unknown.join(', ')}。プレイヤーの更新が必要です。`);
        }
    }

    // F2: 未知の type は default を持つなら switch、持たないなら static として扱う。
    // 生の type で分岐すると、未知の値でパーツが消えるか全レイヤーが重なる。
    function resolvePartType(part) {
        if (part.type === 'static' || part.type === 'switch') return part.type;
        return part.default != null ? 'switch' : 'static';
    }

    // F3 / F4: 未知の値は既定へ倒す。trigger は「自律発火しない」側が安全。
    function resolveSequenceType(sequence) {
        const t = sequence && sequence.type;
        return (t === 'ordered' || t === 'random_hold') ? t : 'ordered';
    }

    function resolveTriggerType(trigger) {
        const t = trigger && trigger.type;
        return (t === 'auto_loop' || t === 'random_interval' || t === 'external') ? t : 'external';
    }

    // 4.2: fps は v0.4.0 で任意になった。不在時は 12。
    function resolveFps(sprite) {
        return (typeof sprite.fps === 'number' && sprite.fps > 0) ? sprite.fps : 12;
    }

    // ------------------------------------------------------------------
    // v0.5.0 §7: トランスフォーム
    // ------------------------------------------------------------------

    // 実行中のトランスフォーム sprite。requestAnimationFrame で毎フレーム評価する。
    let transformSprites = [];
    let transformRafId = null;
    let transformStart = 0;

    /** §7.5: cubic は Catmull-Rom に固定（制御点を持たない）。 */
    function catmullRom(p0, p1, p2, p3, u) {
        const u2 = u * u, u3 = u2 * u;
        return 0.5 * (2 * p1 + (-p0 + p2) * u
            + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
            + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    }

    /** §7.2: トラックの時刻 t（秒）における値。範囲外は端の値を保持する。 */
    function trackValueAt(track, t) {
        const keys = track.keys ?? [];
        if (keys.length === 0) return 0;
        if (keys.length === 1 || t <= keys[0].t) return keys[0].v;
        if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;

        let i = 0;
        while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
        const k0 = keys[i], k1 = keys[i + 1];
        const span = k1.t - k0.t;
        const u = span <= 0 ? 0 : (t - k0.t) / span;

        const interp = ['step', 'linear', 'cubic'].includes(track.interpolation)
            ? track.interpolation : 'linear';
        if (interp === 'step') return k0.v;
        if (interp === 'cubic') {
            return catmullRom(
                keys[Math.max(i - 1, 0)].v, k0.v, k1.v,
                keys[Math.min(i + 2, keys.length - 1)].v, u);
        }
        return k0.v + (k1.v - k0.v) * u;
    }

    /** §7.6 / §7.7: loop / pingpong / phaseOffset を解決して変換を求める。 */
    function resolveTransformAt(sprite, time) {
        const tracks = sprite.tracks ?? [];
        const r = { translate_x: 0, translate_y: 0, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 };
        if (tracks.length === 0) return r;

        const duration = sprite.duration > 0 ? sprite.duration
            : Math.max(0, ...tracks.flatMap(tr => (tr.keys ?? []).map(k => k.t)));
        let local = Math.max(0, time - (sprite.phaseOffset ?? 0));

        let t = 0;
        if (duration > 0) {
            const loop = ['once', 'loop', 'pingpong'].includes(sprite.loop) ? sprite.loop : 'loop';
            if (loop === 'once') t = Math.min(local, duration);
            else if (loop === 'pingpong') {
                const cycle = local % (2 * duration);
                t = cycle <= duration ? cycle : 2 * duration - cycle;
            } else t = local % duration;
        }

        for (const track of tracks) {
            if (track.path in r) r[track.path] = trackValueAt(track, t);
        }
        return r;
    }

    /**
     * §7.4: アンカーを原点へ移動 → scale → rotate → 戻す → translate、最後に opacity。
     * CSS の transform は右から左に適用されるため、記述順は逆にする。
     * transform-origin をアンカー（キャンバス座標）からレイヤー相対へ直して渡す。
     */
    function applyTransformToPart(partID, tf) {
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        layers.forEach(el => {
            const ax = parseFloat(el.dataset.anchorX ?? '0') - parseFloat(el.dataset.baseX ?? '0');
            const ay = parseFloat(el.dataset.anchorY ?? '0') - parseFloat(el.dataset.baseY ?? '0');
            el.style.transformOrigin = `${ax}px ${ay}px`;
            el.style.transform =
                `translate(${tf.translate_x}px, ${tf.translate_y}px) ` +
                `rotate(${tf.rotation}deg) scale(${tf.scale_x}, ${tf.scale_y})`;
            const base = parseFloat(el.dataset.baseOpacity ?? '1');
            el.style.opacity = String(base * tf.opacity);
        });
    }

    function startTransformLoop() {
        if (transformSprites.length === 0) return;
        transformStart = performance.now();
        const tick = () => {
            if (!window.isAnimationRunning) { transformRafId = null; return; }
            const time = (performance.now() - transformStart) / 1000;
            for (const sp of transformSprites) {
                applyTransformToPart(sp.targetPartID, resolveTransformAt(sp, time));
            }
            transformRafId = requestAnimationFrame(tick);
        };
        transformRafId = requestAnimationFrame(tick);
    }

    function applyLayerStyles(element) {
        element.style.position = "absolute";
        element.style.backgroundRepeat = "no-repeat";
        element.style.backgroundSize = "cover"; // あるいはピクセル指定
        element.style.opacity = "1";
    }

    // 表示/非表示は display で行う。
    // 以前は opacity:0 で隠していたが、それだと (1) 非表示レイヤーも合成対象として残り
    // （senti は 36 レイヤー中 18 枚が常時非表示）、(2) レイヤー固有の不透明度
    // （data.json の layer.opacity）を上書きしてしまい反映できなかった。
    // opacity は layer.opacity 専用に使う。
    function setLayerVisible(el, visible) {
        el.style.display = visible ? 'block' : 'none';
    }

    function renderLayers(jsonData, textureBlobs, containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container element '${containerId}' not found`);
            return;
        }
        container.innerHTML = '';

        let containerWidth = jsonData.baseCanvasWidth || 1920;
        let containerHeight = jsonData.baseCanvasHeight || 1080;
        container.style.width = `${containerWidth}px`;
        container.style.height = `${containerHeight}px`;
        container.style.position = 'relative';
        container.style.overflow = 'hidden';

        if (jsonData.parts) {
            // v0.2.2+ render logic
            jsonData.parts.forEach(part => {
                const partType = resolvePartType(part);   // v0.4.0 F2
                // v0.5.0 §4: static パーツは defaultVisible で初期状態が決まる。
                // switch パーツでは無視する（§4.1）。
                const partVisible = partType !== 'static' || (part.defaultVisible !== false);
                // パーツコンテナを作成（必要に応じて）
                // レイヤーを展開
                part.layers.forEach(layer => {
                    const div = document.createElement('div');
                    div.classList.add('layer');
                    div.dataset.partId = part.partID;
                    div.dataset.type = partType;
                    div.id = layer.textureID; // 後方互換のため維持
                    // textureID はパーツ間で重複しうる（senti では "01" が Mouth/Eyes/Eyebrows に存在）ため、
                    // 切り替えの一致判定には id ではなく data 属性を使う。
                    div.dataset.textureId = layer.textureID;
                    // v0.5.0: 切り替えの単位はフレーム識別子（frameName ?? textureID）
                    div.dataset.frameId = frameId(layer);
                    // v0.5.0 §7.4: transform-origin を求めるためアンカーと基準位置を持つ。
                    // anchor は不在時 basePosition と同値（v0.4.0 §3.1）。
                    div.dataset.baseX = String(layer.basePosition_x);
                    div.dataset.baseY = String(layer.basePosition_y);
                    div.dataset.anchorX = String(layer.anchor_x ?? layer.basePosition_x);
                    div.dataset.anchorY = String(layer.anchor_y ?? layer.basePosition_y);

                    applyLayerStyles(div);

                    div.style.width = `${layer.width}px`;
                    div.style.height = `${layer.height}px`;
                    div.style.left = `${layer.basePosition_x}px`;
                    div.style.top = `${layer.basePosition_y}px`;
                    div.style.zIndex = layer.textureZIndex || 0;

                    // テクスチャ適用
                    const texFile = layer.textureFile || jsonData.textures?.[0]?.textureFile || "default";
                    // textureFile名がパスを含む場合もあるので、textureBlobsのキーとマッチさせる工夫が必要
                    // ここでは簡易的に textureBlobs のキーをそのまま使用
                    let blobUrl = textureBlobs[texFile] || textureBlobs["default"];

                    // アトラス内の座標計算
                    // background-image: url(...)
                    // background-position: -x -y
                    // background-size: textureWidth textureHeight

                    if (blobUrl) {
                        div.style.backgroundImage = `url('${blobUrl}')`;
                        div.style.backgroundPosition = `-${layer.x}px -${layer.y}px`;

                        // テクスチャの全体サイズが必要
                        // jsonData.textures から探す
                        let texMeta = jsonData.textures?.find(t => t.textureFile === texFile);
                        if (!texMeta && jsonData.textures?.length > 0) texMeta = jsonData.textures[0];

                        // v0.1.0 互換
                        // TextureNum: [{ canvasWidth, canvasHeight }]
                        const texW = texMeta ? texMeta.width : (jsonData.TextureNum?.[0]?.canvasWidth || 2048);
                        const texH = texMeta ? texMeta.height : (jsonData.TextureNum?.[0]?.canvasHeight || 2048);

                        div.style.backgroundSize = `${texW}px ${texH}px`;
                    }

                    // レイヤー固有の不透明度（未指定なら 1）
                    const baseOpacity = (typeof layer.opacity === 'number') ? layer.opacity : 1;
                    div.dataset.baseOpacity = String(baseOpacity);
                    div.style.opacity = String(baseOpacity);

                    // type: switch の場合、default でないものは非表示
                    setLayerVisible(div,
                        partVisible && (partType !== 'switch' || frameId(layer) === part.default));

                    container.appendChild(div);
                });
            });
        } else if (jsonData.layers) {
            // v0.1.0 render logic (Reference existing code)
            const blobUrl = textureBlobs["default"];
            if (!blobUrl) return;

            jsonData.layers.forEach(layer => {
                const div = document.createElement('div');
                div.classList.add('layer');
                applyLayerStyles(div);

                if (layer.imgType === 'Texture') {
                    div.id = layer.textureID;
                } else if (layer.imgType === 'Sprite') {
                    div.id = layer.assignID;
                }

                div.style.width = `${layer.width}px`;
                div.style.height = `${layer.height}px`;
                div.style.left = `${layer.basePosition_x}px`;
                div.style.top = `${layer.basePosition_y}px`;
                div.style.backgroundImage = `url('${blobUrl}')`;
                div.style.backgroundPosition = `-${layer.x}px -${layer.y}px`;
                div.style.backgroundSize = `${jsonData.TextureNum[0].canvasWidth}px ${jsonData.TextureNum[0].canvasHeight}px`;
                div.style.zIndex = layer.textureZIndex || 0;

                container.appendChild(div);
            });
        }
    }

    // ------------------------------------------------------------------
    // mapping.json (v0.3.0): パーツ役割解決・状態解決・外部制御API
    // 詳細な規範ロジックは emg-mapping-spec.md を参照
    // ------------------------------------------------------------------

    function findPartByKeyword(parts, keywords) {
        return parts.find(part =>
            resolvePartType(part) === 'switch' &&
            keywords.some(kw => part.partID.toLowerCase().includes(kw.toLowerCase()))
        );
    }

    function resolvePartRoles() {
        mappingState.blinkPartID = null;
        mappingState.blinkExplicit = false;
        mappingState.mouthPartID = null;
        mappingState.mouthExplicit = false;

        const parts = window.jsonData?.parts;
        if (!parts) return;

        const mapping = window.emgMapping;
        const base = mapping?.baseMapping;

        let blinkPartID = null;
        let blinkExplicit = false;
        let mouthPartID = null;
        let mouthExplicit = false;

        if (base) {
            // 1. blinkParts（フラットモード）のいずれかの値と一致するパーツ
            if (base.blinkParts) {
                const targets = Object.values(base.blinkParts).filter(Boolean);
                const found = parts.find(p => targets.includes(p.partID));
                if (found) { blinkPartID = found.partID; blinkExplicit = true; }
            }
            // 2. blinkPartKey と一致するパーツ
            if (!blinkPartID && base.blinkPartKey) {
                const found = parts.find(p => p.partID === base.blinkPartKey);
                if (found) { blinkPartID = found.partID; blinkExplicit = true; }
            }

            if (base.lipSyncParts) {
                const targets = Object.values(base.lipSyncParts).filter(Boolean);
                const found = parts.find(p => targets.includes(p.partID));
                if (found) { mouthPartID = found.partID; mouthExplicit = true; }
            }
            if (!mouthPartID && base.lipSyncPartKey) {
                const found = parts.find(p => p.partID === base.lipSyncPartKey);
                if (found) { mouthPartID = found.partID; mouthExplicit = true; }
            }
        }

        // 3/4. ヒューリスティックキーワードによるフォールバック（明示指定ではない = Explicit フラグは立てない）
        if (!blinkPartID) {
            const found = findPartByKeyword(parts, BLINK_KEYWORDS);
            if (found) blinkPartID = found.partID;
        }
        if (!mouthPartID) {
            const found = findPartByKeyword(parts, MOUTH_KEYWORDS);
            if (found) mouthPartID = found.partID;
        }

        // 5. blink役とmouth役の両方に該当する場合は mouth を優先
        if (blinkPartID && blinkPartID === mouthPartID) {
            blinkPartID = null;
            blinkExplicit = false;
        }

        mappingState.blinkPartID = blinkPartID;
        mappingState.blinkExplicit = blinkExplicit;
        mappingState.mouthPartID = mouthPartID;
        mappingState.mouthExplicit = mouthExplicit;
    }

    function findPart(partID) {
        return window.jsonData?.parts?.find(p => p.partID === partID) || null;
    }

    function applyBlinkState(state) {
        // state: 'open' | 'half' | 'closed'
        const mapping = window.emgMapping;
        const base = mapping?.baseMapping;
        const partID = mappingState.blinkPartID;
        if (!base || !partID) return;

        const part = findPart(partID);
        let textureID = null;

        // 表情オーバーライドが優先
        const override = mappingState.activeBlinkOverride;
        if (override && override[state]) {
            textureID = override[state];
        } else if (base.blinkParts) {
            // フラットモード: 状態に対応するパーツ自体を表示/非表示
            const targetPartID = base.blinkParts[state];
            if (targetPartID) {
                Object.values(base.blinkParts).filter(Boolean).forEach(pid => {
                    setPartVisible(pid, pid === targetPartID);
                });
            }
            return;
        } else if (base.blink && base.blink[state]) {
            textureID = base.blink[state];
        } else if (part && part.layers.length === 3) {
            // 既知の制限: 位置的フォールバックは3レイヤー構成のパーツにのみ適用
            const order = { open: 0, half: 1, closed: 2 };
            textureID = part.layers[order[state]]?.textureID || null;
        }

        if (textureID) switchTexture(partID, textureID);
    }

    function applyViseme(vowel) {
        // vowel: 'a' | 'i' | 'u' | 'e' | 'o' | 'n'
        const mapping = window.emgMapping;
        const base = mapping?.baseMapping;
        const partID = mappingState.mouthPartID;
        if (!base || !partID) return;

        const part = findPart(partID);

        const override = mappingState.activeLipSyncOverride;
        if (override && override[vowel]) {
            switchTexture(partID, override[vowel]);
            return;
        }

        if (base.lipSyncParts) {
            const targetPartID = base.lipSyncParts[vowel];
            if (targetPartID) {
                Object.values(base.lipSyncParts).filter(Boolean).forEach(pid => {
                    setPartVisible(pid, pid === targetPartID);
                });
            }
            return;
        }

        let textureID = base.lipSync?.[vowel] || base.lipSync?.open || null;

        if (!textureID && part) {
            // textureID に母音名を含むレイヤーを検索
            const found = part.layers.find(l => l.textureID.toLowerCase().includes(vowel));
            if (found) textureID = found.textureID;
        }
        if (!textureID && part) {
            textureID = part.default || part.layers[0]?.textureID || null;
        }

        if (textureID) switchTexture(partID, textureID);
    }

    function resolveExpressionsMap() {
        return window.emgMapping?.expressions || {};
    }

    function applyExpression(name) {
        const expressions = resolveExpressionsMap();
        const expr = expressions[name] || expressions['default'] || {};
        mappingState.currentExpression = expressions[name] ? name : 'default';

        // v0.5.0 §5.3: presetID を先に適用する。expr.parts が後から上書きするため優先される。
        if (expr.presetID) applyPreset(expr.presetID);

        // parts: partID -> 表示するレイヤーIDの配列
        if (expr.parts) {
            Object.entries(expr.parts).forEach(([partID, layerIDs]) => {
                if (!Array.isArray(layerIDs) || layerIDs.length === 0) return;
                const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
                layers.forEach(el => {
                    setLayerVisible(el, layerIDs.includes(el.dataset.frameId));
                });
            });
        }

        // eyebrow: partID "eyebrow" を持つパーツへの単一レイヤー指定として扱う
        if (expr.eyebrow) {
            switchTexture('eyebrow', expr.eyebrow);
        }

        // other: 個々のレイヤーIDを直接表示（同じパーツの他レイヤーは非表示にする）
        if (Array.isArray(expr.other)) {
            expr.other.forEach(layerID => {
                const el = document.querySelector(`div.layer[data-frame-id="${layerID}"]`);
                if (el && el.dataset.partId) {
                    switchTexture(el.dataset.partId, layerID);
                }
            });
        }

        // この表情専用の blink / lipSync 差し替え
        mappingState.activeBlinkOverride = expr.overrides?.blink || null;
        mappingState.activeLipSyncOverride = expr.overrides?.lipSync || null;
    }

    // v0.5.0 §4: パーツ全体が非表示か（レイヤーが 1 枚も表示されていない状態）
    function isPartHidden(partID) {
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        if (layers.length === 0) return false;
        return [...layers].every(el => el.style.display === 'none');
    }

    /**
     * v0.5.0 §5.2: プリセットを適用する。
     * parts / toggles に現れない partID の状態は変更しない。
     */
    function applyPreset(presetID) {
        const preset = (window.jsonData?.presets ?? []).find(p => p.presetID === presetID);
        if (!preset) {
            console.warn(`preset '${presetID}' が見つかりません`);
            return;
        }
        for (const [partID, frame] of Object.entries(preset.parts ?? {})) {
            switchTexture(partID, frame);
        }
        for (const [partID, visible] of Object.entries(preset.toggles ?? {})) {
            setPartVisible(partID, visible);
        }
    }

    function setPartVisible(partID, visible) {
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        layers.forEach(el => {
            setLayerVisible(el, visible);
        });
    }

    function startAnimation() {
        if (!window.isAnimationRunning) return;
        if (!window.jsonData) return;

        // Clear existing intervals
        window.animationIntervals.forEach(clearInterval);
        window.timeouts.forEach(clearTimeout);
        window.animationIntervals = [];
        window.timeouts = [];

        // v0.5.0 §7: tracks を持つ sprite は毎フレーム評価する経路へ回す。
        transformSprites = (window.jsonData.sprites ?? [])
            .filter(sp => Array.isArray(sp.tracks) && sp.tracks.length > 0)
            .filter(sp => !isPartHidden(sp.targetPartID));
        if (transformRafId !== null) { cancelAnimationFrame(transformRafId); transformRafId = null; }
        startTransformLoop();

        if (window.jsonData.sprites) {
            window.jsonData.sprites.forEach(sprite => {
                // mapping.json との共存ルール: 明示的に blink/lipSync 対象指定されたパーツは
                // sprites[] 側の自律発火を行ってはならない (MUST NOT trigger)
                // v0.5.0 §4.5: 非表示のパーツを対象とする sprite は発火してはならない
                if (isPartHidden(sprite.targetPartID)) {
                    console.log(`Sprite '${sprite.spriteID}' suppressed: part '${sprite.targetPartID}' is hidden`);
                    return;
                }
                if (
                    (sprite.targetPartID === mappingState.blinkPartID && mappingState.blinkExplicit) ||
                    (sprite.targetPartID === mappingState.mouthPartID && mappingState.mouthExplicit)
                ) {
                    console.log(`Sprite '${sprite.spriteID}' suppressed: targetPartID '${sprite.targetPartID}' is under mapping.json control`);
                    return;
                }
                handleSprite(sprite);
            });
        }
    }

    function handleSprite(sprite) {
        // v0.2.2 structured sprite
        const { spriteID, targetPartID, sequence, trigger } = sprite;
        // tracks のみを持つ sprite はトランスフォーム経路が扱う（§7.8 で併用は許容）
        if (!sequence) return;

        // Target Parts
        // partIDに属する全レイヤーのElementを取得しておく
        if (!targetPartID) return;

        // v0.4.0: 未知の列挙値と fps 不在をここで正規化してから使う（F3 / F4 / 4.2）
        const sequenceType = resolveSequenceType(sequence);
        const triggerType = trigger ? resolveTriggerType(trigger) : null;
        const frameMs = 1000 / resolveFps(sprite);

        // v0.5.0 §6.1: keys と frames は排他。keys があればそちらを使う。
        const keys = Array.isArray(sequence.keys) && sequence.keys.length > 0 ? sequence.keys : null;
        const frames = keys ? keys.map(k => k.frame) : (sequence.frames ?? []);

        const runSequence = () => {
            // sequence.type: "ordered", "random_hold"
            if (sequenceType === 'ordered') {
                if (keys) playKeyedSequence(targetPartID, keys, triggerType === 'auto_loop');
                else playOrderedSequence(targetPartID, frames, frameMs, triggerType === 'auto_loop');
            } else if (sequenceType === 'random_hold') {
                const pick = frames[Math.floor(Math.random() * frames.length)];
                switchTexture(targetPartID, pick);
            }
        };

        // Trigger logic
        if (!trigger) return; // External only

        if (triggerType === 'auto_loop') {
            // すぐに開始してループ
            if (sequenceType === 'ordered') {
                if (keys) playKeyedSequence(targetPartID, keys, true);
                else playOrderedSequence(targetPartID, frames, frameMs, true);
            } else {
                // random_hold loop? not meaningful usually, basically static random
                runSequence();
            }
        } else if (triggerType === 'random_interval') {
            const scheduleNext = () => {
                if (!window.isAnimationRunning) return;
                const min = trigger.intervalMin || 1.0;
                const max = trigger.intervalMax || 5.0;
                const delay = (min + Math.random() * (max - min)) * 1000;

                const tm = setTimeout(() => {
                    runSequence();
                    scheduleNext();
                }, delay);
                window.timeouts.push(tm);
            };
            scheduleNext();
        }
    }

    function switchTexture(partID, textureID) {
        // partIDを持つ全レイヤーを探し、textureIDに一致するものだけ表示
        // v0.5.0 §2.2: 選ばれたフレーム識別子を持つレイヤーを *すべて* 表示する。
        // frameName の無いファイルでは 1 枚しか一致しないため従来と同じ挙動になる。
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        layers.forEach(el => {
            setLayerVisible(el, el.dataset.frameId === textureID);
        });
    }

    /**
     * v0.5.0 §6: 不等間隔のキー列を再生する。
     * 各キーの t（秒・再生開始からの絶対時刻）でフレームを切り替える。
     * 尺は最後のキーの t（§6.4）。
     */
    function playKeyedSequence(partID, keys, loop) {
        if (!Array.isArray(keys) || keys.length === 0) return;

        const start = () => {
            if (!window.isAnimationRunning) return;
            for (const k of keys) {
                const tm = setTimeout(() => {
                    if (!window.isAnimationRunning) return;
                    switchTexture(partID, k.frame);
                }, k.t * 1000);
                window.timeouts.push(tm);
            }
            if (loop) {
                const duration = keys[keys.length - 1].t * 1000;
                const tm = setTimeout(start, duration);
                window.timeouts.push(tm);
            }
        };
        start();
    }

    function playOrderedSequence(partID, frames, frameInterval, loop) {
        let idx = 0;

        function nextFrame() {
            if (!window.isAnimationRunning) return;
            if (idx >= frames.length) {
                if (loop) {
                    idx = 0;
                } else {
                    return; // End of sequence
                }
            }

            switchTexture(partID, frames[idx]);
            idx++;

            const tm = setTimeout(nextFrame, frameInterval);
            window.timeouts.push(tm);
        }
        nextFrame();
    }

    function toggleAnimation() {
        window.isAnimationRunning = !window.isAnimationRunning;
        const button = document.getElementById('toggleAnimationButton');
        if (button) {
            button.textContent = window.isAnimationRunning ? "アニメーション一時停止" : "アニメーション再開";
        }

        if (window.isAnimationRunning) {
            startAnimation();
        } else {
            window.animationIntervals.forEach(clearInterval);
            window.timeouts.forEach(clearTimeout);
            window.animationIntervals = [];
            window.timeouts = [];
        }
    }

    function resetAnimation() {
        window.isAnimationRunning = false;
        window.animationIntervals.forEach(clearInterval);
        window.timeouts.forEach(clearTimeout);
        window.animationIntervals = [];
        window.timeouts = [];

        const container = document.getElementById('layerContainer');
        if (container) {
            container.innerHTML = '';
        }
    }

})();
