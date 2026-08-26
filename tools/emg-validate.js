#!/usr/bin/env node
/**
 * .emg が仕様の規範的な要件を満たしているか検査する。
 *
 *   node tools/emg-validate.js <file.emg> [<file.emg> ...]
 *
 * 対象は v0.3.0 / v0.4.0 / v0.5.0 のうち「ファイル側が守るべき」規則。
 * 消費側の挙動（未知の値をどう扱うか）は対象外 — それは実装の検査。
 *
 * 終了コードは、エラーが 1 件でもあれば 1。警告のみなら 0。
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('../emg-packer/node_modules/jszip');

/** emg-extensions-registry.md に登録されている識別子 */
const KNOWN_EXTENSIONS = new Set(['EMG_frame_name', 'EMG_switch_none']);

/** emg-json-spec-0.4.0.md 5.1（CSS mix-blend-mode と同一） */
const KNOWN_BLEND_MODES = new Set([
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light',
    'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

const MAX_ATLAS = 8192;

/** レイヤーのフレーム識別子（emg-json-spec-0.5.0.md 1.1） */
const frameId = layer => layer.frameName ?? layer.textureID;

function validate(data, entryNames, mapping) {
    const errors = [];
    const warnings = [];
    const E = m => errors.push(m);
    const W = m => warnings.push(m);

    // --- ルート ---
    for (const k of ['version', 'baseCanvasWidth', 'baseCanvasHeight', 'textures', 'parts', 'sprites']) {
        if (data[k] === undefined) E(`ルートに必須フィールド '${k}' がありません`);
    }
    if (!Array.isArray(data.textures) || data.textures.length === 0) {
        E('textures[] が空です。テクスチャが 1 枚でも配列に含める必要があります（3 章）');
    }

    // --- requiredExtensions（v0.4.0 2 章） ---
    for (const e of data.requiredExtensions ?? []) {
        if (!KNOWN_EXTENSIONS.has(e)) {
            W(`requiredExtensions に登録簿に無い識別子 '${e}' があります（emg-extensions-registry.md）`);
        }
    }

    // --- テクスチャ ---
    const declared = new Set();
    for (const t of data.textures ?? []) {
        declared.add(t.textureFile);
        if (t.width > MAX_ATLAS || t.height > MAX_ATLAS) {
            E(`アトラス '${t.textureFile}' が ${t.width}x${t.height} で上限 ${MAX_ATLAS}px を超えています（1.3）`);
        }
        if (entryNames && !entryNames.some(n => n.endsWith(t.textureFile))) {
            E(`textures[] が宣言する '${t.textureFile}' が ZIP 内にありません`);
        }
    }

    // --- パーツ・レイヤー ---
    const partIds = new Set();
    const zSeen = new Map();
    let framesWithMultipleLayers = 0;
    const switchNoneParts = [];   // v0.5.0 §4.3: 初期状態でどれも表示しない switch

    for (const part of data.parts ?? []) {
        if (partIds.has(part.partID)) E(`partID '${part.partID}' が重複しています（6 章：ファイル全体で一意）`);
        partIds.add(part.partID);

        if (part.type !== 'static' && part.type !== 'switch') {
            W(`パーツ '${part.partID}' の type が '${part.type}' です。既知の値ではありません`);
        }
        if (part.type === 'switch' && part.default === undefined) {
            E(`switch パーツ '${part.partID}' に default がありません（4 章）`);
        }
        if (part.type === 'switch' && part.defaultVisible === false) {
            switchNoneParts.push(part.partID);
        }
        if (part.control !== undefined && part.control !== 'animated' && part.control !== 'user') {
            W(`パーツ '${part.partID}' の control が '${part.control}' です（v0.5.0 3.1）`);
        }

        // textureID はパーツ内で一意（6 章）
        const tids = new Set();
        const frameGroups = new Map();
        for (const l of part.layers ?? []) {
            if (tids.has(l.textureID)) {
                E(`パーツ '${part.partID}' 内で textureID '${l.textureID}' が重複しています（6 章）`);
            }
            tids.add(l.textureID);

            const fid = frameId(l);
            frameGroups.set(fid, (frameGroups.get(fid) ?? 0) + 1);

            if (l.textureFile && !declared.has(l.textureFile)) {
                E(`レイヤー ${part.partID}/${l.textureID} の textureFile '${l.textureFile}' が textures[] に宣言されていません`);
            }
            if (l.blendMode !== undefined && !KNOWN_BLEND_MODES.has(l.blendMode)) {
                W(`レイヤー ${part.partID}/${l.textureID} の blendMode '${l.blendMode}' は定義済みの値ではありません。normal として描画されます（v0.4.0 5.2）`);
            }
            if (l.opacity !== undefined && (l.opacity < 0 || l.opacity > 1)) {
                E(`レイヤー ${part.partID}/${l.textureID} の opacity が範囲外です: ${l.opacity}`);
            }
            if (typeof l.textureZIndex === 'number') {
                const prev = zSeen.get(l.textureZIndex);
                if (prev) W(`textureZIndex ${l.textureZIndex} が重複しています（${prev} と ${part.partID}/${l.textureID}）。描画順は未定義（5.2）`);
                else zSeen.set(l.textureZIndex, `${part.partID}/${l.textureID}`);
            }
        }

        // default はフレーム識別子で解決される（v0.5.0 1.2）
        if (part.type === 'switch' && part.default !== undefined && !frameGroups.has(part.default)) {
            E(`switch パーツ '${part.partID}' の default '${part.default}' に一致するフレームがありません`);
        }

        for (const n of frameGroups.values()) if (n > 1) framesWithMultipleLayers++;
    }

    // --- switch の defaultVisible の宣言義務（v0.5.0 4.7）---
    // 未対応実装は default のフレームを描いてしまい、出ないはずのものが出る。
    if (switchNoneParts.length > 0 && !(data.requiredExtensions ?? []).includes('EMG_switch_none')) {
        E(`switch パーツ ${switchNoneParts.map(p => `'${p}'`).join(', ')} が defaultVisible: false ですが、` +
          `requiredExtensions に 'EMG_switch_none' がありません（v0.5.0 4.7）。` +
          `未対応の実装は default のフレームを表示してしまいます`);
    }

    // --- frameName の宣言義務（v0.5.0 2.6）---
    // 1 フレームに 2 枚以上属する場合、未対応実装は何も描画できない。
    if (framesWithMultipleLayers > 0 && !(data.requiredExtensions ?? []).includes('EMG_frame_name')) {
        E(`frameName が ${framesWithMultipleLayers} 個のフレームで複数レイヤーをまとめていますが、` +
          `requiredExtensions に 'EMG_frame_name' がありません（v0.5.0 2.6）。` +
          `未対応の実装はこのファイルを描画できず、しかも失敗として検知できません`);
    }

    // --- sprites ---
    for (const s of data.sprites ?? []) {
        const target = (data.parts ?? []).find(p => p.partID === s.targetPartID);
        if (!target) { E(`sprite '${s.spriteID}' の targetPartID '${s.targetPartID}' が存在しません`); continue; }

        if (s.sequence && target.type !== 'switch') {
            E(`sprite '${s.spriteID}' は sequence を持つため targetPartID は switch パーツでなければなりません（v0.5.0 7.1）。'${s.targetPartID}' は ${target.type} です`);
        }
        if (s.tracks && s.duration === undefined) {
            E(`sprite '${s.spriteID}' は tracks を持つため duration が必須です（v0.5.0 7.2）`);
        }
        if (s.sequence?.frames && s.sequence?.keys) {
            E(`sprite '${s.spriteID}' の sequence が frames と keys の両方を持っています（排他・v0.5.0 6.1）`);
        }
        if (s.sequence?.keys) {
            let prev = -Infinity;
            for (const k of s.sequence.keys) {
                if (k.t < prev) { E(`sprite '${s.spriteID}' の sequence.keys が t の昇順ではありません`); break; }
                prev = k.t;
            }
        }
        // frames / keys の参照先はフレーム識別子（v0.5.0 1.2）
        const known = new Set((target.layers ?? []).map(frameId));
        const refs = s.sequence?.frames ?? (s.sequence?.keys ?? []).map(k => k.frame);
        for (const r of refs) {
            if (!known.has(r)) E(`sprite '${s.spriteID}' が参照するフレーム '${r}' が '${s.targetPartID}' にありません`);
        }
    }

    // --- 0.5.2 10.5.1: 同一パーツを自律発火の sequence が奪い合ってはならない ---
    // 表示できるフレームは 1 つなので、複数書くと取り合いになる。
    {
        const autoByPart = new Map();
        for (const s of data.sprites ?? []) {
            if (!s.sequence) continue;
            const t = s.trigger?.type;
            if (!t || t === 'external') continue;   // 自律発火しないものは競合しない
            if (!autoByPart.has(s.targetPartID)) autoByPart.set(s.targetPartID, []);
            autoByPart.get(s.targetPartID).push(s.spriteID);
        }
        for (const [partID, ids] of autoByPart) {
            if (ids.length > 1) {
                E(`パーツ '${partID}' を自律発火する sprite が ${ids.length} 個あります`
                  + `（${ids.map(i => `'${i}'`).join(', ')}）。表示できるフレームは 1 つなので`
                  + `取り合いになります（0.5.2 10.5.1）`);
            }
        }
    }

    // --- 0.5.2 10.4.3: keys と fps を同時に書いてはならない ---
    for (const s of data.sprites ?? []) {
        if (s.sequence?.keys && s.fps !== undefined) {
            W(`sprite '${s.spriteID}' が keys と fps の両方を持っています。`
              + `fps は無視されます（0.5.2 10.4.3）`);
        }
    }

    // --- 0.5.2 10.7: opacity は 0.0〜1.0 ---
    // （範囲外はレイヤー検査で既にエラーにしている）

    // --- 7.3: mapping.json が掌握するパーツは自律発火してはならない ---
    // blinkPartKey / blinkParts / lipSyncPartKey / lipSyncParts による「明示的」な指定のみ。
    // partID のキーワード一致で解決されただけのものは該当しない。
    if (mapping) {
        const base = mapping.baseMapping ?? {};
        const controlled = new Set([
            base.blinkPartKey,
            base.lipSyncPartKey,
            ...Object.values(base.blinkParts ?? {}),
            ...Object.values(base.lipSyncParts ?? {}),
        ].filter(Boolean));

        for (const s of data.sprites ?? []) {
            if (!controlled.has(s.targetPartID)) continue;
            const t = s.trigger?.type;
            if (t && t !== 'external') {
                E(`sprite '${s.spriteID}' は mapping.json が掌握する '${s.targetPartID}' を対象にしていますが、`
                  + `trigger.type が '${t}' です。自律発火してはなりません（7.3）`);
            }
        }
    }

    // --- presets（v0.5.0 5 章）---
    for (const p of data.presets ?? []) {
        for (const [pid, fid] of Object.entries(p.parts ?? {})) {
            const part = (data.parts ?? []).find(x => x.partID === pid);
            if (!part) { E(`preset '${p.presetID}' が存在しない partID '${pid}' を参照しています`); continue; }
            if (!(part.layers ?? []).some(l => frameId(l) === fid)) {
                E(`preset '${p.presetID}' が参照するフレーム '${pid}/${fid}' がありません`);
            }
        }
        for (const pid of Object.keys(p.toggles ?? {})) {
            if (!(data.parts ?? []).some(x => x.partID === pid)) {
                E(`preset '${p.presetID}' の toggles が存在しない partID '${pid}' を参照しています`);
            }
        }
    }

    return { errors, warnings };
}

async function main() {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.error('使い方: node tools/emg-validate.js <file.emg> [...]');
        process.exit(2);
    }

    let failed = 0;
    for (const file of files) {
        const zip = await JSZip.loadAsync(fs.readFileSync(file));
        const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
        const jsonName = names.find(n => /data\.json$/i.test(n))
            || names.find(n => /\.json$/i.test(n) && !/mapping\.json$/i.test(n));
        if (!jsonName) { console.error(`${path.basename(file)}: メイン JSON が見つかりません`); failed++; continue; }

        const data = JSON.parse(await zip.files[jsonName].async('text'));
                // mapping.json があれば 7.3 の検査に使う
        const mappingName = names.find(n => /mapping\.json$/i.test(n));
        const mapping = mappingName ? JSON.parse(await zip.files[mappingName].async('text')) : null;

        const { errors, warnings } = validate(data, names, mapping);

        const label = path.basename(file);
        if (errors.length === 0 && warnings.length === 0) {
            console.log(`OK  ${label}`);
        } else {
            console.log(`${errors.length > 0 ? 'NG ' : '警告'} ${label}  (version=${data.version})`);
            for (const e of errors) console.log(`      エラー: ${e}`);
            for (const w of warnings) console.log(`      警告  : ${w}`);
        }
        if (errors.length > 0) failed++;
    }
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
