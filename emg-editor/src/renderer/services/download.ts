/**
 * 出来上がった Blob をファイルとして渡す。
 *
 * 書き出しの入口が 4 つ（`.emg` / プレビュー / 設定 / テンプレート）あり、
 * それぞれで同じことを書くと抜けが出るのでここにまとめる。
 */

/** 保存名に使えない文字を落とす。パーツ名や素材名がそのまま来るため。 */
function safeName(name: string): string {
    return (name || 'untitled')
        .replace(/[\/\:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'untitled';
}

/**
 * ダウンロードさせる。
 *
 * **アンカーは文書に入れてから押す。** 外したままの要素へのクリックを
 * 無視するブラウザがあり、「押したのにファイルが出てこない」になる。
 *
 * **オブジェクト URL は必ず開放する。** 解放しないと Blob が居座り続け、
 * 大きなアトラスや長い GIF を何度も書き出すとメモリを食い潰す。
 * ダウンロードが始まる前に消すと失敗するので、少し待ってから消す。
 */
export function downloadBlob(blob: Blob, filename: string): string {
    const name = safeName(filename);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
    }, 60_000);
    return name;
}

/**
 * 読み込んだ素材からファイル名の芯を作る。
 *
 * 固定名（`model.emg`）だと、続けて書き出すたびに `model (1).emg` と積み上がり、
 * どれがどの素材か分からなくなる。素材名が付いていれば見つけられる。
 */
export function baseNameOf(sourceName: string | null | undefined): string {
    return safeName((sourceName ?? '').replace(/\.[^.]+$/, '') || 'untitled');
}

// ---- 保存先を先に押さえる ---------------------------------------------------

/**
 * 書き出し先。押した瞬間に確保し、出来上がってから書き込む。
 *
 * **これが要る理由。** ブラウザは「利用者の操作から続いていないダウンロード」を
 * 2 件目以降ブロックする。書き出しには数秒かかるので、終わったころには
 * 押した瞬間の操作扱いが切れており、**押しても何も起きない**（保存先を見ても
 * ファイルが無い）ことがある。実際に起きた。
 *
 * そこで、押された瞬間に保存先を決めておき、あとから中身を流し込む。
 */
export interface SaveTarget {
    write: (blob: Blob) => Promise<string>;
    /** 利用者が選んだ名前。決められない環境では提案した名前。 */
    name: string;
}

type PickerWindow = Window & {
    showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
};

/**
 * 保存先を用意する。**利用者の操作の中から呼ぶこと。**
 *
 * 保存ダイアログを出せる環境ではそれを使い（どこに置いたか利用者が分かる）、
 * 出せない環境ではダウンロードに落とす。
 */
export async function prepareSave(
    suggestedName: string, mime: string, extensions: string[],
): Promise<SaveTarget> {
    const w = window as PickerWindow;
    const name = safeName(suggestedName);
    if (typeof w.showSaveFilePicker === 'function') {
        try {
            const handle = await w.showSaveFilePicker({
                suggestedName: name,
                types: [{ description: name.split('.').pop() ?? 'file', accept: { [mime]: extensions } }],
            });
            return {
                name: handle.name || name,
                write: async (blob: Blob) => {
                    const ws = await handle.createWritable();
                    await blob.stream().pipeTo(ws);
                    return handle.name || name;
                },
            };
        } catch (e) {
            // 利用者が閉じたなら、そのまま伝えて書き出し自体をやめる。
            if (e instanceof DOMException && e.name === 'AbortError') throw e;
            // それ以外（未対応・権限なし）はダウンロードへ。
        }
    }
    return { name, write: async (blob: Blob) => downloadBlob(blob, name) };
}
