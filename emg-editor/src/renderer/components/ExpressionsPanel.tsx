import React, { useState } from 'react';
import { Plus, Smile, Trash2 } from 'lucide-react';
import { BLINK_SLOTS, LIPSYNC_SLOTS, type AvatarExpression, type AvatarMapping, type AvatarPreset } from '../types';
import type { PartInfo } from '../parts';

interface ExpressionsPanelProps {
    expressions: AvatarExpression[];
    presets: AvatarPreset[];
    parts: PartInfo[];
    mapping: AvatarMapping;
    hasFile: boolean;
    onAdd: (name: string) => void;
    onChange: (name: string, patch: Partial<AvatarExpression>) => void;
    onRename: (name: string, next: string) => void;
    onDelete: (name: string) => void;
    onPreviewFrame: (partId: string, frameId: string) => void;
}

const inputStyle: React.CSSProperties = {
    padding: '5px 7px', background: '#1a1a1c', border: '1px solid #3e3e42',
    color: '#fff', borderRadius: '4px', fontSize: '12px', minWidth: 0,
};

/**
 * 表情の編集面。
 *
 * **構造はプリセットが持ち、ここでは目・口だけを足します。**
 * 表情の `parts` に目や口を書いても、解決の順序（parts を適用 →
 * blink / lipSync が自分のパーツを上書き）により黙って無効になるためです。
 * 目・口以外を変えたい場合はプリセットを作って参照します。
 */
export const ExpressionsPanel: React.FC<ExpressionsPanelProps> = ({
    expressions, presets, parts, mapping, hasFile,
    onAdd, onChange, onRename, onDelete, onPreviewFrame,
}) => {
    const [newName, setNewName] = useState('');
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    if (!hasFile) return null;

    const blinkPart = parts.find(p => p.partId === mapping.blinkPartId);
    const lipPart = parts.find(p => p.partId === mapping.lipSyncPartId);

    const add = () => { onAdd(newName); setNewName(''); };
    const commitRename = () => {
        if (renaming && renameValue.trim()) onRename(renaming, renameValue.trim());
        setRenaming(null);
    };

    /** 1 スロット分のフレーム選択。「目と口」タブと同じ操作感にする。 */
    const slotRow = (
        part: PartInfo | undefined, label: string, value: string, onPick: (v: string) => void,
    ) => (
        <div className="slot-row" key={label}>
            <span className={`slot-label ${value ? '' : 'optional'}`}>{label}</span>
            <div className="frame-strip">
                {part?.frames.map(f => (
                    <button
                        key={f.frameId}
                        className={`frame-chip ${f.frameId === value ? 'previewing' : ''}`}
                        onClick={() => {
                            onPick(f.frameId === value ? '' : f.frameId);
                            onPreviewFrame(part.partId, f.frameId);
                        }}
                        title={f.frameId === value ? 'もう一度押すと解除' : `${f.frameId} を割り当てる`}
                    >
                        {f.frameId}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            <div className="map-block">
                <div className="map-head"><Smile size={14} /> 表情</div>

                <div className="anim-row">
                    <input
                        type="text"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) add(); }}
                        placeholder="表情名（angry、照れ など）"
                        style={{ ...inputStyle, flex: 1 }}
                    />
                    <button className="btn btn-sm" onClick={add} disabled={!newName.trim()}>
                        <Plus size={12} /> 追加
                    </button>
                </div>

                <div className="part-meta" style={{ lineHeight: 1.7 }}>
                    見た目の組み合わせは<strong>プリセット</strong>で作り、表情はそれを参照します。
                    表情から目・口のパーツを直接指定することはできません
                    （まばたき・口パクに後から上書きされるため）。目と口はここで指定します。
                </div>

                {!mapping.blinkPartId && !mapping.lipSyncPartId && (
                    <div className="part-meta" style={{ color: '#f0b37e' }}>
                        「目と口」タブで役割パーツを決めると、表情ごとの差し替えができます。
                    </div>
                )}
            </div>

            {expressions.length === 0 ? (
                <div className="part-meta">表情はまだありません。</div>
            ) : expressions.map(e => (
                <div key={e.name} className="part-card">
                    <div className="part-card-head">
                        {renaming === e.name ? (
                            <input
                                value={renameValue}
                                onChange={ev => setRenameValue(ev.target.value)}
                                onBlur={commitRename}
                                onKeyDown={ev => {
                                    if (ev.key === 'Enter') commitRename();
                                    if (ev.key === 'Escape') setRenaming(null);
                                }}
                                autoFocus
                                style={{ ...inputStyle, flex: 1, borderColor: '#2563eb' }}
                            />
                        ) : (
                            <span
                                className="part-name"
                                title="ダブルクリックで名前を変更"
                                onDoubleClick={() => { setRenaming(e.name); setRenameValue(e.name); }}
                            >
                                {e.name}
                            </span>
                        )}
                        <button className="icon-btn" title="削除" onClick={() => onDelete(e.name)}>
                            <Trash2 size={12} color="#777" />
                        </button>
                    </div>

                    <div className="part-card-body">
                        <div className="anim-row">
                            <label>見た目</label>
                            <select
                                value={e.presetID}
                                onChange={ev => onChange(e.name, { presetID: ev.target.value })}
                                style={inputStyle}
                            >
                                <option value="">（変えない）</option>
                                {presets.map(p => (
                                    <option key={p.presetID} value={p.presetID}>{p.label}</option>
                                ))}
                            </select>
                            {presets.length === 0 && (
                                <span className="part-meta">プリセットがありません</span>
                            )}
                        </div>

                        {mapping.blinkPartId && (
                            <>
                                <div className="part-meta">まばたきの差し替え（指定した分だけ効きます）</div>
                                {BLINK_SLOTS.map(s => slotRow(
                                    blinkPart, s.label, e.blink[s.key],
                                    v => onChange(e.name, { blink: { ...e.blink, [s.key]: v } })))}
                            </>
                        )}

                        {mapping.lipSyncPartId && (
                            <>
                                <div className="part-meta">口の差し替え</div>
                                {LIPSYNC_SLOTS.filter(s => s.key !== 'open').map(s => slotRow(
                                    lipPart, s.label, e.lipSync[s.key as keyof typeof e.lipSync],
                                    v => onChange(e.name, { lipSync: { ...e.lipSync, [s.key]: v } })))}
                            </>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};
