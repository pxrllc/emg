import type { PartInfo, PartType } from '../services/analyze';

interface Props {
    parts: PartInfo[];
    partTypes: Map<string, PartType>;
    onChange: (partId: string, type: PartType) => void;
}

/**
 * パーツごとに「ベース（static）／差分（switch）」を選ばせる。
 *
 * ここに並ぶのは PSD のルート直下の項目名ではなく、**実際に .emg に書き出される partID**
 * （ネストしたグループでは内側のグループ名が partID になるため）。
 */
export function PartTypeSelector({ parts, partTypes, onChange }: Props) {
    return (
        <div className="parts">
            <div className="parts-head">
                <span>パーツ</span>
                <span className="parts-head-choice">ベース（常時表示）</span>
            </div>
            {parts.map(part => {
                const isBase = (partTypes.get(part.partId) ?? part.defaultType) === 'static';
                return (
                    <label key={part.partId} className="part-row">
                        <input
                            type="checkbox"
                            checked={isBase}
                            onChange={e => onChange(part.partId, e.target.checked ? 'static' : 'switch')}
                        />
                        <span className="part-name">
                            {part.partId.trim() ? part.partId : <em className="part-unnamed">（名前なしのレイヤー）</em>}
                        </span>
                        <span className="part-count">{part.layerCount} レイヤー</span>
                    </label>
                );
            })}
            <p className="parts-note">
                チェックしたパーツは常に表示されます（体・背景など）。
                チェックを外したパーツは差分として1枚ずつ切り替わります（目・口など）。
            </p>
        </div>
    );
}
