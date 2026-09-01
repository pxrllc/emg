import React, { useState } from 'react';
import { Box, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { TransformGroup } from '../types';

interface GroupsPanelProps {
    groups: TransformGroup[];
    /** 割り当てられる全パーツ（`PartInfo.partId`）。 */
    partIds: string[];
    selectedPartId: string | null;
    onCreate: (partIds: string[]) => void;
    onToggleMember: (groupId: string, partId: string) => void;
    onRename: (groupId: string, name: string) => void;
    onDelete: (groupId: string) => void;
    onSelectPart: (partId: string) => void;
}

/**
 * ヌル（複数パーツをまとめて動かす入れ物）の一覧。
 *
 * **EMG にグループはありません。** ここで作るのは「メンバーが同じトランスフォームと
 * 同じアンカーを共有している」状態で、書き出すとメンバーそれぞれに同じ `tracks` を
 * 持つ sprite が出ます。結果の絵は親子付けと同じになります。
 *
 * したがって**メンバーは自分だけの動きを持てません**。1 枚のレイヤーに書けるアンカーが
 * 1 つで、同じレイヤーを狙う sprite が複数あるときの順序が §7.4 で未定義だからです。
 * メンバーのどれを動かしても全員に配られます。
 */
export const GroupsPanel: React.FC<GroupsPanelProps> = ({
    groups, partIds, selectedPartId, onCreate, onToggleMember, onRename, onDelete, onSelectPart,
}) => {
    const [open, setOpen] = useState(true);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<string | null>(null);

    if (partIds.length === 0) return null;

    const owner = (partId: string) => groups.find(g => g.partIds.includes(partId));
    const selectedFree = !!selectedPartId && !owner(selectedPartId);

    return (
        <div className="sources-panel groups-panel">
            <button className="sources-head" onClick={() => setOpen(o => !o)}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Box size={13} />
                <span>ヌル</span>
                <span className="sources-count">{groups.length}</span>
            </button>

            {open && (
                <>
                    <div className="group-new">
                        <button
                            className="btn btn-sm"
                            disabled={!selectedFree}
                            onClick={() => selectedPartId && onCreate([selectedPartId])}
                            title={selectedFree
                                ? `${selectedPartId} でヌルを作る`
                                : selectedPartId
                                    ? 'このパーツは既に別のヌルに入っています'
                                    : 'パーツを選んでから作れます'}
                        >
                            <Plus size={12} /> 選択中のパーツで作る
                        </button>
                    </div>

                    {groups.length === 0 && (
                        <div className="source-unused" style={{ paddingLeft: '12px' }}>
                            複数のパーツを 1 つの対象としてまとめて動かせます。
                        </div>
                    )}

                    {groups.map(g => {
                        const isOpen = expanded === g.id;
                        return (
                            <div key={g.id} className={`source-row ${isOpen ? 'is-open' : ''}`}>
                                <div className="source-line">
                                    <button
                                        className="source-name"
                                        // 開くと同時にメンバーを選ぶ。ヌルの実体はメンバーが
                                        // 共有しているトランスフォームなので、1 つ選べば
                                        // プレビューの枠も下のタイムラインもヌル全体を指す。
                                        onClick={() => {
                                            const next = isOpen ? null : g.id;
                                            setExpanded(next);
                                            if (next && g.partIds.length > 0) onSelectPart(g.partIds[0]);
                                        }}
                                        title="開くとプレビューに枠が出て、下のタイムラインで動きを付けられます"
                                    >
                                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        <span className="source-label">{g.name}</span>
                                    </button>
                                    <span className="source-meta">{g.partIds.length} パーツ</span>
                                    {confirming === g.id ? (
                                        <span className="source-confirm">
                                            <button className="btn btn-sm btn-danger"
                                                onClick={() => { setConfirming(null); onDelete(g.id); }}>
                                                解除
                                            </button>
                                            <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(null)}>
                                                やめる
                                            </button>
                                        </span>
                                    ) : (
                                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(g.id)}
                                            title="ヌルを解く（各パーツの動きはそのまま残ります）">
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                </div>

                                {isOpen && (
                                    <div className="source-transform">
                                        <div className="source-tf-row">
                                            <label>名前</label>
                                            <input
                                                className="group-name-input"
                                                value={g.name}
                                                onChange={e => onRename(g.id, e.target.value)}
                                            />
                                        </div>
                                        <div className="group-members">
                                            {partIds.map(pid => {
                                                const own = owner(pid);
                                                const mine = own?.id === g.id;
                                                // 他のヌルに入っているものは触らせない。
                                                // 1 パーツが 2 つのヌルに入ると、共有アンカーが競合する。
                                                const taken = !!own && !mine;
                                                return (
                                                    <label key={pid}
                                                        className={`group-member ${taken ? 'is-taken' : ''}`}
                                                        title={taken ? `${own!.name} に入っています` : pid}>
                                                        <input
                                                            type="checkbox"
                                                            checked={mine}
                                                            disabled={taken}
                                                            onChange={() => onToggleMember(g.id, pid)}
                                                        />
                                                        <span onClick={e => { e.preventDefault(); onSelectPart(pid); }}>
                                                            {pid}
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                        <div className="source-note">
                                            メンバーのどれかを選ぶと、プレビューにヌル全体の枠が出ます。
                                            掴んで動かすと全員に同じ動きが入ります（メンバーごとに別の動きは持てません）。
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
};
