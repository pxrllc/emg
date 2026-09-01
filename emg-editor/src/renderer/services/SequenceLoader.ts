import type { LoadedSource } from './SourceLoader';
import { ImageLoader } from './ImageLoader';

/**
 * 連番の画像ファイル群を 1 つのアニメーション素材として読み込む。
 *
 * `frame_001.png` … `frame_120.png` のような書き出しを、GIF と同じ扱い
 * （`kind: 'animation'`）に落とします。1 枚ずつ取り込むと 120 個の別パーツに
 * なってしまい、再生順を手で組み直すことになるためです。
 */

/** 連番として認識した 1 組。 */
export interface SequenceGroup {
    /** 連番を除いた共通の名前。素材名になる。 */
    baseName: string;
    /** 番号の昇順に並べたファイル。 */
    files: File[];
}

/** 既定のコマ送り速度。GIF に倣って 12fps を初期値にする。 */
export const DEFAULT_SEQUENCE_FPS = 12;

/**
 * ファイル名の末尾の数字を切り出す。
 *
 * 末尾でなければ連番とみなしません（`v2_hair.png` の `2` は版番号であって
 * コマ番号ではないため）。区切り（`_` `-` 空白）は共通名から落とします。
 */
function splitNumbering(fileName: string): { base: string; index: number } | null {
    const stem = fileName.replace(/\.[^.]+$/, '');
    const m = stem.match(/^(.*?)[ _-]*(\d+)$/);
    if (!m) return null;
    return { base: m[1], index: Number(m[2]) };
}

/**
 * 画像ファイルの並びから、連番として扱える組を取り出す。
 *
 * **共通名が一致し、2 枚以上あるものだけ**を連番とみなします。`bg.png` `hat.png`
 * `face.png` のように無関係な画像をまとめて放り込んだときに、勝手に 1 本の
 * アニメーションへ変えてしまわないためです。
 *
 * 番号は**数値として**並べます。文字列順だと `img10` が `img2` より前に来ます。
 */
export function groupSequences(files: File[]): { groups: SequenceGroup[]; rest: File[] } {
    const buckets = new Map<string, { file: File; index: number }[]>();
    const rest: File[] = [];

    for (const f of files) {
        // GIF などの複数フレームを持つ形式は AnimationLoader の担当なので触らない。
        if (!ImageLoader.supports(f.name) || /\.gif$/i.test(f.name)) { rest.push(f); continue; }
        const parsed = splitNumbering(f.name);
        if (!parsed) { rest.push(f); continue; }
        const list = buckets.get(parsed.base) ?? [];
        list.push({ file: f, index: parsed.index });
        buckets.set(parsed.base, list);
    }

    const groups: SequenceGroup[] = [];
    for (const [base, list] of buckets) {
        if (list.length < 2) {
            rest.push(...list.map(x => x.file));
            continue;
        }
        list.sort((a, b) => a.index - b.index);
        groups.push({
            // 共通名が空（`01.png` `02.png` のような並び）なら、名前が無いと
            // パーツ名が作れないので当たり障りのないものを充てる。
            baseName: base || 'sequence',
            files: list.map(x => x.file),
        });
    }
    return { groups, rest };
}

/**
 * 連番の組を 1 つのアニメーション素材にする。
 *
 * 各ファイルが 1 コマです。キャンバスは全コマの最大寸法にそろえます
 * （コマごとに余白の落とし方が違っても、位置がずれないようにするため）。
 */
export async function loadSequence(
    group: SequenceGroup,
    fps: number = DEFAULT_SEQUENCE_FPS,
): Promise<LoadedSource> {
    const pad = (i: number) => String(i + 1).padStart(String(group.files.length).length, '0');
    const children = [];
    let width = 0;
    let height = 0;

    for (const [i, file] of group.files.entries()) {
        const img = await ImageLoader.load(file);
        width = Math.max(width, img.width);
        height = Math.max(height, img.height);
        for (const l of img.children) {
            // レイヤー名がフレーム識別子の元になる。元のファイル名は連番の桁数が
            // まちまちなことがあるので、ここで通し番号にそろえる。
            l.name = `${group.baseName || 'frame'}_${pad(i)}`;
            // **2 コマ目以降は非表示にする。** パーツの種別は「非表示が可視と同数以上なら
            // 差分群（switch）」という PSD の慣習から推定されるため、全コマを可視のまま
            // 渡すと `static` と判定され、12 コマが重なって表示されて `sprites[]` にも
            // 出ません（GIF を読む AnimationLoader も同じ理由で同じことをしています）。
            l.hidden = i > 0;
        }
        children.push(...img.children);
    }
    if (children.length === 0) throw new Error(`コマがありませんでした: ${group.baseName}`);

    const per = 1 / Math.max(1, fps);
    return {
        name: group.baseName,
        width,
        height,
        children,
        kind: 'animation',
        frameDurations: children.map(() => per),
    };
}
