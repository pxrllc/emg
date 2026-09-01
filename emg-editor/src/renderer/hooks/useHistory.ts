import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Psd } from 'ag-psd';
import type {
    AvatarExpression, AvatarMapping, AvatarPreset,
    LayerMeta, PartAnimation, PartTransform, SourceEntry, TransformGroup,
} from '../types';

/**
 * 取り消しの対象になる「書類」の状態。
 *
 * **書き出す `.emg` に影響するものだけ**を入れます。プレビューの差分選択・
 * 伏せているパーツ・選択中のパーツ・再生位置は入れません。それらを戻すと、
 * 「1 つ前の操作を取り消す」つもりが画面の見え方まで巻き戻り、
 * どこまで戻ったのか分からなくなります。
 *
 * 値は**参照のまま**持ちます。ツリーもレイヤーのメタも、更新のたびに新しい
 * オブジェクトを作る形（`handlePsdUpdate` / `setLayerMeta` など）で扱われており、
 * 既存のオブジェクトはその場で書き換えられません。したがって深いコピーは
 * 不要で、`canvas` の画素も複製されません。
 */
export interface DocumentSnapshot {
    psdRoot: Psd | null;
    layerMeta: Record<number, LayerMeta>;
    partAnimations: Record<string, PartAnimation>;
    partTransforms: Record<string, PartTransform>;
    mapping: AvatarMapping;
    presets: AvatarPreset[];
    expressions: AvatarExpression[];
    /**
     * 取り込んだ素材の一覧。配置（移動・拡大縮小・回転）を持つので書き出しに
     * 影響し、素材の削除はツリーの変更と対で戻さなければならない。
     */
    sources: SourceEntry[];
    /** ヌル。メンバーの構成が変われば共有アンカーも変わるので、書き出しに影響する。 */
    transformGroups: TransformGroup[];
}

const KEYS = [
    'psdRoot', 'layerMeta', 'partAnimations', 'partTransforms',
    'mapping', 'presets', 'expressions', 'sources', 'transformGroups',
] as const;

/**
 * 同じ操作の続きとみなす間隔（ミリ秒）。
 *
 * バウンディングボックスのドラッグは 1 回の操作で毎フレーム状態を書き換えます。
 * そのまま記録すると 1 回のドラッグで数百の履歴ができ、取り消しが実質使えません。
 * 「直前と同じ種類の状態が、続けて変わった」ときだけまとめます。
 */
const COALESCE_MS = 600;

/** 履歴の上限。参照だけとはいえ、無制限に持つ理由もない。 */
const LIMIT = 80;

export interface History {
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    /**
     * 次の 1 変化を記録しない。
     *
     * 利用者の操作ではなく、エディタが自分で補った変化のためのもの
     * （読み込み直後に役割パーツを推測して埋める、など）。記録すると
     * 「何もしていないのに取り消せる」状態になり、1 回目の取り消しが
     * 空振りしたように見える。
     *
     * **実際に状態が変わるときにだけ呼ぶこと。** 変わらなければ旗が
     * 残ったままになり、次の利用者の操作を飲み込む。
     */
    skipNext: () => void;
}

/**
 * 状態の変化を見張って履歴を作る。
 *
 * **操作側（30 個以上のハンドラ）には手を入れません。** 1 つずつ「記録する」
 * 呼び出しを足す形にすると、後から足したハンドラで書き忘れて
 * 「その操作だけ取り消せない」が生まれます。結果を見張る形なら漏れません。
 */
export function useHistory(
    snapshot: DocumentSnapshot,
    restore: (s: DocumentSnapshot) => void,
    /**
     * これが変わったら履歴を捨てる。読み込みの完了時に増やす。
     *
     * 「捨てる」を関数呼び出しにすると順序に依存して破綻します。読み込みは
     * 「状態を空にする」→（非同期でファイルを読む）→「木を入れる」の 2 段階で
     * 状態が変わるため、捨てた後にもう 1 つ記録が積まれて、
     * 取り消すと空のエディタに戻る、という状態が残りました。
     * 読み込み完了と同じ更新でキーを進めれば、順序を気にせず済みます。
     */
    resetKey: number,
): History {
    const pastRef = useRef<DocumentSnapshot[]>([]);
    const futureRef = useRef<DocumentSnapshot[]>([]);
    const lastRef = useRef<DocumentSnapshot>(snapshot);
    /** 取り消し／やり直しで戻した変化は、記録し直さない。 */
    const restoringRef = useRef(false);
    const resetKeyRef = useRef(resetKey);
    const lastPushRef = useRef({ at: 0, keys: '' });
    const [, bump] = useReducer((x: number) => x + 1, 0);

    const {
        psdRoot, layerMeta, partAnimations, partTransforms, mapping, presets, expressions,
    } = snapshot;

    useEffect(() => {
        // 読み込みが終わった。それ以前には戻れなくてよい。
        if (resetKeyRef.current !== resetKey) {
            resetKeyRef.current = resetKey;
            lastRef.current = snapshot;
            pastRef.current = [];
            futureRef.current = [];
            lastPushRef.current = { at: 0, keys: '' };
            bump();
            return;
        }

        const prev = lastRef.current;
        const changed = KEYS.filter(k => prev[k] !== snapshot[k]);
        if (changed.length === 0) return;

        lastRef.current = snapshot;

        if (restoringRef.current) { restoringRef.current = false; return; }

        const now = Date.now();
        const sig = changed.join(',');
        const sameGesture =
            now - lastPushRef.current.at < COALESCE_MS && lastPushRef.current.keys === sig;
        lastPushRef.current = { at: now, keys: sig };

        // 続きなら、先に積んだ「操作前の状態」をそのまま頂点に残す。
        // これで 1 回の取り消しがドラッグ 1 回分に対応する。
        if (sameGesture && pastRef.current.length > 0) return;

        pastRef.current = [...pastRef.current, prev].slice(-LIMIT);
        futureRef.current = [];
        bump();
        // snapshot 自体は毎回新しいオブジェクトなので、中身で依存を張る。
    }, [psdRoot, layerMeta, partAnimations, partTransforms, mapping, presets, expressions, snapshot, resetKey]);

    /**
     * 戻す。
     *
     * **中身が同じなら旗を立てない。** React は同じ値の setState では再描画しないので、
     * 変化しない復元で旗を立てると、それを下ろす機会が来ないまま残り、
     * 次の「本物の編集」を 1 つ飲み込む（実際にそうなった）。
     */
    const applyRestore = useCallback((from: DocumentSnapshot, to: DocumentSnapshot) => {
        // `lastRef` はここで進めない。先に進めてしまうと、復元後に走る効果が
        // 「変化なし」と判断して早く戻り、旗を下ろす機会が来ない。
        // 結果として次の本物の編集を 1 つ飲み込む（実際にそうなった）。
        restoringRef.current = KEYS.some(k => from[k] !== to[k]);
        // 復元直後の変化を「続き」と誤認しないよう、まとめ判定を切る。
        lastPushRef.current = { at: 0, keys: '' };
        restore(to);
        bump();
    }, [restore]);

    const undo = useCallback(() => {
        const prev = pastRef.current[pastRef.current.length - 1];
        if (!prev) return;
        const from = lastRef.current;
        pastRef.current = pastRef.current.slice(0, -1);
        futureRef.current = [from, ...futureRef.current];
        applyRestore(from, prev);
    }, [applyRestore]);

    const redo = useCallback(() => {
        const next = futureRef.current[0];
        if (!next) return;
        const from = lastRef.current;
        futureRef.current = futureRef.current.slice(1);
        pastRef.current = [...pastRef.current, from];
        applyRestore(from, next);
    }, [applyRestore]);

    const skipNext = useCallback(() => { restoringRef.current = true; }, []);

    return {
        undo, redo, skipNext,
        canUndo: pastRef.current.length > 0,
        canRedo: futureRef.current.length > 0,
    };
}
