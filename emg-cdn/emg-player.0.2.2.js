(function () {
    // グローバル変数の定義
    window.jsonData = null;
    window.emgVersion = null;
    window.isAnimationRunning = true;
    window.animationIntervals = []; // 複数のタイマー管理用
    window.timeouts = [];

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
            resetAnimation: resetAnimation
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
                Object.keys(zipContent.files).find(name => name.endsWith(".json"));

            if (!jsonFile) {
                console.error("EMGファイル内に JSON が見つかりません！");
                return;
            }

            const jsonText = await zipContent.files[jsonFile].async("text");
            window.jsonData = JSON.parse(jsonText);
            window.emgVersion = window.jsonData.version || "0.1.0";

            console.log(`EMG Version: ${window.emgVersion}`);

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
