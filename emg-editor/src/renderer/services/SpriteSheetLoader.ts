import type { Layer } from 'ag-psd';
import { trimTransparent } from './trim';

/**
 * スプライトシート（格子状に並んだコマ）を 1 枚の画像から切り出す。
 *
 * GIF と違い、シートには**コマの区切りも時間も入っていない**。格子の指定と
 * フレームレートは利用者から受け取るしかないため、取り込み前に確認する画面が要る
 * （SpriteSheetDialog）。Aseprite / TexturePacker の JSON 取り込みは、形式が
 * 乱立していて対応コストに見合わないため対象外。
 */
export interface SheetGrid {
    /** 格子の決め方。コマ数で決めるか、1 コマの寸法で決めるか。 */
    mode: 'count' | 'size';
    columns: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    /** 画像の外周の余白。 */
    margin: number;
    /** コマとコマの間隔。 */
    spacing: number;
    /** 中身が全部透明なコマを捨てるか（最終行が半端なシートでよくある）。 */
    skipEmpty: boolean;
}

export const DEFAULT_GRID: SheetGrid = {
    mode: 'count',
    columns: 4,
    rows: 4,
    cellWidth: 64,
    cellHeight: 64,
    margin: 0,
    spacing: 0,
    skipEmpty: true,
};

/** 指定から実際の格子（列数・行数・1 コマの寸法）を求める。 */
export function resolveGrid(
    imageWidth: number, imageHeight: number, grid: SheetGrid
): { columns: number; rows: number; cellWidth: number; cellHeight: number } {
    const usableW = imageWidth - grid.margin * 2;
    const usableH = imageHeight - grid.margin * 2;

    if (grid.mode === 'count') {
        const columns = Math.max(1, Math.floor(grid.columns));
        const rows = Math.max(1, Math.floor(grid.rows));
        return {
            columns,
            rows,
            cellWidth: Math.max(1, Math.floor((usableW - grid.spacing * (columns - 1)) / columns)),
            cellHeight: Math.max(1, Math.floor((usableH - grid.spacing * (rows - 1)) / rows)),
        };
    }

    const cellWidth = Math.max(1, Math.floor(grid.cellWidth));
    const cellHeight = Math.max(1, Math.floor(grid.cellHeight));
    return {
        columns: Math.max(1, Math.floor((usableW + grid.spacing) / (cellWidth + grid.spacing))),
        rows: Math.max(1, Math.floor((usableH + grid.spacing) / (cellHeight + grid.spacing))),
        cellWidth,
        cellHeight,
    };
}

/** コマ i（左上から行優先）の切り出し矩形。 */
export function cellRect(
    index: number, resolved: { columns: number; cellWidth: number; cellHeight: number }, grid: SheetGrid
): { x: number; y: number; width: number; height: number } {
    const col = index % resolved.columns;
    const row = Math.floor(index / resolved.columns);
    return {
        x: grid.margin + col * (resolved.cellWidth + grid.spacing),
        y: grid.margin + row * (resolved.cellHeight + grid.spacing),
        width: resolved.cellWidth,
        height: resolved.cellHeight,
    };
}

export interface SlicedSheet {
    width: number;
    height: number;
    children: Layer[];
    frameDurations: number[];
}

export class SpriteSheetLoader {
    /**
     * 切り出す。フレームは行優先（左→右、上→下）の順に並ぶ。
     *
     * `fps` はシートに情報が無いため利用者の入力。全コマ同じ長さになる。
     */
    static slice(
        source: HTMLCanvasElement, grid: SheetGrid, fps: number, baseName: string
    ): SlicedSheet {
        const resolved = resolveGrid(source.width, source.height, grid);
        const total = resolved.columns * resolved.rows;
        const duration = 1 / Math.max(1, fps);

        const children: Layer[] = [];
        const frameDurations: number[] = [];

        for (let i = 0; i < total; i++) {
            const rect = cellRect(i, resolved, grid);
            // 画像の外にはみ出すコマは切り出せない（格子の指定が画像より大きい場合）。
            if (rect.x + rect.width > source.width || rect.y + rect.height > source.height) continue;

            const cell = document.createElement('canvas');
            cell.width = rect.width;
            cell.height = rect.height;
            const ctx = cell.getContext('2d');
            if (!ctx) throw new Error('Failed to get 2D context');
            ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

            // コマは格子いっぱいで来るので、切り詰めないとアトラスを無駄に食う。
            const trimmed = trimTransparent(cell);
            if (!trimmed) {
                if (grid.skipEmpty) continue;
                const empty = document.createElement('canvas');
                empty.width = 1;
                empty.height = 1;
                children.push(makeLayer(`${baseName}_${pad(children.length)}`, empty, 0, 0, children.length > 0));
                frameDurations.push(duration);
                continue;
            }

            children.push(makeLayer(
                `${baseName}_${pad(children.length)}`,
                trimmed.canvas,
                trimmed.dx,
                trimmed.dy,
                children.length > 0
            ));
            frameDurations.push(duration);
        }

        // コマは元のセル内での位置を保つ。1 コマ分の枠をキャンバスとして扱うことで、
        // 取り込み側の中央寄せがコマ単位で効く。
        return {
            width: resolved.cellWidth,
            height: resolved.cellHeight,
            children,
            frameDurations,
        };
    }
}

/**
 * 2 枚目以降を hidden にするのは、取り込み後の型推定が
 * 「非表示が可視と同数以上なら差分群」で判定するため。
 * シートのコマは排他表示なので switch でなければならない。
 */
function makeLayer(
    name: string, canvas: HTMLCanvasElement, left: number, top: number, hidden: boolean
): Layer {
    return {
        name,
        canvas,
        left,
        top,
        right: left + canvas.width,
        bottom: top + canvas.height,
        hidden,
        opacity: 1,
        blendMode: 'normal',
    };
}

function pad(i: number): string {
    return String(i).padStart(2, '0');
}
