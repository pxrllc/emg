import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { FolderTree, Settings, Image as ImageIcon, FileUp } from 'lucide-react';

interface MainLayoutProps {
    leftPanel?: React.ReactNode;
    centerPanel?: React.ReactNode;
    rightPanel?: React.ReactNode;
    onLoadPsd?: () => void;
}

function ResizeHandle({ className = "" }: { className?: string }) {
    return (
        <PanelResizeHandle className={`resize-handle-outer ${className}`}>
            <div className="resize-handle-inner" />
        </PanelResizeHandle>
    );
}

export const MainLayout: React.FC<MainLayoutProps> = ({ leftPanel, centerPanel, rightPanel, onLoadPsd }) => {
    return (
        <div className="layout-container">
            <PanelGroup orientation="horizontal">
                {/* Left Panel: Layer Tree */}
                <Panel defaultSize="20" minSize="10" maxSize="40">
                    <div className="panel-content left-panel">
                        <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FolderTree size={16} />
                                <span>Layers</span>
                            </div>
                            {onLoadPsd && (
                                <button
                                    onClick={onLoadPsd}
                                    title="Import PSD / KRA"
                                    style={{
                                        background: '#3b82f6',
                                        border: 'none',
                                        color: 'white',
                                        padding: '3px 10px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                    }}
                                >
                                    <FileUp size={13} />
                                    Import
                                </button>
                            )}
                        </div>
                        <div className="panel-body">
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
                            <span>Preview</span>
                        </div>
                        <div className="panel-body preview-area">
                            {centerPanel}
                        </div>
                    </div>
                </Panel>

                <ResizeHandle />

                {/* Right Panel: Properties */}
                <Panel defaultSize="20" minSize="10" maxSize="40">
                    <div className="panel-content right-panel">
                        <div className="panel-header">
                            <Settings size={16} />
                            <span>Properties</span>
                        </div>
                        <div className="panel-body">
                            {rightPanel}
                        </div>
                    </div>
                </Panel>
            </PanelGroup>
        </div>
    );
};
