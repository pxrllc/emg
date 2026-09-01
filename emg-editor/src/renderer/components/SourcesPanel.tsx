import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Layers, RotateCcw, Trash2 } from 'lucide-react';
import { NumberInput } from './NumberInput';
import {
    isIdentitySourceTransform, SOURCE_KIND_LABEL,
    type SourceEntry, type SourceTransform,
} from '../types';

interface SourcesPanelProps {
    sources: SourceEntry[];
    /** partID → 書き出し対象のレイヤー数。素材ごとの「使われている枚数」に足し上げる。 */
    exportedByLayer: Record<number, boolean>;
    onRemove: (sourceId: string) => void;
    onTransform: (sourceId: string, patch: Partial<SourceTransform>) => void;
    onTransformReset: (sourceId: string) => void;
    /**
     * 選んでいる素材。プレビューのバウンディングボックスと同じ状態を指す。
     * 展開と選択を分けない — 「開いているのに枠が出ない」状態を作らないため。
     */
    selectedId: string | null;
    onSelect: (sourceId: string | null) => void;
}

/**
 * 読み込んだ素材の一覧。
 *
 * 合流したあとのレイヤーツリーからは「どこから来たか」が分かりません
 * （1 素材 = 1 グループとは限らず、空のところへ入れた PSD は包まれない）。
 * 取り込んだ単位で見せて、まとめて置き直す・まとめて捨てるための入口です。
 *
 * 配置は**押した瞬間に画素へ落としません**。数値を持つだけで、書き出しのときに
 * 1 回だけ焼き込みます。倍率を往復しても画質が落ちないようにするためです。
 */
export const SourcesPanel: React.FC<SourcesPanelProps> = ({
    sources, exportedByLayer, onRemove, onTransform, onTransformReset,
    selectedId, onSelect,
}) => {
    const [open, setOpen] = useState(true);
    // 誤って押しても消えないように、その行の中だけで一度確かめる。
    // ダイアログを出すほどではない（取り消しも効く）が、小さい行が並ぶので取り違えやすい。
    const [confirming, setConfirming] = useState<string | null>(null);

    if (sources.length === 0) return null;

    return (
        <div className="sources-panel">
            <button className="sources-head" onClick={() => setOpen(o => !o)}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Layers size={13} />
                <span>素材</span>
                <span className="sources-count">{sources.length}</span>
            </button>

            {open && sources.map(s => {
                const used = s.layerIds.filter(id => exportedByLayer[id]).length;
                const placed = !isIdentitySourceTransform(s.transform);
                const isOpen = selectedId === s.id;
                return (
                    <div key={s.id} className={`source-row ${isOpen ? 'is-open' : ''}`}>
                        <div className="source-line">
                            <button
                                className="source-name"
                                onClick={() => onSelect(isOpen ? null : s.id)}
                                title={`${s.fileName}\nプレビューに枠を出して、まとめて動かす`}
                            >
                                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <span className="source-label">{s.name}</span>
                                {placed && <span className="source-moved" title="配置を変えています">配置</span>}
                            </button>
                            <span className="source-meta">
                                {SOURCE_KIND_LABEL[s.kind]} · {used}/{s.layerIds.length}
                            </span>
                            {confirming === s.id ? (
                                <span className="source-confirm">
                                    <button
                                        className="btn btn-sm btn-danger"
                                        onClick={() => { setConfirming(null); onRemove(s.id); }}
                                    >
                                        削除
                                    </button>
                                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(null)}>
                                        やめる
                                    </button>
                                </span>
                            ) : (
                                <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => setConfirming(s.id)}
                                    title="この素材のレイヤーをまとめて取り除く"
                                >
                                    <Trash2 size={12} />
                                </button>
                            )}
                        </div>

                        {/* 使われていない素材はここで分かる。「素材として使わない」判断の材料。 */}
                        {used === 0 && (
                            <div className="source-unused">
                                書き出し対象のレイヤーがありません（この素材は出力に出ません）
                            </div>
                        )}

                        {isOpen && (
                            <div className="source-transform">
                                <div className="source-tf-row">
                                    <label>位置</label>
                                    <NumberInput
                                        value={s.transform.x} onChange={v => onTransform(s.id, { x: v })}
                                        step={1} title="X（px）" style={{ width: '58px' }}
                                    />
                                    <NumberInput
                                        value={s.transform.y} onChange={v => onTransform(s.id, { y: v })}
                                        step={1} title="Y（px）" style={{ width: '58px' }}
                                    />
                                    <span className="source-unit">px</span>
                                </div>
                                <div className="source-tf-row">
                                    <label>拡大</label>
                                    <NumberInput
                                        value={Math.round(s.transform.scale * 1000) / 10}
                                        onChange={v => onTransform(s.id, { scale: Math.max(0.01, v / 100) })}
                                        min={1} max={2000} step={5} decimals={1}
                                        title="拡大率（%）。縦横は同率" style={{ width: '68px' }}
                                    />
                                    <span className="source-unit">%</span>
                                </div>
                                <div className="source-tf-row">
                                    <label>回転</label>
                                    <NumberInput
                                        value={s.transform.rotation}
                                        onChange={v => onTransform(s.id, { rotation: v })}
                                        min={-360} max={360} step={5} decimals={1}
                                        title="回転角（度）。時計回りが正" style={{ width: '68px' }}
                                    />
                                    <span className="source-unit">°</span>
                                    <button
                                        className="btn btn-sm btn-ghost"
                                        onClick={() => onTransformReset(s.id)}
                                        disabled={!placed}
                                        title="等倍・無回転・原点に戻す"
                                    >
                                        <RotateCcw size={12} />
                                    </button>
                                </div>
                                <div className="source-note">
                                    プレビューの枠を掴んでも動かせます（枠の中＝移動、角＝拡大、上の丸＝回転。
                                    Shift で 15° 刻み）。軸は素材の外接矩形の中心です。
                                    書き出し時に画素へ焼き込まれます（回転は EMG のレイヤーでは表現できないため）。
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
