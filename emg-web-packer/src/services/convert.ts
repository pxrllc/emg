import type { Psd } from 'ag-psd';
import { TexturePacker, type PackItem } from '@packer/TexturePacker';
import { EmgGenerator, type ExportItem } from '@packer/EmgGenerator';
import type { AnalyzedLayer, PartType } from './analyze';

/**
 * PSD を .emg（ZIP）に変換する。
 *
 * emg-packer の useEmgPacker.handleExport() の移植だが、React の状態と切り離して
 * 「入力（PSD + パーツ種別の指定）→ 出力（Blob）」の純粋関数にしてある。
 * パッキングと JSON 生成そのものは emg-packer のサービス層をそのまま使う（@packer/*）。
 */
export async function convertToEmg(
    psd: Psd,
    layers: AnalyzedLayer[],
    partTypes: Map<string, PartType>,
): Promise<Blob> {
    if (!psd.width || !psd.height) {
        throw new Error('PSD のキャンバスサイズを取得できませんでした。');
    }

    // PSD では差分レイヤー（表情など）は1枚だけ表示され残りは非表示になっているのが普通なので、
    // 「非表示なら書き出さない」としてしまうと switch パーツの差分が全部落ちて切り替えられなくなる。
    //   - switch（差分）パーツ … 非表示のものも含めて全レイヤーを書き出す
    //   - static（ベース）パーツ … 常時表示されるため、非表示のレイヤーは意図的に使っていないとみなし除外
    // PSD で表示されていたレイヤーは isDefault として渡し、switch パーツの初期表示にする。
    const exportable = layers.filter(l =>
        (partTypes.get(l.partId) ?? 'switch') === 'switch' ? true : l.visible
    );
    if (exportable.length === 0) {
        throw new Error('書き出せるレイヤーがありません。PSD にレイヤーが含まれているか確認してください。');
    }

    const packItems: PackItem[] = exportable.map(l => ({
        id: String(l.layer.id),
        width: l.layer.canvas!.width,
        height: l.layer.canvas!.height,
        image: l.layer.canvas!,
    }));

    // アトラス上限（既定 8192）に収まらない場合はここで例外が飛ぶ。
    // 黙って一部のレイヤーが欠けることはない。
    const packed = await TexturePacker.pack(packItems);

    // textureZIndex は「前面ほど大きい」。走査順は上から（＝index 0 が最前面）なので反転させる。
    // パッキングは高さ順にソートされ z 情報を保持しないため、ここで与える必要がある。
    const total = exportable.length;
    const exportItems: ExportItem[] = [];
    exportable.forEach((l, index) => {
        const item = packed.items.find(p => p.id === String(l.layer.id));
        if (!item) return;

        exportItems.push({
            packed: item,
            originalLayer: l.layer,
            zIndex: total - 1 - index,
            meta: {
                id: l.layer.id!,
                partId: l.partId,
                type: partTypes.get(l.partId) ?? 'switch',
                // PSD で表示されていたレイヤーを switch パーツの初期表示（part.default）にする。
                isDefault: l.visible,
                visible: true,
                opacity: l.opacity,
                blendMode: l.blendMode,
            },
        });
    });

    return EmgGenerator.generate(packed, exportItems, psd.width, psd.height);
}

/** 生成した .emg をブラウザにダウンロードさせる。 */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    // click() は同期的にダウンロードを開始するので、次のタスクで解放してよい。
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
