import React, { useState } from 'react';
import { Eye, EyeOff, Pencil, RotateCcw } from 'lucide-react';
import type { PartInfo } from '../parts';

interface PartsPanelProps {
    parts: PartInfo[];
    selectedPartId: string | null;
    previewFrame: Record<string, string>;
    previewOff: Record<string, boolean>;
    onSelectPart: (partId: string) => void;
    onTypeChange: (partId: string, type: 'static' | 'switch') => void;
    onExportChange: (partId: string, include: boolean) => void;
    onDefaultFrameChange: (partId: string, frameId: string) => void;
    onDefaultVisibleChange: (partId: string, defaultVisible: boolean) => void;
    onPreviewFrame: (partId: string, frameId: string) => void;
    onPreviewToggle: (partId: string) => void;
    onPreviewReset: () => void;
    onRenamePart: (partId: string, newName: string) => void;
    onTypeAll: (type: 'static' | 'switch') => void;
}

/**
 * パーツ単位の編集面。
 *
 * .emg の構造は parts[] なのに、以前の UI はレイヤー 1 枚ずつしか触れず、
 * 一括操作も「全レイヤーを static/switch にする」しかなかった（体も差分も
 * 一律になるので実際には使えない）。パーツを単位にすることで、
 *   - static / switch の切り替えが 1 クリックで、取りこぼしなく効く
 *   - どの差分が既定になるかが一覧で見える
 *   - 差分をクリックするとプレビューがその状態に切り替わる
 * が同時に成り立つ。
 */
export const PartsPanel: React.FC<PartsPanelProps> = ({
    parts, selectedPartId, previewFrame, previewOff,
    onSelectPart, onTypeChange, onExportChange, onDefaultFrameChange, onDefaultVisibleChange,
    onPreviewFrame, onPreviewToggle, onPreviewReset, onRenamePart, onTypeAll,
}) => {
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    if (parts.length === 0) {
        return (
            <div className="empty-state">
                PSD を読み込むとパーツが表示されます。
            </div>
        );
    }

    const previewTouched =
        Object.keys(previewFrame).length > 0 || Object.values(previewOff).some(Boolean);

    const startRename = (partId: string) => {
        setRenaming(partId);
        setRenameValue(partId);
    };

    const commitRename = () => {
        if (renaming && renameValue.trim() && renameValue !== renaming) {
            onRenamePart(renaming, renameValue.trim());
        }
        setRenaming(null);
    };

    return (
        <div style={{ padding: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: '#7d7d82', flex: 1 }}>
                    {parts.length} パーツ
                </span>
                <button className="btn btn-sm" onClick={() => onTypeAll('static')} title="全パーツを Static にする">
                    全 Static
                </button>
                <button className="btn btn-sm" onClick={() => onTypeAll('switch')} title="全パーツを Switch にする">
                    全 Switch
                </button>
                <button
                    className="btn btn-sm btn-ghost"
                    onClick={onPreviewReset}
                    disabled={!previewTouched}
                    title="プレビューを既定の状態に戻す"
                >
                    <RotateCcw size={12} />
                </button>
            </div>

            {parts.map(part => {
                // 書き出すレイヤーが 1 枚も無いパーツ = 「使用しない」。
                // type とは別の状態ではなく、type の選択肢の 1 つとして扱う
                // （static / switch / 使用しない は同時に 1 つしか成り立たない）。
                const unused = part.exportedCount === 0;
                const hidden = previewOff[part.partId] ?? (part.type === 'static' && !part.defaultVisible);
                const activeFrame = previewFrame[part.partId] ?? part.defaultFrameId;

                return (
                    <div
                        key={part.partId}
                        className={`part-card ${selectedPartId === part.partId ? 'selected' : ''} ${unused ? 'unused' : ''}`}
                        onClick={() => onSelectPart(part.partId)}
                    >
                        <div className="part-card-head">
                            <button
                                className="icon-btn"
                                title={unused ? '使用しないパーツです' : hidden ? 'プレビューに表示' : 'プレビューで伏せる'}
                                disabled={unused}
                                onClick={e => { e.stopPropagation(); onPreviewToggle(part.partId); }}
                            >
                                {unused || hidden ? <EyeOff size={14} color="#666" /> : <Eye size={14} />}
                            </button>

                            {renaming === part.partId ? (
                                <input
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onBlur={commitRename}
                                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                                    autoFocus
                                    onClick={e => e.stopPropagation()}
                                    style={{ flex: 1, minWidth: 0, background: '#1a1a1c', color: '#fff', border: '1px solid #2563eb', borderRadius: '3px', padding: '3px 5px', fontSize: '12px' }}
                                />
                            ) : (
                                <span
                                    className="part-name"
                                    title={`${part.partId}（ダブルクリックで名前を変更）`}
                                    onDoubleClick={e => { e.stopPropagation(); startRename(part.partId); }}
                                >
                                    {part.partId}
                                </span>
                            )}

                            <button
                                className="icon-btn"
                                title="パーツ名を変更"
                                onClick={e => { e.stopPropagation(); startRename(part.partId); }}
                            >
                                <Pencil size={12} color="#777" />
                            </button>

                            <div className="seg" onClick={e => e.stopPropagation()}>
                                <button
                                    className={`seg-item ${unused ? 'active none' : ''}`}
                                    onClick={() => onExportChange(part.partId, false)}
                                    title="このパーツを .emg に含めない（下描き・アタリ・作業用レイヤーなど）"
                                >
                                    使わない
                                </button>
                                <button
                                    className={`seg-item ${!unused && part.type === 'static' ? 'active static' : ''}`}
                                    onClick={() => onTypeChange(part.partId, 'static')}
                                    title="常に表示されるパーツ（体・背景など）"
                                >
                                    Static
                                </button>
                                <button
                                    className={`seg-item ${!unused && part.type === 'switch' ? 'active' : ''}`}
                                    onClick={() => onTypeChange(part.partId, 'switch')}
                                    title="1 つだけ表示される差分パーツ（目・口など）"
                                >
                                    Switch
                                </button>
                            </div>
                        </div>

                        <div className="part-card-body">
                            {unused ? (
                                <div className="part-meta">
                                    .emg に含めません（{part.layerIds.length} レイヤー）
                                </div>
                            ) : part.type === 'switch' ? (
                                <>
                                    <div className="frame-strip" onClick={e => e.stopPropagation()}>
                                        {part.frames.map(frame => (
                                            <button
                                                key={frame.frameId}
                                                className={[
                                                    'frame-chip',
                                                    frame.frameId === activeFrame ? 'previewing' : '',
                                                    frame.frameId === part.defaultFrameId ? 'is-default' : '',
                                                ].join(' ')}
                                                title={
                                                    frame.frameId === part.defaultFrameId
                                                        ? `${frame.frameId}（既定）`
                                                        : `${frame.frameId} — クリックでプレビュー / ダブルクリックで既定にする`
                                                }
                                                onClick={() => onPreviewFrame(part.partId, frame.frameId)}
                                                onDoubleClick={() => onDefaultFrameChange(part.partId, frame.frameId)}
                                            >
                                                {frame.frameId}
                                                {frame.layerIds.length > 1 && (
                                                    <span style={{ marginLeft: 4, opacity: 0.6 }}>×{frame.layerIds.length}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="part-meta">
                                        {part.frames.length} 差分 / {part.layerIds.length} レイヤー
                                        {activeFrame !== part.defaultFrameId && (
                                            <span style={{ color: '#93b4fd' }}>
                                                {' '}· プレビュー中: {activeFrame}
                                            </span>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <label
                                    className="part-meta"
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                                    onClick={e => e.stopPropagation()}
                                >
                                    <input
                                        type="checkbox"
                                        checked={part.defaultVisible}
                                        onChange={e => onDefaultVisibleChange(part.partId, e.target.checked)}
                                    />
                                    初期表示
                                    <span style={{ marginLeft: 'auto' }}>
                                        {part.exportedCount < part.layerIds.length
                                            ? `${part.exportedCount} / ${part.layerIds.length} レイヤー`
                                            : `${part.layerIds.length} レイヤー`}
                                    </span>
                                </label>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
