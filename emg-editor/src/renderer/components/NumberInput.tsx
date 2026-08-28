import React, { useEffect, useRef, useState } from 'react';

interface NumberInputProps {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    /** 小数を何桁まで受けるか。整数なら 0。 */
    decimals?: number;
    style?: React.CSSProperties;
    title?: string;
    className?: string;
    disabled?: boolean;
}

/**
 * 数値の入力欄。
 *
 * **打っている途中は空にできます。** 素の `<input type="number">` に
 * `value={n}` と `onChange={e => setN(parseInt(e.target.value) || 1)}` を書くと、
 * 一文字消した瞬間に既定値へ飛ぶため、1280 を 960 にするだけで
 * 「1 を残す → 1960 にする → 960 にする → 1 を消す」という操作になります。
 *
 * そこで**打っている間は文字列のまま持ち**、数として読めたときだけ親に渡します。
 * 範囲外への丸めと、空のまま離れたときの復帰は**確定時（blur / Enter）**に行います。
 * 打っている最中に丸めると、下限より小さい値を経由する入力（10 → 5 と打ちたいのに
 * 途中の 1 で弾かれる）ができなくなるためです。
 */
export const NumberInput: React.FC<NumberInputProps> = ({
    value, onChange, min, max, step, decimals = 0, style, title, className, disabled,
}) => {
    const [text, setText] = useState(String(value));
    const focused = useRef(false);

    // 外から値が変わったら追従する。ただし打っている最中は邪魔しない。
    useEffect(() => {
        if (!focused.current) setText(String(value));
    }, [value]);

    const parse = (s: string): number | null => {
        if (s.trim() === '' || s === '-' || s === '.' || s === '-.') return null;
        const n = decimals > 0 ? parseFloat(s) : parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
    };

    const clamp = (n: number): number => {
        let v = n;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        const p = 10 ** decimals;
        return Math.round(v * p) / p;
    };

    const commit = () => {
        focused.current = false;
        const n = parse(text);
        // 空のまま離れたら、元の値に戻す。勝手に既定値へ飛ばさない。
        const next = n === null ? value : clamp(n);
        setText(String(next));
        if (next !== value) onChange(next);
    };

    return (
        <input
            type="text"
            inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={text}
            style={style}
            title={title}
            className={className}
            disabled={disabled}
            onFocus={() => { focused.current = true; }}
            onChange={e => {
                const s = e.target.value;
                setText(s);
                // 読める数になった時点で親へ流す。範囲の丸めはまだしない。
                const n = parse(s);
                if (n !== null && n !== value) onChange(n);
            }}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
                if (e.key === 'Escape') { setText(String(value)); (e.target as HTMLInputElement).blur(); }
                // 上下キーは type=number の代わりに自前で刻む。
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const d = (step ?? 1) * (e.key === 'ArrowUp' ? 1 : -1);
                    const next = clamp((parse(text) ?? value) + d);
                    setText(String(next));
                    onChange(next);
                }
            }}
        />
    );
};
