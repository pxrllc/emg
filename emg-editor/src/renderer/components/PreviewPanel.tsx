import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Move3d, Crosshair } from 'lucide-react';
import { evaluateTransform, transformMatrix } from '../services/transform';
import { TransformOverlay, type PartBounds } from './TransformOverlay';
import { emptyTransform, transformKey, type PartTransform } from '../types';

export interface PreviewItem {
    id: number;
    /** どのパーツのレイヤーか。 */
    partId: string;
    /** フレーム識別子。0.5.3 §7.4.1 のフレーム単位トランスフォームの宛先。 */
    frameId: string;
    image: HTMLCanvasElement;
    left: number;
    top: number;
    /** レイヤー自身の不透明度。§7.4 の 6 番目でトランスフォーム側と掛け合わせる。 */
    opacity: number;
}

interface PreviewPanelProps {
    /** アトラス画像。分割されている場合は複数枚（emg-json-spec.md 1.3）。 */
    atlasUrls: string[];
    compositionItems: PreviewItem[];
    width: number;
    height: number;

    /** 添字は partID か「partID + フレーム識別子」（0.5.3 §7.4.1）。 */
    transforms: Record<string, PartTransform>;
    selectedPartId: string | null;
    onSelectPart: (partId: string) => void;
    onTransformChange: (key: string, patch: Partial<PartTransform>) => void;
    /** 再生時刻（秒）。停止中は 0。 */
    time: number;
    playing: boolean;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
    atlasUrls, compositionItems, width, height,
    transforms, selectedPartId, onSelectPart, onTransformChange, time, playing,
}) => {
    // 掴む対象を切り替える。アンカーは「回転の中心」なので、絵を動かすのと
    // 同じ操作にすると必ず取り違える。
    const [anchorMode, setAnchorMode] = useState(false);
    const [hint, setHint] = useState<string | null>(null);
    // 何枚目のアトラスを見ているか。分割時に 2 枚目以降が見えないままだと、
    // そこに載った素材の確認ができない。
    const [atlasIndex, setAtlasIndex] = useState(0);
    const textureUrl = atlasUrls[Math.min(atlasIndex, Math.max(0, atlasUrls.length - 1))] ?? null;
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [viewport, setViewport] = useState({ x: 0, y: 0, w: 0, h: 0 }); // Percentages 0-1
    const [imgSize, setImgSizeRaw] = useState({ w: 0, h: 0 });
    // 同じ寸法なら state を触らない。描画は再生中に毎フレーム走るので、
    // 毎回新しいオブジェクトを入れると再描画のループになる。
    const setImgSize = useCallback((next: { w: number; h: number }) => {
        setImgSizeRaw(cur => (cur.w === next.w && cur.h === next.h ? cur : next));
    }, []);
    const [mode, setMode] = useState<'texture' | 'composition'>('composition');
    const [scale, setScale] = useState(1.0);
    // ズームを手で触ったか。触るまでは自動でフィットさせ続ける。
    const userZoomedRef = useRef(false);

    const handleFit = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container || imgSize.w === 0 || imgSize.h === 0) return;
        const s = Math.min(
            (container.clientWidth - 24) / imgSize.w,
            (container.clientHeight - 24) / imgSize.h
        );
        setScale(Math.max(0.05, Math.min(4.0, +s.toFixed(2))));
    }, [imgSize]);

    const setScaleManually = useCallback((next: number | ((s: number) => number)) => {
        userZoomedRef.current = true;
        setScale(next);
    }, []);

    /*
     * 読み込み直後にフィットさせる。
     * 以前は常に 100% 固定だったため、2000px 級の PSD を開くとキャンバスの左上隅しか
     * 見えず、「Fit を押すまでキャラクターが画面に存在しない」状態だった。
     * 一度でも手でズームしたらそれを尊重する。
     */
    useEffect(() => {
        if (userZoomedRef.current) return;
        if (imgSize.w === 0 || imgSize.h === 0) return;
        handleFit();
    }, [imgSize, mode, handleFit]);

    useEffect(() => {
        if (atlasIndex > atlasUrls.length - 1) setAtlasIndex(0);
    }, [atlasUrls.length, atlasIndex]);

    // モードを変えたら「自動フィット」に戻す。合成とアトラスでは寸法が大きく違うので、
    // 片方に合わせたズームをもう片方に持ち越しても意味がない。
    const changeMode = useCallback((next: 'texture' | 'composition') => {
        userZoomedRef.current = false;
        setMode(next);
    }, []);

    /**
     * パーツごとの変形前の外接矩形。バウンディングボックスの土台であり、
     * アンカーの既定（矩形の中心）でもある。
     *
     * 今表示されているレイヤーだけから作る。switch パーツで差分を切り替えると
     * 矩形も変わるが、それが「今掴めるもの」なので正しい。
     */
    const partBounds = useMemo(() => {
        const out: Record<string, PartBounds> = {};
        const add = (key: string, partId: string, item: PreviewItem) => {
            const r = item.left + item.image.width;
            const b = item.top + item.image.height;
            const cur = out[key];
            if (!cur) {
                out[key] = { partId, left: item.left, top: item.top, right: r, bottom: b };
            } else {
                cur.left = Math.min(cur.left, item.left);
                cur.top = Math.min(cur.top, item.top);
                cur.right = Math.max(cur.right, r);
                cur.bottom = Math.max(cur.bottom, b);
            }
        };
        for (const item of compositionItems) {
            // パーツ全体と、フレーム単位（0.5.3 §7.4.1）の両方を持つ。
            add(transformKey(item.partId), item.partId, item);
            add(transformKey(item.partId, item.frameId), item.partId, item);
        }
        return out;
    }, [compositionItems]);

    const displayStyle = useMemo(() => ({
        width: imgSize.w > 0 ? imgSize.w * scale + 'px' : undefined,
        height: imgSize.h > 0 ? imgSize.h * scale + 'px' : undefined,
    }), [imgSize, scale]);

    // Draw Canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (mode === 'texture') {
            if (textureUrl) {
                const img = new Image();
                img.onload = () => {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    setImgSize({ w: img.width, h: img.height });
                };
                img.onerror = () => {
                    console.error('Failed to load texture atlas image');
                    canvas.width = 0;
                    canvas.height = 0;
                    setImgSize({ w: 0, h: 0 });
                };
                img.src = textureUrl;
            } else {
                canvas.width = 0;
                canvas.height = 0;
                setImgSize({ w: 0, h: 0 });
            }
        } else {
            // Composition Mode
            if (width > 0 && height > 0) {
                // **寸法が変わったときだけ代入する。** canvas.width への代入は
                // 中身の破棄とバッファの再確保を伴うので、2894×4093 では
                // これだけで 1 フレーム分の時間を使い切る。再生中は毎フレーム
                // ここを通るため、素通しにするとタブごと固まる（実際に固まった）。
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
                setImgSize({ w: width, h: height });
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, width, height);

                // Draw checkerboard background (optional, for transparency)
                // ...

                // Draw items
                // Reverse order because usually first child in PSD is top layer? 
                // In ag-psd children array, typically index 0 is bottom? Or top?
                // "children: The layer data. The array is in reverse order of the layers in the PSD file."
                // So index 0 is the top-most layer in Photoshop UI?
                // "The first element in the array is the top-most layer." -> Doc says for readPsd?
                // Let's assume input items are already sorted back-to-front if possible, or we sort them?
                // For now, let's assume compositionItems came from traversing psd.children (which is usually top-to-bottom).
                // If we want to draw correctly (painters algorithm), we need to draw BOTTOM first.
                // So we should reverse `compositionItems` if they were collected top-first.

                // App.tsx collects using recursive traversal (Back-to-Front).
                // So compositionItems are Back -> Front order.
                // We draw in order (Back first).

                // パーツ単位でトランスフォームを掛ける（v0.5.0 §7）。
                // 適用順序は transform.ts の transformMatrix が持っている。
                for (const item of compositionItems) {
                    ctx.save();
                    let alpha = item.opacity;
                    // パーツ全体を狙うものと、このフレームを狙うもの（0.5.3 §7.4.1）を
                    // 順に掛ける。両方あるときは重なる — validator が警告する状態だが、
                    // 見えている絵と書き出しを一致させるためここでも同じ扱いにする。
                    let m: DOMMatrix | null = null;
                    for (const key of [transformKey(item.partId),
                                       transformKey(item.partId, item.frameId)]) {
                        const tf = transforms[key];
                        const bounds = partBounds[key];
                        if (!tf || !bounds) continue;
                        const v = evaluateTransform(tf, time);
                        const anchor = tf.anchor ?? {
                            x: (bounds.left + bounds.right) / 2,
                            y: (bounds.top + bounds.bottom) / 2,
                        };
                        const next = transformMatrix(v, anchor.x, anchor.y);
                        m = m ? m.multiply(next) : next;
                        alpha *= v.opacity;
                    }
                    if (m) ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
                    ctx.globalAlpha = alpha;

                    ctx.drawImage(item.image, item.left, item.top);
                    ctx.restore();
                }

                updateViewport();
            }
        }
    }, [textureUrl, compositionItems, mode, width, height, transforms, partBounds, time]);

    // ... Viewport & Minimap Logic (Shared) ...
    // Using same logic as before

    const updateViewport = useCallback(() => {
        if (!scrollContainerRef.current || !canvasRef.current || imgSize.w === 0) return;
        const container = scrollContainerRef.current;
        const next = {
            x: container.scrollLeft / Math.max(container.scrollWidth, 1),
            y: container.scrollTop / Math.max(container.scrollHeight, 1),
            w: container.clientWidth / Math.max(container.scrollWidth, 1),
            h: container.clientHeight / Math.max(container.scrollHeight, 1),
        };
        // 値が同じなら更新しない。再生中はこの関数が毎フレーム呼ばれるので、
        // 毎回新しいオブジェクトを入れると再描画が積み重なってタブごと固まる
        // （実際に固まった）。
        setViewport(cur =>
            cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h
                ? cur : next);
    }, [imgSize]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        container.addEventListener('scroll', updateViewport);
        const observer = new ResizeObserver(updateViewport);
        observer.observe(container);
        return () => {
            container.removeEventListener('scroll', updateViewport);
            observer.disconnect();
        };
    }, [updateViewport]);

    const selectedBounds = selectedPartId ? partBounds[selectedPartId] : undefined;

    /**
     * キャンバスを押した位置にあるパーツを選ぶ。
     *
     * 前面から順に、**そのレイヤーの不透明な画素に当たったか**で判定する。
     * 矩形で判定すると、髪の外接矩形が顔全体を覆っているために顔が一生掴めない。
     */
    const pickPartAt = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (playing) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / scale;
        const cy = (e.clientY - rect.top) / scale;

        for (let i = compositionItems.length - 1; i >= 0; i--) {
            const item = compositionItems[i];
            const tf = transforms[item.partId];
            const b = partBounds[item.partId];
            let x = cx, y = cy;
            if (tf && b) {
                const anchor = tf.anchor ?? {
                    x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2,
                };
                const p = transformMatrix(evaluateTransform(tf, time), anchor.x, anchor.y)
                    .inverse().transformPoint(new DOMPoint(cx, cy));
                x = p.x; y = p.y;
            }
            const lx = Math.floor(x - item.left);
            const ly = Math.floor(y - item.top);
            if (lx < 0 || ly < 0 || lx >= item.image.width || ly >= item.image.height) continue;
            const px = item.image.getContext('2d', { willReadFrequently: true })
                ?.getImageData(lx, ly, 1, 1).data;
            if (px && px[3] > 8) { onSelectPart(item.partId); return; }
        }
    }, [compositionItems, partBounds, transforms, time, scale, playing, onSelectPart]);

    const handleMinimapDrag = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!scrollContainerRef.current || imgSize.w === 0) return;
        const minimapRect = e.currentTarget.getBoundingClientRect();
        const clickX = (e.clientX - minimapRect.left) / minimapRect.width;
        const clickY = (e.clientY - minimapRect.top) / minimapRect.height;
        const container = scrollContainerRef.current;
        container.scrollLeft = (clickX * container.scrollWidth) - (container.clientWidth / 2);
        container.scrollTop = (clickY * container.scrollHeight) - (container.clientHeight / 2);
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Toolbar
                このプロジェクトに Tailwind は入っていないため、以前ここで使われていた
                `bg-gray-800` / `px-3 py-1` などのクラスは 1 つも効いておらず、
                ツールバー全体が素のブラウザ既定のボタンで表示されていた。 */}
            <div className="preview-toolbar">
                <div className="seg">
                    <button
                        className={`seg-item ${mode === 'composition' ? 'active' : ''}`}
                        onClick={() => changeMode('composition')}
                        title="書き出したときの見た目"
                    >
                        合成
                    </button>
                    <button
                        className={`seg-item ${mode === 'texture' ? 'active' : ''}`}
                        onClick={() => changeMode('texture')}
                        title="パッキング後のテクスチャアトラス"
                    >
                        アトラス
                    </button>
                </div>
                {mode === 'texture' && atlasUrls.length > 1 && (
                    <div className="seg" title="アトラスが複数枚に分割されています">
                        {atlasUrls.map((_, i) => (
                            <button
                                key={i}
                                className={`seg-item ${i === atlasIndex ? 'active' : ''}`}
                                onClick={() => { userZoomedRef.current = false; setAtlasIndex(i); }}
                            >
                                {i + 1}
                            </button>
                        ))}
                    </div>
                )}
                {mode === 'composition' && (
                    <div className="seg" title={selectedPartId ? undefined : 'パーツを選ぶと使えます'}>
                        <button
                            className={`seg-item ${!anchorMode ? 'active' : ''}`}
                            onClick={() => setAnchorMode(false)}
                            disabled={!selectedPartId}
                            title="移動・回転・拡縮"
                        >
                            <Move3d size={12} /> 変形
                        </button>
                        <button
                            className={`seg-item ${anchorMode ? 'active' : ''}`}
                            onClick={() => setAnchorMode(true)}
                            disabled={!selectedPartId}
                            title="回転・拡縮の中心（anchor_x / anchor_y）を置く"
                        >
                            <Crosshair size={12} /> 中心
                        </button>
                    </div>
                )}
                {hint && <span className="tf-hint">{hint}</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                        className="btn btn-sm"
                        onClick={() => setScaleManually(s => Math.max(0.05, +(s - 0.1).toFixed(2)))}
                        title="縮小"
                    >－</button>
                    <span className="zoom-readout">{Math.round(scale * 100)}%</span>
                    <button
                        className="btn btn-sm"
                        onClick={() => setScaleManually(s => Math.min(4.0, +(s + 0.1).toFixed(2)))}
                        title="拡大"
                    >＋</button>
                    <button
                        className="btn btn-sm"
                        onClick={() => setScaleManually(1.0)}
                        title="等倍"
                    >100%</button>
                    <button
                        className="btn btn-sm"
                        onClick={() => { userZoomedRef.current = false; handleFit(); }}
                        title="パネルに合わせる"
                    >全体</button>
                </div>
            </div>

            <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                {/* Main Scrollable View */}
                <div
                    ref={scrollContainerRef}
                    className="preview-scroll-container"
                    style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex' }}
                >
                    <div style={{ margin: 'auto', position: 'relative' }}>
                        <canvas
                            ref={canvasRef}
                            onPointerDown={mode === 'composition' ? pickPartAt : undefined}
                            style={{ display: 'block', maxWidth: 'none', background: 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAHElEQVQYlWNgYGD4z8AARwyyD46kAqJhCg0QAABD1AIG7K6OBAAAAABJRU5ErkJggg==) repeat', ...displayStyle }}
                        />
                        {mode === 'composition' && selectedBounds && (
                            <TransformOverlay
                                bounds={selectedBounds}
                                transform={transforms[selectedBounds.partId] ?? emptyTransform()}
                                scale={scale}
                                anchorMode={anchorMode}
                                time={time}
                                playing={playing}
                                onChange={patch => onTransformChange(selectedBounds.partId, patch)}
                                onHint={setHint}
                            />
                        )}
                    </div>
                </div>

                {imgSize.w === 0 && (
                    <div className="empty-state" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        {mode === 'composition'
                            ? 'PSD / 画像を読み込むと、書き出したときの見た目がここに出ます。'
                            : 'パッキング後のテクスチャアトラスがここに出ます。'}
                    </div>
                )}

                {/* Minimap */}
                {imgSize.w > 0 && (
                    <div className="minimap-container" onClick={handleMinimapDrag}>
                        <canvas
                            width={imgSize.w}
                            height={imgSize.h}
                            className="minimap-image" // Reusing class for styles
                            ref={c => {
                                // 再生中は更新しない。毎レンダーで本体キャンバスを
                                // まるごとコピーしていて、1 フレームあたりの負荷が倍になる。
                                if (playing) return;
                                if (c && canvasRef.current) {
                                    const ctx = c.getContext('2d');
                                    ctx?.clearRect(0, 0, c.width, c.height);
                                    ctx?.drawImage(canvasRef.current, 0, 0);
                                }
                            }}
                        />
                        {/* Note: Efficient minimap update might need logic, but for now this re-renders when parent re-renders */}

                        <div
                            className="minimap-viewport"
                            style={{
                                left: `${viewport.x * 100}%`,
                                top: `${viewport.y * 100}%`,
                                width: `${Math.min(viewport.w * 100, 100)}%`,
                                height: `${Math.min(viewport.h * 100, 100)}%`
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
