import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';

export interface PreviewItem {
    id: number;
    image: HTMLCanvasElement;
    left: number;
    top: number;
}

interface PreviewPanelProps {
    textureUrl: string | null;
    compositionItems: PreviewItem[];
    width: number;
    height: number;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ textureUrl, compositionItems, width, height }) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [viewport, setViewport] = useState({ x: 0, y: 0, w: 0, h: 0 }); // Percentages 0-1
    const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
    const [mode, setMode] = useState<'texture' | 'composition'>('composition');
    const [scale, setScale] = useState(1.0);

    const handleFit = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container || imgSize.w === 0 || imgSize.h === 0) return;
        const s = Math.min(
            container.clientWidth / imgSize.w,
            container.clientHeight / imgSize.h
        );
        setScale(Math.max(0.1, Math.min(4.0, +s.toFixed(2))));
    }, [imgSize]);

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
            {/* Toolbar */}
            <div className="flex gap-2 p-2 bg-gray-800 border-b border-gray-700" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                    className={`px-3 py-1 text-xs rounded ${mode === 'composition' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
                    onClick={() => setMode('composition')}
                >
                    Composition
                </button>
                <button
                    className={`px-3 py-1 text-xs rounded ${mode === 'texture' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
                    onClick={() => setMode('texture')}
                >
                    Texture Atlas
                </button>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                        className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300"
                        onClick={() => setScale(s => Math.max(0.1, +(s - 0.25).toFixed(2)))}
                        title="Zoom Out"
                    >－</button>
                    <span style={{ minWidth: '44px', textAlign: 'center', fontSize: '12px', color: '#ccc' }}>
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300"
                        onClick={() => setScale(s => Math.min(4.0, +(s + 0.25).toFixed(2)))}
                        title="Zoom In"
                    >＋</button>
                    <button
                        className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300"
                        onClick={() => setScale(1.0)}
                        title="Reset to 100%"
                    >100%</button>
                    <button
                        className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300"
                        onClick={handleFit}
                        title="Fit to panel"
                    >Fit</button>
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
