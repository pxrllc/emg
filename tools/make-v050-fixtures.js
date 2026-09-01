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
        apply: (d, mapping) => {
            const eyes = d.parts.find(p => p.partID === 'Eyes');
            const rename = tid => `eye_${tid}`;
            for (const l of eyes.layers) l.frameName = rename(l.textureID);
            eyes.default = rename(eyes.default);

            // v0.5.0 §1.2: mapping.json の参照もフレーム識別子で解決される。
            // frameName を付けた以上、こちらも合わせないと解決できなくなる
            // （合わせ忘れると、そのパーツが一切描画されない）。
            if (mapping) {
                const b = mapping.baseMapping?.blink;
                if (b) for (const k of Object.keys(b)) if (b[k]) b[k] = rename(b[k]);
                for (const e of Object.values(mapping.expressions ?? {})) {
                    if (e.parts?.Eyes) e.parts.Eyes = e.parts.Eyes.map(rename);
                    const ob = e.overrides?.blink;
                    if (ob) for (const k of Object.keys(ob)) if (ob[k]) ob[k] = rename(ob[k]);
                }
            }
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
        id: 'switch_none',
        spec: '4.3',
        desc: 'Blushs（switch・5 レイヤー）を defaultVisible: false にする',
        note: '18 枚 → 17 枚。switch はもともと 1 フレームしか描かないため、減るのは 1 枚。'
            + '差分を持ちながら常態は「無し」であるパーツ（チーク・青ざめ）の表現。'
            + 'EMG_switch_none の宣言が必須で、未対応実装は読み込みを拒否する',
        apply: d => {
            d.parts.find(p => p.partID === 'Blushs').defaultVisible = false;
            d.requiredExtensions = [...(d.requiredExtensions ?? []), 'EMG_switch_none'];
        },
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
        // sequence_keys と同じキー列だが auto_loop。読み込み直後から再生されるため
        // 実装の再生経路をそのまま観測できる（random_interval だと最初の発火まで数秒待つ）。
        //
        // 対象は Blushs。Eyes / Mouth は mapping.json の blink / lipSync 管轄であり、
        // 共存ルール（v0.3.0 仕様 7.3）により sprites[] の自律発火が抑制されるため、
        // 再生経路の検証には使えない。
        id: 'sequence_keys_autoloop',
        spec: '6 章',
        desc: 'sequence_keys の auto_loop 版（検証用・mapping 非管轄の Blushs が対象）',
        note: '読み込み直後から不等間隔で再生される',
        apply: d => {
            d.sprites.push({
                spriteID: 'blush_loop',
                targetPartID: 'Blushs',
                sequence: {
                    type: 'ordered',
                    keys: [
                        { t: 0.00, frame: 'cheek' },
                        { t: 0.20, frame: '01' },
                        { t: 0.40, frame: '02' },
                        { t: 0.60, frame: '03' },
                        { t: 0.80, frame: 'cheek' },
                    ],
                },
                trigger: { type: 'auto_loop' },
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
    {
        id: 'tracks_targetLayer',
        spec: '7.4.1 章',
        version: '0.5.3',
        desc: 'Body 全体ではなく Back_hair だけを揺らす（0.5.3 の targetLayer）',
        note: 'EMG_layer_transform の宣言が要る。無視するとパーツ全体が揺れて「別の絵」になる',
        apply: d => {
            // 房の根元を軸にする。アンカーはレイヤーごとに独立しているため（7.4）、
            // 対象のレイヤーにだけ書けばよい。
            const body = d.parts.find(p => p.partID === 'Body');
            const hair = body.layers.find(l => l.textureID === 'Back_hair');
            hair.anchor_x = hair.basePosition_x + hair.width / 2;
            hair.anchor_y = hair.basePosition_y;
            d.requiredExtensions = [...(d.requiredExtensions ?? []), 'EMG_layer_transform'];
            d.sprites.push({
                spriteID: 'hair_sway',
                targetPartID: 'Body',
                targetLayer: 'Back_hair',
                duration: 3.0,
                loop: 'pingpong',
                phaseOffset: 0,
                tracks: [
                    {
                        path: 'rotation',
                        keys: [{ t: 0.0, v: -2.5 }, { t: 1.5, v: 2.5 }, { t: 3.0, v: -2.5 }],
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
        d.version = c.version ?? '0.5.0';
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
