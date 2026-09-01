import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LayerSlice } from '../types';

interface SliceGuidesProps {
    /** 仕上がりの矩形（キャンバス座標）。 */
    rect: { left: number; top: number; width: number; height: number };
    /** 元画像の大きさ。余白はこちらの px なので、上限の判定に要る。 */
    source: { width: number; height: number };
    slice: LayerSlice;
    /** 表示倍率。画面座標 ⇔ キャンバス座標の換算に使う。 */
    scale: number;
    onChange: (patch: Partial<LayerSlice>) => void;
    onHint: (text: string | null) => void;
}

type Edge = 'left' | 'right' | 'top' | 'bottom';

/**
 * 9 スライスのガイド線。
 *
 * 画像の上に 4 本の線を出し、掴んで**各辺からの余白**を決めます
 * （Roblox の Slice Editor と同じ操作。数値欄と同じ値を指します）。
 *
 * 線は**仕上がりの矩形**の上に置けます。四隅と辺は拡縮されない決まりなので、
 * 仕上がりの中でも余白の幅は元画像の px と一対一で対応するためです
 * （伸びるのは中央と、辺の 1 方向だけ）。
 *
 * 余白の合計が仕上がりを超えるときは `sliceLayer` が比例で詰めるため、線の位置は
 * 実際の継ぎ目とずれます。そのときは線を仕上がりの内側に留めて、掴む先を見失わない
 * ようにします。
 */
export const SliceGuides: React.FC<SliceGuidesProps> = ({
    rect, source, slice, scale, onChange, onHint,
}) => {
    const [drag, setDrag] = useState<Edge | null>(null);
    const rootRef = useRef<SVGSVGElement>(null);
    const originRef = useRef({ x: 0, y: 0 });
    const startRef = useRef({ x: 0, y: 0, value: 0 });

    /** 掴める幅（画面 px）。線そのものは細いので、当たり判定だけ広げる。 */
    const GRAB = 9;

    const clampToRect = (v: number, limit: number) => Math.max(0, Math.min(v, limit));
    // 表示位置。仕上がりの外へは出さない（掴めなくなるため）。
    const gx = (v: number) => clampToRect(v, rect.width);
    const gy = (v: number) => clampToRect(v, rect.height);

    const pos = {
        left: gx(slice.left),
        right: rect.width - gx(slice.right),
        top: gy(slice.top),
        bottom: rect.height - gy(slice.bottom),
    };

    const begin = (edge: Edge) => (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* 捕捉なしで続行 */ }
        const r = rootRef.current?.getBoundingClientRect();
        originRef.current = { x: r?.left ?? 0, y: r?.top ?? 0 };
        startRef.current = { x: e.clientX, y: e.clientY, value: slice[edge] };
        setDrag(edge);
    };

    const apply = useCallback((edge: Edge, next: number) => {
        // 余白は元画像の px。向かい合う 2 本が交差しないように上限を決める。
        const limit = edge === 'left' || edge === 'right'
            ? source.width - slice[edge === 'left' ? 'right' : 'left']
            : source.height - slice[edge === 'top' ? 'bottom' : 'top'];
        const v = Math.max(0, Math.min(Math.round(next), Math.max(0, limit)));
        onChange({ [edge]: v } as Partial<LayerSlice>);
        onHint(`余白 ${({ left: '左', right: '右', top: '上', bottom: '下' } as const)[edge]} ${v}px`);
    }, [onChange, onHint, slice, source]);

    useEffect(() => {
        if (!drag) return;
        const move = (e: PointerEvent) => {
            const s = startRef.current;
            const d = (drag === 'left' || drag === 'right')
                ? (e.clientX - s.x) / scale
                : (e.clientY - s.y) / scale;
            // 右と下の線は、引く向きと余白の増減が逆になる。
            apply(drag, s.value + ((drag === 'right' || drag === 'bottom') ? -d : d));
        };
        const up = () => { setDrag(null); onHint(null); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
    }, [drag, scale, apply, onHint]);

    const x0 = rect.left * scale;
    const y0 = rect.top * scale;
    const w = rect.width * scale;
    const h = rect.height * scale;

    const vLine = (edge: 'left' | 'right', at: number) => (
        <g key={edge}>
            <line
                x1={x0 + at * scale} y1={y0} x2={x0 + at * scale} y2={y0 + h}
                className="slice-guide"
            />
            <line
                x1={x0 + at * scale} y1={y0} x2={x0 + at * scale} y2={y0 + h}
                className="slice-grab"
                strokeWidth={GRAB}
                style={{ cursor: 'ew-resize' }}
                onPointerDown={begin(edge)}
            />
        </g>
    );
    const hLine = (edge: 'top' | 'bottom', at: number) => (
        <g key={edge}>
            <line
                x1={x0} y1={y0 + at * scale} x2={x0 + w} y2={y0 + at * scale}
                className="slice-guide"
            />
            <line
                x1={x0} y1={y0 + at * scale} x2={x0 + w} y2={y0 + at * scale}
                className="slice-grab"
                strokeWidth={GRAB}
                style={{ cursor: 'ns-resize' }}
                onPointerDown={begin(edge)}
            />
        </g>
    );

    return (
        <svg ref={rootRef} className="tf-overlay slice-overlay">
            {/* 伸びない部分（四隅）を薄く塗って、どこが固定なのかを見せる */}
            <rect x={x0} y={y0} width={pos.left * scale} height={pos.top * scale} className="slice-fixed" />
            <rect x={x0 + pos.right * scale} y={y0} width={(rect.width - pos.right) * scale} height={pos.top * scale} className="slice-fixed" />
            <rect x={x0} y={y0 + pos.bottom * scale} width={pos.left * scale} height={(rect.height - pos.bottom) * scale} className="slice-fixed" />
            <rect x={x0 + pos.right * scale} y={y0 + pos.bottom * scale} width={(rect.width - pos.right) * scale} height={(rect.height - pos.bottom) * scale} className="slice-fixed" />

            {vLine('left', pos.left)}
            {vLine('right', pos.right)}
            {hLine('top', pos.top)}
            {hLine('bottom', pos.bottom)}
        </svg>
    );
};
