#!/usr/bin/env node
/**
 * .emg のテクスチャアトラス利用状況を報告する。
 *
 * 「全素材を 1 枚のテクスチャに詰める」（doc の要件 R-1）が守られているかを
 * コマンド 1 つで確認するためのもの。占有率は詰め込みアルゴリズムを
 * 変更したときの効果測定にも使う。
 *
 * 使い方:
 *   node tools/emg-atlas-report.js <file.emg> [...]
 *   node tools/emg-atlas-report.js --expect-single <file.emg>   # 2 枚以上なら終了コード 1
 */
const fs = require('fs');
const path = require('path');
const JSZip = require(path.join(__dirname, '..', 'emg-packer', 'node_modules', 'jszip'));

/** data.json は名前が model.json のこともある（emg-json-spec.md 1.2）。 */
function findMainJson(zip) {
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    return names.find(n => n.endsWith('data.json'))
        ?? names.find(n => n.endsWith('.json') && !n.endsWith('mapping.json'));
}

async function report(file) {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const jsonName = findMainJson(zip);
    if (!jsonName) throw new Error(`メイン JSON が見つかりません: ${file}`);
    const data = JSON.parse(await zip.files[jsonName].async('text'));

    const textures = data.textures ?? [];
    // アトラスごとの実使用ピクセル数。レイヤーは textureFile でどの枚に載るか決まる。
    const usedByFile = new Map();
    let layers = 0;
    let maxW = 0;
    let maxH = 0;

    for (const part of data.parts ?? []) {
        for (const l of part.layers ?? []) {
            layers++;
            maxW = Math.max(maxW, l.width ?? 0);
            maxH = Math.max(maxH, l.height ?? 0);
            const key = l.textureFile ?? textures[0]?.textureFile ?? '(unknown)';
            usedByFile.set(key, (usedByFile.get(key) ?? 0) + (l.width ?? 0) * (l.height ?? 0));
        }
    }

    const totalUsed = [...usedByFile.values()].reduce((a, b) => a + b, 0);
    const totalArea = textures.reduce((s, t) => s + (t.width ?? 0) * (t.height ?? 0), 0);

    // ZIP に実在する PNG。textures[] と食い違っていれば生成側の不整合。
    const pngEntries = Object.keys(zip.files).filter(n => !zip.files[n].dir && /\.png$/i.test(n));

    const mpx = v => (v / 1e6).toFixed(2) + ' Mpx';
    const pct = (a, b) => b > 0 ? (100 * a / b).toFixed(1) + '%' : 'n/a';

    console.log(`${path.basename(file)}  version=${data.version ?? '?'}`);
    console.log(`  アトラス: ${textures.length} 枚  レイヤー: ${layers}  最大レイヤー: ${maxW}x${maxH}`);
    for (const t of textures) {
        const used = usedByFile.get(t.textureFile) ?? 0;
        const area = (t.width ?? 0) * (t.height ?? 0);
        console.log(`    ${t.textureFile}  ${t.width}x${t.height}  使用 ${mpx(used)} / ${mpx(area)}  占有率 ${pct(used, area)}`);
    }
    console.log(`  合計: 使用 ${mpx(totalUsed)} / ${mpx(totalArea)}  占有率 ${pct(totalUsed, totalArea)}`);

    if (pngEntries.length !== textures.length) {
        console.log(`  ! textures[] は ${textures.length} 枚だが ZIP の PNG は ${pngEntries.length} 個: ${pngEntries.join(', ')}`);
    }
    return textures.length;
}

async function main() {
    const args = process.argv.slice(2);
    const expectSingle = args.includes('--expect-single');
    const files = args.filter(a => !a.startsWith('--'));

    if (files.length === 0) {
        console.error('使い方: node tools/emg-atlas-report.js [--expect-single] <file.emg> [...]');
        process.exit(2);
    }

    let violated = false;
    for (const f of files) {
        const count = await report(f);
        if (expectSingle && count !== 1) {
            console.error(`  NG  R-1 違反: アトラスが ${count} 枚です（1 枚であるべき）`);
            violated = true;
        }
        console.log('');
    }
    if (violated) process.exit(1);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
