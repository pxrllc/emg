
import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { projectLoader } from './core/ProjectLoader';
import type { LoadedProject } from './core/ProjectLoader';
import { EmgStateMachine } from './core/EmgStateMachine';
import { EmgCanvas } from './components/Canvas/EmgCanvas';
import { VariantEditor } from './components/Editors/VariantEditor';
import { AudioMonitor } from './core/AudioMonitor';
import { exportProject } from './core/ProjectExporter';
import { useUndo } from './hooks/useUndo';

// --- Styled Components (Minimal & Aesthetic) ---

const Container = styled.div`
  display: flex;
  width: 100vw;
  height: 100vh;
  background-color: #1a1a1a;
  color: #eeeeee;
  font-family: 'Inter', sans-serif;
  overflow: hidden;
`;

const Sidebar = styled.div`
  width: 250px;
  background-color: #252525;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  gap: 1rem;
`;

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background: radial-gradient(circle at center, #2a2a2a 0%, #1a1a1a 100%);
`;

const RightPanel = styled.div`
  width: 300px;
  background-color: #252525;
  border-left: 1px solid #333;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const Button = styled.button`
  background-color: #3a3a3a;
  color: #fff;
  border: 1px solid #444;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: #4a4a4a;
    border-color: #555;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const StatePill = styled.div<{ $active: boolean }>`
  background-color: ${props => props.$active ? '#007acc' : '#333'};
  padding: 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid ${props => props.$active ? '#0099ff' : 'transparent'};
  
  &:hover {
    background-color: ${props => props.$active ? '#007acc' : '#3a3a3a'};
  }
`;

// --- Main App Component ---

// --- Localization ---
const T = {
    en: {
        runtimeTitle: "EMG Runtime",
        newProject: "New Project",
        projectName: "Project Name",
        undo: "Undo",
        redo: "Redo",
        enableMic: "Enable Mic",
        disableMic: "Disable Mic",
        onSound: "On Sound:",
        enterEdit: "Enter Edit Mode",
        exitEdit: "Exit Edit Mode",
        snapOn: "Snap: ON",
        snapOff: "Snap: OFF",
        export: "Export .zip",
        hideUI: "Hide UI (H)",
        showUI: "Show UI (H)",
        states: "States",
        inspector: "Inspector",
        runtimeTags: "Runtime Tags:",
        loadProject: "Load a project to start",
        noProject: "No project loaded",
        usage: {
            zoom: "Zoom: Mouse Wheel",
            pan: "Pan: Middle Click / Space+Drag",
            ui: "Toggle UI: 'H' Key"
        },
        license: "License"
    },
    ja: {
        runtimeTitle: "EMG ランタイム",
        newProject: "新規プロジェクト",
        projectName: "プロジェクト名",
        undo: "元に戻す",
        redo: "やり直す",
        enableMic: "マイク有効化",
        disableMic: "マイク無効化",
        onSound: "音声反応:",
        enterEdit: "編集モード開始",
        exitEdit: "編集モード終了",
        snapOn: "スナップ: ON",
        snapOff: "スナップ: OFF",
        export: ".zip エクスポート",
        hideUI: "UIを隠す (H)",
        showUI: "UIを表示 (H)",
        states: "ステート",
        inspector: "インスペクタ",
        runtimeTags: "ランタイムタグ:",
        loadProject: "プロジェクトをロードして開始",
        noProject: "プロジェクト未ロード",
        usage: {
            zoom: "ズーム: ホイール",
            pan: "移動: 中クリック / Space+ドラッグ",
            ui: "UI切替: 'H'キー"
        },
        license: "ライセンス"
    }
};

function App() {
    const [project, setProject, undo, redo, canUndo, canRedo] = useUndo<LoadedProject | null>(null);
    const [stateMachine, setStateMachine] = useState<EmgStateMachine | null>(null);
    const [currentState, setCurrentState] = useState<string>('neutral');
    const [volume, setVolume] = useState(0);
    const [isMicActive, setIsMicActive] = useState(false);
    const [currentTags, setCurrentTags] = useState<{ [key: string]: string }>({});
    const [editMode, setEditMode] = useState(false);
    const [snapToOrigin, setSnapToOrigin] = useState(false);

    // Phase 3.10
    const [talkingState, setTalkingState] = useState<string | null>(null);
    const [showUI, setShowUI] = useState(true);

    // Phase 3.12 (Fix Name Edit)
    const [projectNameInput, setProjectNameInput] = useState("");

    // Phase 3.15 (Localization)
    const [lang, setLang] = useState<'en' | 'ja'>('ja'); // Default to JA
    const t = T[lang];

    // Make sure local input stays in sync with external project changes (Undo/Redo/Load)
    useEffect(() => {
        if (project?.avatar.name) {
            setProjectNameInput(project.avatar.name);
        } else {
            setProjectNameInput(t.newProject); // Use localized default? Or keep "New Project" as data? Keeping data clean.
            // Actually, keep data as "New Project" for consistency, only localize UI labels.
            if (!project) setProjectNameInput("New Project");
        }
    }, [project, t]);

    const audioMonitorRef = useRef<AudioMonitor>(new AudioMonitor());
    const requestRef = useRef<number | null>(null);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if focus is on input/textarea
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;

            // Undo/Redo/UI Toggle
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    if (e.shiftKey) {
                        if (canRedo) redo();
                    } else {
                        if (canUndo) undo();
                    }
                    e.preventDefault();
                } else if (e.key === 'y') {
                    if (canRedo) redo();
                    e.preventDefault();
                }
            } else if (e.key === 'h' || e.key === 'H') {
                setShowUI(prev => !prev);
            }

            // Phase 3.14: State Triggers
            if (project && stateMachine) {
                const state = project.states.states.find(s => s.trigger?.key === e.key);
                if (state) {
                    e.preventDefault();
                    // trigger.mode default is 'toggle' (implied)
                    // For 'toggle', we switch to it. 
                    // For 'hold', we switch to it on KeyDown, and back on KeyUp.

                    // Logic:
                    // If mode is hold, transition.
                    // If mode is toggle, transition.
                    // (Same logic for KeyDown, difference is KeyUp)

                    // prevent repetitive transitions if already there?
                    if (currentState !== state.name) {
                        setCurrentState(state.name);
                        stateMachine.transition(state.name);
                    }
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            // Ignore if focus is on input/textarea
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;

            if (project && stateMachine) {
                const state = project.states.states.find(s => s.trigger?.key === e.key);
                if (state && state.trigger?.mode === 'hold') {
                    e.preventDefault();
                    // If releasing a hold key, go back to default
                    // But only if we are currently in that state?
                    if (currentState === state.name) {
                        setCurrentState(project.states.defaultState);
                        stateMachine.transition(project.states.defaultState);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [undo, redo, canUndo, canRedo, project, stateMachine, currentState]);

    const handleProjectUpdate = (newProject: LoadedProject) => {
        setProject(newProject);
        // Reload State Machine
        const sm = new EmgStateMachine(newProject.states);
        setStateMachine(sm);

        // Restore current state if possible
        if (newProject.states.states.find(s => s.name === currentState)) {
            sm.transition(currentState); // Keep current
        } else {
            // If renamed or deleted, fallback
            setCurrentState(newProject.states.defaultState);
        }
    };

    const handleNewProject = () => {
        const empty = projectLoader.createEmptyProject();
        setProject(empty);
        const sm = new EmgStateMachine(empty.states);
        setStateMachine(sm);
        setCurrentState(empty.states.defaultState);
    };

    // Animation Loop for Volume & Logic
    const tick = () => {
        // 1. Audio Level
        const vol = audioMonitorRef.current.getVolume();
        setVolume(vol);

        // 2. State Machine Logic
        if (stateMachine) {
            // Threshold logic
            const isOpen = vol > 15; // Adjusted threshold

            // Sound-Responsive State Logic
            if (isMicActive && isOpen && talkingState && currentState !== talkingState) {
                setCurrentState(talkingState);
                stateMachine.transition(talkingState);
            }

            // Update Tags
            stateMachine.updateTags({
                mouth: isOpen ? 'open' : 'closed',
                mic: isMicActive ? 'on' : 'off'
            });

            // Sync UI state
            setCurrentTags({ ...stateMachine['context'].currentTags });
        }

        requestRef.current = requestAnimationFrame(tick);
    };

    useEffect(() => {
        requestRef.current = requestAnimationFrame(tick);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [stateMachine]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                const file = e.target.files[0];
                const loaded = await projectLoader.load(file);
                setProject(loaded);

                const sm = new EmgStateMachine(loaded.states);
                setStateMachine(sm);
                setCurrentState(sm.getCurrentState()?.name || 'neutral');

                console.log('Project Loaded', loaded);
            } catch (err) {
                console.error(err);
                alert('Failed to load project: ' + err);
            }
        }
    };

    const toggleMic = async () => {
        if (isMicActive) {
            audioMonitorRef.current.stop();
            setIsMicActive(false);
        } else {
            try {
                await audioMonitorRef.current.start();
                setIsMicActive(true);
            } catch (e) {
                alert('Mic access denied');
            }
        }
    };

    const handleLayerUpdate = (layerID: string, newX: number, newY: number) => {
        if (!project) return;

        // Use Clone to ensure history validity
        const newProject = projectLoader.clone(project);

        const layerIndex = newProject.avatar.layers.findIndex(l => l.layerID === layerID);
        if (layerIndex === -1) return;

        // Update Layer
        newProject.avatar.layers[layerIndex].x = newX;
        newProject.avatar.layers[layerIndex].y = newY;

        setProject(newProject);
    };

    const handleExport = async () => {
        if (!project) return;
        try {
            const blob = await exportProject(project);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Use project name for filename, sanitize it
            const safeName = (project.avatar.name || 'project').replace(/[^a-z0-9_\-\.]/gi, '_');
            a.download = `${safeName}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            alert('Export failed');
        }
    };

    const handleRenameState = (oldName: string, newName: string) => {
        if (!project || !newName || newName === oldName) return;
        const newProject = projectLoader.clone(project);

        const stateIndex = newProject.states.states.findIndex(s => s.name === oldName);
        if (stateIndex === -1) return;

        newProject.states.states[stateIndex].name = newName;

        // Update defaultState if needed
        if (newProject.states.defaultState === oldName) {
            newProject.states.defaultState = newName;
        }

        // Update current state name if needed
        if (currentState === oldName) {
            setCurrentState(newName);
        }

        // Also need to update talkingState if it matches
        if (talkingState === oldName) {
            setTalkingState(newName);
        }

        handleProjectUpdate(newProject);
    };

    return (
        <Container>
            {/* Toggle UI Button (Floating) */}
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, opacity: showUI ? 0 : 0.5, transition: 'opacity 0.2s' }}>
                {!showUI && <Button onClick={() => setShowUI(true)}>{t.showUI}</Button>}
            </div>

            {showUI && (
                <Sidebar>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0 }}>{t.runtimeTitle}</h3>
                        <Button
                            style={{ padding: '2px 5px', fontSize: '0.7rem', background: 'transparent', border: '1px solid #555' }}
                            onClick={() => setLang(l => l === 'en' ? 'ja' : 'en')}
                        >
                            {lang === 'en' ? 'JP' : 'EN'}
                        </Button>
                    </div>

                    <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <Button onClick={handleNewProject}>{t.newProject}</Button>
                        <input
                            type="file"
                            accept=".zip,.emg"
                            onChange={handleFileChange}
                            style={{ color: '#aaa', fontSize: '0.8rem' }}
                        />

                        {/* Project Name Input (Phase 3.12 Fix) */}
                        <div style={{ marginTop: '0.5rem' }}>
                            <label style={{ fontSize: '0.7rem', color: '#888' }}>{t.projectName}</label>
                            <input
                                value={projectNameInput}
                                onChange={(e) => setProjectNameInput(e.target.value)}
                                onBlur={() => {
                                    if (project && projectNameInput !== project.avatar.name) {
                                        const newProject = projectLoader.clone(project);
                                        newProject.avatar.name = projectNameInput;
                                        handleProjectUpdate(newProject);
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                    }
                                }}
                                style={{
                                    background: '#333',
                                    border: '1px solid #444',
                                    color: '#eee',
                                    padding: '5px',
                                    width: '100%',
                                    marginTop: '2px',
                                    boxSizing: 'border-box',
                                    borderRadius: '4px'
                                }}
                            />
                        </div>
                    </div>

                    <hr style={{ width: '100%', borderColor: '#333' }} />

                    <div style={{ display: 'flex', gap: '5px' }}>
                        <Button onClick={undo} disabled={!canUndo} style={{ flex: 1 }}>{t.undo}</Button>
                        <Button onClick={redo} disabled={!canRedo} style={{ flex: 1 }}>{t.redo}</Button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', background: '#333', padding: '5px', borderRadius: '4px' }}>
                        <Button onClick={toggleMic} style={{ width: '100%' }}>
                            {isMicActive ? t.disableMic : t.enableMic}
                        </Button>
                        {/* Sound State Selector */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                            <span style={{ color: '#aaa' }}>{t.onSound}</span>
                            <select
                                value={talkingState || ""}
                                onChange={(e) => setTalkingState(e.target.value || null)}
                                style={{ background: '#222', color: '#eee', border: 'none', maxWidth: '100px' }}
                            >
                                <option value="">(None)</option>
                                {project?.states.states.map(s => (
                                    <option key={s.name} value={s.name}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <Button onClick={() => setEditMode(!editMode)} style={{ background: editMode ? '#ff8800' : '#444' }}>
                        {editMode ? t.exitEdit : t.enterEdit}
                    </Button>

                    <Button onClick={() => setSnapToOrigin(!snapToOrigin)} style={{ background: snapToOrigin ? '#007acc' : '#444' }}>
                        {snapToOrigin ? t.snapOn : t.snapOff}
                    </Button>

                    <Button onClick={handleExport} disabled={!project}>
                        {t.export}
                    </Button>

                    <Button onClick={() => setShowUI(false)} style={{ fontSize: '0.8rem', background: '#222' }}>
                        {t.hideUI}
                    </Button>

                    <hr style={{ width: '100%', borderColor: '#333' }} />

                    <h3>{t.states}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                        {project?.states.states.map(s => (
                            <div key={s.name} style={{ display: 'flex', gap: '2px' }}>
                                <StatePill
                                    $active={currentState === s.name}
                                    onClick={() => {
                                        setCurrentState(s.name);
                                        stateMachine?.transition(s.name);
                                    }}
                                    style={{ flex: 1 }}
                                >
                                    {s.name}
                                </StatePill>
                                <Button
                                    style={{ padding: '0 5px', fontSize: '0.8rem', background: '#333' }}
                                    title="Rename State"
                                    onClick={() => {
                                        const newName = prompt("Rename State:", s.name);
                                        if (newName) handleRenameState(s.name, newName);
                                    }}
                                >
                                    ✎
                                </Button>
                            </div>
                        ))}
                    </div>
                </Sidebar>
            )}

            <MainContent>
                {project && stateMachine ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        {/* Meter overlay */}
                        {showUI && (
                            <div style={{
                                position: 'absolute',
                                bottom: 20,
                                left: 20,
                                width: 20,
                                height: 100,
                                background: '#333',
                                borderRadius: 10,
                                overflow: 'hidden',
                                zIndex: 100
                            }}>
                                <div style={{
                                    width: '100%',
                                    height: `${volume * 100}%`,
                                    background: '#00ff88',
                                    position: 'absolute',
                                    bottom: 0,
                                    transition: 'height 0.1s'
                                }} />
                            </div>
                        )}

                        {/* Usage Overlay (Faint) */}
                        {showUI && (
                            <div style={{
                                position: 'absolute',
                                top: 20,
                                left: 20,
                                color: 'rgba(255, 255, 255, 0.3)',
                                pointerEvents: 'none',
                                zIndex: 50,
                                fontSize: '0.8rem',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px'
                            }}>
                                <div>{t.usage.zoom}</div>
                                <div>{t.usage.pan}</div>
                                <div>{t.usage.ui}</div>
                            </div>
                        )}

                        <EmgCanvas
                            avatar={project.avatar}
                            stateMachine={stateMachine}
                            assets={project.assets}
                            height={600}
                            editMode={editMode}
                            snapToOrigin={snapToOrigin}
                            onUpdateLayer={handleLayerUpdate}
                        />
                    </div>
                ) : (
                    <div style={{ color: '#666' }}>{t.loadProject}</div>
                )}

                {/* Copyright / License Footer */}
                {/* Unobtrusive, bottom right */}
                <div style={{
                    position: 'absolute',
                    bottom: 5,
                    right: 10,
                    fontSize: '0.7rem',
                    color: '#444',
                    zIndex: 20,
                    display: 'flex',
                    gap: '10px'
                }}>
                    <a
                        href="https://github.com/pxrllc/emg/blob/main/LICENSE.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                        {t.license}
                    </a>
                    <a
                        href="https://pxr.co.jp"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                        &copy; PXR LLC
                    </a>
                </div>
            </MainContent>

            {showUI && (
                <RightPanel>
                    <h3>{t.inspector}</h3>
                    {project ? (
                        <VariantEditor
                            project={project}
                            currentStateName={currentState}
                            onUpdate={handleProjectUpdate}
                        />
                    ) : (
                        <div style={{ color: '#666' }}>{t.noProject}</div>
                    )}

                    <hr style={{ width: '100%', borderColor: '#333' }} />

                    <div>{t.runtimeTags}</div>
                    <pre style={{ fontSize: '0.8rem', color: '#aaa' }}>
                        {JSON.stringify(currentTags, null, 2)}
                    </pre>
                </RightPanel>
            )}
        </Container>
    );
}

export default App;
