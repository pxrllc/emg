import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3, X } from 'lucide-react';
import {
    DEFAULT_GRID, resolveGrid, cellRect, type SheetGrid,
} from '../services/SpriteSheetLoader';
import { NumberInput } from './NumberInput';

interface SpriteSheetDialogProps {
    file: File;
    onCancel: () => void;
    onImport: (source: HTMLCanvasElement, grid: SheetGrid, fps: number) => void;
}

const numStyle: React.CSSProperties = {
    width: '64px', padding: '4px 6px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '3px', fontSize: '12px',
};

/**
 * スプライトシートの格子を決める画面。
 *
 * シートにはコマの区切りも時間も入っていないため、GIF のように読み込むだけでは
 * 済まない。**切り出し線を重ねて見せながら**指定させることで、
 * 取り込んでから間違いに気づく事態を避ける。
 */
export const SpriteSheetDialog: React.FC<SpriteSheetDialogProps> = ({ file, onCancel, onImport }) => {
    const [source, setSource] = useState<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [grid, setGrid] = useState<SheetGrid>(DEFAULT_GRID);
    const [fps, setFps] = useState(12);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // 画像を読み込む
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const bitmap = await createImageBitmap(file);
                if (cancelled) { bitmap.close(); return; }
                const c = document.createElement('canvas');
                c.width = bitmap.width;
                c.height = bitmap.height;
                c.getContext('2d')!.drawImage(bitmap, 0, 0);
                bitmap.close();
                setSource(c);
                // 正方形のコマを仮定した初期値。だいたいのシートはこれで当たる。
                setGrid(g => ({ ...g, cellWidth: Math.round(c.width / g.columns), cellHeight: Math.round(c.height / g.rows) }));
            } catch {
                if (!cancelled) setError('画像として読み込めませんでした。');
            }
        })();
        return () => { cancelled = true; };
    }, [file]);

    const resolved = useMemo(
        () => source ? resolveGrid(source.width, source.height, grid) : null,
        [source, grid]
    );

    // 画像 + 切り出し線を描く
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !source || !resolved) return;

        const maxW = 440;
        const maxH = 300;
        const scale = Math.min(1, maxW / source.width, maxH / source.height);
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        const total = resolved.columns * resolved.rows;
        ctx.lineWidth = 1;
        for (let i = 0; i < total; i++) {
            const r = cellRect(i, resolved, grid);
            if (r.x + r.width > source.width || r.y + r.height > source.height) continue;
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
            ctx.strokeRect(
                Math.round(r.x * scale) + 0.5,
                Math.round(r.y * scale) + 0.5,
                Math.round(r.width * scale) - 1,
                Math.round(r.height * scale) - 1
            );
        }
    }, [source, resolved, grid]);

    const frameCount = resolved ? resolved.columns * resolved.rows : 0;
    const set = (patch: Partial<SheetGrid>) => setGrid(g => ({ ...g, ...patch }));

    return (
        <div className="modal-backdrop" onClick={onCancel}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <Grid3x3 size={15} />
                    <span style={{ flex: 1 }}>スプライトシートの切り出し — {file.name}</span>
                    <button className="icon-btn" onClick={onCancel} title="キャンセル"><X size={14} /></button>
                </div>

                {error ? (
                    <div className="empty-state">{error}</div>
                ) : !source ? (
                    <div className="empty-state">読み込み中…</div>
                ) : (
                    <>
                        <div className="sheet-preview">
                            <canvas ref={canvasRef} />
                        </div>

                        <div className="modal-body">
                            <div className="anim-row">
                                <label>指定</label>
                                <div className="seg">
                                    <button
                                        className={`seg-item ${grid.mode === 'count' ? 'active' : ''}`}
                                        onClick={() => set({ mode: 'count' })}
                                    >コマ数</button>
                                    <button
                                        className={`seg-item ${grid.mode === 'size' ? 'active' : ''}`}
                                        onClick={() => set({ mode: 'size' })}
                                    >コマの寸法</button>
                                </div>
                            </div>

                            {grid.mode === 'count' ? (
                                <div className="anim-row">
                                    <label>列 × 行</label>
                                    <NumberInput min={1} value={grid.columns}
                                        onChange={v => set({ columns: v })} style={numStyle} />
                                    <span className="part-meta">×</span>
                                    <NumberInput min={1} value={grid.rows}
                                        onChange={v => set({ rows: v })} style={numStyle} />
                                </div>
                            ) : (
                                <div className="anim-row">
                                    <label>幅 × 高さ</label>
                                    <NumberInput min={1} value={grid.cellWidth}
                                        onChange={v => set({ cellWidth: v })} style={numStyle} />
                                    <span className="part-meta">×</span>
                                    <NumberInput min={1} value={grid.cellHeight}
                                        onChange={v => set({ cellHeight: v })} style={numStyle} />
                                    <span className="part-meta">px</span>
                                </div>
                            )}

                            <div className="anim-row">
                                <label>余白 / 間隔</label>
                                <NumberInput min={0} value={grid.margin}
                                        onChange={v => set({ margin: v })} style={numStyle} />
                                <NumberInput min={0} value={grid.spacing}
                                        onChange={v => set({ spacing: v })} style={numStyle} />
                                <span className="part-meta">px</span>
                            </div>

                            <div className="anim-row">
                                <label>速さ</label>
                                <NumberInput min={1} max={120} value={fps}
                                    onChange={setFps} style={numStyle} />
                                <span className="part-meta">fps（シートに時間の情報が無いため指定が要ります）</span>
                            </div>

                            <label className="anim-row" style={{ cursor: 'pointer' }}>
                                <input type="checkbox" checked={grid.skipEmpty}
                                    onChange={e => set({ skipEmpty: e.target.checked })} />
                                空のコマを取り込まない
                            </label>

                            <div className="part-meta">
                                {source.width}×{source.height} → {resolved?.columns}×{resolved?.rows} =
                                {' '}<b>{frameCount} コマ</b>（1 コマ {resolved?.cellWidth}×{resolved?.cellHeight}px）
                            </div>
                        </div>

                        <div className="modal-foot">
                            <button className="btn" onClick={onCancel}>キャンセル</button>
                            <button
                                className="btn btn-primary"
                                onClick={() => onImport(source, grid, fps)}
                                disabled={frameCount === 0}
                            >
                                {frameCount} コマを取り込む
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
