import React from 'react';
import { ClipboardCheck, X } from 'lucide-react';
import type { ReportLine, TemplateReport } from '../services/Template';

interface TemplateReportDialogProps {
    report: TemplateReport;
    onClose: () => void;
}

const rows: { key: keyof TemplateReport; label: string }[] = [
    { key: 'parts', label: 'パーツ' },
    { key: 'frames', label: 'フレーム' },
    { key: 'presets', label: 'プリセット' },
    { key: 'expressions', label: '表情' },
    { key: 'animations', label: 'アニメーション' },
];

const Row: React.FC<{ label: string; line: ReportLine }> = ({ label, line }) => {
    if (line.total === 0) return null;
    const complete = line.matched === line.total && line.notes.length === 0;
    return (
        <div className="tpl-row">
            <span className="tpl-row-label">{label}</span>
            <span className={`tpl-row-count ${complete ? 'ok' : 'partial'}`}>
                {line.matched} / {line.total}
            </span>
            {line.missing.length > 0 && (
                <div className="tpl-row-missing">
                    見つかりません: {line.missing.join('、')}
                </div>
            )}
            {/* 数だけでは「一致した」ように見えてしまうものを別に出す。 */}
            {line.notes.length > 0 && (
                <div className="tpl-row-missing">
                    中身が欠けています: {line.notes.join('、')}
                </div>
            )}
        </div>
    );
};

/**
 * テンプレートを当てた結果。
 *
 * **消えるトーストでは出しません。** 名前が一致しなかったものは、そのまま
 * 未割り当てとして残ります（推測で近い名前に当てにいかないため）。
 * 何が落ちたかを見逃すと、利用者は「テンプレートが効いていない」ことに
 * 気づけないまま書き出してしまいます。
 */
export const TemplateReportDialog: React.FC<TemplateReportDialogProps> = ({ report, onClose }) => {
    const missed = rows.reduce(
        (n, r) => n + report[r.key].missing.length + report[r.key].notes.length, 0);
    const nothing = rows.every(r => report[r.key].total === 0);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <ClipboardCheck size={15} />
                    <span style={{ flex: 1 }}>テンプレートを適用しました</span>
                    <button className="icon-btn" onClick={onClose} title="閉じる"><X size={14} /></button>
                </div>

                <div className="modal-body">
                    {nothing ? (
                        <div className="empty-state">テンプレートに中身がありませんでした。</div>
                    ) : (
                        rows.map(r => <Row key={r.key} label={r.label} line={report[r.key]} />)
                    )}

                    <div className="part-meta" style={{ lineHeight: 1.7 }}>
                        {missed === 0
                            ? '全て一致しました。'
                            : 'テンプレートは名前だけで対応を取ります（partID とフレーム識別子）。'
                              + '一致しなかったものは未割り当てのまま残してあります — '
                              + '近い名前に当てにいくと、取り違えが黙って通ってしまうためです。'
                              + 'パーツ名やレイヤー名を合わせるか、その分だけ手で割り当ててください。'}
                    </div>
                </div>

                <div className="modal-foot">
                    <button className="btn btn-primary" onClick={onClose}>閉じる</button>
                </div>
            </div>
        </div>
    );
};
