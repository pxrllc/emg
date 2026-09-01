import React from 'react';
import type { LayerMeta, LayerSlice } from '../types';
import { NumberInput } from './NumberInput';

const BLEND_MODES = [
    { value: 'normal',      label: 'Normal' },
    { value: 'multiply',    label: 'Multiply' },
    { value: 'screen',      label: 'Screen（スクリーン）' },
    // 0.5.4 §10.11。色は加算、アルファは通常どおり（透明度が保たれる）。
    { value: 'plus-lighter', label: 'Plus Lighter（加算）' },
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
    /** 9 スライスの初期値を作るために要る、元画像の大きさ。 */
    layerSize?: { width: number; height: number } | null;
    /**
     * このレイヤーが属するパーツの種別。
     * `switch` では合成モードがパーツ全体に配られるので、その旨を出す。
     */
    partType?: 'static' | 'switch';
}

/**
 * 選択中レイヤー 1 枚の属性。
 *
 * partID / type / 既定フレームは **パーツ単位の操作**（PartsPanel）に移した。
 * ここに置くと「今選んでいる 1 枚だけが switch」のような、書き出せない状態を
 * 作れてしまうため。ここに残すのは本当にレイヤー固有の値だけ。
 */
export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ layerName, layerId, meta, onChange, layerSize, partType }) => {
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

    /**
     * 9 スライス。枠や吹き出しを、角を潰さずに好きな大きさへ引き伸ばす。
     *
     * **書き出し時に画素へ焼き込みます。** EMG のレイヤーは矩形と `basePosition`
     * しか持たず「中央だけ伸ばす」を表せないため、再生時に解く方法がありません。
     * 出来上がるのはただの 1 枚のレイヤーなので、どの実装でも正しく描けます。
     */
    const slice = meta.slice;
    const src = layerSize;
    const patchSlice = (p: Partial<LayerSlice>) => {
        if (!slice) return;
        handleChange('slice', { ...slice, ...p });
    };
    const sliceRow = (label: string, keys: (keyof LayerSlice)[], max: number, unit: string) => (
        <div className="source-tf-row" key={label}>
            <label style={{ width: '54px' }}>{label}</label>
            {keys.map(k => (
                <NumberInput
                    key={k}
                    value={slice ? slice[k] : 0}
                    onChange={v => patchSlice({ [k]: Math.max(0, v) } as Partial<LayerSlice>)}
                    min={0} max={max} step={1}
                    style={{ width: '54px' }}
                    title={String(k)}
                />
            ))}
            <span className="source-unit">{unit}</span>
        </div>
    );

    const sliceSection = (
        <div style={{ borderTop: '1px solid #3e3e42', paddingTop: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#ccc', cursor: 'pointer', marginBottom: '8px' }}>
                <input
                    type="checkbox"
                    checked={!!slice}
                    disabled={!src}
                    onChange={e => handleChange('slice', e.target.checked && src
                        ? {
                            // 既定は各辺 1/4。角の目安として無難で、そのままでも絵が壊れない。
                            left: Math.floor(src.width / 4), right: Math.floor(src.width / 4),
                            top: Math.floor(src.height / 4), bottom: Math.floor(src.height / 4),
                            width: src.width, height: src.height,
                        } satisfies LayerSlice
                        : undefined)}
                />
                9 スライスで伸ばす
            </label>

            {slice && src && (
                <>
                    {sliceRow('余白 左右', ['left', 'right'], src.width, 'px')}
                    {sliceRow('余白 上下', ['top', 'bottom'], src.height, 'px')}
                    <div className="source-tf-row">
                        <label style={{ width: '54px' }}>仕上がり</label>
                        <NumberInput value={slice.width} min={1} max={8192} step={1}
                            onChange={v => patchSlice({ width: Math.max(1, v) })}
                            style={{ width: '54px' }} title="幅（px）" />
                        <NumberInput value={slice.height} min={1} max={8192} step={1}
                            onChange={v => patchSlice({ height: Math.max(1, v) })}
                            style={{ width: '54px' }} title="高さ（px）" />
                        <span className="source-unit">px</span>
                    </div>
                    <div className="source-note">
                        元画像 {src.width}×{src.height}px。四隅はそのまま、辺は 1 方向、中央は両方向に伸びます。
                        書き出すと 1 枚のレイヤーになるので、**再生時に大きさは変わりません**。
                    </div>
                </>
            )}
            {!src && (
                <div className="source-note">
                    画像を持つレイヤーを選ぶと設定できます（グループには使えません）。
                </div>
            )}
        </div>
    );

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
                    title={partType === 'switch'
                        ? 'このパーツの全レイヤーに入ります（差分は同じ合成モードで扱います）'
                        : 'このレイヤーだけに入ります'}
                    style={inputStyle}
                >
                    {BLEND_MODES.map(mode => (
                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                </select>
                {/* switch のレイヤーは同じものの入れ替え候補（コマ・差分）なので、
                    コマごとに合成の仕方が変わる状況が無い。1 枚だけ変えると
                    「そのコマが出ている間だけ見え方が違う」という説明のつかない
                    状態になるため、パーツ全体へ配る。 */}
                {partType === 'switch' && (
                    <div style={{ fontSize: '10px', color: '#6f6f75', marginTop: '4px', lineHeight: 1.6 }}>
                        差分パーツなので、不透明度と合成モードは
                        このパーツの<b style={{ color: '#8a8a8e' }}>全レイヤー</b>に入ります。
                    </div>
                )}
                {!layerSize && (
                    <div style={{ fontSize: '10px', color: '#6f6f75', marginTop: '4px', lineHeight: 1.6 }}>
                        グループを選んでいます。不透明度と合成モードは
                        <b style={{ color: '#8a8a8e' }}>配下のレイヤー全部</b>に入ります
                        （グループ自体は描かれないため）。
                    </div>
                )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#ccc', cursor: 'pointer' }}>
                <input
                    type="checkbox"
                    checked={meta.visible}
                    onChange={e => handleChange('visible', e.target.checked)}
                />
                書き出しに含める
            </label>

            {sliceSection}

            <div style={{ fontSize: '11px', color: '#5f5f64', lineHeight: 1.6, borderTop: '1px solid #3e3e42', paddingTop: '10px' }}>
                レイヤー ID: {meta.id}
            </div>
        </div>
    );
};
