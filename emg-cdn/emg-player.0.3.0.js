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
            setExpression: applyExpression
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

    function applyLayerStyles(element) {
        element.style.position = "absolute";
        element.style.backgroundRepeat = "no-repeat";
        element.style.backgroundSize = "cover"; // あるいはピクセル指定
        element.style.opacity = "1";
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
                // パーツコンテナを作成（必要に応じて）
                // レイヤーを展開
                part.layers.forEach(layer => {
                    const div = document.createElement('div');
                    div.classList.add('layer');
                    div.dataset.partId = part.partID;
                    div.dataset.type = part.type;
                    div.id = layer.textureID; // ユニークIDとして使用

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

                    // type: switch の場合、default でないものは非表示
                    if (part.type === 'switch') {
                        if (layer.textureID === part.default) {
                            div.style.opacity = '1';
                        } else {
                            // display: none だとレイアウト崩れの恐れはないが（absoluteなので）、opacity制御の方がフェード等しやすい
                            div.style.opacity = '0';
                        }
                    }

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
            part.type === 'switch' &&
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

        // parts: partID -> 表示するレイヤーIDの配列
        if (expr.parts) {
            Object.entries(expr.parts).forEach(([partID, layerIDs]) => {
                if (!Array.isArray(layerIDs) || layerIDs.length === 0) return;
                const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
                layers.forEach(el => {
                    el.style.opacity = layerIDs.includes(el.id) ? '1' : '0';
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
                const el = document.getElementById(layerID);
                if (el && el.dataset.partId) {
                    switchTexture(el.dataset.partId, layerID);
                }
            });
        }

        // この表情専用の blink / lipSync 差し替え
        mappingState.activeBlinkOverride = expr.overrides?.blink || null;
        mappingState.activeLipSyncOverride = expr.overrides?.lipSync || null;
    }

    function setPartVisible(partID, visible) {
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        layers.forEach(el => {
            el.style.opacity = visible ? '1' : '0';
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

        if (window.jsonData.sprites) {
            window.jsonData.sprites.forEach(sprite => {
                // mapping.json との共存ルール: 明示的に blink/lipSync 対象指定されたパーツは
                // sprites[] 側の自律発火を行ってはならない (MUST NOT trigger)
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
        const { spriteID, targetPartID, sequence, trigger, fps } = sprite;
        if (!sequence) return; // v0.1.0 format not supported in this block for now

        // Target Parts
        // partIDに属する全レイヤーのElementを取得しておく
        if (!targetPartID) return;

        // animation step function
        const frameMs = 1000 / (fps || 12);

        const runSequence = () => {
            // sequence.type: "ordered", "random_hold"
            if (sequence.type === 'ordered') {
                playOrderedSequence(targetPartID, sequence.frames, frameMs, trigger ? trigger.type === 'auto_loop' : false);
            } else if (sequence.type === 'random_hold') {
                const pick = sequence.frames[Math.floor(Math.random() * sequence.frames.length)];
                switchTexture(targetPartID, pick);
            }
        };

        // Trigger logic
        if (!trigger) return; // External only

        if (trigger.type === 'auto_loop') {
            // すぐに開始してループ
            if (sequence.type === 'ordered') {
                playOrderedSequence(targetPartID, sequence.frames, frameMs, true);
            } else {
                // random_hold loop? not meaningful usually, basically static random
                runSequence();
            }
        } else if (trigger.type === 'random_interval') {
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
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        layers.forEach(el => {
            if (el.id === textureID) {
                el.style.opacity = '1';
                // el.style.display = 'block';
            } else {
                el.style.opacity = '0';
                // el.style.display = 'none';
            }
        });
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
