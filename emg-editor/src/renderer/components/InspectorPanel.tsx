import React, { useState } from 'react';
import { Bookmark, Download, Eye, FileJson, Layers, Sliders } from 'lucide-react';
import { JsonViewer } from './JsonViewer';
import { PartsPanel } from './PartsPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { MappingPanel } from './MappingPanel';
import { PresetsPanel } from './PresetsPanel';
import { ExpressionsPanel } from './ExpressionsPanel';
import type { EmgData } from '../services/EmgGenerator';
import type { PartInfo } from '../parts';
import type { AvatarExpression, AvatarMapping, AvatarPreset, LayerMeta, PartAnimation, PartTransform } from '../types';

type Tab = 'parts' | 'mapping' | 'presets' | 'layer' | 'json';

interface InspectorPanelProps {
    hasFile: boolean;
    exportableCount: number;
    /** 書き出し中の進捗。null なら実行中でない。 */
    exportProgress: { phase: string; percent: number } | null;

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

    partTransforms: Record<string, PartTransform>;
    transformTime: number;
    playScope: string | 'all' | null;
    onTransformChange: (partId: string, patch: Partial<PartTransform>) => void;
    onPlayToggle: (scope: string | 'all') => void;
    onTransformReset: () => void;
    onSeek: (t: number) => void;
    /** 再生できるものが 1 つでもあるか（コマ送り・変形の両方）。 */
    anyPlayable: boolean;
    partPlayable: (partId: string) => boolean;
    transformTarget: Record<string, string | undefined>;
    onTransformTargetChange: (partId: string, frame?: string) => void;

    mapping: AvatarMapping;
    onMappingChange: (patch: Partial<AvatarMapping>) => void;
    /** 未割り当てのスロット数。0 でなければ書き出し前に知らせる。 */
    unassigned: { blink: number; lipSync: number };

    presets: AvatarPreset[];
    previewDelta: Pick<AvatarPreset, 'parts' | 'toggles'>;
    onPresetSave: (label: string) => void;
    onPresetApply: (presetID: string) => void;
    onPresetUpdate: (presetID: string) => void;
    onPresetRename: (presetID: string, label: string) => void;
    onPresetDelete: (presetID: string) => void;

    expressions: AvatarExpression[];
    onExpressionAdd: (name: string) => void;
    onExpressionChange: (name: string, patch: Partial<AvatarExpression>) => void;
    onExpressionRename: (name: string, next: string) => void;
    onExpressionDelete: (name: string) => void;

    layerName?: string;
    layerId: number | null;
    meta?: LayerMeta;
    onMetaChange: (meta: LayerMeta) => void;

    emgData?: EmgData;
    onExport: () => void;
    onSaveProject: () => void;
    onLoadProject: () => void;
    onTemplateSave: () => void;
    onTemplateLoad: () => void;
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'parts', label: 'パーツ', icon: <Layers size={13} /> },
    { id: 'mapping', label: '目と口', icon: <Eye size={13} /> },
    { id: 'presets', label: '状態', icon: <Bookmark size={13} /> },
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
                        partTransforms={props.partTransforms}
                        transformTime={props.transformTime}
                        playScope={props.playScope}
                        onTransformChange={props.onTransformChange}
                        onPlayToggle={props.onPlayToggle}
                        onTransformReset={props.onTransformReset}
                        onSeek={props.onSeek}
                        anyPlayable={props.anyPlayable}
                        partPlayable={props.partPlayable}
                        transformTarget={props.transformTarget}
                        onTransformTargetChange={props.onTransformTargetChange}
                    />
                )}
                {activeTab === 'mapping' && (
                    <MappingPanel
                        parts={props.parts}
                        mapping={props.mapping}
                        onChange={props.onMappingChange}
                        onPreviewFrame={props.onPreviewFrame}
                    />
                )}
                {activeTab === 'presets' && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <PresetsPanel
                        presets={props.presets}
                        previewDelta={props.previewDelta}
                        hasFile={props.hasFile}
                        onSave={props.onPresetSave}
                        onApply={props.onPresetApply}
                        onUpdate={props.onPresetUpdate}
                        onRename={props.onPresetRename}
                        onDelete={props.onPresetDelete}
                    />
                    <div style={{ padding: '0 12px 12px' }}>
                        <ExpressionsPanel
                            expressions={props.expressions}
                            presets={props.presets}
                            parts={props.parts}
                            mapping={props.mapping}
                            hasFile={props.hasFile}
                            onAdd={props.onExpressionAdd}
                            onChange={props.onExpressionChange}
                            onRename={props.onExpressionRename}
                            onDelete={props.onExpressionDelete}
                            onPreviewFrame={props.onPreviewFrame}
                        />
                    </div>
                    </div>
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
                        : <div className="empty-state">素材を追加すると data.json のプレビューが出ます。</div>
                )}
            </div>

            <div className="action-bar">
                <button
                    className="btn btn-primary btn-block"
                    onClick={props.onExport}
                    disabled={!props.hasFile || props.exportableCount === 0 || !!props.exportProgress}
                >
                    <Download size={15} />
                    {props.exportProgress ? '書き出し中…' : '.emg を書き出す'}
                </button>
                {!props.exportProgress && props.hasFile
                    && (props.unassigned.blink + props.unassigned.lipSync) > 0 && (
                    <div className="action-warn">
                        未割り当て:
                        {props.unassigned.blink > 0 && ` まばたき ${props.unassigned.blink}`}
                        {props.unassigned.lipSync > 0 && ` 口パク ${props.unassigned.lipSync}`}
                        {' '}— このまま書き出すと動きません
                    </div>
                )}
                {props.exportProgress ? (
                    <>
                        <div className="progress-track">
                            <div
                                className="progress-fill"
                                style={{ width: `${Math.min(100, Math.max(0, props.exportProgress.percent))}%` }}
                            />
                        </div>
                        <div className="action-hint">
                            {props.exportProgress.phase} — {Math.round(props.exportProgress.percent)}%
                        </div>
                    </>
                ) : props.hasFile && (
                    <div className="action-hint">
                        {props.exportableCount > 0
                            ? `${props.parts.length} パーツ / ${props.exportableCount} レイヤー`
                            : '書き出せるレイヤーがありません'}
                    </div>
                )}
                <div className="action-bar-row">
                    <button className="btn" onClick={props.onSaveProject} disabled={!props.hasFile || !!props.exportProgress}
                        title="この素材の続きから編集するためのファイル（レイヤー ID で対応を取ります）">設定を保存</button>
                    <button className="btn" onClick={props.onLoadProject} disabled={!!props.exportProgress}>設定を読込</button>
                </div>
                {/* テンプレートは「設定」と違い、別の素材に持ち込める。
                    対応を取るのが数値 ID か名前かという違いなので、並べて置くと取り違える。 */}
                <div className="action-bar-row">
                    <button className="btn" onClick={props.onTemplateSave} disabled={!props.hasFile || !!props.exportProgress}
                        title="別の素材に持ち込むためのファイル（パーツ名とフレーム名で対応を取ります）">テンプレートを保存</button>
                    <button className="btn" onClick={props.onTemplateLoad} disabled={!props.hasFile || !!props.exportProgress}
                        title="別の素材で作った割り当て・プリセット・表情を当てる">テンプレートを適用</button>
                </div>
            </div>
        </div>
    );
};
