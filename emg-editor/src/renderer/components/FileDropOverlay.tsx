import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus } from 'lucide-react';

interface FileDropOverlayProps {
    /** 落とされたファイル。順に取り込む。 */
    onFiles: (files: File[]) => void;
}

/**
 * ウィンドウ全体でファイルのドロップを受ける。
 *
 * 「編集の途中で素材を持ち込む」操作としては、ボタンを探すよりドロップの方が速い。
 * ボタンからしか追加できないと、機能があること自体に気づかれない。
 *
 * スプライトシートだけはドロップの対象外。格子の指定が要るため、
 * 画像を見ただけではシートかどうか判別できない（専用の入口から取り込む）。
 */
export const FileDropOverlay: React.FC<FileDropOverlayProps> = ({ onFiles }) => {
    const [active, setActive] = useState(false);
    // dragenter / dragleave は子要素をまたぐたびに発火するので、
    // 数を数えないとカーソルが要素を移動しただけで overlay が消える。
    const depth = useRef(0);

    const hasFiles = (e: DragEvent) =>
        !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

    const onDragEnter = useCallback((e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setActive(true);
    }, []);

    const onDragOver = useCallback((e: DragEvent) => {
        if (!hasFiles(e)) return;
        // preventDefault しないとブラウザがファイルを開いてしまう。
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }, []);

    const onDragLeave = useCallback((e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
    }, []);

    const onDrop = useCallback((e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setActive(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles(files);
    }, [onFiles]);

    useEffect(() => {
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, [onDragEnter, onDragOver, onDragLeave, onDrop]);

    if (!active) return null;

    return (
        <div className="drop-overlay">
            <div className="drop-card">
                <FilePlus size={28} />
                <div className="drop-title">ここに落として追加</div>
                <div className="drop-sub">PSD / KRA / 画像 / アニメーション GIF・WebP・APNG</div>
            </div>
        </div>
    );
};
