import { useState, useEffect, useMemo } from 'react';
import { PsdLoader, FileLoader, PsdLayer } from '../services/PsdLoader';
import { Psd } from 'ag-psd';
import { TexturePacker, PackItem, PackResult } from '../services/TexturePacker';
import { EmgGenerator, ExportItem, EmgData } from '../services/EmgGenerator';
import { PreviewItem } from '../components/PreviewPanel';
import { defaultPartAnimation, type LayerMeta, type PartAnimation } from '../types';
import type { ToastMessage } from '../components/Toast';
import { buildParts, flattenLayers, frameIdOf, type PartInfo } from '../parts';

// ag-psd returns opacity as 0-255; normalize to 0.0-1.0
const normalizeOpacity = (v?: number): number => {
    if (typeof v !== 'number') return 1.0;
    return v > 1 ? v / 255 : v;
};

const recalculateMeta = (root: Psd, currentMeta: Record<number, LayerMeta>): Record<number, LayerMeta> => {
    const newMeta = { ...currentMeta };

    // 「@」始まりのグループは *フレーム* グループとして扱う（v0.5.0 §2 の frameName）。
    // 通常のグループはこれまでどおりパーツ（深い階層が partID を上書きする）。
    //
    // 目印を必要とするのは、この traverse がもともと「どのグループ階層も partID を
    // 上書きする」規則で動いており、階層の深さだけでは frameName と区別できないため。
    // 接頭辞を opt-in にすることで既存の PSD の解釈は一切変わらない。
    //
    //   衣装        （グループ）→ partID = 衣装
    //     @制服     （グループ）→ frameName = 制服（partID は 衣装 のまま）
    //       上着
    //       スカート
    const FRAME_GROUP_PREFIX = '@';

    /**
     * グループが差分パーツ（switch）か、重ねて使うパーツ（static）かを推定する。
     *
     * 以前は「グループなら常に switch」だった。`Body`（体・首・脚・スカート…を重ねて
     * 1 つの体にするグループ）まで差分扱いになるため、書き出した .emg では体の
     * 10 枚のうち 1 枚しか描かれない。プレビューが全レイヤーを重ねて描いていたので
     * 画面上は正常に見えていたが、出力は最初から壊れていた。
     *
     * 判定は PSD の慣習に従う。差分グループは「1 つだけ表示して残りは非表示」に
     * してあるので、非表示が可視と同数以上あれば差分群とみなす。逆に全部（または
     * ほとんど）が同時に見えているなら、それは重ねて使うパーツ。
     */
    const inferGroupType = (layer: PsdLayer): 'static' | 'switch' => {
        const leaves = (layer.children ?? []).filter(c => !c.children || c.children.length === 0);
        if (leaves.length === 0) return 'static';   // 直属のレイヤーが無いので実質どちらでもよい
        const hidden = leaves.filter(c => c.hidden).length;
        const visible = leaves.length - hidden;
        return hidden > 0 && hidden >= visible ? 'switch' : 'static';
    };

    const traverse = (
        layer: PsdLayer,
        defaultPartId: string,
        defaultType: 'static' | 'switch',
        defaultFrameName?: string
    ) => {
        const isGroup = layer.children && layer.children.length > 0;

        let currentPartId = defaultPartId;
        let currentType = defaultType;
        let currentFrameName = defaultFrameName;

        if (isGroup) {
            const name = layer.name || `Group_${layer.id}`;
            if (name.startsWith(FRAME_GROUP_PREFIX)) {
                currentFrameName = name.slice(FRAME_GROUP_PREFIX.length);
                currentType = 'switch';   // フレームを持つ以上、親は排他パーツ
            } else {
                currentPartId = name;
                currentType = inferGroupType(layer);
                currentFrameName = undefined;
            }
        }

        if (layer.id !== undefined) {
            if (!newMeta[layer.id]) {
                // PSD では差分（表情など）は 1 枚だけ表示され残りは非表示になっている。
                // それをそのまま「書き出さない」にすると switch パーツの差分が全部落ちて
                // 切り替えられなくなるため、switch は既定で全レイヤーを書き出し、
                // PSD で表示されていたものを isDefault（初期表示）とする。
                //
                // static は PSD の可視性を defaultVisible として持たせる。v0.5.0 §4 により
                // 「初期非表示のトグル」として書き出せるようになったため、
                // 非表示のアクセサリ類を捨てずに済む。
                const isSwitch = currentType === 'switch';
                newMeta[layer.id] = {
                    id: layer.id,
                    partId: currentPartId,
                    type: currentType,
                    frameName: currentFrameName,
                    visible: true,
                    isDefault: isSwitch ? !layer.hidden : undefined,
                    defaultVisible: isSwitch ? undefined : !layer.hidden,
                    opacity: normalizeOpacity(layer.opacity),
                    blendMode: layer.blendMode || 'normal'
                };
            } else {
                newMeta[layer.id].partId = currentPartId;
                newMeta[layer.id].frameName = currentFrameName;
            }
        }

        if (isGroup) {
            layer.children?.forEach(l => traverse(l, currentPartId, currentType, currentFrameName));
        }
    };

    root.children?.forEach(child => {
        const isGroup = child.children && child.children.length > 0;
        const pid = child.name || `Root_${child.id}`;
        const ptype = isGroup ? inferGroupType(child) : 'static';

        traverse(child, pid, ptype);
    });

    // static パーツの後処理。
    // 「全レイヤーが非表示」なら、パーツごと初期非表示のトグルとして書き出す（v0.5.0 §4）。
    // 「一部だけ非表示」なら、その隠れレイヤーは意図的に使っていないものとみなし、
    // 書き出しから外す（常時表示される static に混ぜると意図しない重なりになるため）。
    const staticByPart = new Map<string, LayerMeta[]>();
    for (const id in newMeta) {
        const m = newMeta[id];
        if (m.type !== 'static') continue;
        if (!staticByPart.has(m.partId)) staticByPart.set(m.partId, []);
        staticByPart.get(m.partId)!.push(m);
    }
    for (const metas of staticByPart.values()) {
        const allHidden = metas.every(m => m.defaultVisible === false);
        if (allHidden) continue;   // パーツごとトグルにするのでレイヤーは全部残す
        for (const m of metas) {
            if (m.defaultVisible === false) m.visible = false;
        }
    }

    return newMeta;
};

export function useEmgPacker() {
    const [psdRoot, setPsdRoot] = useState<Psd | null>(null);
    const [packedTextureUrl, setPackedTextureUrl] = useState<string | null>(null);
    const [selectedLayer, setSelectedLayer] = useState<PsdLayer | null>(null);
    const [layerMeta, setLayerMeta] = useState<Record<number, LayerMeta>>({});
    const [packResult, setPackResult] = useState<PackResult | null>(null);
    const [toast, setToast] = useState<ToastMessage | null>(null);

    // プレビュー専用の状態。書き出し結果には一切影響しない。
    //   previewFrame : switch パーツで今どの差分を見ているか（既定は part.default）
    //   previewOff   : プレビュー上で伏せているパーツ（顔の確認で髪を退かす等）
    const [previewFrame, setPreviewFrame] = useState<Record<string, string>>({});
    const [previewOff, setPreviewOff] = useState<Record<string, boolean>>({});
    const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

    // partID -> アニメーション設定。sprites[] の元になる（emg-json-spec.md 7 章）。
    // レイヤーではなくパーツ単位で持つのは、sprites[] が targetPartID を単位に
    // フレームを切り替える仕様だから。
    const [partAnimations, setPartAnimations] = useState<Record<string, PartAnimation>>({});

    const handlePsdLoad = async (file: File) => {
        try {
            const root = await FileLoader.load(file);
            const initialMeta = recalculateMeta(root, {});
            setLayerMeta(initialMeta);
            setPsdRoot(root);
        } catch (e) {
            console.error('Failed to load file:', e);
            alert(String(e instanceof Error ? e.message : e));
        }
    };

    const handlePsdUpdate = (newRoot: Psd) => {
        const newMeta = recalculateMeta(newRoot, layerMeta);
        setLayerMeta(newMeta);
        setPsdRoot(newRoot);
    };

    /** psdRoot + layerMeta から導出したパーツ一覧（parts.ts）。 */
    const parts = useMemo<PartInfo[]>(() => buildParts(psdRoot, layerMeta), [psdRoot, layerMeta]);

    const partById = useMemo(() => {
        const m = new Map<string, PartInfo>();
        for (const p of parts) m.set(p.partId, p);
        return m;
    }, [parts]);

    /**
     * プレビューの合成。**書き出される .emg と同じ規則で描く**。
     *
     * 以前は「visible なレイヤーを全部重ねる」だけだったため、switch パーツの差分が
     * 全部同時に描かれていた（目 6 枚が重なって潰れる）。実際の再生時とは似ても
     * 似つかない絵で、差分の確認ができなかった。
     *   - switch : プレビュー中のフレーム 1 つだけを描く（既定は part.default）
     *   - static : defaultVisible が false のパーツは初期状態で描かない（v0.5.0 §4）
     */
    const compositionItems = useMemo<PreviewItem[]>(() => {
        const items: PreviewItem[] = [];
        for (const layer of flattenLayers(psdRoot)) {
            const meta = layerMeta[layer.id!];
            if (!meta || !meta.visible) continue;

            const part = partById.get(meta.partId);
            if (!part) continue;

            // v0.5.0 §4: static は初期非表示トグル、switch は §4.3 の未選択。
            const off = previewOff[part.partId] ?? !part.defaultVisible;
            if (off) continue;

            if (part.type === 'switch') {
                const active = previewFrame[part.partId] ?? part.defaultFrameId;
                if (frameIdOf(layer, meta) !== active) continue;
            }

            items.push({
                id: layer.id!,
                image: layer.canvas!,
                left: layer.left || 0,
                top: layer.top || 0,
            });
        }
        return items;
    }, [psdRoot, layerMeta, partById, previewFrame, previewOff]);

    useEffect(() => {
        if (!psdRoot) return;

        const packItems: PackItem[] = [];

        const traverse = (layer: PsdLayer) => {
            if (layer.id === undefined) {
                layer.children?.forEach(traverse);
                return;
            }
            const meta = layerMeta[layer.id];
            if (layer.canvas && meta && meta.visible) {
                packItems.push({
                    id: layer.id.toString(),
                    width: layer.canvas.width,
                    height: layer.canvas.height,
                    image: layer.canvas
                });
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot);

        const runPack = async () => {
            if (packItems.length > 0) {
                try {
                    console.log(`Packing ${packItems.length} items...`);
                    const res = await TexturePacker.pack(packItems);
                    setPackResult(res);
                    // プレビューは 1 枚目のみ。分割された場合の 2 枚目以降は表示しない。
                    setPackedTextureUrl(res.atlases[0]?.canvas.toDataURL() ?? null);
                } catch (e) {
                    console.error("Packing failed", e);
                    setPackResult(null);
                    setPackedTextureUrl(null);
                }
            } else {
                setPackResult(null);
                setPackedTextureUrl(null);
            }
        };
        runPack();
    }, [psdRoot, layerMeta]);

    const handleVisibilityAll = (visible: boolean) => {
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id in next) {
                next[id] = { ...next[id], visible };
            }
            return next;
        });
    };

    const handleTypeAll = (type: 'static' | 'switch') => {
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id in next) {
                next[id] = { ...next[id], type };
            }
            return next;
        });
    };

    // ---- パーツ単位の操作 --------------------------------------------------
    // partID は複数レイヤーにまたがるため、1 枚ずつ直させると必ず取りこぼす
    // （目 6 枚のうち 1 枚だけ static、のような壊れた状態が作れてしまう）。
    // パーツを単位にすることで、その状態自体が表現できなくなる。

    /** パーツの type を切り替える。所属レイヤー全部に反映する。 */
    const handlePartTypeChange = (partId: string, type: 'static' | 'switch') => {
        const part = partById.get(partId);
        if (!part) return;

        // 全レイヤーが PSD で非表示だった static パーツは、捨てずにパーツごと
        // 「初期非表示のトグル」として書き出す（v0.5.0 §4）。recalculateMeta と同じ判定。
        const allHidden = part.layerIds.every(id => layerMeta[id]?.defaultVisible === false);

        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of part.layerIds) {
                const m = next[id];
                if (!m) continue;

                // switch → static のとき、defaultVisible はまだ無い（switch では
                // isDefault の方が意味を持つ側だったため）。ここで ?? true に倒すと
                // 差分 6 枚が全部「常時表示」になり、目が 6 枚重なった絵が書き出される。
                // 引き継ぐべきは「既定だったフレームだけが見える」という状態。
                const keepVisible = type !== 'static'
                    ? true
                    : allHidden || (m.type === 'switch' ? !!m.isDefault : (m.defaultVisible ?? true));

                next[id] = {
                    ...m,
                    type,
                    // switch では isDefault が、static では defaultVisible が意味を持つ。
                    // 切り替え時に反対側を消しておかないと、書き出しに前の型の
                    // 判断が残って混ざる。
                    isDefault: type === 'switch' ? m.isDefault : undefined,
                    defaultVisible: type === 'static' ? keepVisible : undefined,
                    visible: keepVisible,
                };
            }

            // static から switch に「変換した」ときだけ、既定が無い状態を避けるために
            // 先頭フレームを既定にする。すでに switch のパーツに対しては行わない。
            // v0.5.0 §4.3 の「初期状態はなし」を選んでいるパーツで Switch を
            // 押し直すたびに、その指定が消えてしまうため。
            const wasSwitch = part.type === 'switch';
            if (type === 'switch' && !wasSwitch && !part.layerIds.some(id => next[id]?.isDefault)) {
                const firstId = part.frames[0]?.layerIds ?? [];
                for (const id of firstId) {
                    if (next[id]) next[id] = { ...next[id], isDefault: true };
                }
            }
            return next;
        });
    };

    /**
     * switch パーツの既定フレーム（.emg の part.default）を決める。
     *
     * frameId に null を渡すと「初期状態でどれも表示しない」（v0.5.0 §4.3）。
     * チークや青ざめのように、差分を持ちながら常態は「無し」であるパーツ用。
     * isDefault が 1 つも立っていない状態がそれを表す。
     */
    const handlePartDefaultFrameChange = (partId: string, frameId: string | null) => {
        const part = partById.get(partId);
        if (!part) return;
        const layers = flattenLayers(psdRoot);
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of part.layerIds) {
                const m = next[id];
                if (!m) continue;
                const layer = layers.find(l => l.id === id);
                if (!layer) continue;
                next[id] = { ...m, isDefault: frameId !== null && frameIdOf(layer, m) === frameId };
            }
            return next;
        });
        // 「なし」を既定にしたらプレビューもその状態にする。
        if (frameId === null) setPreviewOff(prev => ({ ...prev, [partId]: true }));
    };

    /** パーツごと書き出しに含めるか。static の「初期非表示トグル」もこれで表す。 */
    const handlePartExportChange = (partId: string, include: boolean) => {
        const part = partById.get(partId);
        if (!part) return;
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of part.layerIds) {
                if (next[id]) next[id] = { ...next[id], visible: include };
            }
            return next;
        });
    };

    /** static パーツの初期表示（v0.5.0 §4）。false なら初期非表示のトグルとして書き出す。 */
    const handlePartDefaultVisibleChange = (partId: string, defaultVisible: boolean) => {
        const part = partById.get(partId);
        if (!part) return;
        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of part.layerIds) {
                if (next[id]) next[id] = { ...next[id], defaultVisible, visible: true };
            }
            return next;
        });
        setPreviewOff(prev => ({ ...prev, [partId]: !defaultVisible }));
    };

    // ---- プレビュー操作（書き出しには影響しない） --------------------------
    const handlePreviewFrame = (partId: string, frameId: string) => {
        setPreviewFrame(prev => ({ ...prev, [partId]: frameId }));
        setPreviewOff(prev => ({ ...prev, [partId]: false }));
    };

    // ---- アニメーション（emg-json-spec.md 7 章） ------------------------------

    /**
     * パーツにアニメーションを付ける / 外す。
     * 初期値は「そのパーツの全フレームを並び順どおり 12fps でループ」。
     */
    const handleAnimationToggle = (partId: string, enabled: boolean) => {
        const part = partById.get(partId);
        if (!part) return;
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (cur) return { ...prev, [partId]: { ...cur, enabled } };
            if (!enabled) return prev;
            return {
                ...prev,
                [partId]: defaultPartAnimation(partId, part.frames.map(f => f.frameId)),
            };
        });
    };

    const handleAnimationChange = (partId: string, patch: Partial<PartAnimation>) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            const next = { ...cur, ...patch };
            // frames と durations は同じ長さでなければならない（keys の組み立てで対応が崩れる）。
            if (patch.frames) {
                next.durations = patch.frames.map((_, i) => cur.durations[i] ?? 0.1);
            }
            return { ...prev, [partId]: next };
        });
    };

    /** 再生順の末尾にフレームを足す。同じフレームを何度でも置ける（まばたきの往復など）。 */
    const handleAnimationAddFrame = (partId: string, frameId: string) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            return {
                ...prev,
                [partId]: {
                    ...cur,
                    frames: [...cur.frames, frameId],
                    durations: [...cur.durations, cur.durations[cur.durations.length - 1] ?? 0.1],
                },
            };
        });
    };

    const handleAnimationRemoveFrame = (partId: string, index: number) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            return {
                ...prev,
                [partId]: {
                    ...cur,
                    frames: cur.frames.filter((_, i) => i !== index),
                    durations: cur.durations.filter((_, i) => i !== index),
                },
            };
        });
    };

    const handleAnimationDurationChange = (partId: string, index: number, seconds: number) => {
        setPartAnimations(prev => {
            const cur = prev[partId];
            if (!cur) return prev;
            const durations = [...cur.durations];
            durations[index] = seconds;
            return { ...prev, [partId]: { ...cur, durations } };
        });
    };

    /** v0.5.0 §4.3: プレビューを「どれも表示しない」にする。 */
    const handlePreviewNone = (partId: string) => {
        setPreviewOff(prev => ({ ...prev, [partId]: true }));
    };

    const handlePreviewToggle = (partId: string) => {
        const part = partById.get(partId);
        const current = previewOff[partId] ?? !(part?.defaultVisible ?? true);
        setPreviewOff(prev => ({ ...prev, [partId]: !current }));
    };

    const handlePreviewReset = () => {
        setPreviewFrame({});
        setPreviewOff({});
    };

    const handleLayerVisibilityChange = (layer: any, visible: boolean) => {
        const psdLayer = layer as PsdLayer;
        if (psdLayer.id === undefined) return;

        // Collect this layer and all its descendants
        const ids: number[] = [psdLayer.id];
        const collectDescendants = (l: PsdLayer) => {
            l.children?.forEach(child => {
                if (child.id !== undefined) ids.push(child.id);
                collectDescendants(child);
            });
        };
        collectDescendants(psdLayer);

        setLayerMeta(prev => {
            const next = { ...prev };
            for (const id of ids) {
                if (next[id]) next[id] = { ...next[id], visible };
            }
            return next;
        });
    };

    const emgData = useMemo((): EmgData | undefined => {
        if (!psdRoot) return undefined;

        // Return minimal structure while waiting for pack result (enables JSON tab immediately)
        if (!packResult) {
            return {
                version: '0.3.0',
                baseCanvasWidth: psdRoot.width || 0,
                baseCanvasHeight: psdRoot.height || 0,
                textures: [],
                parts: [],
                sprites: []
            };
        }

        const exportItems: ExportItem[] = [];
        const allExportableLayers: PsdLayer[] = [];

        const traverse = (layer: PsdLayer) => {
            if (layer.id !== undefined && layerMeta[layer.id]?.visible && layer.canvas) {
                allExportableLayers.push(layer);
            }
            layer.children?.forEach(traverse);
        };
        traverse(psdRoot as PsdLayer);

        const totalLayers = allExportableLayers.length;

        allExportableLayers.forEach((layer, index) => {
            const packed = packResult.items.find(p => p.id === layer.id!.toString());
            if (packed && layerMeta[layer.id!]) {
                exportItems.push({
                    packed: packed,
                    meta: layerMeta[layer.id!],
                    originalLayer: layer,
                    // ag-psd の children は「下から上」（index 0 = 最背面）。textureZIndex は
                    // 仕様上「大きいほど前面」なので、走査順をそのまま z にすればよい。
                    // 以前は totalLayers-1-index として最背面に最大値を与えており、
                    // 書き出した .emg の重なり順が全て前後逆になっていた。
                    zIndex: index
                });
            }
        });

        return EmgGenerator.createData(packResult, exportItems, psdRoot.width, psdRoot.height, partAnimations);
    }, [packResult, psdRoot, layerMeta, partAnimations]);

    const handleExport = async () => {
        if (!psdRoot) return;
        try {
            const packItems: PackItem[] = [];
            const allExportableLayers: PsdLayer[] = [];

            const traverse = (layer: PsdLayer) => {
                const meta = layerMeta[layer.id!];
                if (meta && meta.visible && layer.canvas && layer.id !== undefined) {
                    packItems.push({
                        id: layer.id.toString(),
                        width: layer.canvas.width,
                        height: layer.canvas.height,
                        image: layer.canvas
                    });
                    allExportableLayers.push(layer);
                }
                layer.children?.forEach(traverse);
            };
            traverse(psdRoot as PsdLayer);

            if (packItems.length === 0) {
                alert('No visible layers to export');
                return;
            }

            const result = await TexturePacker.pack(packItems);
            const exportItems: ExportItem[] = [];
            const totalLayers = allExportableLayers.length;

            console.log('--- Exporting Layers ---');
            allExportableLayers.forEach((layer, index) => {
                const packed = result.items.find(p => p.id === layer.id!.toString());
                const meta = layerMeta[layer.id!];
                if (packed && meta) {
                    // ag-psd の children は「下から上」（index 0 = 最背面）。
                    // textureZIndex は「大きいほど前面」なので走査順がそのまま z になる。
                    const zIndex = index;
                    console.log(`Layer: ${layer.name}, Index: ${index}, Z-Index: ${zIndex}`);
                    exportItems.push({
                        packed: packed,
                        meta: meta,
                        originalLayer: layer,
                        zIndex: zIndex
                    });
                }
            });

            if (!psdRoot.width || !psdRoot.height) {
                throw new Error("PSD dimensions missing");
            }

            const blob = await EmgGenerator.generate(
                result,
                exportItems,
                psdRoot.width,
                psdRoot.height,
                partAnimations
            );

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'model.emg';
            link.click();

            setToast({
                title: 'Export Complete',
                body: `model.emg (${exportItems.length} layers)`
            });
        } catch (e) {
            console.error('Export failed:', e);
            alert('Export failed: ' + e);
        }
    };

    /**
     * 選択中のレイヤー（またはグループ）を、その場で新しいグループに包む。
     *
     * グループ名がそのまま partID になるので、これは「このレイヤーを独立した
     * パーツにする」操作でもある。空グループをルート末尾に作ってから 1 枚ずつ
     * ドラッグする、という以前の手順を置き換える。
     */
    const handleGroupSelected = (): string | null => {
        if (!psdRoot || !selectedLayer || selectedLayer.id === undefined) return null;

        const targetId = selectedLayer.id;
        const groupId = Date.now();
        const groupName = 'New Part';
        let wrapped = false;

        const clone = (l: PsdLayer): PsdLayer => ({ ...l, children: l.children?.map(clone) });
        const rebuild = (layers: PsdLayer[]): PsdLayer[] => layers.map(l => {
            if (l.id === targetId) {
                wrapped = true;
                return { id: groupId, name: groupName, hidden: false, children: [l], canvas: undefined } as PsdLayer;
            }
            if (l.children) return { ...l, children: rebuild(l.children) };
            return l;
        });

        const newRoot: Psd = { ...psdRoot, children: rebuild((psdRoot.children ?? []).map(clone)) };
        if (!wrapped) return null;

        handlePsdUpdate(newRoot);
        return groupName;
    };

    /**
     * パーツ名（= PSD グループ名 = partID）を変更する。
     * recalculateMeta がグループ名から partID を引き直すので、名前を変えれば追従する。
     */
    const handleRenamePart = (partId: string, newName: string) => {
        if (!psdRoot || !newName.trim() || newName === partId) return;

        const rename = (layers: PsdLayer[]): PsdLayer[] => layers.map(l => {
            const next: PsdLayer = { ...l, children: l.children ? rename(l.children) : undefined };
            if (l.children && l.name === partId) next.name = newName;
            return next;
        });

        handlePsdUpdate({ ...psdRoot, children: rename(psdRoot.children ?? []) });

        // partID をキーにしているプレビュー状態も付け替える
        setPreviewFrame(prev => {
            if (!(partId in prev)) return prev;
            const { [partId]: v, ...rest } = prev;
            return { ...rest, [newName]: v };
        });
        setPreviewOff(prev => {
            if (!(partId in prev)) return prev;
            const { [partId]: v, ...rest } = prev;
            return { ...rest, [newName]: v };
        });
        setSelectedPartId(cur => (cur === partId ? newName : cur));
    };

    const handleSaveProject = () => {
        const projectData = {
            version: '1.0',
            layerMeta: layerMeta
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'project.json';
        link.click();
    };

    const handleLoadProject = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const data = JSON.parse(re.target?.result as string);
                    if (data.layerMeta) {
                        setLayerMeta(data.layerMeta);
                        alert('Project settings loaded.');
                    }
                } catch (err) {
                    console.error(err);
                    alert('Failed to load project file');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    return {
        psdRoot,
        packedTextureUrl,
        selectedLayer,
        layerMeta,
        compositionItems,
        packResult,
        emgData,
        parts,
        selectedPartId,
        previewFrame,
        previewOff,
        partAnimations,
        handlePsdLoad,
        handlePsdUpdate,
        handleLayerVisibilityChange,
        handleExport,
        handleSaveProject,
        handleLoadProject,
        handleVisibilityAll,
        handleTypeAll,
        handlePartTypeChange,
        handlePartDefaultFrameChange,
        handlePartExportChange,
        handlePartDefaultVisibleChange,
        handleAnimationToggle,
        handleAnimationChange,
        handleAnimationAddFrame,
        handleAnimationRemoveFrame,
        handleAnimationDurationChange,
        handlePreviewFrame,
        handlePreviewNone,
        handlePreviewToggle,
        handlePreviewReset,
        handleGroupSelected,
        handleRenamePart,
        setSelectedPartId,
        setSelectedLayer,
        setLayerMeta,
        toast,
        setToast,
    };
}
