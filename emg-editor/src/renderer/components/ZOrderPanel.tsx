import React, { useState } from 'react';
import { GripVertical, Layers, RotateCcw } from 'lucide-react';

export interface ZOrderRow {
    id: number;
    name: string;
    partId: string;
    z: number;
    visible: boolean;
}

interface ZOrderPanelProps {
    /** 背面 → 前面の順。 */
    rows: ZOrderRow[];
    selectedLayerId: number | null;
    /** 背面 → 前面の新しい並び。 */
    onReorder: (ids: number[]) => void;
    onSelectLayer: (layerId: number) => void;
    onReset: () => void;
}

/**
 * 重なり順（`textureZIndex`）の編集。
 *
 * **これはレイヤーツリーとは別の並びです。** `textureZIndex` はファイル全体で 1 本の
 * 順序で、パーツをまたいで入れ子になっている必要がありません。木の形だけで z を
 * 決めていると、
 *
 *   顔のベース（体パーツ） → 首（別パーツ） → 後ろ髪（体パーツ）
 *
 * のように**別のパーツを間に挟む重なり**が表せません。首だけ動かしたいのに、
 * そのために体を 2 つのパーツへ割る、という不要な分割を強いられます。
 * ここで並べれば、パーツの分け方はそのままで重なりだけ決められます。
 *
 * 表示は**前面が上**です。プレビューで手前にあるものが上に来るほうが、
 * 掴んで動かすときに迷いません。
 */
export const ZOrderPanel: React.FC<ZOrderPanelProps> = ({
    rows, selectedLayerId, onReorder, onSelectLayer, onReset,
}) => {
    const [dragId, setDragId] = useState<number | null>(null);
    const [overId, setOverId] = useState<number | null>(null);

    if (rows.length === 0) {
        return <div className="empty-state">素材を読み込むと、重なり順をここで並べ替えられます。</div>;
    }

    // 前面が上。内部の並び（背面 → 前面）を逆に見せる。
    const front = [...rows].reverse();

    const drop = (targetId: number) => {
        if (dragId === null || dragId === targetId) { setDragId(null); setOverId(null); return; }
        const order = front.map(r => r.id).filter(id => id !== dragId);
        const at = order.indexOf(targetId);
        order.splice(at, 0, dragId);
        // 内部は背面 → 前面なので戻して渡す。
        onReorder(order.reverse());
        setDragId(null);
        setOverId(null);
    };

    return (
        <div className="z-panel">
            <div className="z-head">
                <Layers size={13} />
                <span>重なり順</span>
                <span className="z-count">{rows.length} レイヤー</span>
                <button className="btn btn-sm btn-ghost" onClick={onReset}
                    title="明示的な重なり順を捨てて、レイヤーツリーの並びに戻す">
                    <RotateCcw size={12} /> 木の順に戻す
                </button>
            </div>

            <div className="z-note">
                上が手前。<b>パーツをまたいで挟めます</b> — 体のパーツの中に首を入れ直さなくても、
                顔のベースと後ろ髪の間に首を置けます。
            </div>

            <div className="z-list">
                {front.map(r => (
                    <div
                        key={r.id}
                        className={`z-row${selectedLayerId === r.id ? ' is-selected' : ''}`
                            + (overId === r.id ? ' is-over' : '')
                            + (r.visible ? '' : ' is-hidden')}
                        draggable
                        onDragStart={() => setDragId(r.id)}
                        onDragEnd={() => { setDragId(null); setOverId(null); }}
                        onDragOver={e => { e.preventDefault(); setOverId(r.id); }}
                        onDrop={e => { e.preventDefault(); drop(r.id); }}
                        onClick={() => onSelectLayer(r.id)}
                        title={`${r.partId} / ${r.name}`}
                    >
                        <GripVertical size={11} className="z-grip" />
                        <span className="z-part">{r.partId}</span>
                        <span className="z-name">{r.name}</span>
                        <span className="z-value">{r.z}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
