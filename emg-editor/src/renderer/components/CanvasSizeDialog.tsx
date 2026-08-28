import React, { useState } from 'react';
import { FolderOpen, Frame, X } from 'lucide-react';
import { NumberInput } from './NumberInput';

/** 既存の中身を、広くなった／狭くなったキャンバスのどこに置くか。 */
export type CanvasAlign = 'topLeft' | 'center';

interface CanvasSizeDialogProps {
    /** 新規作成なら現在値なし。変更なら今の寸法。 */
    current?: { width: number; height: number };
    /** 変更のとき、外にはみ出す中身があるかを伝えるための実測値。 */
    contentBounds?: { left: number; top: number; right: number; bottom: number } | null;
    onCancel: () => void;
    onApply: (width: number, height: number, align: CanvasAlign) => void;
    /**
     * 既存の `.emg` から始める（新規のときだけ）。
     *
     * 「新規」は空から作るためのものだが、書き出した `.emg` の続きを始めたい
     * ことも同じくらいある。「開く」を探し直させないよう、ここにも置く。
     */
    onOpenEmg?: () => void;
}

const numStyle: React.CSSProperties = {
    width: '84px', padding: '5px 7px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '4px', fontSize: '12px',
};

/**
 * よく使う寸法。**キャラクター用に寄せません。** EMG は背景や UI パーツも
 * 扱うので（`emg-spec-intent.md` §1.1）、動画・配信・正方形を並べます。
 */
const PRESETS: { label: string; w: number; h: number }[] = [
    { label: 'フル HD 横', w: 1920, h: 1080 },
    { label: 'フル HD 縦', w: 1080, h: 1920 },
    { label: '正方形', w: 1024, h: 1024 },
    { label: '立ち絵', w: 1000, h: 2000 },
];

const MAX = 8192;   // アトラスの上限と揃える（emg-json-spec.md 1.3）

export const CanvasSizeDialog: React.FC<CanvasSizeDialogProps> = ({
    current, contentBounds, onCancel, onApply, onOpenEmg,
}) => {
    const [w, setW] = useState(current?.width || 1024);
    const [h, setH] = useState(current?.height || 1024);
    const [align, setAlign] = useState<CanvasAlign>('topLeft');

    const resizing = !!current;
    const valid = w >= 1 && h >= 1 && w <= MAX && h <= MAX;

    // 変更後にキャンバスの外へ出る中身があるか。書き出し自体は落ちないが、
    // 見えない場所に置かれたまま気づかないのが一番困る。
    const spill = (() => {
        if (!contentBounds) return null;
        const dx = align === 'center' ? Math.round((w - (current?.width ?? w)) / 2) : 0;
        const dy = align === 'center' ? Math.round((h - (current?.height ?? h)) / 2) : 0;
        const out = {
            left: contentBounds.left + dx < 0,
            top: contentBounds.top + dy < 0,
            right: contentBounds.right + dx > w,
            bottom: contentBounds.bottom + dy > h,
        };
        const names = [out.left && '左', out.top && '上', out.right && '右', out.bottom && '下']
            .filter(Boolean) as string[];
        return names.length > 0 ? names.join('・') : null;
    })();

    return (
        <div className="modal-backdrop" onClick={onCancel}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '420px' }}>
                <div className="modal-head">
                    <Frame size={15} />
                    <span style={{ flex: 1 }}>{resizing ? 'キャンバスサイズを変更' : '新規作成'}</span>
                    <button className="icon-btn" onClick={onCancel} title="キャンセル"><X size={14} /></button>
                </div>

                <div className="modal-body">
                    <div className="anim-row">
                        <label>幅 × 高さ</label>
                        <NumberInput min={1} max={MAX} value={w} onChange={setW} style={numStyle} />
                        <span className="part-meta">×</span>
                        <NumberInput min={1} max={MAX} value={h} onChange={setH} style={numStyle} />
                        <span className="part-meta">px</span>
                    </div>

                    <div className="frame-strip">
                        {PRESETS.map(p => (
                            <button
                                key={p.label}
                                className={`frame-chip ${w === p.w && h === p.h ? 'previewing' : ''}`}
                                onClick={() => { setW(p.w); setH(p.h); }}
                            >
                                {p.label} <span className="delta-arrow">{p.w}×{p.h}</span>
                            </button>
                        ))}
                        {resizing && current && (
                            <button className="frame-chip" onClick={() => { setW(current.width); setH(current.height); }}>
                                今のまま <span className="delta-arrow">{current.width}×{current.height}</span>
                            </button>
                        )}
                    </div>

                    {resizing && (
                        <>
                            <div className="anim-row">
                                <label>中身の位置</label>
                                <div className="seg">
                                    <button className={`seg-item ${align === 'topLeft' ? 'active' : ''}`}
                                        onClick={() => setAlign('topLeft')}>左上のまま</button>
                                    <button className={`seg-item ${align === 'center' ? 'active' : ''}`}
                                        onClick={() => setAlign('center')}>中央へ寄せる</button>
                                </div>
                            </div>
                            <div className="part-meta" style={{ lineHeight: 1.7 }}>
                                「左上のまま」は座標を一切変えません。書き出した
                                <code> basePosition </code>もそのままなので、既に配布した
                                ファイルと位置がずれません。<br />
                                「中央へ寄せる」は増減分の半分だけ全レイヤーを動かします。
                            </div>
                        </>
                    )}

                    {spill && (
                        <div className="action-warn">
                            この寸法では中身が{spill}にはみ出します。はみ出した部分も書き出されますが、
                            プレビューには映りません。
                        </div>
                    )}

                    {!valid && (
                        <div className="action-warn">
                            1 〜 {MAX}px で指定してください（テクスチャの上限に合わせています）。
                        </div>
                    )}

                    {!resizing && (
                        <>
                            <div className="part-meta" style={{ lineHeight: 1.7 }}>
                                空のキャンバスから始めます。素材はドラッグ&amp;ドロップか
                                「素材を追加」で足してください。
                            </div>
                            {onOpenEmg && (
                                <div className="map-block">
                                    <div className="part-meta" style={{ lineHeight: 1.7 }}>
                                        書き出した <code>.emg</code> の続きから始めることもできます。
                                        パーツ・差分・アニメーション・まばたきの設定まで戻ります。
                                    </div>
                                    <button className="btn btn-block" onClick={onOpenEmg}>
                                        <FolderOpen size={14} /> 既存の .emg を開く
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="modal-foot">
                    <button className="btn" onClick={onCancel}>キャンセル</button>
                    <button className="btn btn-primary" disabled={!valid}
                        onClick={() => onApply(w, h, align)}>
                        {resizing ? '変更する' : '作成する'}
                    </button>
                </div>
            </div>
        </div>
    );
};
