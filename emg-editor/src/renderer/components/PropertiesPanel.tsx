import React from 'react';
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

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px', background: '#1a1a1c',
    border: '1px solid #3e3e42', color: '#fff', borderRadius: '4px', fontSize: '12px',
};

const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '4px', fontSize: '11px', color: '#8a8a8e',
};

interface PropertiesPanelProps {
    layerName?: string;
    layerId: number | null;
    meta?: LayerMeta;
    onChange: (meta: LayerMeta) => void;
}

/**
 * 選択中レイヤー 1 枚の属性。
 *
 * partID / type / 既定フレームは **パーツ単位の操作**（PartsPanel）に移した。
 * ここに置くと「今選んでいる 1 枚だけが switch」のような、書き出せない状態を
 * 作れてしまうため。ここに残すのは本当にレイヤー固有の値だけ。
 */
export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ layerName, layerId, meta, onChange }) => {
    if (!layerId || !meta) {
        return (
            <div className="empty-state">
                レイヤーを選ぶと、そのレイヤー固有の設定が出ます。
                <div style={{ fontSize: '11px', color: '#5f5f64' }}>
                    パーツの種別や差分の既定は「パーツ」タブで設定します。
                </div>
            </div>
        );
    }

    const handleChange = (field: keyof LayerMeta, value: unknown) => {
        onChange({ ...meta, [field]: value });
    };

    return (
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {layerName || `Layer ${meta.id}`}
                </div>
                <div style={{ fontSize: '11px', color: '#7d7d82', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span className={`badge badge-${meta.type}`}>{meta.type}</span>
                    <span>{meta.partId}</span>
                    {meta.frameName && <span className="badge badge-frame">{meta.frameName}</span>}
                </div>
            </div>

            <div>
                <label style={labelStyle}>不透明度: {Math.round((meta.opacity ?? 1) * 100)}%</label>
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((meta.opacity ?? 1) * 100)}
                    onChange={e => handleChange('opacity', parseInt(e.target.value) / 100)}
                    style={{ width: '100%', accentColor: '#2563eb' }}
                />
            </div>

            <div>
                <label style={labelStyle}>ブレンドモード</label>
                <select
                    value={meta.blendMode || 'normal'}
                    onChange={e => handleChange('blendMode', e.target.value)}
                    style={inputStyle}
                >
                    {BLEND_MODES.map(mode => (
                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#ccc', cursor: 'pointer' }}>
                <input
                    type="checkbox"
                    checked={meta.visible}
                    onChange={e => handleChange('visible', e.target.checked)}
                />
                書き出しに含める
            </label>

            <div style={{ fontSize: '11px', color: '#5f5f64', lineHeight: 1.6, borderTop: '1px solid #3e3e42', paddingTop: '10px' }}>
                レイヤー ID: {meta.id}
            </div>
        </div>
    );
};
