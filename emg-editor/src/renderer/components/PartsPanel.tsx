import React, { useState } from 'react';
import { Eye, EyeOff, Pause, Pencil, Play, RotateCcw } from 'lucide-react';
import type { PartInfo } from '../parts';
import { emptyTransform, transformKey, type PartAnimation, type PartTransform } from '../types';
import { hasAnimation } from '../services/transform';
import { AnimationEditor } from './AnimationEditor';
import { TransformTimeline } from './TransformTimeline';

interface PartsPanelProps {
    parts: PartInfo[];
    selectedPartId: string | null;
    previewFrame: Record<string, string>;
    previewOff: Record<string, boolean>;
    onSelectPart: (partId: string) => void;
    onTypeChange: (partId: string, type: 'static' | 'switch') => void;
    onExportChange: (partId: string, include: boolean) => void;
    /** frameId が null なら「初期状態でどれも表示しない」（v0.5.0 §4.3）。 */
    onDefaultFrameChange: (partId: string, frameId: string | null) => void;
    onDefaultVisibleChange: (partId: string, defaultVisible: boolean) => void;
    onPreviewFrame: (partId: string, frameId: string) => void;
    onPreviewNone: (partId: string) => void;
    onPreviewToggle: (partId: string) => void;
    onPreviewReset: () => void;
    onRenamePart: (partId: string, newName: string) => void;
    onTypeAll: (type: 'static' | 'switch') => void;

    /** partID -> アニメーション設定（emg-json-spec.md 7 章）。 */
    partAnimations: Record<string, PartAnimation>;
    /** mapping.json が blink/lipSync として掌握する partID（7.3）。 */
    mappingControlled: Set<string>;
    onAnimationToggle: (partId: string, enabled: boolean) => void;
    onAnimationChange: (partId: string, patch: Partial<PartAnimation>) => void;
    onAnimationAddFrame: (partId: string, frameId: string) => void;
    onAnimationRemoveFrame: (partId: string, index: number) => void;
    onAnimationDurationChange: (partId: string, index: number, seconds: number) => void;

    /** partID -> トランスフォーム（v0.5.0 §7）。static パーツにも付けられる（§7.1）。 */
    partTransforms: Record<string, PartTransform>;
    transformTime: number;
    /** 今どの範囲を再生しているか。partID か 'all'、止まっていれば null。 */
    playScope: string | 'all' | null;
    /** 対象は partID か「partID + フレーム識別子」（0.5.3 §7.4.1）。 */
    onTransformChange: (key: string, patch: Partial<PartTransform>) => void;
    onPlayToggle: (scope: string | 'all') => void;
    onTransformReset: () => void;
    onSeek: (t: number) => void;
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
    onPreviewFrame, onPreviewNone, onPreviewToggle, onPreviewReset, onRenamePart, onTypeAll,
    partAnimations, mappingControlled,
    onAnimationToggle, onAnimationChange, onAnimationAddFrame,
    onAnimationRemoveFrame, onAnimationDurationChange,
    partTransforms, transformTime, playScope,
    onTransformChange, onPlayToggle, onTransformReset, onSeek,
}) => {
    // 「全体」ボタンは、動くトラックが 1 つも無ければ押せない。
    const anyAnimated = Object.values(partTransforms).some(hasAnimation);
    // パーツごとに「今どの対象を編集しているか」。既定はパーツ全体。
    const [tfTarget, setTfTarget] = useState<Record<string, string | undefined>>({});
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
                <button
                    className={`btn btn-sm ${playScope === 'all' ? 'btn-primary' : ''}`}
                    onClick={() => onPlayToggle('all')}
                    disabled={!anyAnimated}
                    title={anyAnimated
                        ? '全パーツのアニメーションを同時に再生する'
                        : '動くトラックを持つパーツがまだありません'}
                >
                    {playScope === 'all' ? <Pause size={12} /> : <Play size={12} />} 全体
                </button>
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
                // v0.5.0 §4: static は初期非表示トグル、switch は §4.3 の未選択。
                const hidden = previewOff[part.partId] ?? !part.defaultVisible;
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
                                        {/* v0.5.0 §4.3: 差分を持ちながら「どれも出さない」のが
                                            常態であるパーツ（チーク・青ざめ・汗・涙）用。 */}
                                        <button
                                            className={[
                                                'frame-chip', 'frame-none',
                                                hidden ? 'previewing' : '',
                                                part.initiallyNone ? 'is-default' : '',
                                            ].join(' ')}
                                            title="どれも表示しない — クリックでプレビュー / ダブルクリックで初期状態にする"
                                            onClick={() => onPreviewNone(part.partId)}
                                            onDoubleClick={() => onDefaultFrameChange(part.partId, null)}
                                        >
                                            なし
                                        </button>
                                        {part.frames.map(frame => (
                                            <button
                                                key={frame.frameId}
                                                className={[
                                                    'frame-chip',
                                                    !hidden && frame.frameId === activeFrame ? 'previewing' : '',
                                                    !part.initiallyNone && frame.frameId === part.defaultFrameId ? 'is-default' : '',
                                                ].join(' ')}
                                                title={
                                                    !part.initiallyNone && frame.frameId === part.defaultFrameId
                                                        ? `${frame.frameId}（初期表示）`
                                                        : `${frame.frameId} — クリックでプレビュー / ダブルクリックで初期表示にする`
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
                                    <AnimationEditor
                                        part={part}
                                        animation={partAnimations[part.partId]}
                                        mappingControlled={mappingControlled.has(part.partId)}
                                        onToggle={onAnimationToggle}
                                        onChange={onAnimationChange}
                                        onAddFrame={onAnimationAddFrame}
                                        onRemoveFrame={onAnimationRemoveFrame}
                                        onDurationChange={onAnimationDurationChange}
                                    />
                                    <div className="part-meta">
                                        {part.frames.length} 差分 / {part.layerIds.length} レイヤー
                                        {part.initiallyNone && <span> · 初期状態は「なし」</span>}
                                        {(hidden ? !part.initiallyNone : activeFrame !== part.defaultFrameId || part.initiallyNone) && (
                                            <span style={{ color: '#93b4fd' }}>
                                                {' '}· プレビュー中: {hidden ? 'なし' : activeFrame}
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

                            {/* トランスフォーム（§7）。static / switch のどちらにも付く。
                                差分の切り替えとは別の軸なので、常に出しておく。 */}
                            {selectedPartId === part.partId && (() => {
                                const target = tfTarget[part.partId];
                                const key = transformKey(part.partId, target);
                                return (
                                    <TransformTimeline
                                        partId={part.partId}
                                        frames={part.frames.map(f => f.frameId)}
                                        target={target}
                                        onTargetChange={f => setTfTarget(prev => ({ ...prev, [part.partId]: f }))}
                                        hasTransform={f => !!partTransforms[transformKey(part.partId, f)]}
                                        transform={partTransforms[key] ?? emptyTransform()}
                                        time={transformTime}
                                        playing={playScope === key || playScope === 'all'}
                                        onChange={patch => onTransformChange(key, patch)}
                                        onSeek={onSeek}
                                        onPlayToggle={() => onPlayToggle(key)}
                                        onReset={onTransformReset}
                                    />
                                );
                            })()}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
