import React, { useCallback, useEffect, useRef, useState } from 'react';
import { evaluateTransform, transformMatrix } from '../services/transform';
import type { PartTransform, TransformPath } from '../types';

/** パーツの変形前の外接矩形（キャンバス座標）。 */
export interface PartBounds {
    partId: string;
    left: number; top: number; right: number; bottom: number;
}

interface TransformOverlayProps {
    bounds: PartBounds;
    transform: PartTransform;
    /** 表示倍率。画面座標 ⇔ キャンバス座標の換算に使う。 */
    scale: number;
    /** アンカーを置き直すモードか。 */
    anchorMode: boolean;
    /** 変形を適用する時刻。再生中は掴めないようにする。 */
    time: number;
    playing: boolean;
    onChange: (patch: Partial<PartTransform>) => void;
    /** 掴んでいる間だけ出す読み値。 */
    onHint: (text: string | null) => void;
}

type Handle =
    | 'move' | 'rotate' | 'anchor'
    | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 8 方向ハンドルの、矩形内での位置（0..1）。 */
const HANDLE_POS: Record<string, [number, number]> = {
    nw: [0, 0], n: [0.5, 0], ne: [1, 0],
    w: [0, 0.5], e: [1, 0.5],
    sw: [0, 1], s: [0.5, 1], se: [1, 1],
};

const CURSORS: Record<string, string> = {
    nw: 'nwse-resize', se: 'nwse-resize',
    ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize',
    e: 'ew-resize', w: 'ew-resize',
    rotate: 'grab', move: 'move', anchor: 'crosshair',
};

const round = (v: number, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * バウンディングボックス。
 *
 * **掴めるのは「静止時の値」だけです。** 再生中や、そのパスにキーが 2 つ以上ある
 * （＝動いている）場合に掴んで動かすと、キーの値と食い違った状態が作れてしまいます。
 * 動きの編集はタイムライン側の仕事なので、ここでは触らせません。
 *
 * 座標は「変形前のキャンバス座標」で計算し、表示のときだけ §7.4 の行列を通します。
 * 逆にすると、回転済みの絵の上で拡縮ハンドルを引いたときに軸がずれます。
 */
export const TransformOverlay: React.FC<TransformOverlayProps> = ({
    bounds, transform, scale, anchorMode, time, playing, onChange, onHint,
}) => {
    const [drag, setDrag] = useState<Handle | null>(null);
    const startRef = useRef<{
        x: number; y: number; base: PartTransform['base'];
        anchor: { x: number; y: number };
    } | null>(null);

    const w = Math.max(1, bounds.right - bounds.left);
    const h = Math.max(1, bounds.bottom - bounds.top);
    const values = evaluateTransform(transform, time);

    // アンカーの既定は矩形の中心。v0.4.0 §3 の既定（basePosition と同値）は
    // レイヤー単位の話で、パーツを回す中心としては左上すぎて使いものにならない。
    const anchor = transform.anchor ?? { x: bounds.left + w / 2, y: bounds.top + h / 2 };
    const matrix = transformMatrix(values, anchor.x, anchor.y);

    /** 変形前のキャンバス座標 → 画面上の位置（px、キャンバス左上基準）。 */
    const project = useCallback((x: number, y: number) => {
        const p = matrix.transformPoint(new DOMPoint(x, y));
        return { x: p.x * scale, y: p.y * scale };
    }, [matrix, scale]);

    const corners = {
        nw: project(bounds.left, bounds.top),
        ne: project(bounds.right, bounds.top),
        se: project(bounds.right, bounds.bottom),
        sw: project(bounds.left, bounds.bottom),
    };
    const anchorPt = project(anchor.x, anchor.y);
    // 回転ハンドルは上辺の外側。矩形が回っていても常に「上辺の外」に付く。
    const topMid = project((bounds.left + bounds.right) / 2, bounds.top);
    const botMid = project((bounds.left + bounds.right) / 2, bounds.bottom);
    const upLen = Math.hypot(topMid.x - botMid.x, topMid.y - botMid.y) || 1;
    const rotatePt = {
        x: topMid.x + (topMid.x - botMid.x) / upLen * 26,
        y: topMid.y + (topMid.y - botMid.y) / upLen * 26,
    };

    const locked = (path: TransformPath) =>
        (transform.tracks.find(t => t.path === path)?.keys.length ?? 0) > 1;
    const frozen = playing || anchorMode;

    // キャンバスの画面上の原点。掴んだ瞬間に確定させる（ドラッグ中にスクロール
    // されても、掴んだときの座標系で計算し続ける方が挙動が素直）。
    const rootRef = useRef<SVGSVGElement>(null);
    const originRef = useRef({ x: 0, y: 0 });

    const begin = (handle: Handle) => (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // 捕捉できなくてもドラッグ自体は window のリスナーで成立する。
        // ここで例外が出ると掴む処理ごと中断してしまうので握りつぶす。
        try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* 捕捉なしで続行 */ }
        const r = rootRef.current?.getBoundingClientRect();
        originRef.current = { x: r?.left ?? 0, y: r?.top ?? 0 };
        startRef.current = {
            x: e.clientX, y: e.clientY,
            base: { ...transform.base },
            anchor: { ...anchor },
        };
        setDrag(handle);
    };

    /** 画面座標 → 変形前のキャンバス座標。 */
    const toLocal = useCallback((clientX: number, clientY: number) => {
        const p = new DOMPoint(
            (clientX - originRef.current.x) / scale,
            (clientY - originRef.current.y) / scale,
        );
        return matrix.inverse().transformPoint(p);
    }, [matrix, scale]);

    useEffect(() => {
        if (!drag) return;

        const move = (e: PointerEvent) => {
            const s = startRef.current;
            if (!s) return;
            // 画面上の移動量をキャンバス座標に戻す。
            const dx = (e.clientX - s.x) / scale;
            const dy = (e.clientY - s.y) / scale;

            if (drag === 'anchor') {
                const next = { x: round(s.anchor.x + dx), y: round(s.anchor.y + dy) };
                onChange({ anchor: next });
                onHint(`アンカー ${next.x}, ${next.y}`);
                return;
            }

            if (drag === 'move') {
                const base = {
                    ...s.base,
                    translate_x: round(s.base.translate_x + dx),
                    translate_y: round(s.base.translate_y + dy),
                };
                onChange({ base });
                onHint(`移動 ${base.translate_x}, ${base.translate_y} px`);
                return;
            }

            if (drag === 'rotate') {
                // 画面上のアンカーを中心に、掴んだ点との角度差を足す。
                const ax = originRef.current.x + anchorPt.x;
                const ay = originRef.current.y + anchorPt.y;
                const from = Math.atan2(s.y - ay, s.x - ax);
                const to = Math.atan2(e.clientY - ay, e.clientX - ax);
                let deg = s.base.rotation + (to - from) * 180 / Math.PI;
                // Shift で 15° 刻み。細かく合わせたいときは数値欄で入れる。
                if (e.shiftKey) deg = Math.round(deg / 15) * 15;
                const base = { ...s.base, rotation: round(deg, 1) };
                onChange({ base });
                onHint(`回転 ${base.rotation}°`);
                return;
            }

            // 拡縮。掴んだ辺／角の向きにだけ効かせる。
            // 回転済みでも軸がずれないよう、移動量を**変形前の軸**へ戻してから使う。
            const p0 = toLocal(s.x, s.y);
            const p1 = toLocal(e.clientX, e.clientY);
            const lx = p1.x - p0.x;
            const ly = p1.y - p0.y;

            const signX = drag.includes('e') ? 1 : drag.includes('w') ? -1 : 0;
            const signY = drag.includes('s') ? 1 : drag.includes('n') ? -1 : 0;

            let sx = signX === 0 ? s.base.scale_x : s.base.scale_x * (1 + (signX * lx) / w);
            let sy = signY === 0 ? s.base.scale_y : s.base.scale_y * (1 + (signY * ly) / h);

            // Shift で縦横比を保つ。角ハンドルのときだけ意味がある。
            if (e.shiftKey && signX !== 0 && signY !== 0) {
                const k = Math.abs(sx / (s.base.scale_x || 1));
                sx = s.base.scale_x * k;
                sy = s.base.scale_y * k;
            }

            const base = {
                ...s.base,
                scale_x: round(Math.max(0.01, sx), 3),
                scale_y: round(Math.max(0.01, sy), 3),
            };
            onChange({ base });
            onHint(`拡縮 ${base.scale_x} × ${base.scale_y}`);
        };

        const up = () => { setDrag(null); startRef.current = null; onHint(null); };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        };
    }, [drag, scale, w, h, toLocal, anchorPt.x, anchorPt.y, onChange, onHint]);

    const path = `M ${corners.nw.x} ${corners.nw.y} L ${corners.ne.x} ${corners.ne.y} `
        + `L ${corners.se.x} ${corners.se.y} L ${corners.sw.x} ${corners.sw.y} Z`;

    const handleAt = (key: string) => {
        const [fx, fy] = HANDLE_POS[key];
        return project(bounds.left + w * fx, bounds.top + h * fy);
    };

    return (
        <svg
            ref={rootRef}
            className="tf-overlay"
        >
            {/* 枠。掴めるのは中身なので、線自体はイベントを取らない */}
            <path d={path} className="tf-box" />

            {/* **枠の内側は掴みません。** 以前はここに当たり判定の面を敷いていたが、
                外接矩形は透明な余白も他パーツの上も覆うので、
                  - 髪の矩形の下にある顔をクリックしても選べない
                  - 何も描かれていない余白を引いても絵が動く
                という状態だった。移動は「絵そのもの」を引く操作に移し
                （PreviewPanel の当たり判定）、ここはハンドルとアンカーだけにする。 */}

            {/* 回転 */}
            {!frozen && !locked('rotation') && (
                <>
                    <line x1={topMid.x} y1={topMid.y} x2={rotatePt.x} y2={rotatePt.y} className="tf-box" />
                    <circle
                        cx={rotatePt.x} cy={rotatePt.y} r={6}
                        className="tf-handle tf-rotate"
                        style={{ cursor: CURSORS.rotate }}
                        onPointerDown={begin('rotate')}
                    />
                </>
            )}

            {/* 拡縮 */}
            {!frozen && !locked('scale_x') && !locked('scale_y') && Object.keys(HANDLE_POS).map(key => {
                const p = handleAt(key);
                return (
                    <rect
                        key={key}
                        x={p.x - 4} y={p.y - 4} width={8} height={8}
                        className="tf-handle"
                        style={{ cursor: CURSORS[key] }}
                        onPointerDown={begin(key as Handle)}
                    />
                );
            })}

            {/* アンカー。回転・拡縮の中心なので、常に見えている必要がある */}
            <g
                style={{ cursor: anchorMode ? CURSORS.anchor : 'default', pointerEvents: anchorMode ? 'auto' : 'none' }}
                onPointerDown={anchorMode ? begin('anchor') : undefined}
            >
                <circle cx={anchorPt.x} cy={anchorPt.y} r={anchorMode ? 9 : 6} className="tf-anchor" />
                <line x1={anchorPt.x - 9} y1={anchorPt.y} x2={anchorPt.x + 9} y2={anchorPt.y} className="tf-anchor-cross" />
                <line x1={anchorPt.x} y1={anchorPt.y - 9} x2={anchorPt.x} y2={anchorPt.y + 9} className="tf-anchor-cross" />
            </g>
        </svg>
    );
};
