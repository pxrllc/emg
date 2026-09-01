import { useEffect, useMemo, useRef, useState } from 'react';
import { emptyTransform, parseTransformKey, transformKey, type LayerSlice, type PartTransform } from './types';
import { TransformTimeline } from './components/TransformTimeline';
import { useEmgPacker } from './hooks/useEmgPacker';
import { MainLayout } from './components/MainLayout';
import { LayerTree } from './components/LayerTree';
import { SourcesPanel } from './components/SourcesPanel';
import { GroupsPanel } from './components/GroupsPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { InspectorPanel } from './components/InspectorPanel';
import { Toast } from './components/Toast';
import { FileDropOverlay } from './components/FileDropOverlay';
import { countUnassigned, findMappingControlledParts } from './services/MappingGenerator';
import { SourceLoader } from './services/SourceLoader';
import { SpriteSheetLoader } from './services/SpriteSheetLoader';
import { SpriteSheetDialog } from './components/SpriteSheetDialog';
import { TemplateReportDialog } from './components/TemplateReportDialog';
import { CanvasSizeDialog } from './components/CanvasSizeDialog';
import { PreviewExportDialog } from './components/PreviewExportDialog';
import { EmgDropDialog } from './components/EmgDropDialog';
import { computeBounds, drawComposite } from './services/composite';
import { flattenLayers } from './parts';
import { toPartTransform } from './services/sourceTransform';
import { exportPreview, extensionOf } from './services/previewExport';
import { downloadBlob, prepareSave } from './services/download';

function App() {
    const {
        psdRoot, atlasUrls, selectedLayer, layerMeta,
        compositionItems, composeAt, contentDuration, emgData,
        parts, selectedPartId, previewFrame, previewOff, partAnimations,
        partTransforms, transformTarget, setTransformTarget, transformTime, playScope,
        handleTransformChange, handlePlayToggle, handleTransformReset, setTransformTime,
        anyPlayable, partPlayable,
        mapping, setMapping,
        presets, expressions, handleExpressionAdd, handleExpressionChange,
        handleExpressionRename, handleExpressionDelete,
        previewDelta, handlePresetSave, handlePresetApply,
        handlePresetUpdate, handlePresetRename, handlePresetDelete,
        handlePsdLoad, handleNewProject, handleCanvasResize, projectName, setProjectName, handleSourceAdd, handleSourcesAdd,
        sources, handleSourceRemove, handleSourceTransform, handleSourceTransformReset,
        handlePartDuplicate,
        selectedSourceId, handleSelectSource, selectedSource, handleSourceBoxChange,
        zOrder, handleReorderZ, handleResetZ,
        includeAnimation, setIncludeAnimation,
        transformGroups, groupOfPart, groupBounds: groupBoundsById,
        handleGroupCreate, handleGroupToggleMember, handleGroupRename, handleGroupDelete,
        pendingEmgDrop, resolveEmgDrop, handleSheetImport, handlePsdUpdate, handleLayerVisibilityChange,
        handleExport, pendingExport, handleSavePending, handleSaveProject, handleLoadProject,
        handleTemplateSave, handleTemplateLoad, templateReport, setTemplateReport,
        handleVisibilityAll, handleTypeAll,
        handlePartTypeChange, handlePartDefaultFrameChange,
        handlePartBlendModeChange, partBlendModes, handleLayerMetaChange,
        handlePartDefaultVisibleChange, handlePartExportChange,
        handlePreviewFrame, handlePreviewNone, handlePreviewToggle, handlePreviewReset,
        handleAnimationToggle, handleAnimationChange, handleAnimationAddFrame,
        handleAnimationRemoveFrame, handleAnimationDurationChange, handleAnimationSet, handleLayerOffset,
        handleGroupSelected, handleRenamePart,
        setSelectedPartId, setSelectedLayer, setLayerMeta,
        exportProgress, history, toast, setToast,
    } = useEmgPacker();

    const visibility = useMemo(
        () => Object.fromEntries(Object.values(layerMeta).map(m => [m.id, m.visible])),
        [layerMeta]
    );

    // layerMeta はグループにも作られるので、そのまま数えると
    // グループを 1 つ足しただけで「レイヤーが増えた」ように見える。
    // parts[] は canvas を持つ葉レイヤーだけを持っているので、そちらから数える。
    const exportableCount = useMemo(
        () => parts.reduce((n, p) => n + p.exportedCount, 0),
        [parts]
    );

    // mapping.json が blink/lipSync として掌握するパーツ（emg-json-spec.md 7.3）。
    // そのパーツの sprites[] は自律発火できないので、UI 側でもその旨を示す。
    // 判定は書き出し時と同じ関数を使う（食い違うと UI の表示が嘘になる）。
    const mappingControlled = useMemo(
        () => emgData ? findMappingControlledParts(emgData.parts) : new Set<string>(),
        [emgData]
    );

    /**
     * プレビューに渡すトランスフォーム。
     *
     * **単体再生のときは、そのパーツ以外を時刻 0 に固定します。** 全部が同時に
     * 動くと、今どのパーツの動きを見ているのか分からなくなるためです。
     * 止まっているときは選択中のパーツだけがスクラブに追従します（他は静止）。
     *
     * 時刻 0 に固定するのは `duration` を 0 にすることで行います。`foldTime` が
     * `duration <= 0` を 0 として扱うので、トラックは先頭の値に落ち着きます。
     */
    const scopedTransforms = useMemo(() => {
        if (playScope === 'all') return partTransforms;
        const out: typeof partTransforms = {};
        for (const [key, tf] of Object.entries(partTransforms)) {
            // 再生中はその対象だけ。止まっているときは、選択中パーツに属する対象
            // （パーツ全体でも中のフレームでも）がスクラブに追従する。
            const live = playScope
                ? key === playScope
                : parseTransformKey(key).partId === selectedPartId;
            out[key] = live ? tf : { ...tf, duration: 0 };
        }
        return out;
    }, [partTransforms, playScope, selectedPartId]);

    // スプライトシートは格子の指定が要るので、読み込んだ後に確認画面を挟む。
    const [sheetFile, setSheetFile] = useState<File | null>(null);

    // 新規作成 / キャンバスサイズ変更。同じ画面を使い分ける。
    const [sizeDialog, setSizeDialog] = useState<'new' | 'resize' | null>(null);

    // プレビューの書き出し（GIF / 動画）。
    const [previewExportOpen, setPreviewExportOpen] = useState(false);
    const [previewBusy, setPreviewBusy] = useState<{ phase: string; ratio: number } | null>(null);
    // 保存ダイアログを出せない環境で、押されるまで持っておく出来上がり。
    const [previewResult, setPreviewResult] = useState<{ blob: Blob; name: string } | null>(null);

    /**
     * プレビューをアニメーションとして書き出す。
     *
     * 描画は `composite.ts` を通すので、画面で見たものと同じ規則で出ます。
     * トランスフォームは範囲を絞る前の `partTransforms` を使う — 書き出しでは
     * 全部が動いてほしいため（単体再生の絞り込みは画面上の都合）。
     */
    const runPreviewExport = async (o: {
        format: 'gif' | 'webm'; duration: number; fps: number;
        scale: number; background: 'transparent' | string; name: string;
    }) => {
        if (!psdRoot) return;
        // **保存先は押された瞬間に押さえる。** 書き出しに数秒かかるので、
        // 終わってから保存しようとすると「操作から続いていない」と見なされて
        // ブロックされ、押しても何も起きないことがある。
        let target;
        try {
            target = await prepareSave(
                `${o.name}.${extensionOf(o.format)}`,
                o.format === 'gif' ? 'image/gif' : 'video/webm',
                [`.${extensionOf(o.format)}`]);
        } catch {
            return;   // 利用者が保存先の選択をやめた
        }
        setPreviewBusy({ phase: '準備しています', ratio: 0 });
        setPreviewResult(null);
        try {
            const blob = await exportPreview({
                ...o,
                width: psdRoot.width ?? 0,
                height: psdRoot.height ?? 0,
                frameAt: t => composeAt(t),
                draw: (ctx, items, t, base) => drawComposite(ctx, items, partTransforms, computeBounds(items), t, base),
                onProgress: (phase, ratio) => setPreviewBusy({ phase, ratio }),
            });
            if (target.kind === 'picker') {
                const saved = await target.write(blob);
                setPreviewExportOpen(false);
                setToast({
                    title: 'プレビューを書き出しました',
                    body: `${saved} — ${o.duration}s / ${o.fps}fps / ${Math.round(blob.size / 1024)} KB`,
                });
            } else {
                // 自動で落とすとブラウザに捨てられることがあるので、押してもらう。
                setPreviewResult({ blob, name: target.name });
            }
        } catch (e) {
            console.error(e);
            setToast({ title: '書き出せませんでした', body: String(e instanceof Error ? e.message : e), tone: 'error' });
        } finally {
            setPreviewBusy(null);
        }
    };

    /**
     * 今の中身が占めている範囲（キャンバス座標）。
     * 寸法を縮めたときに何がはみ出すかを、決める前に見せるために要る。
     */
    const contentBounds = useMemo(() => {
        if (compositionItems.length === 0) return null;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const it of compositionItems) {
            left = Math.min(left, it.left);
            top = Math.min(top, it.top);
            right = Math.max(right, it.left + it.image.width);
            bottom = Math.max(bottom, it.top + it.image.height);
        }
        return { left, top, right, bottom };
    }, [compositionItems]);

    /**
     * 複数ファイルは 1 つずつ順に取り込む。まとめて並行に走らせると、
     * 合流処理が同じ木を同時に書き換えて取りこぼす。
     */
    const addFiles = async (files: File[]) => {
        // 連番の判定にはファイルの並び全体が要るので、まとめて渡す。
        await handleSourcesAdd(files);
    };

    /**
     * 9 スライスの仕上がり寸法を掴む枠。
     *
     * 枠は**元画像の矩形**に出し、仕上がり寸法を倍率として渡します。`TransformOverlay`
     * は倍率で拡縮するので、そのまま px に戻せば `slice` に書けます。軸は左上に置き、
     * 掴んだ辺だけが伸びる（＝ふつうのリサイズ）ようにします。
     */
    const sliceLayerMeta = selectedLayer?.id !== undefined ? layerMeta[selectedLayer.id] : undefined;
    const sliceSrc = selectedLayer?.canvas;

    /**
     * いまの木にある選択レイヤー。
     *
     * `selectedLayer` は**選んだ時点のスナップショット**で、木を作り直しても
     * 差し替わりません。位置をそこから読むと、動かした直後に枠だけ元の場所へ
     * 取り残されます（左のハンドルを引くと右側が動いて見えたのはこれ）。
     */
    const liveSelectedLayer = useMemo(() => {
        if (selectedLayer?.id === undefined) return null;
        return flattenLayers(psdRoot).find(l => l.id === selectedLayer.id) ?? null;
    }, [psdRoot, selectedLayer]);
    const sliceBox = useMemo(() => {
        const s = sliceLayerMeta?.slice;
        if (!s || !sliceSrc || !liveSelectedLayer) return null;
        const left = liveSelectedLayer.left ?? 0;
        const top = liveSelectedLayer.top ?? 0;
        return {
            bounds: {
                partId: sliceLayerMeta!.partId,
                left, top,
                right: left + sliceSrc.width,
                bottom: top + sliceSrc.height,
            },
            transform: {
                ...emptyTransform(),
                base: {
                    ...emptyTransform().base,
                    scale_x: s.width / Math.max(1, sliceSrc.width),
                    scale_y: s.height / Math.max(1, sliceSrc.height),
                },
                anchor: { x: left, y: top },
            },
            rect: { left, top, width: s.width, height: s.height },
            source: { width: sliceSrc.width, height: sliceSrc.height },
            slice: s,
        };
    }, [sliceLayerMeta, sliceSrc, liveSelectedLayer]);

    /** ガイド線から来る余白の変更。数値欄と同じ経路（`LayerMeta.slice`）へ書く。 */
    const onSliceChange = (patch: Partial<LayerSlice>) => {
        const s = sliceLayerMeta?.slice;
        if (!s || selectedLayer?.id === undefined) return;
        setLayerMeta(prev => ({
            ...prev,
            [selectedLayer.id!]: { ...prev[selectedLayer.id!], slice: { ...s, ...patch } },
        }));
    };

    /** 仕上がり寸法の枠で、いま掴んでいるハンドル。 */
    const sliceHandle = useRef<string | null>(null);

    const onSliceBoxChange = (patch: Partial<PartTransform>) => {
        const s = sliceLayerMeta?.slice;
        if (!s || !sliceSrc || !patch.base || selectedLayer?.id === undefined) return;
        const width = Math.max(1, Math.round(patch.base.scale_x * sliceSrc.width));
        const height = Math.max(1, Math.round(patch.base.scale_y * sliceSrc.height));

        // **左・上を掴んだときは、反対側を固定する。** 仕上がりはレイヤーの左上から
        // 描かれるので、寸法だけ変えると掴んでいない側（右・下）が動いてしまう。
        // 縮んだ分だけ左上を送り返して、掴んだ辺のほうが動くようにする。
        const h = sliceHandle.current ?? '';
        const dx = h.includes('w') ? s.width - width : 0;
        const dy = h.includes('n') ? s.height - height : 0;
        if (dx !== 0 || dy !== 0) handleLayerOffset(selectedLayer.id, dx, dy);

        setLayerMeta(prev => ({
            ...prev,
            [selectedLayer.id!]: {
                ...prev[selectedLayer.id!],
                slice: { ...s, width, height },
            },
        }));
    };

    const unassigned = useMemo(() => countUnassigned(mapping), [mapping]);

    /**
     * Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y も受ける）。
     *
     * 文字を打っている最中は横取りしない。パーツ名や表情名の入力欄で
     * Ctrl+Z を押したとき、期待されるのは入力欄自身の取り消しなので。
     */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const el = e.target as HTMLElement | null;
            if (el && (el.isContentEditable
                || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;

            const k = e.key.toLowerCase();
            if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
            else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); history.redo(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [history]);

    const openFilePicker = () => document.getElementById('psd-upload-input')?.click();
    const openAddPicker = () => document.getElementById('source-add-input')?.click();
    const openSheetPicker = () => document.getElementById('sheet-add-input')?.click();

    return (
        <>
            {/* 開く: 今の内容を捨てて読み直す */}
            <input
                type="file"
                accept={SourceLoader.ACCEPT}
                style={{ display: 'none' }}
                id="psd-upload-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePsdLoad(file);
                    e.target.value = '';
                }}
            />
            {/* 追加: 今の内容に合流させる。複数選択すると順に取り込む */}
            <input
                type="file"
                accept={SourceLoader.ACCEPT}
                multiple
                style={{ display: 'none' }}
                id="source-add-input"
                onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    void addFiles(files);
                }}
            />
            {/* スプライトシート: 画像なので拡張子からは判別できない。専用の入口にする */}
            <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                id="sheet-add-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) setSheetFile(file);
                }}
            />
            {/* 「新規」から既存の .emg を開くための入口。`.emg` に絞る */}
            <input
                type="file"
                accept=".emg"
                style={{ display: 'none' }}
                id="emg-open-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) handlePsdLoad(file);
                }}
            />
            <MainLayout
                hasFile={!!psdRoot}
                leftPanel={
                    <div className="left-stack">
                    {/* 素材の一覧はツリーの上。ツリーは合流後の形しか見せないので、
                        「何を読み込んだか」はここでしか分からない。 */}
                    <SourcesPanel
                        sources={sources}
                        exportedByLayer={visibility}
                        onRemove={handleSourceRemove}
                        onTransform={handleSourceTransform}
                        onTransformReset={handleSourceTransformReset}
                        selectedId={selectedSourceId}
                        onSelect={handleSelectSource}
                    />
                    <GroupsPanel
                        groups={transformGroups}
                        partIds={parts.map(p => p.partId)}
                        selectedPartId={selectedPartId}
                        onCreate={handleGroupCreate}
                        onToggleMember={handleGroupToggleMember}
                        onRename={handleGroupRename}
                        onDelete={handleGroupDelete}
                        onSelectPart={setSelectedPartId}
                    />
                    <LayerTree
                        psd={psdRoot}
                        visibility={visibility}
                        layerMeta={layerMeta}
                        selectedLayer={selectedLayer}
                        onSelectionChange={setSelectedLayer}
                        onLayerVisibilityChange={handleLayerVisibilityChange}
                        onPsdUpdate={handlePsdUpdate}
                        onVisibilityAll={handleVisibilityAll}
                        onLoadPsd={openFilePicker}
                        onAddSource={openAddPicker}
                        onAddSheet={openSheetPicker}
                        onGroupSelected={handleGroupSelected}
                        onNewProject={() => setSizeDialog('new')}
                    />
                    </div>
                }
                bottomPanel={(() => {
                    const part = parts.find(p => p.partId === selectedPartId);
                    if (!part) {
                        return (
                            <div className="empty-state" style={{ fontSize: '12px' }}>
                                パーツを選ぶと、動き（§7 のトランスフォーム）をここで編集できます。
                            </div>
                        );
                    }
                    // ヌルに属していれば、それは「メンバーが 1 つの動きを共有している」状態。
                    // フレーム単位（§7.4.1）はパーツの内側の話で、メンバーへ配れないため
                    // 対象の選択は出さず、パーツ全体に固定する。
                    const group = groupOfPart(part.partId);
                    const target = group ? undefined : transformTarget[part.partId];
                    const key = transformKey(part.partId, target);
                    // **再生範囲の外なら時刻を進めない。** 単体再生中に別のパーツを選ぶと、
                    // 絵は止まっているのに数値とプレイヘッドだけ動く、という食い違いになる
                    // （プレビューは範囲外を 0 に固定しているので、こちらも合わせる）。
                    const live = !playScope || playScope === 'all' || playScope === key;
                    return (
                        <TransformTimeline
                            partId={part.partId}
                            label={group ? `${group.name}（${group.partIds.length} パーツ）` : undefined}
                            frames={group ? [] : part.frames.map(f => f.frameId)}
                            target={target}
                            onTargetChange={f => setTransformTarget(prev => ({ ...prev, [part.partId]: f }))}
                            hasTransform={f => !!partTransforms[transformKey(part.partId, f)]}
                            transform={partTransforms[key] ?? emptyTransform()}
                            time={live ? transformTime : 0}
                            frozen={!live}
                            playing={playScope === key || playScope === 'all'}
                            onChange={patch => handleTransformChange(key, patch)}
                            // 止まって見えるタイムラインを掴んだら、掴んだ方を見たいはずなので
                            // 再生を止めてから送る。
                            onSeek={t => { if (!live) handleTransformReset(); setTransformTime(t); }}
                            onPlayToggle={() => handlePlayToggle(key)}
                            onReset={handleTransformReset}
                        />
                    );
                })()}
                centerPanel={
                    <PreviewPanel
                        atlasUrls={atlasUrls}
                        compositionItems={compositionItems}
                        width={psdRoot?.width || 0}
                        height={psdRoot?.height || 0}
                        transforms={scopedTransforms}
                        selectedPartId={selectedPartId}
                        transformTarget={transformTarget}
                        // キャンバスでパーツを掴んだら素材の選択は解く。
                        // 枠が 2 つ出ていると、掴んだものがどちらに効くのか分からない。
                        onSelectPart={(id) => { handleSelectSource(null); setSelectedPartId(id); }}
                        sourceBox={selectedSource ? {
                            bounds: selectedSource.bounds,
                            transform: toPartTransform(selectedSource.entry.transform, selectedSource.pivot),
                            label: selectedSource.entry.name,
                        } : null}
                        onSourceBoxChange={handleSourceBoxChange}
                        sliceBox={sliceBox}
                        onSliceBoxChange={onSliceBoxChange}
                        onSliceChange={onSliceChange}
                        onSliceHandle={h => { sliceHandle.current = h; }}
                        groupBounds={selectedPartId
                            ? (groupBoundsById[groupOfPart(selectedPartId)?.id ?? ''] ?? null)
                            : null}
                        onTransformChange={handleTransformChange}
                        time={transformTime}
                        playing={!!playScope}
                        onPlayAll={() => handlePlayToggle('all')}
                        onRewind={handleTransformReset}
                        playingAll={playScope === 'all'}
                        canPlay={anyPlayable}
                        onResizeCanvas={() => setSizeDialog('resize')}
                        onExportPreview={() => setPreviewExportOpen(true)}
                    />
                }
                rightPanel={
                    <InspectorPanel
                        hasFile={!!psdRoot}
                        exportableCount={exportableCount}
                        exportProgress={exportProgress}
                        mapping={mapping}
                        onMappingChange={patch => setMapping(prev => ({ ...prev, ...patch }))}
                        unassigned={unassigned}
                        presets={presets}
                        previewDelta={previewDelta}
                        onPresetSave={handlePresetSave}
                        onPresetApply={handlePresetApply}
                        onPresetUpdate={handlePresetUpdate}
                        onPresetRename={handlePresetRename}
                        onPresetDelete={handlePresetDelete}
                        expressions={expressions}
                        onExpressionAdd={handleExpressionAdd}
                        onExpressionChange={handleExpressionChange}
                        onExpressionRename={handleExpressionRename}
                        onExpressionDelete={handleExpressionDelete}
                        parts={parts}
                        selectedPartId={selectedPartId}
                        previewFrame={previewFrame}
                        previewOff={previewOff}
                        onSelectPart={setSelectedPartId}
                        onTypeChange={handlePartTypeChange}
                        onExportChange={handlePartExportChange}
                        onDefaultFrameChange={handlePartDefaultFrameChange}
                        onDefaultVisibleChange={handlePartDefaultVisibleChange}
                        onPreviewFrame={handlePreviewFrame}
                        onPreviewNone={handlePreviewNone}
                        onPreviewToggle={handlePreviewToggle}
                        onPreviewReset={handlePreviewReset}
                        onRenamePart={handleRenamePart}
                        onTypeAll={handleTypeAll}
                        partAnimations={partAnimations}
                        partTransforms={partTransforms}
                        transformTime={transformTime}
                        playScope={playScope}
                        onTransformChange={handleTransformChange}
                        onPlayToggle={handlePlayToggle}
                        onTransformReset={handleTransformReset}
                        onSeek={setTransformTime}
                        anyPlayable={anyPlayable}
                        partPlayable={partPlayable}
                        transformTarget={transformTarget}
                        onTransformTargetChange={(partId, frame) =>
                            setTransformTarget(prev => ({ ...prev, [partId]: frame }))}
                        mappingControlled={mappingControlled}
                        onAnimationToggle={handleAnimationToggle}
                        onAnimationChange={handleAnimationChange}
                        onAnimationSet={handleAnimationSet}
                        onDuplicatePart={handlePartDuplicate}
                        partBlendModes={partBlendModes}
                        onPartBlendModeChange={handlePartBlendModeChange}
                        zOrder={zOrder}
                        onReorderZ={handleReorderZ}
                        onResetZ={handleResetZ}
                        onSelectLayerById={(id) => {
                            const l = flattenLayers(psdRoot).find(x => x.id === id);
                            if (l) setSelectedLayer(l);
                        }}
                        layerSize={selectedLayer?.canvas
                            ? { width: selectedLayer.canvas.width, height: selectedLayer.canvas.height }
                            : null}
                        onAnimationAddFrame={handleAnimationAddFrame}
                        onAnimationRemoveFrame={handleAnimationRemoveFrame}
                        onAnimationDurationChange={handleAnimationDurationChange}
                        layerName={selectedLayer?.name}
                        layerId={selectedLayer?.id ?? null}
                        meta={selectedLayer?.id !== undefined ? layerMeta[selectedLayer.id] : undefined}
                        onMetaChange={(newMeta) => {
                            if (selectedLayer?.id === undefined) return;
                            handleLayerMetaChange(selectedLayer.id, newMeta);
                        }}
                        partType={parts.find(p => p.partId === sliceLayerMeta?.partId)?.type}
                        emgData={emgData}
                        onExport={handleExport}
                        includeAnimation={includeAnimation}
                        onIncludeAnimationChange={setIncludeAnimation}
                        animationCount={
                            Object.values(partAnimations).filter(a => a.enabled && a.frames.length > 1).length
                            + Object.keys(partTransforms).length
                        }
                        pendingExport={pendingExport && { name: pendingExport.name, size: pendingExport.blob.size }}
                        onSavePending={handleSavePending}
                        projectName={projectName}
                        onProjectNameChange={setProjectName}
                        onSaveProject={handleSaveProject}
                        onLoadProject={handleLoadProject}
                        onTemplateSave={handleTemplateSave}
                        onTemplateLoad={handleTemplateLoad}
                    />
                }
                onLoadPsd={openFilePicker}
                onNewProject={() => setSizeDialog('new')}
                onUndo={history.undo}
                onRedo={history.redo}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
            />
            {sheetFile && (
                <SpriteSheetDialog
                    file={sheetFile}
                    onCancel={() => setSheetFile(null)}
                    onImport={(source, grid, fps) => {
                        const name = sheetFile.name.replace(/\.[^.]+$/, '') || 'sheet';
                        handleSheetImport(name, SpriteSheetLoader.slice(source, grid, fps, name));
                        setSheetFile(null);
                    }}
                />
            )}
            {pendingEmgDrop && (
                <EmgDropDialog fileName={pendingEmgDrop.name} onChoose={resolveEmgDrop} />
            )}
            {previewExportOpen && psdRoot && (
                <PreviewExportDialog
                    contentDuration={contentDuration}
                    canvas={{ width: psdRoot.width ?? 0, height: psdRoot.height ?? 0 }}
                    defaultName={projectName}
                    busy={previewBusy}
                    result={previewResult && { name: previewResult.name, size: previewResult.blob.size }}
                    onSaveResult={() => {
                        if (!previewResult) return;
                        const saved = downloadBlob(previewResult.blob, previewResult.name);
                        setPreviewResult(null);
                        setPreviewExportOpen(false);
                        setToast({ title: '保存しました', body: `ダウンロードフォルダに ${saved}` });
                    }}
                    onCancel={() => { setPreviewResult(null); setPreviewExportOpen(false); }}
                    onExport={runPreviewExport}
                />
            )}
            {sizeDialog && (
                <CanvasSizeDialog
                    current={sizeDialog === 'resize' && psdRoot
                        ? { width: psdRoot.width ?? 0, height: psdRoot.height ?? 0 } : undefined}
                    contentBounds={sizeDialog === 'resize' ? contentBounds : null}
                    onCancel={() => setSizeDialog(null)}
                    onOpenEmg={sizeDialog === 'new'
                        ? () => { setSizeDialog(null); document.getElementById('emg-open-input')?.click(); }
                        : undefined}
                    onApply={(w, h, align) => {
                        if (sizeDialog === 'new') handleNewProject(w, h);
                        else handleCanvasResize(w, h, align);
                        setSizeDialog(null);
                    }}
                />
            )}
            {templateReport && (
                <TemplateReportDialog report={templateReport} onClose={() => setTemplateReport(null)} />
            )}
            <FileDropOverlay onFiles={files => void addFiles(files)} />
            <Toast message={toast} onClose={() => setToast(null)} />
        </>
    );
}

export default App;
