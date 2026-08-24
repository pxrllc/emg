#!/usr/bin/env node
/**
 * emg-json-spec-0.5.0.md の各機能を含む .emg を生成する。
 *
 *   node tools/make-v050-fixtures.js [出力先] [基準 .emg]
 *
 * v0.5.0 のファイルを書き出せるパッカーはまだ無いため、消費側の実装を始めるには
 * 手で組んだ検証用ファイルが要る。これがその生成器。
 *
 * 基準の senti は 7 パーツ・18 レイヤーで、z 順は
 *   Body: Cap0 Back_hair1 Back_collar2 neck3 Head4 leg5 skirt6 top10 collar11 ribbon12
 *   arms: back_sleeve7 arm8 sleeve9
 * となっており、skirt(6) と top(10) の間に arms(7〜9) が挟まる。
 * frameName の検証にはこの「z が非連続な組」が要る（焼き込みで代替できないことの実例）。
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('../emg-packer/node_modules/jszip');

const OUT = process.argv[2] || path.join(__dirname, '..', 'test-fixtures', 'v050');
const SRC = process.argv[3] || path.join(__dirname, '..', 'samples', 'senti.emg');

/** 指定 partID のレイヤーを取り出し、元のパーツからは取り除く。 */
function extractLayers(data, partID, textureIDs) {
    const part = data.parts.find(p => p.partID === partID);
    const taken = [];
    for (const tid of textureIDs) {
        const i = part.layers.findIndex(l => l.textureID === tid);
        if (i < 0) throw new Error(`layer not found: ${partID}/${tid}`);
        taken.push(part.layers.splice(i, 1)[0]);
    }
    return taken;
}

const CASES = [
    {
        id: 'frameName_alias',
        spec: '2 章',
        desc: 'frameName が別名として使われるだけ（1 フレーム = 1 レイヤー）',
        note: 'requiredExtensions の宣言は不要。未対応実装も textureID で解決できる',
        apply: d => {
            const eyes = d.parts.find(p => p.partID === 'Eyes');
            for (const l of eyes.layers) l.frameName = `eye_${l.textureID}`;
            eyes.default = 'eye_01';
        },
    },
    {
        id: 'frameName_group',
        spec: '2 章 / 2.6',
        desc: '1 フレームに 2 レイヤー。z が非連続（skirt=6 と top=10 の間に arms=7..9）',
        note: 'requiredExtensions に EMG_frame_name が必要。焼き込みで代替できない組',
        apply: d => {
            const uniform = extractLayers(d, 'Body', ['skirt', 'top']);
            const casual = extractLayers(d, 'Body', ['collar', 'ribbon']);
            for (const l of uniform) l.frameName = 'uniform';
            for (const l of casual) l.frameName = 'casual';
            d.parts.push({
                partID: 'costume',
                type: 'switch',
                control: 'user',
                default: 'uniform',
                layers: [...uniform, ...casual],
            });
            d.requiredExtensions = ['EMG_frame_name'];
        },
    },
    {
        id: 'frameName_undeclared',
        spec: '2.6',
        desc: 'frameName_group と同じ構造だが requiredExtensions を宣言していない',
        note: '**不正なファイル**。検証ツールが検出できることを確認するための負例',
        apply: d => {
            const uniform = extractLayers(d, 'Body', ['skirt', 'top']);
            const casual = extractLayers(d, 'Body', ['collar', 'ribbon']);
            for (const l of uniform) l.frameName = 'uniform';
            for (const l of casual) l.frameName = 'casual';
            d.parts.push({
                partID: 'costume', type: 'switch', default: 'uniform',
                layers: [...uniform, ...casual],
            });
            // requiredExtensions を意図的に付けない
        },
    },
    {
        id: 'control',
        spec: '3 章',
        desc: 'Blushs を control: "user" にする',
        note: '見た目は変わらない。UI が「表情」ではなく「設定」側へ出し分けるための情報',
        apply: d => { d.parts.find(p => p.partID === 'Blushs').control = 'user'; },
    },
    {
        id: 'defaultVisible',
        spec: '4 章',
        desc: 'arms（static・3 レイヤー）を defaultVisible: false にする',
        note: '18 枚 → 15 枚になるのが正しい。未対応実装は無視して 18 枚のまま（許容される劣化）',
        apply: d => { d.parts.find(p => p.partID === 'arms').defaultVisible = false; },
    },
    {
        id: 'presets',
        spec: '5 章',
        desc: 'presets[] を追加し、mapping.json の表情から presetID で参照する',
        note: 'プリセットは指定した partID のみを変更する（5.2）',
        apply: (d, mapping) => {
            d.parts.find(p => p.partID === 'arms').defaultVisible = true;
            d.presets = [
                {
                    presetID: 'happy_look',
                    label: 'にこやか',
                    parts: { Eyebrows: '01', Blushs: '01' },
                    toggles: { arms: true },
                },
            ];
            if (mapping) mapping.expressions.preset_happy = { presetID: 'happy_look' };
        },
    },
    {
        id: 'sequence_keys',
        spec: '6 章',
        desc: '不等間隔のまばたき（fps では表現できない緩急）',
        note: '解決規則は key.t <= t を満たす最後のキー（6.2）。fps は不要',
        apply: d => {
            d.sprites.push({
                spriteID: 'blink',
                targetPartID: 'Eyes',
                sequence: {
                    type: 'ordered',
                    keys: [
                        { t: 0.00, frame: '01' },
                        { t: 0.06, frame: '03' },
                        { t: 0.10, frame: '04' },
                        { t: 0.18, frame: '03' },
                        { t: 0.24, frame: '01' },
                    ],
                },
                trigger: { type: 'random_interval', intervalMin: 3.0, intervalMax: 8.0 },
            });
        },
    },
    {
        id: 'tracks',
        spec: '7 章',
        desc: 'static パーツ（Body）への回転。targetPartID の switch 限定を外した先の形（7.1）',
        note: 'anchor は v0.4.0 で定義済み。未対応実装は sprite を無視して静止する（許容）',
        apply: d => {
            // 回転の中心を頭の付け根あたりに置く（Head の basePosition を流用）
            const head = d.parts.find(p => p.partID === 'Body').layers.find(l => l.textureID === 'Head');
            for (const l of d.parts.find(p => p.partID === 'Body').layers) {
                l.anchor_x = head.basePosition_x + head.width / 2;
                l.anchor_y = head.basePosition_y + head.height;
            }
            d.sprites.push({
                spriteID: 'body_sway',
                targetPartID: 'Body',
                duration: 3.0,
                loop: 'pingpong',
                phaseOffset: 0,
                tracks: [
                    {
                        path: 'rotation',
                        keys: [{ t: 0.0, v: -1.5 }, { t: 1.5, v: 1.5 }, { t: 3.0, v: -1.5 }],
                        interpolation: 'linear',
                    },
                ],
            });
        },
    },
];

async function main() {
    if (!fs.existsSync(SRC)) { console.error(`基準ファイルが見つかりません: ${SRC}`); process.exit(1); }
    fs.mkdirSync(OUT, { recursive: true });

    const srcZip = await JSZip.loadAsync(fs.readFileSync(SRC));
    const names = Object.keys(srcZip.files).filter(n => !srcZip.files[n].dir);
    const jsonName = names.find(n => /data\.json$/i.test(n))
        || names.find(n => /\.json$/i.test(n) && !/mapping\.json$/i.test(n));
    const mappingName = names.find(n => /mapping\.json$/i.test(n));

    const baseJson = await srcZip.files[jsonName].async('text');
    const baseMapping = mappingName ? await srcZip.files[mappingName].async('text') : null;

    const passthrough = [];
    for (const n of names) {
        if (n === jsonName || n === mappingName) continue;
        passthrough.push([n, await srcZip.files[n].async('nodebuffer')]);
    }

    const index = [];
    for (const c of CASES) {
        const d = JSON.parse(baseJson);
        const mapping = baseMapping ? JSON.parse(baseMapping) : null;
        d.version = '0.5.0';
        c.apply(d, mapping);

        const zip = new JSZip();
        zip.file(jsonName, JSON.stringify(d, null, 2));
        if (mapping && mappingName) zip.file(mappingName, JSON.stringify(mapping, null, 2));
        for (const [n, buf] of passthrough) zip.file(n, buf);
        const buf = await zip.generateAsync({ type: 'nodebuffer' });   // STORE

        const file = `${c.id}.emg`;
        fs.writeFileSync(path.join(OUT, file), buf);
        index.push({ id: c.id, spec: c.spec, desc: c.desc, note: c.note, file });
        console.log(`  ${c.id.padEnd(20)} ${c.spec.padEnd(10)} ${c.desc}`);
    }

    fs.writeFileSync(path.join(OUT, 'index.json'),
        JSON.stringify({ base: path.basename(SRC), cases: index }, null, 2));
    console.log(`\n${CASES.length} 件を生成: ${OUT}`);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
