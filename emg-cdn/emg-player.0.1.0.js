(async function() {
    // JSZip をCDNからロード
    const jsZipScript = document.createElement('script');
    jsZipScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js";
    document.head.appendChild(jsZipScript);

    jsZipScript.onload = function() {
        console.log("JSZip loaded");
        window.EMGPlayer = {
            load: loadEmgFromCDN
        };
    };

    async function loadEmgFromCDN(url, containerId = "layerContainer") {
        try {
            console.log(`Loading EMG from: ${url}`);
            const response = await fetch(url);
            const blob = await response.blob();

            const zip = new JSZip();
            const zipContent = await zip.loadAsync(blob);

            const jsonFile = Object.keys(zipContent.files).find(name => name.endsWith(".json"));
            const textureFile = Object.keys(zipContent.files).find(name => /\.(png|jpg|jpeg)$/i.test(name));

            if (!jsonFile || !textureFile) {
                console.error("EMGファイル内に JSON または テクスチャが見つかりません！");
                return;
            }

            const jsonText = await zipContent.files[jsonFile].async("text");
            const jsonData = JSON.parse(jsonText);
            const textureBlob = await zipContent.files[textureFile].async("blob");
            const texturePath = URL.createObjectURL(textureBlob);

            renderLayers(jsonData, texturePath, containerId);
            startAnimation(jsonData);
        } catch (error) {
            console.error("Failed to load EMG from CDN:", error);
        }
    }



function extractGroupSettings(templateGroups) {
    let groups = {};

    if (!templateGroups || !Array.isArray(templateGroups)) return groups;

    const groupData = templateGroups[0];
    for (let key in groupData) {
        let groupValue = groupData[key];
        if (Array.isArray(groupValue) && groupValue.length > 1) {
            groups[groupValue[0]] = groupValue[1] !== "false";
        } else if (typeof groupValue === "string") {
            groups[groupValue] = true;
        }
    }

    return groups;
}

function applyLayerStyles(element) {
    element.style.position = "absolute";
    element.style.backgroundRepeat = "no-repeat";
    element.style.backgroundSize = "cover";
    element.style.opacity = "1";
}

function renderLayers(texturePath) {
    const container = document.getElementById('layerContainer');
    container.innerHTML = '';

    let containerWidth = jsonData.baseCanvasWidth || 1920;
    let containerHeight = jsonData.baseCanvasHeight || 1080;
    container.style.width = `${containerWidth}px`;
    container.style.height = `${containerHeight}px`;

    // テクスチャ全体のサイズを取得
    const textureImage = new Image();
    textureImage.src = texturePath;
    textureImage.onload = () => {
        const textureWidth = textureImage.width;
        const textureHeight = textureImage.height;

        // レイヤーを生成
        layersData.forEach(layer => {
            const div = document.createElement('div');
            div.classList.add('layer');
            applyLayerStyles(div);
    
            // imgType に基づいて設定
            if (layer.imgType === 'Texture') {
                div.id = layer.textureID;
            } else if (layer.imgType === 'Sprite') {
                div.id = layer.assignID;
            }
    
            div.style.width = `${layer.width}px`;
            div.style.height = `${layer.height}px`;
            div.style.left = `${layer.basePosition_x}px`;
            div.style.top = `${layer.basePosition_y}px`;
            div.style.backgroundImage = `url('${texturePath}')`;
            div.style.backgroundPosition = `-${layer.x}px -${layer.y}px`;
            div.style.backgroundSize = `${jsonData.TextureNum[0].canvasWidth}px ${jsonData.TextureNum[0].canvasHeight}px`;
            div.style.zIndex = layer.textureZIndex || 0;
    
            container.appendChild(div);
        });
    };
}


function startAnimation() {
    if (!isAnimationRunning) return;

    layersData.forEach(layer => {
        if (layer.imgType === 'Sprite' && layer.animID) {
            // スプライトアニメーション開始
            animateSprite(layer);
        }
    });

    // グループ切り替え（Textureの場合）
    if (!animationInterval) {
        animationInterval = setInterval(() => {
            Object.keys(groupSettings).forEach(group => {
                if (groupSettings[group]) {
                    toggleGroupLayer(group);
                }
            });
        }, 500);
    }
}

// 🔹 Spriteアニメーション: FPSに基づいてフレームを切り替え
function animateSprite(layer) {
    const spriteConfig = jsonData.sprites[0][layer.animID]?.[0];
    if (!spriteConfig) {
        console.warn(`Sprite configuration not found for animID: ${layer.animID}`);
        return;
    }

    let frameIndex = 0;
    let isAnimationRunning = true;

    function updateFrame() {
        if (!isAnimationRunning) return;

        const frameAssignID = spriteConfig.useTex[frameIndex];
        const frameLayer = layersData.find(l => l.assignID === frameAssignID);

        if (frameLayer) {
            const element = document.getElementById(frameLayer.assignID);
            if (element) {
                // 現在のフレームを表示
                element.style.opacity = "1";

                // 他のフレームを非表示
                spriteConfig.useTex.forEach(assignID => {
                    if (assignID !== frameAssignID) {
                        const otherLayer = layersData.find(l => l.assignID === assignID);
                        if (otherLayer) {
                            const otherElement = document.getElementById(otherLayer.assignID);
                            if (otherElement) {
                                otherElement.style.opacity = "0";
                            }
                        }
                    }
                });
            }
        } else {
            console.warn(`Frame layer not found for assignID: ${frameAssignID}`);
        }

        // フレームの進行制御
        switch (spriteConfig.loop) {
            case 0: // ループなし
                frameIndex++;
                if (frameIndex >= spriteConfig.useTex.length) {
                    isAnimationRunning = false; // アニメーション終了
                    return;
                }
                break;

            case 1: // ループする
                frameIndex = (frameIndex + 1) % spriteConfig.useTex.length;
                break;

            case 2: // ランダム
                frameIndex = Math.floor(Math.random() * spriteConfig.useTex.length);
                break;

            case 3: // タイムラインを定義
                const timelineConfig = spriteConfig.timeline;
                if (timelineConfig && Array.isArray(timelineConfig)) {
                    frameIndex = timelineConfig[frameIndex] || 0; // 次のフレーム
                } else {
                    console.warn(`Timeline not defined for animID: ${layer.animID}`);
                    frameIndex = (frameIndex + 1) % spriteConfig.useTex.length;
                }
                break;

            default:
                console.warn(`Unknown loop type: ${spriteConfig.loop}`);
                frameIndex = (frameIndex + 1) % spriteConfig.useTex.length;
                break;
        }

        // 次のフレームを設定
        setTimeout(updateFrame, 1000 / spriteConfig.fps);
    }

    updateFrame();
}





function toggleGroupLayer(group) {
    const groupLayers = layersData.filter(layer => layer.group === group && layer.imgType === 'Texture');
    if (groupLayers.length < 2) {
        console.warn(`Not enough layers found for group: ${group}`);
        return;
    }

    groupLayers.forEach(layer => {
        const element = document.getElementById(layer.textureID);
        if (element) element.style.opacity = "0";
    });

    const randomLayer = groupLayers[Math.floor(Math.random() * groupLayers.length)];
    const randomElement = document.getElementById(randomLayer.textureID);
    if (randomElement) randomElement.style.opacity = "1";
}

function toggleAnimation() {
    isAnimationRunning = !isAnimationRunning;
    document.getElementById('toggleAnimationButton').textContent = isAnimationRunning ? "アニメーション一時停止" : "アニメーション再開";

    if (isAnimationRunning) {
        startAnimation();
    } else {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

function resetAnimation() {
    clearInterval(animationInterval);
    animationInterval = null;
    isAnimationRunning = false;
    document.getElementById('toggleAnimationButton').textContent = "アニメーション再開";
    const container = document.getElementById('layerContainer');
    container.innerHTML = '';
}
})();