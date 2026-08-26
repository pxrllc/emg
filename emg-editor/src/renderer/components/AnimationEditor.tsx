import React from 'react';
import { Plus, X } from 'lucide-react';
import type { PartAnimation } from '../types';
import type { PartInfo } from '../parts';

interface AnimationEditorProps {
    part: PartInfo;
    animation?: PartAnimation;
    /** mapping.json が blink/lipSync として掌握するパーツか（7.3）。 */
    mappingControlled: boolean;
    onToggle: (partId: string, enabled: boolean) => void;
    onChange: (partId: string, patch: Partial<PartAnimation>) => void;
    onAddFrame: (partId: string, frameId: string) => void;
    onRemoveFrame: (partId: string, index: number) => void;
    onDurationChange: (partId: string, index: number, seconds: number) => void;
}

const numStyle: React.CSSProperties = {
    width: '52px', padding: '3px 4px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '3px', fontSize: '11px',
};

const selStyle: React.CSSProperties = {
    padding: '3px 4px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '3px', fontSize: '11px',
};

/**
 * 1 パーツ分の `sprites[]` を編集する。
 *
 * 対象は `switch` パーツのみ。`sprites[].targetPartID` のパーツは switch でなければ
 * ならないという仕様（emg-json-spec.md 7 章）を、UI の段階で満たしておく。
 */
export const AnimationEditor: React.FC<AnimationEditorProps> = ({
    part, animation, mappingControlled,
    onToggle, onChange, onAddFrame, onRemoveFrame, onDurationChange,
}) => {
    const enabled = !!animation?.enabled;

    return (
        <div className="anim-block" onClick={e => e.stopPropagation()}>
            <label className="anim-head">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => onToggle(part.partId, e.target.checked)}
                />
                アニメーション
                {enabled && animation && (
                    <span className="part-meta" style={{ marginLeft: 'auto' }}>
                        {animation.frames.length} フレーム
                    </span>
                )}
            </label>

            {enabled && animation && (
                <>
                    {/* 再生順。同じフレームを何度でも置ける（まばたきの 01→03→04→03→01）。 */}
                    <div className="frame-strip">
                        {animation.frames.map((frameId, i) => (
                            <span key={`${frameId}-${i}`} className="seq-chip">
                                <span className="seq-index">{i + 1}</span>
                                {frameId}
                                {animation.timing === 'keys' && (
                                    <input
                                        type="number"
                                        min={0.01}
                                        step={0.01}
                                        value={animation.durations[i] ?? 0.1}
                                        onChange={e => onDurationChange(part.partId, i, parseFloat(e.target.value) || 0.1)}
                                        style={{ ...numStyle, width: '46px', marginLeft: '4px' }}
                                        title="このフレームの表示秒数"
                                    />
                                )}
                                <button
                                    className="seq-remove"
                                    onClick={() => onRemoveFrame(part.partId, i)}
                                    title="この再生位置を削除"
                                >
                                    <X size={10} />
                                </button>
                            </span>
                        ))}
                        {animation.frames.length === 0 && (
                            <span className="part-meta">下からフレームを足してください</span>
                        )}
                    </div>

                    {/* 追加できるフレーム */}
                    <div className="frame-strip">
                        {part.frames.map(f => (
                            <button
                                key={f.frameId}
                                className="frame-chip frame-add"
                                onClick={() => onAddFrame(part.partId, f.frameId)}
                                title={`${f.frameId} を再生順の末尾に足す`}
                            >
                                <Plus size={9} /> {f.frameId}
                            </button>
                        ))}
                    </div>

                    <div className="anim-row">
                        <label>間隔</label>
                        <select
                            value={animation.timing}
                            onChange={e => onChange(part.partId, { timing: e.target.value as PartAnimation['timing'] })}
                            style={selStyle}
                            title="等間隔は fps、フレームごとに時間を変えるなら可変"
                        >
                            <option value="fps">等間隔</option>
                            <option value="keys">可変</option>
                        </select>
                        {animation.timing === 'fps' && (
                            <>
                                <input
                                    type="number"
                                    min={1}
                                    max={120}
                                    value={animation.fps}
                                    onChange={e => onChange(part.partId, { fps: parseInt(e.target.value) || 12 })}
                                    style={numStyle}
                                />
                                <span className="part-meta">fps</span>
                            </>
                        )}
                    </div>

                    <div className="anim-row">
                        <label>再生順</label>
                        <select
                            value={animation.sequenceType}
                            onChange={e => onChange(part.partId, { sequenceType: e.target.value as PartAnimation['sequenceType'] })}
                            style={selStyle}
                        >
                            <option value="ordered">順番に</option>
                            <option value="random_hold">1 つ選んで保持</option>
                        </select>
                    </div>

                    <div className="anim-row">
                        <label>発火</label>
                        <select
                            value={animation.triggerType}
                            onChange={e => onChange(part.partId, { triggerType: e.target.value as PartAnimation['triggerType'] })}
                            style={selStyle}
                            disabled={mappingControlled}
                        >
                            <option value="auto_loop">常にループ</option>
                            <option value="random_interval">ランダム間隔</option>
                            <option value="external">外部から</option>
                        </select>
                        {animation.triggerType === 'random_interval' && !mappingControlled && (
                            <>
                                <input
                                    type="number" min={0} step={0.5}
                                    value={animation.intervalMin}
                                    onChange={e => onChange(part.partId, { intervalMin: parseFloat(e.target.value) || 0 })}
                                    style={numStyle}
                                />
                                <span className="part-meta">〜</span>
                                <input
                                    type="number" min={0} step={0.5}
                                    value={animation.intervalMax}
                                    onChange={e => onChange(part.partId, { intervalMax: parseFloat(e.target.value) || 0 })}
                                    style={numStyle}
                                />
                                <span className="part-meta">秒</span>
                            </>
                        )}
                    </div>

                    {mappingControlled && (
                        <div className="part-meta anim-note">
                            mapping.json がこのパーツのまばたき / 口パクを掌握するため、
                            自律発火しません（外部から再生）。
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
