import React from 'react';
import { AlertTriangle, Eye, MessageSquare } from 'lucide-react';
import { BLINK_SLOTS, LIPSYNC_SLOTS, type AvatarMapping } from '../types';
import type { PartInfo } from '../parts';

interface MappingPanelProps {
    parts: PartInfo[];
    mapping: AvatarMapping;
    onChange: (patch: Partial<AvatarMapping>) => void;
    /** 割り当て中のフレームをプレビューに出す。見ないと「どれが閉じ目か」は決められない。 */
    onPreviewFrame: (partId: string, frameId: string) => void;
}

const inputStyle: React.CSSProperties = {
    padding: '5px 7px', background: '#1a1a1c', border: '1px solid #3e3e42',
    color: '#fff', borderRadius: '4px', fontSize: '12px', minWidth: 0,
};

/**
 * `mapping.json` の編集面。
 *
 * これが無いと、書き出した `.emg` はまばたきも口パクも動きません。
 * 自動生成は対象パーツがちょうど 3 レイヤーのときだけ blink を仮埋めし、
 * それ以外は空のままだったため、生成された mapping.json は多くの場合
 * そのままでは機能しませんでした。
 */
export const MappingPanel: React.FC<MappingPanelProps> = ({
    parts, mapping, onChange, onPreviewFrame,
}) => {
    const switchParts = parts.filter(p => p.type === 'switch' && p.exportedCount > 0);

    if (parts.length === 0) {
        return <div className="empty-state">素材を読み込むと、まばたきと口の設定ができます。</div>;
    }

    if (switchParts.length === 0) {
        return (
            <div className="empty-state">
                差分パーツ（Switch）がありません。<br />
                まばたきや口パクには、フレームを切り替えられるパーツが要ります。
            </div>
        );
    }

    const blinkPart = parts.find(p => p.partId === mapping.blinkPartId);
    const lipPart = parts.find(p => p.partId === mapping.lipSyncPartId);

    /** 1 つのスロット（開/閉、あ/い/…）にフレームを割り当てる行。 */
    const slotRow = (
        part: PartInfo | undefined,
        slotKey: string,
        slotLabel: string,
        value: string,
        onPick: (frameId: string) => void,
        optional = false,
    ) => (
        <div className="slot-row" key={slotKey}>
            <span className={`slot-label ${value ? '' : optional ? 'optional' : 'missing'}`}>
                {slotLabel}
            </span>
            <div className="frame-strip">
                {part?.frames.map(f => (
                    <button
                        key={f.frameId}
                        className={`frame-chip ${f.frameId === value ? 'previewing' : ''}`}
                        onClick={() => {
                            onPick(f.frameId === value ? '' : f.frameId);
                            onPreviewFrame(part.partId, f.frameId);
                        }}
                        title={
                            f.frameId === value
                                ? `${f.frameId} — もう一度押すと解除`
                                : `${f.frameId} を「${slotLabel}」に割り当てる`
                        }
                    >
                        {f.frameId}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '18px' }}>

            <div>
                <label className="fld-label">アバター名</label>
                <input
                    type="text"
                    value={mapping.avatarId}
                    onChange={e => onChange({ avatarId: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }}
                    placeholder="avatar"
                />
                <div className="part-meta" style={{ marginTop: '4px' }}>
                    識別用のラベルです。表示の解決には使われません。
                </div>
            </div>

            {/* ── まばたき ─────────────────────────────── */}
            <div className="map-block">
                <div className="map-head"><Eye size={14} /> まばたき</div>

                <div className="anim-row">
                    <label>パーツ</label>
                    <select
                        value={mapping.blinkPartId}
                        onChange={e => onChange({
                            blinkPartId: e.target.value,
                            // パーツを変えたら割り当ては無効になる。持ち越すと
                            // 存在しないフレームを指したままになる。
                            blink: { open: '', half: '', closed: '' },
                        })}
                        style={inputStyle}
                    >
                        <option value="">（使わない）</option>
                        {switchParts.map(p => (
                            <option key={p.partId} value={p.partId}>{p.partId}</option>
                        ))}
                    </select>
                </div>

                {mapping.blinkPartId && BLINK_SLOTS.map(s =>
                    slotRow(blinkPart, s.key, s.label, mapping.blink[s.key],
                        v => onChange({ blink: { ...mapping.blink, [s.key]: v } })))}
            </div>

            {/* ── 口パク ───────────────────────────────── */}
            <div className="map-block">
                <div className="map-head"><MessageSquare size={14} /> 口パク</div>

                <div className="anim-row">
                    <label>パーツ</label>
                    <select
                        value={mapping.lipSyncPartId}
                        onChange={e => onChange({
                            lipSyncPartId: e.target.value,
                            lipSync: { a: '', i: '', u: '', e: '', o: '', n: '', open: '' },
                        })}
                        style={inputStyle}
                    >
                        <option value="">（使わない）</option>
                        {switchParts.map(p => (
                            <option key={p.partId} value={p.partId}>{p.partId}</option>
                        ))}
                    </select>
                </div>

                {mapping.lipSyncPartId && LIPSYNC_SLOTS.map(s =>
                    slotRow(lipPart, s.key, s.label, mapping.lipSync[s.key],
                        v => onChange({ lipSync: { ...mapping.lipSync, [s.key]: v } }),
                        s.key === 'open'))}
            </div>

            <div className="part-meta" style={{ lineHeight: 1.7 }}>
                <AlertTriangle size={11} style={{ verticalAlign: '-1px' }} />{' '}
                割り当てないまま書き出すと、その状態は動きません。
                フレーム名からは判断できないので、押してプレビューで確かめてください。
            </div>
        </div>
    );
};
