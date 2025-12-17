import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import type { EMGLiteState, EMGModelDefinition } from './emg-lite/types';
import { INITIAL_EMG_LITE_STATE, INITIAL_MODEL_DEFINITION } from './emg-lite/types';
import { AudioHandler } from './audio-handler';

type StateChangeListener = (state: EMGLiteState) => void;


export class Editor {
    private state: EMGLiteState;
    public modelDef: EMGModelDefinition; // Added for external access
    private listeners: StateChangeListener[] = [];

    // Public Hooks for Main
    public onImageLoad: (url: string) => void = () => { };
    public onBlink: (closed: boolean) => void = () => { };
    public onBlobUpdate: (map: Record<string, string>) => void = () => { };
    public onModelUpdate: (def: EMGModelDefinition) => void = () => { };

    // Internal State
    private currentModelName: string = 'avatar';
    private blobAssets: Record<string, string> = {};
    private audioHandler: AudioHandler;
    private micEnabled: boolean = false;
    private micThreshold: number = 0.1;

    // Preview State
    private previewInterval: number | undefined;
    private blinkInterval: number | undefined;
    private talkingInterval: number | undefined;
    private demoSpeakingTarget: boolean = false;

    // UI Elements
    private emotionInput: HTMLInputElement;
    private activityInput: HTMLInputElement;
    private speakingCheckbox: HTMLInputElement;
    private intensityRange: HTMLInputElement;
    private intensityValDisplay: HTMLElement;

    // Audio UI
    private audioDeviceSelect: HTMLSelectElement;
    private micEnableCheckbox: HTMLInputElement;
    private micThresholdInput: HTMLInputElement;
    private micLevelBar: HTMLElement;

    // Model Config UI
    private previewBtn?: HTMLButtonElement;
    private modelJsonPreview?: HTMLTextAreaElement;
    private assetsRootInput?: HTMLInputElement; // New input

    constructor() {
        this.state = { ...INITIAL_EMG_LITE_STATE };
        // Deep clone to ensure independent instance
        this.modelDef = JSON.parse(JSON.stringify(INITIAL_MODEL_DEFINITION));
        this.audioHandler = new AudioHandler();

        // Bind UI
        this.emotionInput = document.getElementById('emotion') as HTMLInputElement;
        this.activityInput = document.getElementById('activity') as HTMLInputElement;
        this.speakingCheckbox = document.getElementById('speaking') as HTMLInputElement;
        this.intensityRange = document.getElementById('intensity') as HTMLInputElement;
        this.intensityValDisplay = document.getElementById('intensity-val') as HTMLElement;

        // Bind Audio UI
        this.audioDeviceSelect = document.getElementById('audio-device') as HTMLSelectElement;
        this.micEnableCheckbox = document.getElementById('mic-enable') as HTMLInputElement;
        this.micThresholdInput = document.getElementById('mic-threshold') as HTMLInputElement;
        this.micLevelBar = document.getElementById('mic-level') as HTMLElement;

        // Init Audio Events
        this.populateAudioDevices();

        if (this.micEnableCheckbox) {
            this.micEnableCheckbox.addEventListener('change', () => this.toggleMic());
        }

        if (this.micThresholdInput) {
            this.micThresholdInput.addEventListener('input', () => {
                this.micThreshold = parseFloat(this.micThresholdInput.value);
                const disp = document.getElementById('mic-threshold-val');
                if (disp) disp.textContent = this.micThreshold.toFixed(2);
            });
        }

        // Populate devices on mouseover (in case permissions changed)
        this.audioDeviceSelect.addEventListener('mouseenter', () => this.populateAudioDevices());


        // Bind Assets Root
        this.assetsRootInput = document.getElementById('assets-root') as HTMLInputElement;
        if (this.assetsRootInput) {
            this.assetsRootInput.value = this.modelDef.assetsRoot || "./";
            this.assetsRootInput.addEventListener('input', () => {
                this.modelDef.assetsRoot = this.assetsRootInput!.value;
                this.updateJSONPreviews();
                if (this.onModelUpdate) this.onModelUpdate(this.modelDef);
            });
        }


        // Bind List UI
        const addMappingBtn = document.getElementById('add-mapping-btn');
        addMappingBtn?.addEventListener('click', () => {
            console.log('[UI] Add Status button clicked');
            // Add current selection as new mapping
            // Add current selection as new mapping
            let key = `${this.state.activity}.${this.state.emotion}`;

            // Auto-generate unique name if exists
            if (this.modelDef.mapping[key]) {
                let counter = 1;
                while (this.modelDef.mapping[`${key} (${counter})`]) {
                    counter++;
                }
                key = `${key} (${counter})`;
            }

            this.modelDef.mapping[key] = {};
            this.onModelUpdate(this.modelDef);
            this.renderMappingList();
            this.updateJSONPreviews();

            // Scroll to bottom
            setTimeout(() => {
                const container = document.getElementById('mapping-list-container');
                if (container) container.scrollTop = container.scrollHeight;
            }, 50);

            console.log(`[UI] Added new status: ${key}`);
        });

        // Bind Status Selector
        const statusSelect = document.getElementById('status-selector') as HTMLSelectElement;

        statusSelect?.addEventListener('change', () => {
            const key = statusSelect.value;
            if (!key) return;

            const parts = key.split('.');
            if (parts.length >= 2) {
                this.state.activity = parts[0];
                this.state.emotion = parts[1];
                this.updateUI();
                this.notify();
            }
        });

        // Bind Set Model Button (Renamed from Use Model)
        const setModelBtn = document.getElementById('set-model-btn') as HTMLButtonElement;
        setModelBtn?.addEventListener('click', () => {
            // Toggle Logic
            setModelBtn.classList.toggle('active');
            const isActive = setModelBtn.classList.contains('active');
            setModelBtn.textContent = isActive ? 'Stop Setting Model' : 'Set Model';

            if (isActive) {
                setModelBtn.classList.remove('primary-btn');
                setModelBtn.classList.add('destructive-btn');
                this.startModelBehavior();
            } else {
                setModelBtn.classList.add('primary-btn');
                setModelBtn.classList.remove('destructive-btn');
                this.stopModelBehavior();
            }
        });

        // Bind Load Model (Sidebar)
        const loadModelBtn = document.getElementById('load-model-sidebar-btn');
        const loadModelInput = document.getElementById('load-model-input') as HTMLInputElement;
        loadModelBtn?.addEventListener('click', () => {
            loadModelInput?.click();
        });

        loadModelInput?.addEventListener('change', async (e) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (file) {
                // Check extension
                const isZip = file.name.endsWith('.zip') || file.name.endsWith('.emgl');

                if (isZip) {
                    // ZIP Loading
                    try {
                        const JSZip = (await import('jszip')).default;
                        const zip = new JSZip();
                        const loadedZip = await zip.loadAsync(file);

                        // Find JSON in root
                        let jsonFile: any = null;
                        for (const [path, entry] of Object.entries(loadedZip.files)) {
                            // Check for root JSON (no directory separators or simple structure)
                            if (path.endsWith('.json') && !path.includes('/') && !entry.dir) {
                                jsonFile = entry;
                                break;
                            }
                        }

                        if (!jsonFile) throw new Error('No root JSON file found in .emgl archive');

                        // Parse JSON
                        const jsonStr = await jsonFile.async('string');
                        const json = JSON.parse(jsonStr);

                        if (!json.mapping || typeof json.mapping !== 'object') {
                            throw new Error('Missing "mapping" object in JSON');
                        }

                        // Load all images as Blobs
                        const newBlobs: Record<string, string> = {};
                        for (const [path, entry] of Object.entries(loadedZip.files)) {
                            if (!entry.dir && (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg'))) {
                                const blob = await entry.async('blob');
                                const url = URL.createObjectURL(blob);
                                const filename = path.split('/').pop() || path;
                                newBlobs[filename] = url;
                            }
                        }

                        this.blobAssets = newBlobs;
                        this.onBlobUpdate?.(this.blobAssets); // Pass to Viewer

                        this.modelDef = json;
                        // Adjust assetsRoot if strictly specified to specific logic?
                        // Readme says: "JSON specified directory or same hierarchy"
                        // If JSON assetsRoot is "./", images in ZIP "something.png" (root) will be resolved as "./something.png".
                        // PngAdapter resolves "./something.png" as "something.png" in blob map? 
                        // Check PngAdapter: 
                        // "const filename = path.split('/').pop() || path;" -> Key for blobMap.
                        // This ignores directory structure in Blob Map lookup!
                        // WARNING: This implementation assumes flat filename uniqueness!
                        // If ZIP has "a/img.png" and "b/img.png", Blob Map key "img.png" will collide.
                        // But PngAdapter (Step 282) logic: "const filename = path.split('/').pop() || path;" 
                        // confirms it uses only filename. This is a limitation of current Viewer/Adapter.
                        // However, for .emgl (ZIP), let's stick to this as it covers most cases.

                        if (!this.modelDef.assetsRoot) this.modelDef.assetsRoot = '/assets';
                        this.onModelUpdate(this.modelDef);
                        this.updateUI();
                        alert(`Model loaded successfully from ${file.name} (ZIP/EMGL)`);

                    } catch (err) {
                        console.error(err);
                        alert('Failed to load EMGL/ZIP: ' + (err instanceof Error ? err.message : String(err)));
                    }
                    target.value = '';
                } else {
                    // Legacy JSON Loading
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        try {
                            const json = JSON.parse(ev.target?.result as string);
                            if (!json.mapping || typeof json.mapping !== 'object') {
                                throw new Error('Missing "mapping" object in JSON');
                            }
                            this.modelDef = json;
                            if (!this.modelDef.assetsRoot) this.modelDef.assetsRoot = '/assets';
                            this.onModelUpdate(this.modelDef);
                            this.updateUI();
                            alert(`Model loaded successfully from ${file.name}`);
                        } catch (err) {
                            console.error(err);
                            alert('Invalid Model File: ' + (err instanceof Error ? err.message : 'Unknown error'));
                        }
                        target.value = '';
                    };
                    reader.readAsText(file);
                }
            }
        });

        // Bind Demo Mode
        const demoBtn = document.getElementById('demo-mode-btn') as HTMLButtonElement;
        demoBtn?.addEventListener('click', () => {
            if (this.previewInterval) {
                // Stop
                clearInterval(this.previewInterval);
                clearTimeout(this.blinkInterval);
                this.previewInterval = undefined;
                this.blinkInterval = undefined;
                demoBtn.textContent = 'Demo Mode';
                demoBtn.classList.remove('destructive-btn'); // assuming style
                demoBtn.classList.add('secondary-btn');
                this.triggerBlink(false);
            } else {
                // Start
                demoBtn.textContent = 'Stop Demo';
                demoBtn.classList.remove('secondary-btn');
                demoBtn.classList.add('destructive-btn'); // Use destructive style for stop

                const allKeys = Object.keys(this.modelDef.mapping);
                this.previewInterval = window.setInterval(() => {
                    if (allKeys.length > 0) {
                        const rnd = Math.floor(Math.random() * allKeys.length);
                        const key = allKeys[rnd];
                        const parts = key.split('.');
                        if (parts.length >= 2) {
                            this.state.activity = parts[0];
                            this.state.emotion = parts[1];
                            this.updateUI();
                            this.notify();
                        }
                    }
                }, 2000);

                const runBlink = () => {
                    const duration = 150 + Math.random() * 100;
                    this.triggerBlink(true);
                    setTimeout(() => {
                        this.triggerBlink(false);
                        if (this.previewInterval) {
                            const next = 2000 + Math.random() * 3000;
                            this.blinkInterval = window.setTimeout(runBlink, next);
                        }
                    }, duration);
                };
                runBlink();
            }
        });

        // Initial Render
        this.renderMappingList();

        // Bind Export EMGL
        const exportEmglBtn = document.getElementById('export-emgl-btn');
        exportEmglBtn?.addEventListener('click', async () => {
            try {
                console.log('[Export] Starting .emgl export...');
                // 1. Gather Assets
                // Static import handling or dynamic import fallback
                const JSZipModule = await import('jszip');
                // Handle different import structures (ESM vs CommonJS)
                const JSZip = JSZipModule.default || JSZipModule;
                const zip = new JSZip();

                // Clone Definition to modify paths
                const exportDef = JSON.parse(JSON.stringify(this.modelDef)) as EMGModelDefinition;
                exportDef.assetsRoot = './'; // Set root to relative for ZIP portability

                const assetsFolder = zip.folder("assets");
                const processedFiles = new Set<string>();

                // Helper to process a path
                const processAsset = async (path: string): Promise<string> => {
                    const filename = path.split('/').pop() || path;

                    // If we haven't processed this filename yet
                    if (!processedFiles.has(filename)) {
                        let blob: Blob | null = null;

                        // Check Blob Map (Local File)
                        if (this.blobAssets[filename]) {
                            const resp = await fetch(this.blobAssets[filename]);
                            blob = await resp.blob();
                        }
                        // Check Remote/Path
                        else {
                            try {
                                // Resolve path against current assetsRoot if valid
                                let fetchPath = path;
                                if (this.modelDef.assetsRoot && !path.startsWith('http') && !path.startsWith('/')) {
                                    // Simple join, assuming assetsRoot doesn't end with / usually, but handle it
                                    const root = this.modelDef.assetsRoot.endsWith('/')
                                        ? this.modelDef.assetsRoot
                                        : this.modelDef.assetsRoot + '/';
                                    fetchPath = root + path;
                                } else if (path.startsWith('/')) {
                                    // Absolute path from server root (e.g. /assets/foo.png)
                                    fetchPath = path;
                                }

                                const resp = await fetch(fetchPath);
                                if (!resp.ok) throw new Error(`Failed to fetch ${fetchPath}`);
                                blob = await resp.blob();
                            } catch (e) {
                                console.warn(`Could not include asset ${path} in ZIP`, e);
                            }
                        }

                        if (blob && assetsFolder) {
                            assetsFolder.file(filename, blob);
                            processedFiles.add(filename);
                        }
                    }
                    return `assets/${filename}`;
                };

                // 2. Iterate and Update Paths
                for (const key in exportDef.mapping) {
                    const map = exportDef.mapping[key];
                    if (map.base) map.base = await processAsset(map.base);
                    if (map.mouthOpen) map.mouthOpen = await processAsset(map.mouthOpen);
                    if (map.mouthClosed) map.mouthClosed = await processAsset(map.mouthClosed);
                    if (map.eyesClosed) map.eyesClosed = await processAsset(map.eyesClosed);
                    if (map.mouthOpenEyesClosed) map.mouthOpenEyesClosed = await processAsset(map.mouthOpenEyesClosed);
                }

                // 3. Add model.json
                zip.file("model.json", JSON.stringify(exportDef, null, 2));

                // 4. Generate and Download
                console.log('[Export] Generating ZIP...');
                const content = await zip.generateAsync({ type: "blob" });

                // Use FileSaver if available, or robust fallback
                const filename = `${this.currentModelName}.emgl`;
                console.log(`[Export] Saving as ${filename} (${content.size} bytes)`);

                // Strict FileSaver usage
                console.log(`[Export] Saving as ${filename} (${content.size} bytes)`);
                alert(`Exporting: ${filename} / Size: ${content.size}`);

                // @ts-ignore
                if (typeof saveAs === 'undefined') {
                    alert('CRITICAL: saveAs is undefined!');
                    console.error('saveAs is undefined');
                } else {
                    saveAs(content, filename);
                    console.log('[Export] Save initiated.');
                }

                // alert('Exported .emgl successfully!');

            } catch (err) {
                console.error('Export Failed:', err);
                alert('Export Failed: ' + err);
            }
        });

        // Attach all other events (Load, Save, etc.)
        this.attachEvents();
    }

    public subscribe(listener: StateChangeListener) {
        this.listeners.push(listener);
    }

    public getState(): EMGLiteState {
        return { ...this.state };
    }

    public getModelDefinition(): EMGModelDefinition {
        return this.modelDef;
    }

    private renderMappingList() {
        const container = document.getElementById('mapping-list-container');
        if (!container) return;
        container.innerHTML = '';

        const keys = Object.keys(this.modelDef.mapping).sort();
        if (keys.length === 0) {
            container.innerHTML = `
            <p style="color: #666; font-size: 0.8em; text-align: center; padding: 20px;">
                No statuses defined.<br>Select Activity/Emotion above and click "+ Add Status".
            </p>`;
            return;
        }

        keys.forEach(key => {
            const map = this.modelDef.mapping[key];
            const card = document.createElement('div');
            card.className = 'mapping-card';

            // Header
            const header = document.createElement('div');
            header.className = 'card-header';

            // Editable Title (Rename)
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.className = 'card-title-input';
            titleInput.value = key;
            titleInput.title = 'Edit Status Name';

            // Rename Logic
            titleInput.onchange = () => {
                const newKey = titleInput.value.trim();
                if (newKey && newKey !== key) {
                    if (this.modelDef.mapping[newKey]) {
                        alert(`Status "${newKey}" already exists.`);
                        titleInput.value = key; // Revert
                    } else {
                        // Rename: Copy data, delete old
                        this.modelDef.mapping[newKey] = this.modelDef.mapping[key];
                        delete this.modelDef.mapping[key];
                        this.onModelUpdate(this.modelDef);
                        this.renderMappingList();
                    }
                }
            };
            titleInput.onclick = (e) => e.stopPropagation(); // Prevent card preview click

            // Wrapper for buttons
            const btnWrap = document.createElement('div');
            btnWrap.style.display = 'flex';
            btnWrap.style.gap = '8px';

            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn';
            delBtn.innerHTML = '×';
            delBtn.title = 'Remove Status';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Remove status "${key}"?`)) {
                    delete this.modelDef.mapping[key];
                    this.onModelUpdate(this.modelDef);
                    this.renderMappingList();
                }
            };

            header.appendChild(titleInput);

            // Flags
            const flagsDiv = document.createElement('div');
            flagsDiv.style.display = 'flex';
            flagsDiv.style.gap = '8px';
            flagsDiv.style.alignItems = 'center';
            flagsDiv.style.marginLeft = 'auto'; // Push to right
            flagsDiv.style.marginRight = '8px';
            flagsDiv.style.fontSize = '0.7em';

            const createFlag = (label: string, id: 'autoBlink' | 'lipSync') => {
                const labelEl = document.createElement('label');
                labelEl.style.display = 'flex';
                labelEl.style.alignItems = 'center';
                labelEl.style.gap = '4px';
                labelEl.style.cursor = 'pointer';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = !!map[id];
                cb.onchange = () => {
                    this.modelDef.mapping[key][id] = cb.checked;
                    this.onModelUpdate(this.modelDef);
                };
                cb.onclick = (e) => e.stopPropagation();

                labelEl.appendChild(cb);
                labelEl.appendChild(document.createTextNode(label));
                labelEl.onclick = (e) => e.stopPropagation();
                return labelEl;
            };

            flagsDiv.appendChild(createFlag('Blink', 'autoBlink'));
            flagsDiv.appendChild(createFlag('LipSync', 'lipSync'));

            header.appendChild(flagsDiv);
            header.appendChild(delBtn);
            card.appendChild(header);

            // Preview Click on Card (Except inputs)
            card.onclick = (e) => {
                // If not clicking an input
                if ((e.target as HTMLElement).tagName !== 'INPUT') {
                    // Update State to match this card
                    // Try to parse 'activity.emotion'
                    const parts = key.split('.');
                    if (parts.length >= 2) {
                        this.state.activity = parts[0];
                        this.state.emotion = parts[1];
                        this.updateUI(); // Updates top inputs
                        this.notify(); // Updates Viewer
                    }
                }
            };
            card.title = "Click background to Preview";

            // 5-Slot Grid
            const grid = document.createElement('div');
            grid.className = 'asset-grid-5';

            // Defs for loop (Task 41: Updated 5-Slot Set)
            const slots = [
                { id: 'base', label: 'Base', val: map.base },
                { id: 'mouthOpen', label: 'Mouth Open', val: map.mouthOpen },
                { id: 'mouthClosed', label: 'Mouth Closed', val: map.mouthClosed },
                { id: 'eyesClosed', label: 'Eyes Closed (Mouth Closed)', val: map.eyesClosed }, // Originally eyesClosed usually implies mouth closed
                { id: 'mouthOpenEyesClosed', label: 'Eyes Closed (Mouth Open)', val: map.mouthOpenEyesClosed },
            ];

            slots.forEach(slotInfo => {
                const slotDiv = document.createElement('div');
                slotDiv.className = 'asset-slot-visual small';
                slotDiv.title = `Click to set ${slotInfo.label}`;

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'image/*';
                fileInput.className = 'hidden';

                const label = document.createElement('div');
                label.className = 'slot-label';
                label.style.display = 'flex';
                label.style.justifyContent = 'space-between';
                label.style.width = '100%';

                const labelText = document.createElement('span');
                labelText.textContent = slotInfo.label;

                const clearBtn = document.createElement('span');
                clearBtn.innerHTML = '&times;';
                clearBtn.title = 'Clear Image';
                clearBtn.style.cursor = 'pointer';
                clearBtn.style.color = '#ff6666';
                clearBtn.style.fontWeight = 'bold';
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    // Clear logic
                    // @ts-ignore
                    delete this.modelDef.mapping[key][slotInfo.id];
                    this.onModelUpdate(this.modelDef);
                    // UI Update
                    textInput.value = '';
                    preview.src = '';
                    preview.classList.add('hidden');
                    placeholder.classList.remove('hidden');
                };

                label.appendChild(labelText);
                label.appendChild(clearBtn);

                const preview = document.createElement('img');
                preview.className = 'slot-preview';
                // Resolve preview if we have blob or it's a path
                if (slotInfo.val) {
                    const filename = slotInfo.val.split('/').pop() || slotInfo.val;
                    if (this.blobAssets[filename]) {
                        preview.src = this.blobAssets[filename];
                    } else if (slotInfo.val.startsWith('/')) {
                        // absolute server path
                        preview.src = slotInfo.val;
                    } else {
                        // relative to assets root
                        preview.src = `${this.modelDef.assetsRoot}/${slotInfo.val}`;
                    }
                } else {
                    preview.classList.add('hidden');
                }

                const placeholder = document.createElement('div');
                placeholder.className = 'slot-placeholder';
                placeholder.textContent = '+';
                if (!preview.classList.contains('hidden')) placeholder.classList.add('hidden');

                const textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.className = 'slot-filename';
                textInput.placeholder = 'file.png';
                textInput.value = slotInfo.val || '';

                // Events
                slotDiv.onclick = (e) => {
                    if (e.target !== textInput) fileInput.click();
                    e.stopPropagation(); // Prevent card preview click
                };

                fileInput.onchange = (e: any) => {
                    const file = e.target.files?.[0];
                    if (file) {
                        const url = URL.createObjectURL(file);
                        this.blobAssets[file.name] = url;
                        this.onBlobUpdate(this.blobAssets); // Update viewer immediately

                        // Update Model
                        // @ts-ignore
                        this.modelDef.mapping[key][slotInfo.id] = file.name;

                        // Update UI local
                        textInput.value = file.name;
                        preview.src = url;
                        preview.classList.remove('hidden');
                        placeholder.classList.add('hidden');

                        this.onModelUpdate(this.modelDef);
                        this.updateJSONPreviews();
                    }
                };

                textInput.onchange = () => {
                    const val = textInput.value;
                    // @ts-ignore
                    if (val) this.modelDef.mapping[key][slotInfo.id] = val;
                    // @ts-ignore
                    else delete this.modelDef.mapping[key][slotInfo.id];

                    this.onModelUpdate(this.modelDef);
                    this.updateJSONPreviews();
                };
                textInput.onclick = (e) => e.stopPropagation();

                const configDiv = document.createElement('div');
                configDiv.style.marginTop = '4px';
                configDiv.style.fontSize = '0.7em';
                configDiv.style.color = '#ccc';
                configDiv.style.display = 'flex';
                configDiv.style.gap = '8px';

                // Helper for checkbox
                const createConfigCb = (label: string, prop: 'useForBlink' | 'useForLipSync') => {
                    const lbl = document.createElement('label');
                    lbl.style.display = 'flex';
                    lbl.style.alignItems = 'center';
                    lbl.style.gap = '3px';
                    lbl.style.cursor = 'pointer';

                    const cb = document.createElement('input');
                    cb.type = 'checkbox';

                    // Default to true if undefined
                    const currentConfig = map.imageConfig?.[slotInfo.id];
                    cb.checked = currentConfig ? !!currentConfig[prop] : true;

                    cb.onchange = (e) => {
                        e.stopPropagation();
                        if (!this.modelDef.mapping[key].imageConfig) {
                            this.modelDef.mapping[key].imageConfig = {};
                        }
                        if (!this.modelDef.mapping[key].imageConfig![slotInfo.id]) {
                            this.modelDef.mapping[key].imageConfig![slotInfo.id] = { useForBlink: true, useForLipSync: true };
                        }
                        this.modelDef.mapping[key].imageConfig![slotInfo.id][prop] = cb.checked;
                        this.onModelUpdate(this.modelDef);
                    };
                    cb.onclick = e => e.stopPropagation();

                    lbl.appendChild(cb);
                    lbl.appendChild(document.createTextNode(label));
                    lbl.onclick = e => e.stopPropagation();
                    return lbl;
                };

                configDiv.appendChild(createConfigCb('Blink', 'useForBlink'));
                configDiv.appendChild(createConfigCb('LipSync', 'useForLipSync'));

                slotDiv.appendChild(label);
                slotDiv.appendChild(preview);
                slotDiv.appendChild(placeholder);
                slotDiv.appendChild(fileInput);
                slotDiv.appendChild(textInput);
                slotDiv.appendChild(configDiv); // Add checkboxes
                grid.appendChild(slotDiv);
            });

            card.appendChild(grid);
            container.appendChild(card);
        });

        this.populateStatusSelector();
    }

    private populateStatusSelector() {
        const select = document.getElementById('status-selector') as HTMLSelectElement;
        if (!select) return;

        // Keep current selection if possible
        const currentVal = select.value;
        select.innerHTML = '<option value="">(Select Status)</option>';

        const keys = Object.keys(this.modelDef.mapping).sort();
        keys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            if (key === `${this.state.activity}.${this.state.emotion}`) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // If the calculated current state matches nothing, maybe revert to old value?
        // But the loop above sets selected based on state.
    }

    // Task 35 Behavior Implementation
    private isRunningModel = false;
    private behaviorFrameId: number | undefined;
    private lastBlinkToggle = 0;
    private nextBlinkDuration = 0;
    private isEyeClosed = false;
    private audioMonitor: AudioMonitor | undefined;

    private async startModelBehavior() {
        console.log('Model Behavior Started');
        this.isRunningModel = true;

        if (!this.audioMonitor) {
            this.audioMonitor = new AudioMonitor();
        }

        // Initialize Blink Timing
        this.lastBlinkToggle = performance.now();
        this.nextBlinkDuration = 3000 + Math.random() * 2000; // Initial open time 3-5s
        this.isEyeClosed = false;

        const loop = () => {
            if (!this.isRunningModel) return;

            const now = performance.now();
            const currentKey = `${this.state.activity}.${this.state.emotion}`;
            const map = this.modelDef.mapping[currentKey];

            if (!map) {
                // Debug log (throttled?)
                if (Math.random() < 0.01) console.warn('[Model] No mapping for:', currentKey);
            }
            // 1. Auto Blink Logic
            if (map && map.autoBlink) {
                if (now - this.lastBlinkToggle > this.nextBlinkDuration) {
                    // Toggle
                    this.isEyeClosed = !this.isEyeClosed;
                    this.lastBlinkToggle = now;
                    this.triggerBlink(this.isEyeClosed);

                    if (this.isEyeClosed) {
                        this.nextBlinkDuration = 100 + Math.random() * 100; // Close for 100-200ms
                    } else {
                        this.nextBlinkDuration = 2000 + Math.random() * 4000; // Open for 2-6s
                    }
                }
            } else {
                if (this.isEyeClosed) {
                    this.isEyeClosed = false;
                    this.triggerBlink(false);
                }
            }

            // 2. Lip Sync Logic
            // If "Speaking" checkbox is checked, we detect Audio
            if (this.speakingCheckbox.checked) {
                // Ensure Mic is active
                this.audioMonitor?.activate();
                const vol = this.audioMonitor?.getVolume() || 0;
                const isTalking = vol > 0.05; // Threshold

                if (this.state.speaking !== isTalking) {
                    this.state.speaking = isTalking;
                    this.notify();
                }
            } else {
                // If unchecked, disable mic processing? 
                // Or user meant "Manually checked speaking = detection ON"
                // If unchecked, maybe we pause detection.
                // Assuming Unchecked = No Speaking (Manual control ignored for now if we strictly follow "used as on/off for detecting")
                // But typically checkbox IS the state.
                // Request says: "speaking checkbox ... used as on/off for detecting input audio"
                // So Checked = Audio Detection ON. Unchecked = Audio Detection OFF.
                this.audioMonitor?.suspend();
                if (this.state.speaking) {
                    this.state.speaking = false;
                    this.notify();
                }
            }

            this.behaviorFrameId = requestAnimationFrame(loop);
        };

        loop();
    }

    private stopModelBehavior() {
        console.log('Model Behavior Stopped');
        this.isRunningModel = false;
        if (this.behaviorFrameId) cancelAnimationFrame(this.behaviorFrameId);
        this.triggerBlink(false);
        this.isEyeClosed = false;
        this.audioMonitor?.suspend();
    }

    private triggerBlink(isClosed: boolean) {
        this.state.eyesClosed = isClosed;
        this.onBlink?.(isClosed); // Call public hook
        this.notify();
    }

    private attachEvents() {
        // ... (JSON handling remains same) ...
        const handleGenericJSONLoad = (json: any, fileName: string) => {
            // Track filename for export
            this.currentModelName = fileName.replace(/\.(json|emgl|zip)$/i, '');

            // Smart Load Logic
            if (json.mapping && typeof json.mapping === 'object') {
                this.modelDef = json;
                if (!this.modelDef.mapping) this.modelDef.mapping = {};
                this.onModelUpdate(this.modelDef);
                this.updateUI(); // Calls renderMappingList inside updateUI
                alert(`Loaded EMG Model from ${fileName}\n(${Object.keys(this.modelDef.mapping).length} mappings)`);
            } else if (typeof json.emotion === 'string' && typeof json.activity === 'string') {
                this.state = { ...this.state, ...json };
                this.updateUI();
                this.notify();
                alert(`Loaded Situation State from ${fileName}`);
            } else {
                alert('Unknown JSON format.');
            }
        };

        // ... (remain same) ...

        // Use 'input' event for real-time updates or 'change' for commit. 
        // 'change' is better for avoiding too many updates while typing, but 'input' feels more responsive.
        // Let's use 'input' to immediately reflect target in verifying.
        this.emotionInput.addEventListener('input', () => {
            this.state.emotion = this.emotionInput.value;
            this.notify();
        });

        this.activityInput.addEventListener('input', () => {
            // console.log('[UI] Activity changed:', this.activityInput.value); // Verbose
            this.state.activity = this.activityInput.value;
            this.notify();
        });

        this.speakingCheckbox.addEventListener('change', () => {
            this.state.speaking = this.speakingCheckbox.checked;
            this.notify();
        });

        this.intensityRange.addEventListener('input', () => {
            const val = parseFloat(this.intensityRange.value);
            this.state.intensity = val;
            this.intensityValDisplay.textContent = val.toFixed(1);
            this.notify();
        });

        // Task 43: Removed duplicate event listeners that caused unwanted downloads.
        // The onclick handlers below handle the saving correctly without fallback.

        const loadBtn = document.getElementById('load-json-btn') as HTMLButtonElement;
        const loadInput = document.getElementById('load-json-input') as HTMLInputElement;

        console.log('[UI][Init] Binding Load JSON. Button:', !!loadBtn, 'Input:', !!loadInput);

        if (loadBtn && loadInput) {
            loadBtn.addEventListener('click', () => {
                console.log('[UI] Load JSON clicked');
                loadInput.click();
            });

            loadInput.addEventListener('change', async (e) => {
                console.log('[UI] Load JSON file selected');
                const target = e.target as HTMLInputElement;
                const file = target.files?.[0];
                if (file) {
                    const isZip = file.name.endsWith('.zip') || file.name.endsWith('.emgl');
                    if (isZip) {
                        await this.loadFromZip(file);
                    } else {
                        await this.loadFromJson(file);
                    }
                    target.value = '';
                }
            });
        } else {
            console.error('[UI][Init] Failed to find Load JSON elements');
        }

        // Load Sample Button
        const sampleBtn = document.getElementById('load-sample-btn') as HTMLButtonElement;
        console.log('[UI][Init] Binding Load Sample. Button:', !!sampleBtn);

        if (sampleBtn) {
            sampleBtn.onclick = async () => {
                console.log('[UI] Load Sample (Bob) clicked');
                sampleBtn.textContent = 'Loading...';
                try {
                    // Cache buster to ensure fresh load
                    const url = `/assets/bob_.json?t=${Date.now()}`;
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

                    const json = await res.json();

                    // Basic Validation
                    if (!json.mapping) throw new Error('JSON has no mapping');

                    handleGenericJSONLoad(json, 'Sample Bob');

                    sampleBtn.textContent = 'Success!';
                    setTimeout(() => sampleBtn.textContent = 'Load Sample (Bob)', 2000);
                } catch (e: any) {
                    console.warn('Fetch failed, using inline fallback', e);
                    sampleBtn.textContent = `Error -> Fallback`;

                    // Fallback: Inline Bob JSON
                    const fallbackJson: any = {
                        "assetsRoot": "/assets",
                        "mapping": {
                            "idle.neutral": {
                                "base": "base.png",
                                "mouthOpen": "mouse_open.png",
                                "eyesClosed": "eye_close.png"
                            }
                        }
                    };
                    handleGenericJSONLoad(fallbackJson, 'Sample Bob (Fallback)');
                    setTimeout(() => sampleBtn.textContent = 'Load Sample (Bob)', 2000);
                }
            };
        }

        // ... (Existing) ...

        // Advanced Configuration Listeners

        const saveModelBtn = document.getElementById('save-model-btn');
        if (saveModelBtn) {
            saveModelBtn.onclick = async (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                console.log('[UI] Save Model clicked (onclick)');

                // User requested to save in same dir as images
                // Force assetsRoot to be relative
                this.modelDef.assetsRoot = "./";
                const jsonStr = JSON.stringify(this.modelDef, null, 2);

                const message = "Saving model with 'assetsRoot' set to './'.\n\n" +
                    "IMPORTANT: You MUST save this JSON file in the SAME directory as your image files for them to load correctly.";

                // Allow browser confirmation to render
                await new Promise(r => setTimeout(r, 100));
                if (!confirm(message)) return;

                try {
                    // @ts-ignore
                    if (window.showSaveFilePicker) {
                        try {
                            // @ts-ignore
                            const handle = await window.showSaveFilePicker({
                                suggestedName: 'emg-model.json',
                                types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
                            });
                            const writable = await handle.createWritable();
                            await writable.write(jsonStr);
                            await writable.close();
                        } catch (err: any) {
                            if (err.name === 'AbortError') {
                                // User cancelled, do nothing
                                console.log('[UI] Save cancelled by user');
                                return;
                            }
                            throw err; // Re-throw to outer catch if it's a real error
                        }
                    } else {
                        throw new Error('Not supported');
                    }
                } catch (e: any) {
                    // Only fallback if API is not supported. 
                    // If API exists but failed (and not aborted), we prefer showing error than silent download?
                    // User request: "Do NOT download from browser" implying they hate the fallback behavior when it fails/cancels.

                    if (e.message === 'Not supported') {
                        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
                        const a = document.createElement('a');
                        a.href = dataStr;
                        a.download = "emg-model.json";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    } else {
                        console.error('Save failed', e);
                        alert('Failed to save file: ' + e.message);
                    }
                }
            };
        }

        // Save JSON (Situation State)
        const saveJsonBtn = document.getElementById('save-json');
        if (saveJsonBtn) {
            saveJsonBtn.onclick = async () => {
                console.log('[UI] Save JSON clicked');

                // Modified to save Model Definition (with assets) instead of just State
                // Assets Root is now controlled by the input field, do not overwrite.
                const jsonStr = JSON.stringify(this.modelDef, null, 2);
                console.log('[UI] JSON prepared. Length:', jsonStr.length);

                // const message = "Saving model (mappings & settings).\n\n" +
                //    "IMPORTANT: Save this file in the SAME directory as your assets.";



                // REMOVED: setTimeout delay breaks the 'User Gesture' token required for file picker / confirm.
                // REMOVED: Confirm dialog causing issues. Proceeding directly to save.
                console.log('[UI] Proceeding to save (Confirmation skipped)...');

                try {
                    // @ts-ignore
                    if (window.showSaveFilePicker) {
                        console.log('[UI] Using File System Access API (showSaveFilePicker)');
                        try {
                            // @ts-ignore
                            const handle = await window.showSaveFilePicker({
                                suggestedName: 'emg-model.json',
                                types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
                            });
                            console.log('[UI] File handle obtained. Writing...');
                            const writable = await handle.createWritable();
                            await writable.write(jsonStr);
                            await writable.close();
                            console.log('[UI] Save complete via File System Access API');
                        } catch (err: any) {
                            if (err.name === 'AbortError') {
                                console.log('[UI] Save cancelled by user (File Picker)');
                                return;
                            }
                            console.error('[UI] File Picker Error:', err);
                            throw err;
                        }
                    } else {
                        console.log('[UI] File System Access API not supported. Using fallback.');
                        throw new Error('Not supported');
                    }
                } catch (e: any) {
                    if (e.message === 'Not supported') {
                        console.log('[UI] Executing download fallback (<a> tag)');
                        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
                        const a = document.createElement('a');
                        a.href = dataStr;
                        a.download = "emg-model.json";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        console.log('[UI] Download fallback triggered.');
                    } else {
                        console.error('[UI] Save failed', e);
                        alert('Failed to save file: ' + e.message);
                    }
                }
            };
        }

        // Hide redundant export-btn or make it do the same as Save JSON
        const exportBtn = document.getElementById('export-btn');
        if (exportBtn) {
            exportBtn.textContent = 'Save Situation (JSON)';
            exportBtn.onclick = () => document.getElementById('save-json')?.click();
        }

        // Preview Logic
        this.previewBtn?.addEventListener('click', () => {
            if (this.previewInterval) {
                clearInterval(this.previewInterval);
                clearTimeout(this.blinkInterval);
                this.previewInterval = undefined;
                this.blinkInterval = undefined;
                if (this.talkingInterval) {
                    clearInterval(this.talkingInterval);
                    this.talkingInterval = undefined;
                }
                this.previewBtn!.textContent = 'Start Random Preview';
                this.previewBtn!.classList.remove('primary-btn');
                this.previewBtn!.classList.add('secondary-btn');
                this.triggerBlink(false);
                // Reset Speaking
                this.state.speaking = false;
                this.updateUI();
                this.notify();
            } else {
                this.previewBtn!.textContent = 'Stop Preview';
                this.previewBtn!.classList.remove('secondary-btn');
                this.previewBtn!.classList.add('primary-btn');

                const allKeys = Object.keys(this.modelDef.mapping);

                // 1. Pose Selection Loop (Every 2-3 seconds)
                this.previewInterval = window.setInterval(() => {
                    if (allKeys.length > 0) {
                        const rnd = Math.floor(Math.random() * allKeys.length);
                        const key = allKeys[rnd];
                        const parts = key.split('.');
                        if (parts.length >= 2) {
                            this.state.activity = parts[0];
                            this.state.emotion = parts[1];

                            // Determine if we should be talking in this pose (50% chance)
                            this.demoSpeakingTarget = Math.random() > 0.5;
                        }
                    }
                }, 2500);

                // 2. Mouth "Pakupaku" Animation Loop (Fast, ~150ms)
                this.talkingInterval = window.setInterval(() => {
                    if (this.demoSpeakingTarget) {
                        // Toggle speaking state to simulate mouth moving
                        this.state.speaking = !this.state.speaking;
                    } else {
                        this.state.speaking = false;
                    }
                    this.updateUI();
                    this.notify();
                }, 150);

                const runBlink = () => {
                    const duration = 150 + Math.random() * 100;
                    this.triggerBlink(true);
                    setTimeout(() => {
                        this.triggerBlink(false);
                        if (this.previewInterval) {
                            const next = 2000 + Math.random() * 3000;
                            this.blinkInterval = window.setTimeout(runBlink, next);
                        }
                    }, duration);
                };
                runBlink();
            }
        });
    }

    // Duplicates removed (onImageLoad, onModelUpdate, blink, etc)
    // Legacy fix logic merged into main class body


    private notify() {
        this.updateUI(); // Keep UI in sync for internal changes (like preview)
        this.listeners.forEach(l => l(this.state));
    }

    private updateUI() {
        this.emotionInput.value = this.state.emotion;
        this.activityInput.value = this.state.activity;
        this.speakingCheckbox.checked = this.state.speaking;
        this.intensityRange.value = this.state.intensity.toString();
        this.intensityValDisplay.textContent = this.state.intensity.toFixed(1);

        // Task 45: Sync Assets Root Input
        if (this.assetsRootInput) {
            this.assetsRootInput.value = this.modelDef.assetsRoot || "./";
        }

        // Update Model JSON Preview
        if (this.modelJsonPreview) {
            this.modelJsonPreview.value = JSON.stringify(this.modelDef, null, 2);
        }

        // Task 43: Update Active Status JSON Preview
        this.updateJSONPreviews();

        // Render Asset Inspector (Read-only list on right)
        this.renderAssetInspector();

        // Render Editable Mapping List (Left Config)
        this.renderMappingList();
    }


    public async loadFromJson(file: File) {
        return new Promise<void>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    // Update filename tracking
                    this.currentModelName = file.name.replace(/\.[^/.]+$/, "");

                    const json = JSON.parse(ev.target?.result as string);
                    if (!json.mapping || typeof json.mapping !== 'object') {
                        throw new Error('Missing "mapping" object in JSON');
                    }
                    this.modelDef = json;
                    if (!this.modelDef.assetsRoot) this.modelDef.assetsRoot = '/assets';
                    this.onModelUpdate(this.modelDef);
                    this.updateUI();
                    alert(`Model loaded successfully from ${file.name}`);
                    resolve();
                } catch (err) {
                    console.error(err);
                    alert('Invalid Model File: ' + (err instanceof Error ? err.message : 'Unknown error'));
                    reject(err);
                }
            };
            reader.readAsText(file);
        });
    }

    public async loadFromZip(file: File | Blob) {
        try {
            // Update filename tracking if File
            if (file instanceof File) {
                this.currentModelName = file.name.replace(/\.[^/.]+$/, "");
            }

            // ZIP Loading
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            const loadedZip = await zip.loadAsync(file);

            // Find JSON in root
            let jsonFile: any = null;
            for (const [path, entry] of Object.entries(loadedZip.files)) {
                // Check for root JSON (no directory separators or simple structure)
                if (path.endsWith('.json') && !path.includes('/') && !entry.dir) {
                    jsonFile = entry;
                    break;
                }
            }

            if (!jsonFile) throw new Error('No root JSON file found in .emgl archive');

            // Parse JSON
            const jsonStr = await jsonFile.async('string');
            const json = JSON.parse(jsonStr);

            if (!json.mapping || typeof json.mapping !== 'object') {
                throw new Error('Missing "mapping" object in JSON');
            }

            // Load all images as Blobs
            const newBlobs: Record<string, string> = {};
            for (const [path, entry] of Object.entries(loadedZip.files)) {
                if (!entry.dir && (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg'))) {
                    const blob = await entry.async('blob');
                    const url = URL.createObjectURL(blob);
                    const filename = path.split('/').pop() || path;
                    newBlobs[filename] = url;
                }
            }

            this.blobAssets = newBlobs;
            this.onBlobUpdate?.(this.blobAssets); // Pass to Viewer

            this.modelDef = json;
            if (!this.modelDef.assetsRoot) this.modelDef.assetsRoot = '/assets';

            this.onModelUpdate(this.modelDef);
            this.updateUI();

            const name = (file instanceof File) ? file.name : "Blob";
            alert(`Model loaded successfully from ${name} (ZIP/EMGL)`);

        } catch (err) {
            console.error(err);
            alert('Failed to load EMGL/ZIP: ' + (err instanceof Error ? err.message : String(err)));
            throw err;
        }
    }

    private updateJSONPreviews() {
        // 1. Update Main Model JSON
        if (this.modelJsonPreview) {
            this.modelJsonPreview.value = JSON.stringify(this.modelDef, null, 2);
        }

        // 2. Update Active Status JSON
        const ta = document.getElementById('active-status-json') as HTMLTextAreaElement;
        if (!ta) return;

        const key = `${this.state.activity}.${this.state.emotion}`;
        const mapping = this.modelDef.mapping[key];

        if (mapping) {
            ta.value = JSON.stringify(mapping, null, 2);
        } else {
            ta.value = `// No mapping for ${key}`;
        }
    }

    private renderAssetInspector() {
        const container = document.getElementById('asset-list');
        if (!container) return;

        container.innerHTML = '';
        const keys = Object.keys(this.modelDef.mapping).sort();

        if (keys.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center;">No assets mapped.</p>';
            return;
        }

        keys.forEach(key => {
            const map = this.modelDef.mapping[key];
            const div = document.createElement('div');
            div.className = 'asset-item-card';

            let html = `<div class="asset-item-header">${key}</div>`;
            if (map.base) html += `<div class="asset-item-row"><span class="asset-item-label">Base:</span> <span class="asset-item-value" title="${map.base}">${map.base}</span></div>`;
            if (map.mouthOpen) html += `<div class="asset-item-row"><span class="asset-item-label">Mouth:</span> <span class="asset-item-value" title="${map.mouthOpen}">${map.mouthOpen}</span></div>`;
            if (map.eyesClosed) html += `<div class="asset-item-row"><span class="asset-item-label">Eyes:</span> <span class="asset-item-value" title="${map.eyesClosed}">${map.eyesClosed}</span></div>`;

            div.innerHTML = html;
            container.appendChild(div);
        });
    }

    private async populateAudioDevices() {
        if (!this.audioDeviceSelect) return;

        // Remember current selection
        const current = this.audioDeviceSelect.value;

        const devices = await this.audioHandler.getDevices();
        this.audioDeviceSelect.innerHTML = '<option value="">Default Microphone</option>';
        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label;
            this.audioDeviceSelect.appendChild(opt);
        });

        // Restore selection if still exists
        if (devices.find(d => d.deviceId === current)) {
            this.audioDeviceSelect.value = current;
        }
    }

    private toggleMic() {
        this.micEnabled = this.micEnableCheckbox.checked;
        if (this.micEnabled) {
            const deviceId = this.audioDeviceSelect.value;
            this.audioHandler.start(deviceId, (vol) => {
                // Update Meter
                if (this.micLevelBar) {
                    // Visual boost for better feedback
                    this.micLevelBar.style.width = `${Math.min(100, vol * 100 * 5)}%`;
                }

                // Logic
                const isSpeaking = vol > this.micThreshold;

                // Only update if state changes to avoid DOM thrashing
                if (this.state.speaking !== isSpeaking) {
                    this.state.speaking = isSpeaking;
                    this.updateUI(); // Sync UI with state
                    this.notify();
                }
            });
        } else {
            this.audioHandler.stop();
            // Don't force set speaking=false here to allow manual override if needed, 
            // but for safety let's reset it so it doesn't get stuck.
            this.state.speaking = false;

            if (this.micLevelBar) this.micLevelBar.style.width = '0%';
            this.updateUI();
            this.notify();
        }
    }
}

class AudioMonitor {
    private ctx: AudioContext | undefined;
    private analyser: AnalyserNode | undefined;
    private source: MediaStreamAudioSourceNode | undefined;
    private dataArray: Uint8Array | undefined;
    private stream: MediaStream | undefined;
    public isActive = false;

    async activate() {
        if (this.isActive) return;

        try {
            if (!this.ctx) {
                // @ts-ignore
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AudioContext();
            }

            if (this.ctx?.state === 'suspended') {
                await this.ctx.resume();
            }

            if (!this.stream) {
                this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.isActive = true;

                this.analyser = this.ctx!.createAnalyser();
                this.analyser.fftSize = 256;
                this.source = this.ctx!.createMediaStreamSource(this.stream);
                this.source.connect(this.analyser);
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            } else {
                this.isActive = true;
            }
        } catch (e) {
            console.error('Mic Access Failed', e);
            this.isActive = false;
        }
    }

    suspend() {
        // We don't necessarily close the stream to avoid repeated permission prompts, 
        // but we flag as inactive.
        this.isActive = false;
    }

    getVolume(): number {
        if (!this.isActive || !this.analyser || !this.dataArray) return 0;
        // @ts-ignore
        this.analyser.getByteFrequencyData(this.dataArray);

        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const avg = sum / this.dataArray.length;
        return avg / 255; // Normalize 0-1
    }
}
