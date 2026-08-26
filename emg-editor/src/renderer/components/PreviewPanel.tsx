import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';

export interface PreviewItem {
    id: number;
    image: HTMLCanvasElement;
    left: number;
    top: number;
}

interface PreviewPanelProps {
    /** アトラス画像。分割されている場合は複数枚（emg-json-spec.md 1.3）。 */
    atlasUrls: string[];
    compositionItems: PreviewItem[];
    width: number;
    height: number;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ atlasUrls, compositionItems, width, height }) => {
    // 何枚目のアトラスを見ているか。分割時に 2 枚目以降が見えないままだと、
    // そこに載った素材の確認ができない。
    const [atlasIndex, setAtlasIndex] = useState(0);
    const textureUrl = atlasUrls[Math.min(atlasIndex, Math.max(0, atlasUrls.length - 1))] ?? null;
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [viewport, setViewport] = useState({ x: 0, y: 0, w: 0, h: 0 }); // Percentages 0-1
    const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
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
                canvas.width = width;
                canvas.height = height;
                setImgSize({ w: width, h: height });
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

                [...compositionItems].forEach(item => {
                    ctx.drawImage(item.image, item.left, item.top);
                });

                updateViewport();
            }
        }
    }, [textureUrl, compositionItems, mode, width, height]);

    // ... Viewport & Minimap Logic (Shared) ...
    // Using same logic as before

    const updateViewport = useCallback(() => {
        if (!scrollContainerRef.current || !canvasRef.current || imgSize.w === 0) return;
        const container = scrollContainerRef.current;
        const wRatio = container.clientWidth / Math.max(container.scrollWidth, 1);
        const hRatio = container.clientHeight / Math.max(container.scrollHeight, 1);
        const xRatio = container.scrollLeft / Math.max(container.scrollWidth, 1);
        const yRatio = container.scrollTop / Math.max(container.scrollHeight, 1);
        setViewport({ x: xRatio, y: yRatio, w: wRatio, h: hRatio });
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
                        <canvas ref={canvasRef} style={{ display: 'block', maxWidth: 'none', background: 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAHElEQVQYlWNgYGD4z8AARwyyD46kAqJhCg0QAABD1AIG7K6OBAAAAABJRU5ErkJggg==) repeat', ...displayStyle }} />
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
                                // Draw simple preview on minimap
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
