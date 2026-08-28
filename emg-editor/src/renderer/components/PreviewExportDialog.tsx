import React, { useState } from 'react';
import { Clapperboard, Download, X } from 'lucide-react';
import { NumberInput } from './NumberInput';
import { canRecordWebm, type PreviewFormat } from '../services/previewExport';

interface PreviewExportDialogProps {
    /** 一番長いアセットの尺（秒）。0 なら動くものがない。 */
    contentDuration: number;
    canvas: { width: number; height: number };
    busy: { phase: string; ratio: number } | null;
    /**
     * 出来上がったが、まだ保存していないもの。
     *
     * 保存ダイアログを出せない環境では、書き出しの直後に自動で落とすと
     * ブラウザに黙って捨てられることがある（操作から続いていない扱い）。
     * 押されたときに落とすため、ここに置いて保存ボタンを出す。
     */
    result: { name: string; size: number } | null;
    onSaveResult: () => void;
    onCancel: () => void;
    onExport: (o: {
        format: PreviewFormat; duration: number; fps: number;
        scale: number; background: 'transparent' | string;
    }) => void;
}

const numStyle: React.CSSProperties = {
    width: '76px', padding: '5px 7px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '4px', fontSize: '12px',
};

/**
 * プレビューをアニメーションとして書き出す画面。
 *
 * **既定の尺は一番長いアセットに合わせます。** 手で入れ直さなくても、
 * 作ったものが 1 周する長さで出るのが普通に欲しい結果なので。
 */
export const PreviewExportDialog: React.FC<PreviewExportDialogProps> = ({
    contentDuration, canvas, busy, result, onSaveResult, onCancel, onExport,
}) => {
    const [format, setFormat] = useState<PreviewFormat>('gif');
    // 動くものが無ければ 1 秒。0 秒だと 1 コマも出ない。
    const [duration, setDuration] = useState(contentDuration > 0 ? contentDuration : 1);
    const [fps, setFps] = useState(20);
    const [scale, setScale] = useState(1);
    const [transparent, setTransparent] = useState(true);

    const webmOk = canRecordWebm();
    const frames = Math.max(1, Math.round(duration * fps));
    const outW = Math.round(canvas.width * scale);
    const outH = Math.round(canvas.height * scale);
    // GIF は 1 枚まるごと保持するので、大きすぎると詰まる。目安を出す。
    const heavy = format === 'gif' && frames * outW * outH > 120_000_000;

    return (
        <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '440px' }}>
                <div className="modal-head">
                    <Clapperboard size={15} />
                    <span style={{ flex: 1 }}>プレビューを書き出す</span>
                    {!busy && (
                        <button className="icon-btn" onClick={onCancel} title="キャンセル"><X size={14} /></button>
                    )}
                </div>

                <div className="modal-body">
                    <div className="anim-row">
                        <label>形式</label>
                        <div className="seg">
                            <button className={`seg-item ${format === 'gif' ? 'active' : ''}`}
                                onClick={() => setFormat('gif')}>GIF</button>
                            <button className={`seg-item ${format === 'webm' ? 'active' : ''}`}
                                onClick={() => setFormat('webm')} disabled={!webmOk}
                                title={webmOk ? undefined : 'この環境では書き出せません'}>動画（WebM）</button>
                        </div>
                    </div>

                    <div className="anim-row">
                        <label>尺</label>
                        <NumberInput min={0.05} max={120} step={0.5} decimals={2}
                            value={duration} onChange={setDuration} style={numStyle} />
                        <span className="part-meta">秒</span>
                        {contentDuration > 0 && (
                            <button className="frame-chip" onClick={() => setDuration(contentDuration)}
                                title="一番長いアセットに合わせる">
                                アセットに合わせる <span className="delta-arrow">{contentDuration}s</span>
                            </button>
                        )}
                    </div>

                    <div className="anim-row">
                        <label>fps</label>
                        <NumberInput min={1} max={60} value={fps} onChange={setFps} style={numStyle} />
                        <span className="part-meta">・倍率</span>
                        <NumberInput min={0.1} max={4} step={0.1} decimals={2}
                            value={scale} onChange={setScale} style={numStyle} />
                        <span className="part-meta">{outW} × {outH} px</span>
                    </div>

                    <label className="anim-row" style={{ cursor: 'pointer' }}>
                        <input type="checkbox" checked={transparent}
                            onChange={e => setTransparent(e.target.checked)} />
                        背景を透明にする
                    </label>

                    <div className="part-meta" style={{ lineHeight: 1.7 }}>
                        {frames} コマ。
                        {format === 'gif'
                            ? 'GIF の透明は 1 段階だけなので、半透明の縁はギザつきます。'
                            : 'WebM は半透明をそのまま保てます。'}
                        {contentDuration === 0 && (
                            <><br />動くものがまだ無いので、静止した絵が続くだけになります。</>
                        )}
                    </div>

                    {heavy && (
                        <div className="action-warn">
                            コマ数と大きさの積が大きく、時間とメモリを使います。
                            倍率か fps を下げるか、動画で書き出してください。
                        </div>
                    )}

                    {result && !busy && (
                        <div className="map-block">
                            <div className="map-head">できました</div>
                            <div className="part-meta">
                                {result.name} — {Math.round(result.size / 1024)} KB
                            </div>
                            <button className="btn btn-primary btn-block" onClick={onSaveResult}>
                                <Download size={14} /> 保存する
                            </button>
                        </div>
                    )}

                    {busy && (
                        <>
                            <div className="progress-track">
                                <div className="progress-fill"
                                    style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
                            </div>
                            <div className="action-hint">
                                {busy.phase} — {Math.round(busy.ratio * 100)}%
                            </div>
                        </>
                    )}
                </div>

                <div className="modal-foot">
                    <button className="btn" onClick={onCancel} disabled={!!busy}>キャンセル</button>
                    <button
                        className="btn btn-primary"
                        disabled={!!busy}
                        onClick={() => onExport({
                            format, duration, fps, scale,
                            background: transparent ? 'transparent' : '#ffffff',
                        })}
                    >
                        {busy ? '書き出し中…' : result ? 'もう一度書き出す' : '書き出す'}
                    </button>
                </div>
            </div>
        </div>
    );
};
