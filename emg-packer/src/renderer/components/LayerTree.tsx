import React, { useState } from 'react';
import type { Layer, Psd } from 'ag-psd';
import { ChevronRight, ChevronDown, Eye, EyeOff, Folder, File } from 'lucide-react';

interface LayerTreeProps {
    psd: Psd | null;
    visibility: Record<number, boolean>;
    onLayerVisibilityChange: (layer: Layer, visible: boolean) => void;
    onSelectionChange?: (layer: Layer) => void;
    selectedLayer?: Layer | null;
}

export const LayerTree: React.FC<LayerTreeProps> = ({
    psd,
    visibility,
    onLayerVisibilityChange,
    onSelectionChange,
    selectedLayer
}) => {
    if (!psd || !psd.children) return <div className="p-2 text-sm text-gray-500">No PSD loaded</div>;

    return (
        <div className="layer-tree">
            {psd.children.slice().reverse().map((layer, index) => (
                <LayerNode
                    key={index}
                    layer={layer}
                    visibility={visibility}
                    onVisibilityChange={onLayerVisibilityChange}
                    onSelectionChange={onSelectionChange}
                    selectedLayer={selectedLayer}
                    depth={0}
                />
            ))}
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
}

const LayerNode: React.FC<LayerNodeProps> = ({
    layer,
    visibility,
    onVisibilityChange,
    onSelectionChange,
    selectedLayer,
    depth
}) => {
    const [expanded, setExpanded] = useState(true);

    const isGroup = !!layer.children;
    // Use visibility from prop if available, otherwise fallback to !layer.hidden
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

    return (
        <div className="layer-node-container">
            <div
                className={`tree-item ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
                onClick={handleSelect}
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
                    <span className="layer-name">{layer.name}</span>
                </div>
            </div>

            {isGroup && expanded && layer.children && (
                <div className="layer-children">
                    {layer.children.slice().reverse().map((child, idx) => (
                        <LayerNode
                            key={idx}
                            layer={child}
                            visibility={visibility}
                            onVisibilityChange={onVisibilityChange}
                            onSelectionChange={onSelectionChange}
                            selectedLayer={selectedLayer}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
