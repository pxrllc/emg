import React, { useState } from 'react';
import type { Layer, Psd } from 'ag-psd';
import { ChevronRight, ChevronDown, Eye, EyeOff, Folder, File, FolderPlus, Group } from 'lucide-react';
import type { LayerMeta } from '../types';

// Module-level variable for reliable drag tracking in Electron
let _activeDragLayerId: number | null = null;

interface LayerTreeProps {
    psd: Psd | null;
    visibility: Record<number, boolean>;
    layerMeta?: Record<number, LayerMeta>;
    onLayerVisibilityChange: (layer: Layer, visible: boolean) => void;
    onSelectionChange?: (layer: Layer) => void;
    onPsdUpdate?: (psd: Psd) => void;
    selectedLayer?: Layer | null;
    onVisibilityAll?: (visible: boolean) => void;
    onLoadPsd?: () => void;
    onGroupSelected?: () => void;
}

export const LayerTree: React.FC<LayerTreeProps> = ({
    psd,
    visibility,
    layerMeta,
    onLayerVisibilityChange,
    onSelectionChange,
    onPsdUpdate,
    selectedLayer,
    onVisibilityAll,
    onLoadPsd,
    onGroupSelected
}) => {
    if (!psd || !psd.children) return (
        <div className="empty-state">
            <div style={{ fontSize: '40px', lineHeight: 1 }}>📂</div>
            <div style={{ color: '#a5a5aa', fontSize: '13px' }}>PSD / KRA を読み込んで始めます</div>
            <button className="btn btn-primary" onClick={onLoadPsd} style={{ width: '100%', maxWidth: '220px' }}>
                <FolderPlus size={16} /> PSD / KRA を開く
            </button>
            <div style={{ fontSize: '11px', color: '#5f5f64', lineHeight: 1.7 }}>
                トップレベルのグループが 1 パーツになります。<br />
                「@」で始まるグループは 1 つの差分としてまとまります。
            </div>
        </div>
    );

    /** 選択中のレイヤーを新しいグループ（= 新しいパーツ）に包む。 */
    const handleGroupSelected = () => onGroupSelected?.();

    const handleMove = (draggedId: number, targetId: number | 'root', position: 'before' | 'after' | 'inside') => {
        if (!psd || !onPsdUpdate) return;

        console.log(`Move: ${draggedId} -> ${targetId} (${position})`);

        // Clone PSD structure (deep enough for children arrays)
        const cloneLayer = (l: Layer): Layer => ({ ...l, children: l.children ? l.children.map(cloneLayer) : undefined });
        const newPsd: Psd = { ...psd, children: psd.children!.map(cloneLayer) };

        // Helper to find and remove layer
        let draggedLayer: Layer | undefined;

        const removeLayer = (layers: Layer[]): Layer[] => {
            const list = [];
            for (const l of layers) {
                if (l.id === draggedId) {
                    draggedLayer = l;
                } else {
                    if (l.children) {
                        l.children = removeLayer(l.children);
                    }
                    list.push(l);
                }
            }
            return list;
        };

        const childrenAfterRemoval = removeLayer(newPsd.children!);

        if (!draggedLayer) {
            console.error('Dragged layer not found:', draggedId);
            return;
        }

        // Helper to insert layer
        const insertLayer = (layers: Layer[]): boolean => {
            if (targetId === 'root') {
                // Insert at top of list (End of Array for Front)
                layers.push(draggedLayer!);
                return true;
            }

            for (let i = 0; i < layers.length; i++) {
                const l = layers[i];
                if (l.id === targetId) {
                    // Logic for position relative to Reverse-Rendered UI
                    // UI: [Front (N), ..., Back (0)]
                    // Array: [Back (0), ..., Front (N)]
                    //
                    // "Before" Target (UI Top of Target):
                    // Insert at index i+1 (Between Target and Next)
                    //
                    // "After" Target (UI Bottom of Target):
                    // Insert at index i (Between Prev and Target)

                    if (position === 'inside' && l.children) {
                        l.children.push(draggedLayer!);
                    } else if (position === 'before') {
                        layers.splice(i + 1, 0, draggedLayer!);
                    } else if (position === 'after') {
                        layers.splice(i, 0, draggedLayer!);
                    }
                    return true;
                }
                if (l.children) {
                    if (insertLayer(l.children)) return true;
                }
            }
            return false;
        };

        // Execute Insert on the Cleaned List
        // Start with the list that has the dragged layer removed
        // We need to apply this list to newPsd.children first? 
        // Or wait, insertLayer modifies the array in place.
        // But removeLayer returned a NEW array for the root level.
        // We must update newPsd.children to use the removed list BEFORE inserting.

        newPsd.children = childrenAfterRemoval;

        if (insertLayer(newPsd.children)) {
            onPsdUpdate(newPsd);
        } else {
            console.error('Failed to insert layer. Reverting.');
            // Do not call onPsdUpdate, effectively reverting.
        }
    };

    const handleRename = (layerId: number, newName: string) => {
        if (!psd || !onPsdUpdate) return;
        // Clone PSD structure
        const cloneLayer = (l: Layer): Layer => ({ ...l, children: l.children ? l.children.map(cloneLayer) : undefined });
        const newPsd: Psd = { ...psd, children: psd.children!.map(cloneLayer) };

        const updateName = (layers: Layer[]) => {
            for (const l of layers) {
                if (l.id === layerId) {
                    l.name = newName;
                    return;
                }
                if (l.children) updateName(l.children);
            }
        };
        updateName(newPsd.children!);
        onPsdUpdate(newPsd);
    }


    return (
        <div className="layer-tree" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="toolbar" style={{ padding: '8px', borderBottom: '1px solid #3e3e42', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                    className="btn btn-sm"
                    onClick={handleGroupSelected}
                    disabled={!selectedLayer}
                    title={selectedLayer ? '選択中のレイヤーを新しいパーツにまとめる' : 'まとめたいレイヤーを選んでください'}
                >
                    <Group size={13} /> パーツにまとめる
                </button>
                <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => onVisibilityAll?.(true)}
                    title="全レイヤーを書き出し対象にする"
                >
                    <Eye size={13} /> 全選択
                </button>
                <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => onVisibilityAll?.(false)}
                    title="全レイヤーを書き出し対象から外す"
                >
                    <EyeOff size={13} /> 全解除
                </button>
            </div>
            <div className="tree-content" style={{ padding: '6px 4px', flex: 1, overflow: 'auto' }}>
                {psd.children.slice().reverse().map((layer, index) => (
                    <LayerNode
                        key={layer.id || index}
                        layer={layer}
                        visibility={visibility}
                        layerMeta={layerMeta}
                        parentPartId={undefined}
                        onVisibilityChange={onLayerVisibilityChange}
                        onSelectionChange={onSelectionChange}
                        selectedLayer={selectedLayer}
                        depth={0}
                        onMove={handleMove}
                        onRename={handleRename}
                    />
                ))}
            </div>
        </div>
    );
};

interface LayerNodeProps {
    layer: Layer;
    visibility: Record<number, boolean>;
    layerMeta?: Record<number, LayerMeta>;
    /** 親から引き継いだ partID。これと違えば、このグループが新しいパーツの起点。 */
    parentPartId?: string;
    onVisibilityChange: (layer: Layer, visible: boolean) => void;
    onSelectionChange?: (layer: Layer) => void;
    selectedLayer?: Layer | null;
    depth: number;
    onMove: (draggedId: number, targetId: number, position: 'before' | 'after' | 'inside') => void;
    onRename: (layerId: number, newName: string) => void;
}

const LayerNode: React.FC<LayerNodeProps> = ({
    layer,
    visibility,
    layerMeta,
    parentPartId,
    onVisibilityChange,
    onSelectionChange,
    selectedLayer,
    depth,
    onMove,
    onRename
}) => {
    const [expanded, setExpanded] = useState(true);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(layer.name || '');
    const [dragOverPos, setDragOverPos] = useState<'top' | 'bottom' | 'inside' | null>(null);

    const isGroup = !!layer.children;
    const isVisible = (layer.id !== undefined && visibility[layer.id] !== undefined) ? visibility[layer.id] : !layer.hidden;
    const isSelected = selectedLayer === layer;

    // どのグループが 1 つの partID になるかは、これまでツリー上で全く見えなかった。
    // partID の出所はグループ名なので、その境界を線と色で示す。
    const meta = layer.id !== undefined ? layerMeta?.[layer.id] : undefined;
    const partId = meta?.partId;
    const isFrameGroup = isGroup && !!layer.name?.startsWith('@');
    const isPartRoot = isGroup && !isFrameGroup && !!partId && partId !== parentPartId;
    const isExcluded = !!meta && !meta.visible;

    const handleToggleVisibility = (e: React.MouseEvent) => {
        e.stopPropagation();
        onVisibilityChange(layer, !isVisible);
    };

    const handleToggleExpand = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(!expanded);
    };

    const handleSelect = () => {
        onSelectionChange?.(layer);
    };

    const handleDragStart = (e: React.DragEvent) => {
        if (layer.id === undefined) return;
        _activeDragLayerId = layer.id;
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
    };

    const handleDragEnd = () => {
        _activeDragLayerId = null;
        setDragOverPos(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (layer.id === undefined) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        if (isGroup && y > height * 0.25 && y < height * 0.75) {
            setDragOverPos('inside');
        } else if (y < height * 0.5) {
            setDragOverPos('top');
        } else {
            setDragOverPos('bottom');
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverPos(null);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const pos = dragOverPos === 'top' ? 'before' : dragOverPos === 'bottom' ? 'after' : 'inside';
        setDragOverPos(null);

        const draggedId = _activeDragLayerId;
        _activeDragLayerId = null;

        if (draggedId === null || draggedId === layer.id) return;

        if (layer.id !== undefined) {
            onMove(draggedId, layer.id, pos);
        }
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsRenaming(true);
        setRenameValue(layer.name || '');
    };

    const handleRenameSubmit = () => {
        setIsRenaming(false);
        if (layer.id !== undefined && renameValue !== layer.name) {
            onRename(layer.id, renameValue);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleRenameSubmit();
    };

    // Calculate drag indicator style
    const indicatorStyle = {
        borderTop: dragOverPos === 'top' ? '2px solid #3b82f6' : 'none',
        borderBottom: dragOverPos === 'bottom' ? '2px solid #3b82f6' : 'none',
        background: dragOverPos === 'inside' ? 'rgba(59, 130, 246, 0.2)' : 'transparent'
    };

    return (
        <div className="layer-node-container">
            <div
                className={[
                    'tree-item',
                    isSelected ? 'selected' : '',
                    isPartRoot ? 'part-root' : '',
                    isPartRoot && meta?.type === 'static' ? 'static-part' : '',
                    isExcluded ? 'excluded' : '',
                ].filter(Boolean).join(' ')}
                style={{ paddingLeft: `${depth * 14 + 4}px`, ...indicatorStyle }}
                onClick={handleSelect}
                draggable
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <button className="icon-btn" onClick={handleToggleVisibility}>
                    {isVisible ? <Eye size={14} /> : <EyeOff size={14} color="#666" />}
                </button>

                <span className="spacer" style={{ width: 4 }}></span>

                {isGroup ? (
                    <button className="icon-btn" onClick={handleToggleExpand}>
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                ) : (
                    <span className="indent" />
                )}

                <div className="tree-item-content">
                    {isGroup
                        ? <Folder size={14} fill={isFrameGroup ? '#e3c15b' : '#e8c466'} color={isFrameGroup ? '#e3c15b' : '#e8c466'} />
                        : <File size={14} />}
                    {isRenaming ? (
                        <input
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={handleRenameSubmit}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            style={{ background: '#1a1a1c', color: '#fff', border: '1px solid #2563eb', borderRadius: '3px', padding: '2px 4px', fontSize: '12px', minWidth: 0, flex: 1 }}
                            onClick={e => e.stopPropagation()}
                        />
                    ) : (
                        <span className="layer-name" title="ダブルクリックで名前を変更" onDoubleClick={handleDoubleClick}>
                            {layer.name}
                        </span>
                    )}
                    {isPartRoot && meta && (
                        <span className={`badge badge-${meta.type}`} title={`partID: ${partId}`}>
                            {meta.type}
                        </span>
                    )}
                    {isFrameGroup && <span className="badge badge-frame" title="frameName（1 つの差分としてまとまる）">frame</span>}
                </div>
            </div>

            {isGroup && expanded && layer.children && (
                <div className="layer-children">
                    {layer.children.slice().reverse().map((child, idx) => (
                        <LayerNode
                            key={child.id || idx}
                            layer={child}
                            visibility={visibility}
                            layerMeta={layerMeta}
                            parentPartId={partId ?? parentPartId}
                            onVisibilityChange={onVisibilityChange}
                            onSelectionChange={onSelectionChange}
                            selectedLayer={selectedLayer}
                            depth={depth + 1}
                            onMove={onMove}
                            onRename={onRename}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
