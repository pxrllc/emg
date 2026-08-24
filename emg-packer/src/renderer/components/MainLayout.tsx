import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { FolderTree, Settings, Image as ImageIcon, FileUp } from 'lucide-react';

interface MainLayoutProps {
    leftPanel?: React.ReactNode;
    centerPanel?: React.ReactNode;
    rightPanel?: React.ReactNode;
    onLoadPsd?: () => void;
    /** ファイル読み込み前だけ、読み込みが唯一のプライマリ操作になる。 */
    hasFile?: boolean;
}

function ResizeHandle({ className = "" }: { className?: string }) {
    return (
        <PanelResizeHandle className={`resize-handle-outer ${className}`}>
            <div className="resize-handle-inner" />
        </PanelResizeHandle>
    );
}

export const MainLayout: React.FC<MainLayoutProps> = ({ leftPanel, centerPanel, rightPanel, onLoadPsd, hasFile }) => {
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
                            {onLoadPsd && hasFile && (
                                <button className="btn btn-sm btn-ghost" onClick={onLoadPsd} title="別の PSD / KRA を開く">
                                    <FileUp size={13} />
                                    開く
                                </button>
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
                                v0.1.5 · pxrllc
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
