import React, { useState } from 'react';
import { Download, FileJson, Sliders } from 'lucide-react';
import { JsonViewer } from './JsonViewer';
import type { EmgData } from '../services/EmgGenerator';

import type { LayerMeta } from '../types';

const BLEND_MODES = [
    { value: 'normal',      label: 'Normal' },
    { value: 'multiply',    label: 'Multiply' },
    { value: 'screen',      label: 'Screen' },
    { value: 'overlay',     label: 'Overlay' },
    { value: 'darken',      label: 'Darken' },
    { value: 'lighten',     label: 'Lighten' },
    { value: 'color dodge', label: 'Color Dodge' },
    { value: 'color burn',  label: 'Color Burn' },
    { value: 'soft light',  label: 'Soft Light' },
    { value: 'hard light',  label: 'Hard Light' },
    { value: 'difference',  label: 'Difference' },
    { value: 'exclusion',   label: 'Exclusion' },
    { value: 'hue',         label: 'Hue' },
    { value: 'saturation',  label: 'Saturation' },
    { value: 'color',       label: 'Color' },
    { value: 'luminosity',  label: 'Luminosity' },
];

interface PropertiesPanelProps {
    layerId: number | null;
    meta?: LayerMeta;
    onChange: (meta: LayerMeta) => void;
    onExport: () => void;
    onSaveProject: () => void;
    onLoadProject: () => void;
    emgData?: EmgData;
    onTypeAll?: (type: 'static' | 'switch') => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ layerId, meta, onChange, onExport, onSaveProject, onLoadProject, emgData, onTypeAll }) => {
    const [activeTab, setActiveTab] = useState<'properties' | 'json'>('properties');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #444', background: '#252526' }}>
                <button
                    onClick={() => setActiveTab('properties')}
                    style={{
                        flex: 1,
                        padding: '10px',
                        background: activeTab === 'properties' ? '#1e1e1e' : 'transparent',
                        color: activeTab === 'properties' ? 'white' : '#888',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        fontSize: '12px'
                    }}
                >
                    <Sliders size={14} /> Properties
                </button>
                <button
                    onClick={() => setActiveTab('json')}
                    style={{
                        flex: 1,
                        padding: '10px',
                        background: activeTab === 'json' ? '#1e1e1e' : 'transparent',
                        color: activeTab === 'json' ? 'white' : '#888',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        fontSize: '12px'
                    }}
                >
                    <FileJson size={14} /> JSON
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', background: '#1e1e1e' }}>
                {activeTab === 'properties' ? (
                    !layerId || !meta ? (
                        <div className="properties-empty" style={{ padding: '20px', color: '#888', textAlign: 'center' }}>
                            Select a layer to view properties
                            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {onTypeAll && (
                                    <div style={{ textAlign: 'left' }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#ccc' }}>Batch Set Type</label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => onTypeAll('static')} style={{ flex: 1, padding: '6px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
                                                All Static
                                            </button>
                                            <button onClick={() => onTypeAll('switch')} style={{ flex: 1, padding: '6px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
                                                All Switch
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <button className="btn-primary" onClick={onExport} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                                    <Download size={16} />
                                    Export EMG
                                </button>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button onClick={onSaveProject} style={{ flex: 1, padding: '8px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                                        Save Project
                                    </button>
                                    <button onClick={onLoadProject} style={{ flex: 1, padding: '8px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                                        Load Project
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="properties-form" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Layer Properties</h3>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#ccc' }}>ID</label>
                                <input type="text" value={meta.id} disabled style={{ width: '100%', padding: '6px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px' }} />
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#ccc' }}>Part ID</label>
                                <input
                                    type="text"
                                    value={meta.partId}
                                    onChange={(e) => handleChange('partId', e.target.value)}
                                    style={{ width: '100%', padding: '6px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px' }}
                                />
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#ccc' }}>Type</label>
                                <select
                                    value={meta.type}
                                    onChange={(e) => handleChange('type', e.target.value)}
                                    style={{ width: '100%', padding: '6px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px' }}
                                >
                                    <option value="static">Static</option>
                                    <option value="switch">Switch</option>
                                </select>
                                {onTypeAll && (
                                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                                        <button onClick={() => onTypeAll('static')} style={{ flex: 1, padding: '4px', background: '#555', color: '#ccc', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                                            All Static
                                        </button>
                                        <button onClick={() => onTypeAll('switch')} style={{ flex: 1, padding: '4px', background: '#555', color: '#ccc', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                                            All Switch
                                        </button>
                                    </div>
                                )}
                            </div>

                            {meta.type === 'switch' && (
                                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="checkbox"
                                        id="isDefault"
                                        checked={meta.isDefault || false}
                                        onChange={(e) => handleChange('isDefault', e.target.checked)}
                                    />
                                    <label htmlFor="isDefault" style={{ fontSize: '12px', color: '#ccc', cursor: 'pointer' }}>
                                        Set as Default for this Part
                                    </label>
                                </div>
                            )}

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#ccc' }}>
                                    Opacity: {Math.round((meta.opacity ?? 1) * 100)}%
                                </label>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={Math.round((meta.opacity ?? 1) * 100)}
                                    onChange={(e) => handleChange('opacity', parseInt(e.target.value) / 100)}
                                    style={{ width: '100%', accentColor: '#3b82f6' }}
                                />
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#ccc' }}>Blend Mode</label>
                                <select
                                    value={meta.blendMode || 'normal'}
                                    onChange={(e) => handleChange('blendMode', e.target.value)}
                                    style={{ width: '100%', padding: '6px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px' }}
                                >
                                    {BLEND_MODES.map(mode => (
                                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-actions" style={{ marginTop: '20px' }}>
                                <button className="btn-primary" onClick={onExport} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                                    <Download size={16} />
                                    Export EMG
                                </button>
                                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                    <button onClick={onSaveProject} style={{ flex: 1, padding: '8px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                                        Save Project
                                    </button>
                                    <button onClick={onLoadProject} style={{ flex: 1, padding: '8px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                                        Load Project
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                ) : (
                    emgData ? (
                        <JsonViewer data={emgData} highlightId={layerId?.toString()} />
                    ) : (
                        <div style={{ padding: '20px', color: '#888', textAlign: 'center' }}>
                            No data generated yet. Load a PSD and ensure layers are visible.
                        </div>
                    )
                )}
            </div>
        </div>
    );

    function handleChange(field: keyof LayerMeta, value: any) {
        if (meta) {
            onChange({ ...meta, [field]: value });
        }
    }
};
