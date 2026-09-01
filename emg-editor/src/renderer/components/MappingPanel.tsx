import React from 'react';
import { AlertTriangle, Eye, MessageSquare } from 'lucide-react';
import { BLINK_SLOTS, defaultPartAnimation, LIPSYNC_SLOTS, type AvatarMapping, type PartAnimation } from '../types';
import type { PartInfo } from '../parts';
import { NumberInput } from './NumberInput';

interface MappingPanelProps {
    parts: PartInfo[];
    mapping: AvatarMapping;
    onChange: (patch: Partial<AvatarMapping>) => void;
    /** 割り当て中のフレームをプレビューに出す。見ないと「どれが閉じ目か」は決められない。 */
    onPreviewFrame: (partId: string, frameId: string) => void;
    /** 自動まばたき（sprites[] 方式）を組み立てるために要る。 */
    partAnimations: Record<string, PartAnimation>;
    onAnimationChange: (partId: string, patch: Partial<PartAnimation>) => void;
    /** 無ければ作る経路。自動まばたきはここで設定を丸ごと組み立てる。 */
    onAnimationSet: (partId: string, anim: PartAnimation) => void;
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
    parts, mapping, onChange, onPreviewFrame, partAnimations, onAnimationChange, onAnimationSet,
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

    /**
     * 自動まばたきの設定。
     *
     * **仕様上、2 つの方式は同時に使えません。** `mapping.json` が名指ししたパーツの
     * `sprites[]` は自律発火してはならない（`emg-mapping-spec.md` 7.3 / 二重制御の防止）
     * ためです。どちらを取るかは失うものが違うので、選ばせて明示します。
     *
     *   mapping.json 方式 … タイミングはプレイヤーが決める（間隔を指定できない）。
     *                        表情ごとのまばたき差し替え（expressions.overrides）が効く。
     *   sprites[] 方式   … ランダム間隔を秒で指定できる。表情ごとの差し替えは効かない。
     *
     * `mapping.json` には**まばたきの間隔を書く場所がありません**（本書 5 章の
     * baseMapping にタイミングのフィールドが無い）。各実装が独自に決めています。
     */
    const blinkFrames = [mapping.blink.open, mapping.blink.half, mapping.blink.closed].filter(Boolean);
    const spriteBlinkPart = !mapping.blinkPartId
        ? switchParts.find(p => partAnimations[p.partId]?.triggerType === 'random_interval')
        : undefined;
    const spriteAnim = spriteBlinkPart ? partAnimations[spriteBlinkPart.partId] : undefined;

    /** mapping を外して、間隔を指定できる sprites[] 方式へ移す。 */
    const switchToSprite = () => {
        const partId = mapping.blinkPartId;
        const part = parts.find(p => p.partId === partId);
        if (!partId || !part) return;
        // 開 → 半 → 閉 → 半 → 開。半開が無ければ開 → 閉 → 開。
        const { open, half, closed } = mapping.blink;
        const seq = half
            ? [open, half, closed, half, open]
            : [open, closed, open];
        const frames = seq.filter(Boolean);
        const base = defaultPartAnimation(partId, frames.length > 0 ? frames : [part.defaultFrameId ?? '']);
        // **先に設定を作ってから mapping を外す。** 逆にすると、作れなかったときに
        // 「mapping も sprites も無い」状態になる（実際にそうなった）。
        onAnimationSet(partId, {
            ...base,
            enabled: true,
            fps: 14,
            triggerType: 'random_interval',
            intervalMin: 3,
            intervalMax: 8,
        });
        // これを外さないと 7.3 により発火できない。
        onChange({ blinkPartId: '' });
    };

    const autoBlink = (
        <div className="auto-blink">
            <div className="section-head" style={{ marginBottom: '6px' }}>
                <Eye size={13} /> <span>自動まばたき</span>
            </div>

            {mapping.blinkPartId ? (
                <>
                    <div className="auto-blink-state">
                        いまは <b>mapping.json</b> が {mapping.blinkPartId} を制御しています。
                        タイミングは再生側が決めるため、<b>間隔は指定できません</b>。
                        そのかわり表情ごとのまばたき差し替えが効きます。
                    </div>
                    <button
                        className="btn btn-sm"
                        disabled={blinkFrames.length < 2}
                        onClick={switchToSprite}
                        title={blinkFrames.length < 2
                            ? '開と閉を割り当ててから切り替えられます'
                            : 'mapping の割り当てを外し、秒で間隔を決める方式に移す'}
                    >
                        間隔を自分で決める（mapping を外す）
                    </button>
                </>
            ) : spriteBlinkPart && spriteAnim ? (
                <>
                    <div className="auto-blink-state is-sprite">
                        いまは <b>sprites[]</b> が {spriteBlinkPart.partId} を
                        ランダム間隔で再生しています。表情ごとの差し替えは効きません。
                        戻すには上の「パーツ」でまばたき対象を選び直してください。
                    </div>
                    <div className="auto-blink-row">
                        <label>間隔</label>
                        <NumberInput
                            value={spriteAnim.intervalMin} decimals={1} min={0.1} max={60} step={0.5}
                            onChange={v => onAnimationChange(spriteBlinkPart.partId, { intervalMin: v })}
                            style={{ width: '58px' }} title="最短（秒）"
                        />
                        <span className="source-unit">〜</span>
                        <NumberInput
                            value={spriteAnim.intervalMax} decimals={1} min={0.1} max={60} step={0.5}
                            onChange={v => onAnimationChange(spriteBlinkPart.partId, { intervalMax: v })}
                            style={{ width: '58px' }} title="最長（秒）"
                        />
                        <span className="source-unit">秒</span>
                    </div>
                    <div className="auto-blink-row">
                        <label>速さ</label>
                        <NumberInput
                            value={spriteAnim.fps} min={1} max={60} step={1}
                            onChange={v => onAnimationChange(spriteBlinkPart.partId, { fps: v })}
                            style={{ width: '58px' }} title="まばたき 1 回のコマ送り（fps）"
                        />
                        <span className="source-unit">fps</span>
                        <span className="source-unit" style={{ width: 'auto' }}>
                            {spriteAnim.frames.length} コマ
                        </span>
                    </div>
                </>
            ) : (
                <div className="auto-blink-state">
                    まばたきの対象パーツが未設定です。上の「パーツ」で選ぶと、
                    mapping.json による自動まばたきが有効になります。
                </div>
            )}
        </div>
    );

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

            {autoBlink}

            <div className="part-meta" style={{ lineHeight: 1.7 }}>
                <AlertTriangle size={11} style={{ verticalAlign: '-1px' }} />{' '}
                割り当てないまま書き出すと、その状態は動きません。
                フレーム名からは判断できないので、押してプレビューで確かめてください。
            </div>
        </div>
    );
};
