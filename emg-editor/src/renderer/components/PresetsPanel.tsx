import React, { useState } from 'react';
import { Camera, Pencil, RotateCw, Trash2 } from 'lucide-react';
import type { AvatarPreset } from '../types';

interface PresetsPanelProps {
    presets: AvatarPreset[];
    /** 今のプレビューを保存したら何が記録されるか。 */
    previewDelta: Pick<AvatarPreset, 'parts' | 'toggles'>;
    hasFile: boolean;
    /** excluded に入れたキー（`p:partId` / `t:partId`）は記録しない。 */
    onSave: (label: string, excluded: Set<string>) => void;
    onApply: (presetID: string) => void;
    onUpdate: (presetID: string) => void;
    onRename: (presetID: string, label: string) => void;
    onDelete: (presetID: string) => void;
}

const countOf = (d: Pick<AvatarPreset, 'parts' | 'toggles'>) =>
    Object.keys(d.parts).length + Object.keys(d.toggles).length;

/**
 * 記録された内容をチップで並べる。何が入っているか見えないと更新の判断ができない。
 *
 * `onToggle` を渡すと、押して**記録から外せる**ようになる。プレビューは
 * 前のプリセットの状態を引きずるので（「今見えているもの」を撮るため）、
 * これが無いと「怒り眉」に口の変更まで混ざる。
 */
const Contents: React.FC<{
    d: Pick<AvatarPreset, 'parts' | 'toggles'>;
    excluded?: Set<string>;
    onToggle?: (key: string) => void;
}> = ({ d, excluded, onToggle }) => {
    const chip = (key: string, cls: string, body: React.ReactNode) => {
        const off = excluded?.has(key);
        const content = (
            <>{body}</>
        );
        return onToggle ? (
            <button
                key={key}
                className={`delta-chip ${cls} ${off ? 'excluded' : ''}`}
                onClick={() => onToggle(key)}
                title={off ? '記録に戻す' : '記録から外す'}
            >{content}</button>
        ) : (
            <span key={key} className={`delta-chip ${cls}`}>{content}</span>
        );
    };

    return (
        <div className="frame-strip">
            {Object.entries(d.parts).map(([partId, frameId]) =>
                chip('p:' + partId, '', <>{partId} <span className="delta-arrow">→</span> {frameId}</>))}
            {Object.entries(d.toggles).map(([partId, visible]) =>
                chip('t:' + partId, visible ? 'on' : 'off',
                    <>{partId} <span className="delta-arrow">→</span> {visible ? '表示' : '非表示'}</>))}
        </div>
    );
};

/**
 * 状態の組（`presets[]`）の編集面。
 *
 * 作り方は「プレビューで見た目を作る → 保存」。エディタは既にプリセットが
 * 必要とする状態を持っているので、partID を打ち込ませる UI にはしない。
 */
export const PresetsPanel: React.FC<PresetsPanelProps> = ({
    presets, previewDelta, hasFile, onSave, onApply, onUpdate, onRename, onDelete,
}) => {
    const [label, setLabel] = useState('');
    // 記録から外した項目。プレビューは前の状態を引きずるので、毎回選べる必要がある。
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    if (!hasFile) {
        return <div className="empty-state">素材を読み込むと、状態を保存できます。</div>;
    }

    const total = countOf(previewDelta);
    const deltaCount = total - [...excluded].filter(k =>
        k.startsWith('p:') ? k.slice(2) in previewDelta.parts : k.slice(2) in previewDelta.toggles
    ).length;

    const save = () => {
        onSave(label, excluded);
        setLabel('');
        setExcluded(new Set());
    };

    const toggleExcluded = (key: string) => setExcluded(prev => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });

    const commitRename = () => {
        if (renaming && renameValue.trim()) onRename(renaming, renameValue.trim());
        setRenaming(null);
    };

    return (
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* ── 保存 ─────────────────────────────────── */}
            <div className="map-block">
                <div className="map-head"><Camera size={14} /> 今のプレビューを保存</div>

                <div className="anim-row">
                    <input
                        type="text"
                        value={label}
                        onChange={e => setLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && deltaCount > 0) save(); }}
                        placeholder="名前（にこやか、制服 など）"
                        style={{
                            flex: 1, minWidth: 0, padding: '5px 7px', background: '#1a1a1c',
                            border: '1px solid #3e3e42', color: '#fff', borderRadius: '4px', fontSize: '12px',
                        }}
                    />
                    <button
                        className="btn btn-sm"
                        onClick={save}
                        disabled={!label.trim() || deltaCount === 0}
                    >
                        保存
                    </button>
                </div>

                {total > 0 ? (
                    <>
                        <div className="part-meta">
                            記録される内容（{deltaCount} / {total} 件）
                            {excluded.size > 0 && <span> — 押すと記録から外せます</span>}
                        </div>
                        <Contents d={previewDelta} excluded={excluded} onToggle={toggleExcluded} />
                    </>
                ) : (
                    <div className="part-meta">
                        既定のままなので記録するものがありません。
                        「パーツ」タブで差分やトグルを変えてから保存してください。
                    </div>
                )}

                <div className="part-meta" style={{ lineHeight: 1.7 }}>
                    <strong>既定と違うものだけ</strong>を記録します。触れていないパーツは
                    適用しても変わりません — だから表情と衣装のように別々のパーツを扱う
                    プリセットは重ねられます。<br />
                    プレビューは前に触った状態を引きずるので、混ざったものはチップを押して外してください。
                </div>
            </div>

            {/* ── 一覧 ─────────────────────────────────── */}
            {presets.length === 0 ? (
                <div className="part-meta">保存した状態はまだありません。</div>
            ) : presets.map(p => (
                <div key={p.presetID} className="part-card">
                    <div className="part-card-head">
                        {renaming === p.presetID ? (
                            <input
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                                autoFocus
                                style={{
                                    flex: 1, minWidth: 0, background: '#1a1a1c', color: '#fff',
                                    border: '1px solid #2563eb', borderRadius: '3px', padding: '3px 5px', fontSize: '12px',
                                }}
                            />
                        ) : (
                            <span
                                className="part-name"
                                title={`presetID: ${p.presetID}`}
                                onDoubleClick={() => { setRenaming(p.presetID); setRenameValue(p.label); }}
                            >
                                {p.label}
                            </span>
                        )}

                        <button className="icon-btn" title="名前を変更"
                            onClick={() => { setRenaming(p.presetID); setRenameValue(p.label); }}>
                            <Pencil size={12} color="#777" />
                        </button>
                        <button className="icon-btn" title="今のプレビューで上書きする"
                            onClick={() => onUpdate(p.presetID)}>
                            <RotateCw size={12} color="#777" />
                        </button>
                        <button className="icon-btn" title="削除"
                            onClick={() => onDelete(p.presetID)}>
                            <Trash2 size={12} color="#777" />
                        </button>
                        <button className="btn btn-sm" onClick={() => onApply(p.presetID)}>
                            適用
                        </button>
                    </div>
                    <div className="part-card-body">
                        <Contents d={p} />
                        <div className="part-meta">{countOf(p)} 件</div>
                    </div>
                </div>
            ))}
        </div>
    );
};
