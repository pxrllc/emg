(function() {
    // グローバル変数の定義
    window.jsonData = null;
    window.layersData = [];
    window.isAnimationRunning = true;
    window.animationInterval = null;
    window.groupSettings = {};

    // JSZip をCDNからロード
    const jsZipScript = document.createElement('script');
    jsZipScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js";
    document.head.appendChild(jsZipScript);

    jsZipScript.onload = function() {
        console.log("JSZip loaded");
        
        // 公開関数
        window.EMGPlayer = {
            loadEmgFromCDN: loadEmgFromCDN,
            toggleAnimation: toggleAnimation,
            resetAnimation: resetAnimation
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
            window.jsonData = JSON.parse(jsonText);
            window.layersData = window.jsonData.layers || [];
            window.groupSettings = extractGroupSettings(window.jsonData.templateGroups);

            const textureBlob = await zipContent.files[textureFile].async("blob");
            const texturePath = URL.createObjectURL(textureBlob);

            renderLayers(window.jsonData, texturePath, containerId);
            startAnimation();
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

    function renderLayers(jsonData, texturePath) {
        const container = document.getElementById('layerContainer');
        if (!container) {
            console.error('Container element not found');
            return;
        }
        container.innerHTML = '';

        let containerWidth = jsonData.baseCanvasWidth || 1920;
        let containerHeight = jsonData.baseCanvasHeight || 1080;
        container.style.width = `${containerWidth}px`;
        container.style.height = `${containerHeight}px`;

        const textureImage = new Image();
        textureImage.src = texturePath;
        textureImage.onload = () => {
            window.layersData.forEach(layer => {
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
                div.style.backgroundImage = `url('${texturePath}')`;
                div.style.backgroundPosition = `-${layer.x}px -${layer.y}px`;
                div.style.backgroundSize = `${jsonData.TextureNum[0].canvasWidth}px ${jsonData.TextureNum[0].canvasHeight}px`;
                div.style.zIndex = layer.textureZIndex || 0;
                
                container.appendChild(div);
            });
        };
    }

    function startAnimation() {
        if (!window.isAnimationRunning) return;

        window.layersData.forEach(layer => {
            if (layer.imgType === 'Sprite' && layer.animID) {
                animateSprite(layer);
            }
        });

        if (!window.animationInterval) {
            window.animationInterval = setInterval(() => {
                Object.keys(window.groupSettings).forEach(group => {
                    if (window.groupSettings[group]) {
                        toggleGroupLayer(group);
                    }
                });
            }, 500);
        }
    }

    function animateSprite(layer) {
        const spriteConfig = window.jsonData.sprites?.[0]?.[layer.animID]?.[0];
        if (!spriteConfig) {
            console.warn(`Sprite configuration not found for animID: ${layer.animID}`);
            return;
        }

        let frameIndex = 0;
        let localAnimationRunning = true;

        function updateFrame() {
            if (!localAnimationRunning) return;

            const frameAssignID = spriteConfig.useTex[frameIndex];
            const frameLayer = window.layersData.find(l => l.assignID === frameAssignID);

            if (frameLayer) {
                const element = document.getElementById(frameLayer.assignID);
                if (element) {
                    element.style.opacity = "1";

                    spriteConfig.useTex.forEach(assignID => {
                        if (assignID !== frameAssignID) {
                            const otherElement = document.getElementById(assignID);
                            if (otherElement) {
                                otherElement.style.opacity = "0";
                            }
                        }
                    });
                }
            }

            switch (spriteConfig.loop) {
                case 0: // ループなし
                    frameIndex++;
                    if (frameIndex >= spriteConfig.useTex.length) {
                        localAnimationRunning = false;
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
                        frameIndex = timelineConfig[frameIndex] || 0;
                    } else {
                        frameIndex = (frameIndex + 1) % spriteConfig.useTex.length;
                    }
                    break;
                default:
                    frameIndex = (frameIndex + 1) % spriteConfig.useTex.length;
                    break;
            }

            setTimeout(updateFrame, 1000 / spriteConfig.fps);
        }

        updateFrame();
    }

    function toggleGroupLayer(group) {
        const groupLayers = window.layersData.filter(layer => 
            layer.group === group && layer.imgType === 'Texture'
        );
        
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
        window.isAnimationRunning = !window.isAnimationRunning;
        const button = document.getElementById('toggleAnimationButton');
        if (button) {
            button.textContent = window.isAnimationRunning ? "アニメーション一時停止" : "アニメーション再開";
        }

        if (window.isAnimationRunning) {
            startAnimation();
        } else {
            clearInterval(window.animationInterval);
            window.animationInterval = null;
        }
    }

    function resetAnimation() {
        clearInterval(window.animationInterval);
        window.animationInterval = null;
        window.isAnimationRunning = false;
        const button = document.getElementById('toggleAnimationButton');
        if (button) {
            button.textContent = "アニメーション再開";
        }
        const container = document.getElementById('layerContainer');
        if (container) {
            container.innerHTML = '';
        }
    }
})();