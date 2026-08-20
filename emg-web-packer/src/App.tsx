import { useState } from 'react';
import type { Psd } from 'ag-psd';
import { FileLoader } from '@packer/PsdLoader';
import { analyzePsd, type AnalyzedLayer, type PartInfo, type PartType } from './services/analyze';
import { convertToEmg, downloadBlob } from './services/convert';
import { DropZone } from './components/DropZone';
import { PartTypeSelector } from './components/PartTypeSelector';

interface Loaded {
    fileName: string;
    psd: Psd;
    parts: PartInfo[];
    layers: AnalyzedLayer[];
}

type Status = 'idle' | 'loading' | 'converting';

export default function App() {
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [partTypes, setPartTypes] = useState<Map<string, PartType>>(new Map());
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);

    const busy = status !== 'idle';

    const handleFile = async (file: File) => {
        setStatus('loading');
        setError(null);
        setLoaded(null);
        try {
            // FileLoader が拡張子で PSD / KRA を振り分ける（.clip は案内付きで例外）。
            const psd = await FileLoader.load(file);
            const { parts, layers } = analyzePsd(psd);
            if (parts.length === 0) {
                throw new Error('書き出せるレイヤーが見つかりませんでした。');
            }
            setLoaded({ fileName: file.name, psd, parts, layers });
            setPartTypes(new Map(parts.map(p => [p.partId, p.defaultType])));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setStatus('idle');
        }
    };

    const handleConvert = async () => {
        if (!loaded) return;
        setStatus('converting');
        setError(null);
        try {
            const blob = await convertToEmg(loaded.psd, loaded.layers, partTypes);
            const base = loaded.fileName.replace(/\.[^.]+$/, '') || 'model';
            downloadBlob(blob, `${base}.emg`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setStatus('idle');
        }
    };

    return (
        <main className="app">
            <header>
                <h1>EMG Web Packer</h1>
                <p className="lead">PSD をアップロードすると <code>.emg</code> に変換してダウンロードします。</p>
            </header>

            <DropZone onFile={handleFile} disabled={busy} />

            {status === 'loading' && <p className="status">読み込み中…</p>}

            {error && (
                <div className="error" role="alert">
                    <strong>変換できませんでした</strong>
                    <p>{error}</p>
                </div>
            )}

            {loaded && (
                <section className="result">
                    <p className="file-info">
                        <strong>{loaded.fileName}</strong>
                        <span>
                            {loaded.psd.width} × {loaded.psd.height} px ／ {loaded.layers.length} レイヤー
                        </span>
                    </p>

                    <PartTypeSelector
                        parts={loaded.parts}
                        partTypes={partTypes}
                        onChange={(partId, type) =>
                            setPartTypes(prev => new Map(prev).set(partId, type))
                        }
                    />

                    <button className="convert" onClick={handleConvert} disabled={busy}>
                        {status === 'converting' ? '変換中…' : '.emg をダウンロード'}
                    </button>
                </section>
            )}

            <footer>
                <p>
                    変換はすべてブラウザ内で行われ、ファイルがアップロードされることはありません。
                </p>
            </footer>
        </main>
    );
}
