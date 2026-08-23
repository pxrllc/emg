#!/usr/bin/env node
/**
 * emg-json-spec-0.4.0.md §9.2 の異常系フィクスチャを生成する。
 *
 *   node tools/make-compat-fixtures.js [出力先ディレクトリ]
 *
 * samples/senti.emg を基に、未知フィールド・未知の列挙値などを仕込んだ .emg を作る。
 * 各実装へ流して挙動を記録し、v0.4.0 §1.2 の規定文を実測に基づいて確定させるためのもの。
 *
 * 基準ファイルは sprites[] が空なので、sprite に関する検証（D/E/F）では
 * Eyes を対象とする sprite を1つ注入してから改変する。
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('../emg-packer/node_modules/jszip');

const SRC = path.join(__dirname, '..', 'samples', 'senti.emg');
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-fixtures', 'compat');

/** 検証対象の sprite。D/E/F はこれを改変する。 */
function baseSprite() {
    return {
        spriteID: 'blink',
        targetPartID: 'Eyes',
        fps: 12,
        sequence: { type: 'ordered', frames: ['01', '03', '04', '03', '01'] },
        trigger: { type: 'random_interval', intervalMin: 3.0, intervalMax: 8.0 },
    };
}

/**
 * 各ケースは data.json を破壊的に変更する関数。
 * expected は v0.4.0 適合実装に期待される挙動。
 */
const CASES = [
    {
        id: 'A', name: '未知のルートキー',
        rule: 'F1',
        expected: '無視して読み込む',
        apply: d => { d.futureFeature = { note: 'unknown root key' }; },
    },
    {
        // Mouth は mapping.json の lipSync 管轄。type の解釈に関わらず解決されるため、
        // このケース単独では F2 の適合を判定できない（B2 と併せて読むこと）。
        id: 'B', name: 'parts[].type が未知（default あり・mapping 管轄）',
        rule: 'F2',
        expected: 'switch として扱う（Mouth は 03 のみ表示）',
        apply: d => { d.parts.find(p => p.partID === 'Mouth').type = 'future_exclusive'; },
    },
    {
        // Character は mapping.json のどの項目からも参照されない switch パーツ。
        // type の解釈だけが結果を決めるため、F2 の適合を単独で判定できる。
        id: 'B2', name: 'parts[].type が未知（default あり・mapping 非管轄）',
        rule: 'F2',
        expected: 'switch として扱う（Character は Front_hair を表示 = 18 枚）',
        apply: d => { d.parts.find(p => p.partID === 'Character').type = 'future_exclusive'; },
    },
    {
        id: 'C', name: 'parts[].type が未知（default なし）',
        rule: 'F2',
        expected: 'static として扱う（arms は全 3 レイヤー表示）',
        apply: d => { d.parts.find(p => p.partID === 'arms').type = 'future_toggle'; },
    },
    {
        id: 'D', name: 'sequence.type が未知',
        rule: 'F3',
        expected: 'ordered として扱う',
        apply: d => { const s = baseSprite(); s.sequence.type = 'future_order'; d.sprites.push(s); },
    },
    {
        id: 'E', name: 'trigger.type が未知',
        rule: 'F4',
        expected: '自律発火しない',
        apply: d => { const s = baseSprite(); s.trigger = { type: 'future_trigger' }; d.sprites.push(s); },
    },
    {
        id: 'F', name: 'sprites[].fps が不在',
        rule: '4.2',
        expected: '12 として継続',
        apply: d => { const s = baseSprite(); delete s.fps; d.sprites.push(s); },
    },
    {
        id: 'G', name: 'layers[] に未知フィールド',
        rule: 'F1',
        expected: '無視して読み込む',
        apply: d => { d.parts[0].layers[0].futureField = 123; },
    },
    {
        id: 'H', name: 'requiredExtensions に未知の識別子',
        rule: 'F5',
        expected: '読み込みを拒否し、識別子を提示する',
        apply: d => { d.requiredExtensions = ['EMG_unknown']; },
    },
    {
        id: 'I', name: 'blendMode が未知',
        rule: '5.2',
        expected: 'normal として描画',
        apply: d => { d.parts[0].layers[0].blendMode = 'future-blend'; },
    },
];

async function main() {
    if (!fs.existsSync(SRC)) {
        console.error(`基準ファイルが見つかりません: ${SRC}`);
        process.exit(1);
    }
    fs.mkdirSync(OUT, { recursive: true });

    const srcZip = await JSZip.loadAsync(fs.readFileSync(SRC));
    const jsonName = Object.keys(srcZip.files).find(n => n.endsWith('data.json'))
        || Object.keys(srcZip.files).find(n => n.endsWith('.json') && !n.endsWith('mapping.json'));
    const baseJson = await srcZip.files[jsonName].async('text');

    // JSON 以外のエントリ（テクスチャ・mapping・LICENSE）はそのまま複製する
    const passthrough = [];
    for (const name of Object.keys(srcZip.files)) {
        if (srcZip.files[name].dir || name === jsonName) continue;
        passthrough.push([name, await srcZip.files[name].async('nodebuffer')]);
    }

    const index = [];
    for (const c of CASES) {
        const d = JSON.parse(baseJson);
        d.version = '0.4.0';
        c.apply(d);

        const zip = new JSZip();
        zip.file(jsonName, JSON.stringify(d, null, 2));
        for (const [name, buf] of passthrough) zip.file(name, buf);
        // 圧縮指定なし = STORE（emg-json-spec.md 1.2）
        const buf = await zip.generateAsync({ type: 'nodebuffer' });

        const fileName = `case_${c.id}.emg`;
        fs.writeFileSync(path.join(OUT, fileName), buf);
        index.push({ ...c, file: fileName, apply: undefined });
        console.log(`  ${c.id}  ${fileName.padEnd(12)} ${c.name}`);
    }

    fs.writeFileSync(
        path.join(OUT, 'index.json'),
        JSON.stringify({ base: path.basename(SRC), cases: index }, null, 2)
    );
    console.log(`\n${CASES.length} 件を生成: ${OUT}`);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
