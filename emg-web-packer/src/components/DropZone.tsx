import { useRef, useState } from 'react';

interface Props {
    onFile: (file: File) => void;
    disabled?: boolean;
}

export function DropZone({ onFile, disabled }: Props) {
    const [isOver, setIsOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
    };

    return (
        <>
            <div
                className={`dropzone${isOver ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
                onDragOver={e => { e.preventDefault(); if (!disabled) setIsOver(true); }}
                onDragLeave={() => setIsOver(false)}
                onDrop={handleDrop}
                onClick={() => !disabled && inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                    if (disabled) return;
                    if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
                }}
            >
                <p className="dropzone-title">PSD をドロップ</p>
                <p className="dropzone-sub">またはクリックして選択（.psd / .kra）</p>
            </div>
            <input
                ref={inputRef}
                type="file"
                accept=".psd,.kra"
                style={{ display: 'none' }}
                onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) onFile(file);
                    // 同じファイルを続けて選び直せるようにリセットする
                    e.target.value = '';
                }}
            />
        </>
    );
}
