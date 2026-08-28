import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { FolderTree, Settings, Image as ImageIcon, FileUp, Frame, Undo2, Redo2 } from 'lucide-react';

interface MainLayoutProps {
    leftPanel?: React.ReactNode;
    centerPanel?: React.ReactNode;
    rightPanel?: React.ReactNode;
    onLoadPsd?: () => void;
    /** ファイル読み込み前だけ、読み込みが唯一のプライマリ操作になる。 */
    hasFile?: boolean;
    /** 取り消し / やり直し。書き出しに影響する操作だけが対象。 */
    onNewProject?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
}

function ResizeHandle({ className = "" }: { className?: string }) {
    return (
        <PanelResizeHandle className={`resize-handle-outer ${className}`}>
            <div className="resize-handle-inner" />
        </PanelResizeHandle>
    );
}

export const MainLayout: React.FC<MainLayoutProps> = ({ leftPanel, centerPanel, rightPanel, onLoadPsd, hasFile, onNewProject, onUndo, onRedo, canUndo, canRedo }) => {
    return (
        <div className="layout-container">
            <PanelGroup orientation="horizontal">
                {/* Left Panel: Layer Tree */}
                <Panel defaultSize="20" minSize="10" maxSize="40">
                    <div className="panel-content left-panel">
                        <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FolderTree size={16} />
                                <span>レイヤー</span>
                            </div>
                            {/* 読み込み済みなら、これはもう主役ではない。青は Export 側に譲る。 */}
                            {/* **素材の追加はここに置きません。** すぐ下の
                                ツールバーに同じものがあり、4 つ並べるとパネルが
                                狭いときにヘッダが溢れて「開く」「新規」が
                                画面外に切れていた（押せなくなっていた）。 */}
                            {hasFile && (
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    {/* 取り消しは編集全体に効く。素材の追加より前に置く。 */}
                                    <button className="btn btn-sm btn-ghost" onClick={onUndo} disabled={!canUndo}
                                        title="取り消す（Ctrl+Z）">
                                        <Undo2 size={13} />
                                    </button>
                                    <button className="btn btn-sm btn-ghost" onClick={onRedo} disabled={!canRedo}
                                        title="やり直す（Ctrl+Shift+Z）">
                                        <Redo2 size={13} />
                                    </button>
                                    {onLoadPsd && (
                                        <button className="btn btn-sm btn-ghost" onClick={onLoadPsd} title="別のファイルを開き直す（今の内容は破棄）">
                                            <FileUp size={13} />
                                            開く
                                        </button>
                                    )}
                                    {onNewProject && (
                                        <button className="btn btn-sm btn-ghost" onClick={onNewProject} title="空のキャンバスから始める（今の内容は破棄）">
                                            <Frame size={13} />
                                            新規
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="panel-body no-pad">
                            {leftPanel}
                        </div>
                    </div>
                </Panel>

                <ResizeHandle />

                {/* Center Panel: Preview */}
                <Panel defaultSize="60" minSize="20">
                    <div className="panel-content center-panel">
                        <div className="panel-header">
                            <ImageIcon size={16} />
                            <span>プレビュー</span>
                        </div>
                        <div className="panel-body no-pad preview-area">
                            {centerPanel}
                        </div>
                    </div>
                </Panel>

                <ResizeHandle />

                {/* Right Panel: Properties */}
                <Panel defaultSize="20" minSize="10" maxSize="40">
                    <div className="panel-content right-panel">
                        <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Settings size={16} />
                                <span>設定</span>
                            </div>
                            <span style={{ fontSize: '10px', color: '#5f5f64', fontWeight: 400, letterSpacing: '0.03em' }}>
                                v{__APP_VERSION__} · pxrllc
                            </span>
                        </div>
                        <div className="panel-body no-pad">
                            {rightPanel}
                        </div>
                    </div>
                </Panel>
            </PanelGroup>
        </div>
    );
};
