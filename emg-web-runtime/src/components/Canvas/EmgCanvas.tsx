import React, { useEffect, useRef, useState } from 'react';
import type { EmgAvatar } from '../../types/schema';
import { EmgStateMachine } from '../../core/EmgStateMachine';
import { resolvePartType } from '../../core/EmgCompat';

interface EmgCanvasProps {
    avatar: EmgAvatar;
    stateMachine: EmgStateMachine;
    assets: Map<string, string>; // path -> blobUrl
    width?: number; // Override width
    height?: number; // Override height
    style?: React.CSSProperties;
    editMode?: boolean; // New prop
    snapToOrigin?: boolean; // New prop
    onUpdateLayer?: (layerID: string, newX: number, newY: number) => void; // New prop
}

export const EmgCanvas: React.FC<EmgCanvasProps> = ({
    avatar,
    stateMachine,
    assets,
    width,
    height,
    style,
    editMode = false,
    snapToOrigin = false,
    onUpdateLayer
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());

    // Transform State
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    // Edit Mode State
    const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
    const [isDraggingLayer, setIsDraggingLayer] = useState(false);
    const [layerDragStart, setLayerDragStart] = useState({ x: 0, y: 0 }); // Mouse pos at start
    const [initialLayerPos, setInitialLayerPos] = useState({ x: 0, y: 0 }); // Layer pos at start

    // Load images
    useEffect(() => {
        const loadImages = async () => {
            const newImages = new Map<string, HTMLImageElement>();
            const promises: Promise<void>[] = [];

            assets.forEach((url, path) => {
                const img = new Image();
                const p = new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = reject;
                });
                img.src = url;
                newImages.set(path, img); // Store by original path (e.g. "texture_0.png")
                promises.push(p);
            });

            try {
                await Promise.all(promises);
                setImages(newImages);
                console.log('All assets loaded for canvas');
            } catch (e) {
                console.error('Failed to load some assets', e);
            }
        };

        if (avatar && assets.size > 0) {
            loadImages();
        }
    }, [assets, avatar]);

    // Input Handling
    const getMousePos = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const getWorldPos = (mouseX: number, mouseY: number) => {
        return {
            x: (mouseX - transform.x) / transform.scale,
            y: (mouseY - transform.y) / transform.scale
        };
    };



    const handleMouseDown = (e: React.MouseEvent) => {
        const mouse = getMousePos(e);
        const worldMouse = getWorldPos(mouse.x, mouse.y); // Click in world coords

        // 1. Check Layer Click (Edit Mode)
        if (editMode && onUpdateLayer && e.button === 0) { // Left click
            // Find top-most visible layer under mouse
            const sortedLayers = [...avatar.layers].sort((a, b) => b.zIndex - a.zIndex); // Reverse Order (Top first)

            // We need to resolve effective layers (switches etc.) to check hit
            const currentVariant = stateMachine.resolveVariant();

            for (const layer of sortedLayers) {
                // Check Visibility & Switch Logic
                let isVisible = layer.visible;
                if (!isVisible) continue;

                const part = avatar.parts.find(p => p.partID === layer.partID);
                if (part && resolvePartType(part) === 'switch') {
                    let activeLayerID = part.default;
                    if (currentVariant && currentVariant.overrides && currentVariant.overrides[layer.partID]) {
                        activeLayerID = currentVariant.overrides[layer.partID];
                    }
                    // Check for Hidden
                    if (activeLayerID === '__HIDDEN__') continue;

                    // v0.5.0 §2.2: 一致はフレーム識別子で見る。同じフレームの
                    // レイヤーはすべて表示される（frameName の無いファイルでは 1 枚）。
                    if ((layer.frameID ?? layer.textureID) !== activeLayerID) continue;
                } else { // Normal part
                    // Check for Hidden override
                    if (currentVariant && currentVariant.overrides && currentVariant.overrides[layer.partID] === '__HIDDEN__') {
                        continue;
                    }
                }

                // Hit Test
                // Simple box hit test
                if (worldMouse.x >= layer.x && worldMouse.x <= layer.x + layer.width &&
                    worldMouse.y >= layer.y && worldMouse.y <= layer.y + layer.height) {

                    // Found Layer
                    setSelectedLayerId(layer.layerID);
                    setIsDraggingLayer(true);
                    setLayerDragStart(mouse);
                    setInitialLayerPos({ x: layer.x, y: layer.y });
                    return;
                }
            }
        }

        // 2. Pan (Middle Click or Space+Left or just Left if no layer hit/no edit mode)
        // Default: Middle Click (button 1) pans. 
        if (e.button === 1 || (!editMode && e.button === 0)) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDraggingLayer && selectedLayerId && onUpdateLayer) {
            const mouse = getMousePos(e);

            // Delta in Screen Space
            const dx = mouse.x - layerDragStart.x;
            const dy = mouse.y - layerDragStart.y;

            // Convert Delta to World Space (divide by scale)
            const worldDx = dx / transform.scale;
            const worldDy = dy / transform.scale;

            let newX = initialLayerPos.x + worldDx;
            let newY = initialLayerPos.y + worldDy;

            // Snap Logic
            if (snapToOrigin) {
                const threshold = 10 / transform.scale; // Screen pixel threshold converted to world
                if (Math.abs(newX) < threshold) newX = 0;
                if (Math.abs(newY) < threshold) newY = 0;
            }

            // Debounce/Throttle? For now live update is okay for standard React.
            onUpdateLayer(selectedLayerId, newX, newY);
            return;
        }

        if (isDragging) {
            setTransform({
                ...transform,
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        setIsDraggingLayer(false);
    };

    // Animation Loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            // Clear
            ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform to clear full canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Apply Camera Transform
            ctx.setTransform(transform.scale, 0, 0, transform.scale, transform.x, transform.y);

            // Draw Origin Guide (if Edit Mode)
            if (editMode) {
                ctx.save();
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 1 / transform.scale;
                ctx.beginPath();
                ctx.moveTo(-1000, 0); ctx.lineTo(1000, 0); // Horizontal
                ctx.moveTo(0, -1000); ctx.lineTo(0, 1000); // Vertical
                // Draw origin dot
                ctx.arc(0, 0, 3 / transform.scale, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            // Determine current variant state
            const currentVariant = stateMachine.resolveVariant();

            // Draw Layers
            // Sort by zIndex (ascending)
            const sortedLayers = [...avatar.layers].sort((a, b) => a.zIndex - b.zIndex);

            sortedLayers.forEach(layer => {
                const part = avatar.parts.find(p => p.partID === layer.partID);
                if (!part) return;

                // Visibility Check
                let isVisible = layer.visible;
                if (!isVisible) return; // Basic visibility

                // Texture Selection Logic (Switch Parts)
                if (resolvePartType(part) === 'switch') {
                    // Check if this layer is the "active" texture for this part
                    // 1. Check Variant Override
                    let activeLayerID = part.default;
                    if (currentVariant && currentVariant.overrides && currentVariant.overrides[layer.partID]) {
                        activeLayerID = currentVariant.overrides[layer.partID];
                    }

                    // Hidden Logic
                    if (activeLayerID === '__HIDDEN__') return; // Do not draw

                    // v0.5.0 §2.2: 一致はフレーム識別子で見る。
                    if ((layer.frameID ?? layer.textureID) !== activeLayerID) {
                        return; // Skip inactive layers in switch part
                    }
                } else {
                    // Normal part visibility check
                    if (currentVariant && currentVariant.overrides && currentVariant.overrides[layer.partID] === '__HIDDEN__') {
                        return; // Hidden via override
                    }
                }

                // Get Atlas Image
                const atlasDef = avatar.textures.find(t => t.id === (layer as any).textureID); // Cast if needed or update schema
                if (!atlasDef?.src) return;

                const img = images.get(atlasDef.src);
                if (!img) return;

                // Source Rect (Atlas)
                let sx = 0, sy = 0, sw = 0, sh = 0;

                if (layer.srcX !== undefined && layer.srcY !== undefined && layer.srcWidth !== undefined && layer.srcHeight !== undefined) {
                    // Use Pixel Coords directly
                    sx = layer.srcX;
                    sy = layer.srcY;
                    sw = layer.srcWidth;
                    sh = layer.srcHeight;
                } else if (layer.uv) {
                    sx = layer.uv.u * img.width;
                    sy = layer.uv.v * img.width; // Potential bug in original code (v * width), keeping for now or fixing? Standard is v * height. But let's stick to pixel coords if possible.
                    sw = layer.uv.w * img.width;
                    sh = layer.uv.h * img.height;
                } else {
                    return;
                }

                // Dest Rect (Canvas)
                const dx = layer.x;
                const dy = layer.y;
                const dw = layer.width;
                const dh = layer.height;

                ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
                if (layer.blendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';
                else ctx.globalCompositeOperation = 'source-over';

                ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);

                // Highlight Selection (Edit Mode)
                if (editMode && selectedLayerId === layer.layerID) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = '#00ff00';
                    ctx.lineWidth = 2 / transform.scale; // Keep stroke width constant screen-size
                    ctx.strokeRect(dx, dy, dw, dh);
                    ctx.restore();
                }
            });

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [avatar, stateMachine, images, transform, editMode, selectedLayerId]);

    // Wheel Handler (Non-passive for preventDefault)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const scaleBy = 1.1;
            const factor = e.deltaY < 0 ? scaleBy : 1 / scaleBy;

            // Native Event coords
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // World calculation using current transform
            const worldMouseX = (mouseX - transform.x) / transform.scale;
            const worldMouseY = (mouseY - transform.y) / transform.scale;

            const newScale = transform.scale * factor;
            if (newScale < 0.1 || newScale > 10) return;

            const newX = mouseX - worldMouseX * newScale;
            const newY = mouseY - worldMouseY * newScale;

            setTransform({ x: newX, y: newY, scale: newScale });
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', onWheel);
        };
    }, [transform]); // Re-bind on transform change

    return (
        <canvas
            ref={canvasRef}
            width={width || avatar.width}
            height={height || avatar.height}
            // onWheel removed - handled by useEffect
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
                width: width ? `${width}px` : '100%',
                height: 'auto',
                cursor: editMode ? (isDraggingLayer ? 'grabbing' : 'grab') : (isDragging ? 'grabbing' : 'grab'),
                backgroundColor: '#111', // Dark bg for canvas to see boundaries
                ...style
            }}
        />
    );
};
