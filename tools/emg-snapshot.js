#!/usr/bin/env node
/**
 * .emg から「1 フレーム分の描画リスト」を求めてテキスト化する。
 * emg-json-spec.md 8 章（描画モデル）の手順をそのまま実装したもの。
 *
 *   node tools/emg-snapshot.js <file.emg>            スナップショットを出力
 *   node tools/emg-snapshot.js <file.emg> --check <snapshot.txt>
 *                                                    既存スナップショットと比較
 *
 * ピクセルではなく描画リストを固定するのは、画像デコードのために重い依存を
 * 持ち込まずに済むうえ、退行として拾いたいもの（パーツ解決・重ね順・座標・
 * 不透明度）がすべてこの段階で決まるため。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('../emg-packer/node_modules/jszip');

/** emg-json-spec.md 1.1 のエントリ探索 */
function findMainJson(zip) {
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    return names.find(n => /data\.json$/i.test(n))
        || names.find(n => /\.json$/i.test(n) && !/mapping\.json$/i.test(n));
}

/** emg-json-spec-0.5.0.md 1.1: レイヤーのフレーム識別子 */
const frameId = layer => layer.frameName ?? layer.textureID;

/**
 * emg-json-spec.md 4.2 + v0.5.0 2.2:
 * switch パーツで表示するフレームを決め、そのフレームに属する *すべての* レイヤーを返す。
 * frameName の無いファイルでは 1 枚しか一致しないため、従来の結果と変わらない。
 */
function resolveSwitch(part) {
    const target = part.layers.some(l => frameId(l) === part.default)
        ? part.default
        : (part.layers.length > 0 ? frameId(part.layers[0]) : null);
    return part.layers.filter(l => frameId(l) === target);
}

/** emg-json-spec.md 8 章の手順 1〜2 */
function buildDrawList(data) {
    const draw = [];
    for (const part of data.parts || []) {
        // v0.5.0 4 章: defaultVisible: false は初期状態で描かれない。
        // static は「初期非表示のトグル」、switch は 4.3 の「どのフレームも表示しない」。
        if (part.defaultVisible === false) continue;
        if (part.type === 'static') {
            for (const l of part.layers || []) draw.push({ part: part.partID, layer: l });
        } else {
            for (const l of resolveSwitch(part)) draw.push({ part: part.partID, layer: l });
        }
    }
    // textureZIndex 昇順 = 奥から手前。
    // 同値のときは宣言順（parts[] の順、その中の layers[] の順）で描く（0.5.2 10.3）。
    // 以前は partID/textureID の辞書順で並べていたが、それは仕様が定める順序ではない。
    return draw
        .map((d, i) => ({ ...d, seq: i }))
        .sort((a, b) => (a.layer.textureZIndex - b.layer.textureZIndex) || (a.seq - b.seq));
}

function render(data, label) {
    const out = [];
    out.push(`# EMG 描画スナップショット`);
    out.push(`# 生成: tools/emg-snapshot.js  対象: ${label}`);
    out.push(`# 仕様: emg-json-spec.md 8 章（描画モデル）`);
    out.push('');
    out.push(`version=${data.version}`);
    out.push(`canvas=${data.baseCanvasWidth}x${data.baseCanvasHeight}`);
    for (const t of data.textures || []) out.push(`texture=${t.textureFile} ${t.width}x${t.height}`);
    out.push(`requiredExtensions=${JSON.stringify(data.requiredExtensions || [])}`);
    out.push('');
    out.push(`parts=${(data.parts || []).length} sprites=${(data.sprites || []).length}`);
    for (const p of data.parts || []) {
        out.push(`  part ${p.partID} type=${p.type} default=${p.default ?? '-'} layers=${(p.layers || []).length}`);
    }
    out.push('');
    const draw = buildDrawList(data);
    out.push(`draw=${draw.length}  # 奥から手前`);
    for (const d of draw) {
        const l = d.layer;
        out.push(
            `  z=${String(l.textureZIndex).padStart(4)} ${d.part}/${l.textureID}` +
            (l.frameName ? ` frame=${l.frameName}` : '') +
            ` tex=${l.textureFile}` +
            ` src=(${l.x},${l.y},${l.width}x${l.height})` +
            ` dst=(${l.basePosition_x},${l.basePosition_y})` +
            ` opacity=${l.opacity ?? 1}` +
            ` blend=${l.blendMode ?? 'normal'}`
        );
    }
    return out.join('\n') + '\n';
}

async function main() {
    const [, , file, flag, snapPath] = process.argv;
    if (!file) {
        console.error('使い方: node tools/emg-snapshot.js <file.emg> [--check <snapshot.txt>]');
        process.exit(2);
    }

    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const jsonName = findMainJson(zip);
    if (!jsonName) { console.error(`メイン JSON が見つかりません: ${file}`); process.exit(1); }
    const data = JSON.parse(await zip.files[jsonName].async('text'));

    const text = render(data, path.basename(file));

    if (flag === '--check') {
        if (!snapPath) { console.error('--check にはスナップショットのパスが必要です'); process.exit(2); }
        if (!fs.existsSync(snapPath)) { console.error(`スナップショットがありません: ${snapPath}`); process.exit(1); }
        const expected = fs.readFileSync(snapPath, 'utf8').replace(/\r\n/g, '\n');
        if (expected === text) {
            const h = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
            console.log(`OK  ${path.basename(file)} は ${path.basename(snapPath)} と一致 (sha256:${h})`);
            return;
        }
        console.error(`NG  ${path.basename(file)} が ${path.basename(snapPath)} と一致しません\n`);
        const a = expected.split('\n'), b = text.split('\n');
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if (a[i] !== b[i]) {
                console.error(`  行 ${i + 1}`);
                console.error(`    期待: ${a[i] ?? '(なし)'}`);
                console.error(`    実際: ${b[i] ?? '(なし)'}`);
            }
        }
        process.exit(1);
    }

    process.stdout.write(text);
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
