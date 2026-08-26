import React, { useState } from 'react';
import { Download, FileJson, Layers, Sliders } from 'lucide-react';
import { JsonViewer } from './JsonViewer';
import { PartsPanel } from './PartsPanel';
import { PropertiesPanel } from './PropertiesPanel';
import type { EmgData } from '../services/EmgGenerator';
import type { PartInfo } from '../parts';
import type { LayerMeta, PartAnimation } from '../types';

type Tab = 'parts' | 'layer' | 'json';

interface InspectorPanelProps {
    hasFile: boolean;
    exportableCount: number;

    parts: PartInfo[];
    selectedPartId: string | null;
    previewFrame: Record<string, string>;
    previewOff: Record<string, boolean>;
    onSelectPart: (partId: string) => void;
    onTypeChange: (partId: string, type: 'static' | 'switch') => void;
    onExportChange: (partId: string, include: boolean) => void;
    onDefaultFrameChange: (partId: string, frameId: string | null) => void;
    onDefaultVisibleChange: (partId: string, defaultVisible: boolean) => void;
    onPreviewFrame: (partId: string, frameId: string) => void;
    onPreviewNone: (partId: string) => void;
    onPreviewToggle: (partId: string) => void;
    onPreviewReset: () => void;
    onRenamePart: (partId: string, newName: string) => void;
    onTypeAll: (type: 'static' | 'switch') => void;

    partAnimations: Record<string, PartAnimation>;
    mappingControlled: Set<string>;
    onAnimationToggle: (partId: string, enabled: boolean) => void;
    onAnimationChange: (partId: string, patch: Partial<PartAnimation>) => void;
    onAnimationAddFrame: (partId: string, frameId: string) => void;
    onAnimationRemoveFrame: (partId: string, index: number) => void;
    onAnimationDurationChange: (partId: string, index: number, seconds: number) => void;

    layerName?: string;
    layerId: number | null;
    meta?: LayerMeta;
    onMetaChange: (meta: LayerMeta) => void;

    emgData?: EmgData;
    onExport: () => void;
    onSaveProject: () => void;
    onLoadProject: () => void;
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'parts', label: 'パーツ', icon: <Layers size={13} /> },
    { id: 'layer', label: 'レイヤー', icon: <Sliders size={13} /> },
    { id: 'json', label: 'JSON', icon: <FileJson size={13} /> },
];

/**
 * 右パネル。タブの中身が切り替わっても書き出し操作は動かない。
 *
 * 以前は Export ボタンがプロパティフォームの末尾にあり、レイヤーを選ぶ前と後で
 * 縦位置が 250px ほど飛んでいた。最後にやる操作は常に同じ場所に置く。
 */
export const InspectorPanel: React.FC<InspectorPanelProps> = (props) => {
    const [activeTab, setActiveTab] = useState<Tab>('parts');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #3e3e42', background: '#252526', flexShrink: 0 }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1,
                            padding: '9px 4px',
                            background: activeTab === tab.id ? '#1e1e1e' : 'transparent',
                            color: activeTab === tab.id ? '#fff' : '#8a8a8e',
                            border: 'none',
                            borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '5px',
                            fontSize: '11px',
                            fontWeight: activeTab === tab.id ? 600 : 400,
                        }}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {activeTab === 'parts' && (
                    <PartsPanel
                        parts={props.parts}
                        selectedPartId={props.selectedPartId}
                        previewFrame={props.previewFrame}
                        previewOff={props.previewOff}
                        onSelectPart={props.onSelectPart}
                        onTypeChange={props.onTypeChange}
                        onExportChange={props.onExportChange}
                        onDefaultFrameChange={props.onDefaultFrameChange}
                        onDefaultVisibleChange={props.onDefaultVisibleChange}
                        onPreviewFrame={props.onPreviewFrame}
                        onPreviewNone={props.onPreviewNone}
                        onPreviewToggle={props.onPreviewToggle}
                        onPreviewReset={props.onPreviewReset}
                        onRenamePart={props.onRenamePart}
                        onTypeAll={props.onTypeAll}
                        partAnimations={props.partAnimations}
                        mappingControlled={props.mappingControlled}
                        onAnimationToggle={props.onAnimationToggle}
                        onAnimationChange={props.onAnimationChange}
                        onAnimationAddFrame={props.onAnimationAddFrame}
                        onAnimationRemoveFrame={props.onAnimationRemoveFrame}
                        onAnimationDurationChange={props.onAnimationDurationChange}
                    />
                )}
                {activeTab === 'layer' && (
                    <PropertiesPanel
                        layerName={props.layerName}
                        layerId={props.layerId}
                        meta={props.meta}
                        onChange={props.onMetaChange}
                    />
                )}
                {activeTab === 'json' && (
                    props.emgData
                        ? <JsonViewer data={props.emgData} highlightId={props.layerId?.toString()} />
                        : <div className="empty-state">PSD を読み込むと data.json のプレビューが出ます。</div>
                )}
            </div>

            <div className="action-bar">
                <button
                    className="btn btn-primary btn-block"
                    onClick={props.onExport}
                    disabled={!props.hasFile || props.exportableCount === 0}
                >
                    <Download size={15} />
                    .emg を書き出す
                </button>
                {props.hasFile && (
                    <div className="action-hint">
                        {props.exportableCount > 0
                            ? `${props.parts.length} パーツ / ${props.exportableCount} レイヤー`
                            : '書き出せるレイヤーがありません'}
                    </div>
                )}
                <div className="action-bar-row">
                    <button className="btn" onClick={props.onSaveProject} disabled={!props.hasFile}>設定を保存</button>
                    <button className="btn" onClick={props.onLoadProject}>設定を読込</button>
                </div>
            </div>
        </div>
    );
};
