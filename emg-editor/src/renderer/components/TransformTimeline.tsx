import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Diamond, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { evaluateTransform, foldTime, hasAnimation } from '../services/transform';
import { NumberInput } from './NumberInput';
import { applyEasing, EASING_PRESETS } from '../services/easing';
import {
    TRANSFORM_PATHS, type PartTransform, type TransformPath, type TransformTrack,
} from '../types';

interface TransformTimelineProps {
    partId: string;
    /**
     * 見出しに出す名前。ヌルを選んでいるときはヌルの名前になる。
     *
     * ヌルは「メンバーが同じトランスフォームを共有している」状態なので、中身は
     * メンバー 1 つのタイムラインそのものです。ただし partID を出すと、
     * 触っているのがそのパーツだけに見えてしまうため、表示だけ差し替えます。
     */
    label?: string;
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
    partId, label, frames, target, onTargetChange, hasTransform,
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
        setSelected(s => (s && s.path === path && s.t === t) ? null : s);
    };

    /**
     * 選んでいるキー。Del / Backspace の宛先と、イージングを掛ける区間の起点。
     *
     * 「再生位置のキー」を暗黙の対象にはしません。再生位置はスクラブで動くので、
     * 消したつもりのものと消えるものが食い違います。
     */
    const [selected, setSelected] = useState<{ path: TransformPath; t: number } | null>(null);

    /**
     * ドラッグ中に読む最新の状態。
     *
     * ポインタのリスナーは `window` に付くので、閉じ込めた `transform` は 1 回目の
     * 移動で古くなります（動かした結果が state に入ると再描画されるため）。
     * 参照から読めば、常にいまのキー列を見て隣との間隔を決められます。
     */
    const transformRef = useRef(transform);
    transformRef.current = transform;

    /** キーを掴んでいる間の状態。`curT` は「いま書き込んである時刻」。 */
    const keyDrag = useRef<{
        path: TransformPath; v: number; curT: number;
        startX: number; laneW: number; moved: boolean;
    } | null>(null);

    /**
     * キーを掴んで時刻を変える。
     *
     * **隣のキーは追い越せません。** 追い越せるようにすると、イージングを掛けた区間の
     * 内と外が入れ替わって、指定した曲線と結果が食い違います。並びが保たれていれば
     * 「このキーから次まで」という区間の意味がずっと同じままです。
     */
    const keyPointerDown = (path: TransformPath, t: number, v: number) =>
        (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const lane = (e.currentTarget as HTMLElement).parentElement;
            const laneW = Math.max(1, lane?.getBoundingClientRect().width ?? 1);
            keyDrag.current = { path, v, curT: t, startX: e.clientX, laneW, moved: false };
            setSelected({ path, t });

            const move = (ev: PointerEvent) => {
                const d = keyDrag.current;
                if (!d) return;
                const dx = ev.clientX - d.startX;
                if (!d.moved && Math.abs(dx) < 3) return;   // 数 px の揺れでは動かさない
                d.moved = true;

                const cur = transformRef.current.tracks.find(tr => tr.path === d.path);
                if (!cur) return;
                const others = cur.keys.filter(k => k.t !== d.curT).sort((a, b) => a.t - b.t);
                const prev = [...others].reverse().find(k => k.t < d.curT);
                const next = others.find(k => k.t > d.curT);
                const GAP = 0.01;
                const lo = prev ? prev.t + GAP : 0;
                const hi = next ? next.t - GAP : duration;

                const raw = t + (dx / d.laneW) * duration;
                const nt = round(Math.min(hi, Math.max(lo, raw)));
                if (nt === d.curT) return;

                putTrack(d.path, {
                    ...cur,
                    keys: [...others, { t: nt, v: d.v }].sort((a, b) => a.t - b.t),
                });
                d.curT = nt;
                setSelected({ path: d.path, t: nt });
                onSeek(nt);
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                // 掴んだだけ（動かさなかった）ならその時刻へ移動する。
                if (keyDrag.current && !keyDrag.current.moved) onSeek(keyDrag.current.curT);
                keyDrag.current = null;
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        };

    // Del / Backspace で選択中のキーを消す。文字を打っている最中は横取りしない。
    useEffect(() => {
        if (!selected) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            const el = e.target as HTMLElement | null;
            if (el && (el.isContentEditable
                || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
            e.preventDefault();
            removeKeyAt(selected.path, selected.t);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    /**
     * 選んだキーから**次のキーまで**の区間にイージングを焼き込む。
     *
     * §7.5 の補間は step / linear / cubic の 3 つだけで、曲線を書く場所がありません。
     * 曲線を標本化したキーを挿し、補間は linear にします（`easing.ts` を参照）。
     */
    const applyEasingToSegment = (presetId: string) => {
        if (!selected) return;
        const cur = trackOf(selected.path);
        if (!cur) return;
        const sorted = [...cur.keys].sort((a, b) => a.t - b.t);
        const i = sorted.findIndex(k => k.t === selected.t);
        if (i < 0 || i >= sorted.length - 1) return;   // 最後のキーには「次」が無い
        const preset = EASING_PRESETS.find(p => p.id === presetId);
        if (!preset) return;
        putTrack(selected.path, {
            ...cur,
            keys: applyEasing(sorted, sorted[i], sorted[i + 1], preset.bezier),
            interpolation: 'linear',
        });
    };

    /** 選択中のキーに「次」があるか。無ければイージングは掛けられない。 */
    const selectedHasNext = (() => {
        if (!selected) return false;
        const cur = trackOf(selected.path);
        if (!cur) return false;
        return cur.keys.some(k => k.t > selected.t + 1e-6);
    })();

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
                        <option value="">パーツ全体（{label ?? partId}）{hasTransform() ? ' ●' : ''}</option>
                        {frames.map(f => (
                            <option key={f} value={f}>{f}{hasTransform(f) ? ' ●' : ''}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* いま何を動かしているか。ヌルのときは対象の選択欄が出ないので、
                ここに出さないと「どれを触っているのか」が画面上に無くなる。 */}
            <div className="tl-target">
                {label
                    ? <><b>{label}</b> をまとめて動かします</>
                    : <><b>{partId}</b> の動き</>}
            </div>

            {/* 選んだキーの操作。イージングは「このキーから次のキーまで」に掛かる。 */}
            {selected && (
                <div className="tl-sel">
                    <span className="tl-sel-what">
                        {TRANSFORM_PATHS.find(p => p.path === selected.path)?.label} · {selected.t}s
                    </span>
                    <select
                        style={selStyle}
                        defaultValue=""
                        disabled={!selectedHasNext}
                        onChange={e => { applyEasingToSegment(e.target.value); e.currentTarget.value = ''; }}
                        title={selectedHasNext
                            ? 'このキーから次のキーまでの動き方'
                            : '最後のキーには「次」が無いので掛けられません'}
                    >
                        <option value="" disabled>イージング…</option>
                        {EASING_PRESETS.map(p => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                    <button
                        className="icon-btn"
                        onClick={() => removeKeyAt(selected.path, selected.t)}
                        title="このキーを削除（Del / Backspace）"
                    >
                        <Trash2 size={12} />
                    </button>
                    <span className="tl-sel-hint">Del で削除</span>
                </div>
            )}

            <div className="tl-head">
                <button
                    className={`icon-btn ${playing ? 'on' : ''}`}
                    onClick={onPlayToggle}
                    disabled={!animated}
                    title={animated
                        ? (playing ? '停止' : `${label ?? partId} を再生`)
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
                <NumberInput
                    min={0.05} step={0.1} decimals={2} value={transform.duration}
                    onChange={v => onChange({ duration: v })}
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

                        <NumberInput
                            step={p.step}
                            decimals={3}
                            value={round(values[p.path])}
                            onChange={v => setValue(p.path, v)}
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
                                    className={`tl-key ${Math.abs(k.t - time) < 0.02 ? 'at' : ''}`
                                        + (selected && selected.path === p.path && selected.t === k.t ? ' sel' : '')}
                                    style={{ left: `${Math.min(100, (k.t / duration) * 100)}%` }}
                                    title={`${k.t}s = ${k.v}${p.unit} — 掴んで時刻を変更、Del で削除`}
                                    onPointerDown={keyPointerDown(p.path, k.t, k.v)}
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
