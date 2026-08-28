import React from 'react';
import { FileQuestion, X } from 'lucide-react';

interface EmgDropDialogProps {
    fileName: string;
    onChoose: (how: 'open' | 'merge' | 'cancel') => void;
}

/**
 * 編集中に `.emg` を放り込まれたときに、開くのか足すのかを尋ねる。
 *
 * **黙って足していたのが分かりにくかった。** `.emg` は 1 つで完結したファイルなので
 * 放り込んだ人はたいてい「開きたい」のに、元の絵が残ったまま別のものが増え、
 * さらに読み込んだ側の意味づけで上書きされていた。
 */
export const EmgDropDialog: React.FC<EmgDropDialogProps> = ({ fileName, onChoose }) => (
    <div className="modal-backdrop" onClick={() => onChoose('cancel')}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '420px' }}>
            <div className="modal-head">
                <FileQuestion size={15} />
                <span style={{ flex: 1 }}>{fileName} をどうしますか</span>
                <button className="icon-btn" onClick={() => onChoose('cancel')} title="やめる">
                    <X size={14} />
                </button>
            </div>
            <div className="modal-body">
                <button className="btn btn-primary btn-block" onClick={() => onChoose('open')}>
                    開く（今の内容は破棄）
                </button>
                <div className="part-meta" style={{ lineHeight: 1.7 }}>
                    パーツも差分もアニメーションも、そのファイルの内容に入れ替わります。
                </div>

                <button className="btn btn-block" onClick={() => onChoose('merge')}>
                    素材として足す
                </button>
                <div className="part-meta" style={{ lineHeight: 1.7 }}>
                    今の内容を残したまま、パーツを増やします。名前がぶつかるパーツは
                    改名されます。<br />
                    まばたき・口パクの割り当ては<strong>今のものを残します</strong>
                    （読み込んだ側の割り当ては使いません）。
                </div>
            </div>
            <div className="modal-foot">
                <button className="btn" onClick={() => onChoose('cancel')}>やめる</button>
            </div>
        </div>
    </div>
);
