import React, { useCallback, useRef } from 'react';
import { Diamond, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { evaluateTransform, foldTime, hasAnimation } from '../services/transform';
import {
    TRANSFORM_PATHS, type PartTransform, type TransformPath, type TransformTrack,
} from '../types';

interface TransformTimelineProps {
    partId: string;
    /** このパーツのフレーム識別子（背面→前面）。対象の切り替えに使う。 */
    frames: string[];
    /** 今編集している対象。undefined ならパーツ全体。 */
    target?: string;
    onTargetChange: (frame?: string) => void;
    /** 対象ごとに何か入っているか（選択欄に印を出す）。 */
    hasTransform: (frame?: string) => boolean;
    transform: PartTransform;
    /** 今の再生時刻（秒）。停止中も位置を保つ。 */
    time: number;
    /** 別の対象を再生中で、この対象は止まっている。 */
    frozen?: boolean;
    playing: boolean;
    onChange: (patch: Partial<PartTransform>) => void;
    onSeek: (t: number) => void;
    onPlayToggle: () => void;
    onReset: () => void;
}

const numStyle: React.CSSProperties = {
    width: '62px', padding: '3px 4px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '3px', fontSize: '11px',
};

const selStyle: React.CSSProperties = {
    padding: '3px 4px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '3px', fontSize: '11px',
};

const round = (v: number, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * 1 パーツ分のトランスフォーム・タイムライン（v0.5.0 §7）。
 *
 * **6 つのパスをそれぞれ独立した行にします。** 仕様がパスごとの独立したキー列と
 * 補間として定義しているためで（§7.2・§7.5）、まとめて 1 本のキーにすると
 * 「回転だけ step、移動は linear」が表現できなくなります。
 *
 * 値の入力欄はキーが無ければ `base` を、あれば**再生位置のキー**を編集します。
 * 同じ欄が 2 つの意味を持つように見えますが、`base` は「トラックが無いときの値」
 * なので（types.ts の `PartTransform`）、この 2 つは同時には存在しません。
 */
export const TransformTimeline: React.FC<TransformTimelineProps> = ({
    partId, frames, target, onTargetChange, hasTransform,
    transform, time, frozen, playing, onChange, onSeek, onPlayToggle, onReset,
}) => {
    const laneRef = useRef<HTMLDivElement>(null);
    const duration = Math.max(0.05, transform.duration);
    const values = evaluateTransform(transform, time);
    const animated = hasAnimation(transform);

    const trackOf = (path: TransformPath) => transform.tracks.find(t => t.path === path);

    const putTrack = (path: TransformPath, next: TransformTrack | null) => {
        const rest = transform.tracks.filter(t => t.path !== path);
        onChange({ tracks: next ? [...rest, next] : rest });
    };

    /** 今の再生位置にキーを打つ。既にその時刻にあれば値を置き換える。 */
    const addKey = (path: TransformPath, v: number) => {
        const cur = trackOf(path);
        // 再生位置と同じ折り返し後の時刻に打つ。素の time を使うと、
        // ループ長を超えた位置では打ったキーが読まれず、入力が消えたように見える。
        const t = round(foldTime(time, duration, transform.loop, transform.phaseOffset));
        const keys = [...(cur?.keys ?? [])].filter(k => Math.abs(k.t - t) > 0.001);
        keys.push({ t, v: round(v) });
        keys.sort((a, b) => a.t - b.t);
        putTrack(path, { path, keys, interpolation: cur?.interpolation ?? 'linear' });
    };

    const removeKeyAt = (path: TransformPath, t: number) => {
        const cur = trackOf(path);
        if (!cur) return;
        const keys = cur.keys.filter(k => k.t !== t);
        putTrack(path, keys.length > 0 ? { ...cur, keys } : null);
    };

    /** 数値欄。キーが無ければ base、あれば再生位置のキーを動かす。 */
    const setValue = (path: TransformPath, v: number) => {
        const cur = trackOf(path);
        if (!cur || cur.keys.length === 0) {
            onChange({ base: { ...transform.base, [path]: round(v) } });
        } else {
            addKey(path, v);
        }
    };

    const seekFromEvent = useCallback((clientX: number) => {
        const el = laneRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
        onSeek(round(ratio * duration));
    }, [duration, onSeek]);

    const scrubStart = (e: React.PointerEvent) => {
        seekFromEvent(e.clientX);
        const move = (ev: PointerEvent) => seekFromEvent(ev.clientX);
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    const playheadPct = Math.min(100, Math.max(0, (time / duration) * 100));

    return (
        <div className="tl" onClick={e => e.stopPropagation()}>
            {/* 対象。0.5.3 §7.4.1 でフレームごとに別の動きを持てる。
                体というまとまりを保ったまま髪だけ揺らす、といった用途のため。 */}
            {frames.length > 1 && (
                <div className="anim-row">
                    <label className="tl-lbl">動かす対象</label>
                    <select
                        value={target ?? ''}
                        onChange={e => onTargetChange(e.target.value || undefined)}
                        style={{ ...selStyle, flex: 1, minWidth: 0 }}
                        title="パーツ全体か、その中の 1 つか"
                    >
                        <option value="">パーツ全体（{partId}）{hasTransform() ? ' ●' : ''}</option>
                        {frames.map(f => (
                            <option key={f} value={f}>{f}{hasTransform(f) ? ' ●' : ''}</option>
                        ))}
                    </select>
                </div>
            )}

            <div className="tl-head">
                <button
                    className={`icon-btn ${playing ? 'on' : ''}`}
                    onClick={onPlayToggle}
                    disabled={!animated}
                    title={animated
                        ? (playing ? '停止' : `${partId} を再生`)
                        : 'キーが 2 つ以上ある行がまだありません'}
                >
                    {playing ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <button className="icon-btn" onClick={onReset} title="先頭に戻す">
                    <RotateCcw size={12} />
                </button>
                <span className="tl-time">{time.toFixed(2)}s</span>
                {frozen && (
                    <span className="part-meta">別のパーツを再生中（ここは停止）</span>
                )}

                <label className="tl-lbl">尺</label>
                <input
                    type="number" min={0.05} step={0.1} value={transform.duration}
                    onChange={e => onChange({ duration: Math.max(0.05, parseFloat(e.target.value) || 0.05) })}
                    style={numStyle}
                />
                <select
                    value={transform.loop}
                    onChange={e => onChange({ loop: e.target.value as PartTransform['loop'] })}
                    style={selStyle}
                    title="§7.6。once は最後のキーの値を保持します"
                >
                    <option value="loop">ループ</option>
                    <option value="pingpong">往復</option>
                    <option value="once">1 回だけ</option>
                </select>
            </div>

            {/* 目盛りとプレイヘッド。ここを掴むとスクラブできる */}
            <div className="tl-ruler" ref={laneRef} onPointerDown={scrubStart}>
                {[0, 0.25, 0.5, 0.75, 1].map(f => (
                    <span key={f} className="tl-tick" style={{ left: `${f * 100}%` }}>
                        {round(duration * f, 2)}
                    </span>
                ))}
                <div className="tl-playhead" style={{ left: `${playheadPct}%` }} />
            </div>

            {TRANSFORM_PATHS.map(p => {
                const track = trackOf(p.path);
                const keys = track?.keys ?? [];
                const moving = keys.length > 1;
                return (
                    <div className={`tl-row ${moving ? 'moving' : ''}`} key={p.path}>
                        <span className="tl-name">{p.label}</span>

                        <input
                            type="number"
                            step={p.step}
                            value={round(values[p.path])}
                            onChange={e => setValue(p.path, parseFloat(e.target.value) || 0)}
                            style={numStyle}
                            title={moving ? '再生位置にキーを打ちます' : '静止時の値'}
                        />
                        <span className="tl-unit">{p.unit}</span>

                        <button
                            className="icon-btn"
                            onClick={() => addKey(p.path, values[p.path])}
                            title="再生位置にキーを打つ"
                        >
                            <Plus size={11} />
                        </button>

                        <div className="tl-lane" onPointerDown={scrubStart}>
                            {keys.map(k => (
                                <button
                                    key={k.t}
                                    className={`tl-key ${Math.abs(k.t - time) < 0.02 ? 'at' : ''}`}
                                    style={{ left: `${Math.min(100, (k.t / duration) * 100)}%` }}
                                    title={`${k.t}s = ${k.v}${p.unit} — クリックで移動、右クリックで削除`}
                                    onPointerDown={e => e.stopPropagation()}
                                    onClick={() => onSeek(k.t)}
                                    onContextMenu={e => { e.preventDefault(); removeKeyAt(p.path, k.t); }}
                                >
                                    <Diamond size={9} />
                                </button>
                            ))}
                            <div className="tl-playhead thin" style={{ left: `${playheadPct}%` }} />
                        </div>

                        {track && (
                            <>
                                <select
                                    value={track.interpolation}
                                    onChange={e => putTrack(p.path, {
                                        ...track,
                                        interpolation: e.target.value as TransformTrack['interpolation'],
                                    })}
                                    style={{ ...selStyle, width: '68px' }}
                                    title="§7.5。cubic は Catmull-Rom に固定"
                                >
                                    <option value="linear">線形</option>
                                    <option value="step">保持</option>
                                    <option value="cubic">曲線</option>
                                </select>
                                <button
                                    className="icon-btn"
                                    onClick={() => putTrack(p.path, null)}
                                    title="この行のキーを全部消す"
                                >
                                    <Trash2 size={11} color="#777" />
                                </button>
                            </>
                        )}
                    </div>
                );
            })}

            <div className="part-meta">
                {target !== undefined && (
                    <>「{target}」だけを動かします。回転・拡縮の中心もこの対象のものになります
                    （<code>targetLayer</code>、0.5.3）。<br /></>
                )}
                キーが 1 つだけの行は「静止した値」として書き出します
                （<code>loop: "once"</code> が最後のキーの値を保持します）。
                移動だけは <code>basePosition</code> に畳み込むのでトラックになりません。
            </div>
        </div>
    );
};
