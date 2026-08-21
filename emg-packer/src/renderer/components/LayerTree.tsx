import React, { useState } from 'react';
import type { Layer, Psd } from 'ag-psd';
import { ChevronRight, ChevronDown, Eye, EyeOff, Folder, File, FolderPlus } from 'lucide-react';

// Module-level variable for reliable drag tracking in Electron
let _activeDragLayerId: number | null = null;

interface LayerTreeProps {
    psd: Psd | null;
    visibility: Record<number, boolean>;
    onLayerVisibilityChange: (layer: Layer, visible: boolean) => void;
    onSelectionChange?: (layer: Layer) => void;
    onPsdUpdate?: (psd: Psd) => void;
    selectedLayer?: Layer | null;
    onVisibilityAll?: (visible: boolean) => void;
    onLoadPsd?: () => void;
}

export const LayerTree: React.FC<LayerTreeProps> = ({
    psd,
    visibility,
    onLayerVisibilityChange,
    onSelectionChange,
    onPsdUpdate,
    selectedLayer,
    onVisibilityAll,
    onLoadPsd
}) => {
    if (!psd || !psd.children) return (
        <div style={{ padding: '24px 16px', color: '#666', textAlign: 'center', fontSize: '12px', lineHeight: 1.6, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ marginBottom: '8px', fontSize: '48px', color: '#555' }}>📂</div>
            <div style={{ color: '#999', marginBottom: '24px', fontSize: '14px' }}>No file loaded</div>
            <button 
                onClick={onLoadPsd}
                style={{
                    background: '#3b82f6', color: 'white', border: 'none', padding: '14px 24px', borderRadius: '6px', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold', width: '100%', maxWidth: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                }}
            >
                <FolderPlus size={20} /> Open PSD / KRA
            </button>
        </div>
    );

    const handleCreateGroup = () => {
        if (!psd || !onPsdUpdate) return;
        const newGroup: Layer = {
            id: Date.now(), // Generate a temp ID
            name: 'New Group',
            children: [],
            hidden: false,
            canvas: undefined
        };
        // Add to root for now
        const newPsd = { ...psd, children: [...(psd.children || []), newGroup] };
        onPsdUpdate(newPsd);
    };

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
            <div style={{ padding: '12px 8px', borderBottom: '1px solid #333' }}>
                <button 
                    onClick={onLoadPsd}
                    style={{
                        background: '#3b82f6', color: 'white', border: 'none', padding: '12px', borderRadius: '4px', fontSize: '14px', cursor: 'pointer', fontWeight: 'bold', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'background 0.2s', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
                    }}
                >
                    <FolderPlus size={18} /> Open PSD / KRA
                </button>
            </div>
            <div className="toolbar" style={{ padding: '8px', borderBottom: '1px solid #444', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                    onClick={handleCreateGroup}
                    style={{ background: '#444', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                >
                    <FolderPlus size={14} /> New Group
                </button>
                <button
                    onClick={() => onVisibilityAll?.(true)}
                    title="Show All Layers"
                    style={{ background: '#444', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                >
                    <Eye size={14} /> Show All
                </button>
                <button
                    onClick={() => onVisibilityAll?.(false)}
                    title="Hide All Layers"
                    style={{ background: '#444', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                >
                    <EyeOff size={14} /> Hide All
                </button>
            </div>
            <div className="tree-content" style={{ padding: '8px' }}>
                {psd.children.slice().reverse().map((layer, index) => (
                    <LayerNode
                        key={layer.id || index}
                        layer={layer}
                        visibility={visibility}
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
                className={`tree-item ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft: `${depth * 16 + 4}px`, ...indicatorStyle }}
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
                    {isGroup ? <Folder size={14} fill={isGroup ? "#e8c466" : "none"} color={isGroup ? "#e8c466" : "currentColor"} /> : <File size={14} />}
                    {isRenaming ? (
                        <input
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={handleRenameSubmit}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: '2px 4px', fontSize: '12px' }}
                            onClick={e => e.stopPropagation()}
                        />
                    ) : (
                        <span className="layer-name" onDoubleClick={handleDoubleClick}>{layer.name}</span>
                    )}
                </div>
            </div>

            {isGroup && expanded && layer.children && (
                <div className="layer-children">
                    {layer.children.slice().reverse().map((child, idx) => (
                        <LayerNode
                            key={child.id || idx}
                            layer={child}
                            visibility={visibility}
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
