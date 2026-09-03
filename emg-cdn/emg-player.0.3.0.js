(function () {
    // グローバル変数の定義
    window.jsonData = null;
    window.emgMapping = null; // mapping.json (v0.3.0+, optional)
    window.emgVersion = null;
    window.isAnimationRunning = true;
    window.animationIntervals = []; // 複数のタイマー管理用
    window.timeouts = [];

    // mapping.json 由来のランタイム状態（emg-mapping-spec.md の解決ロジックが参照する）
    const mappingState = {
        blinkPartID: null,
        blinkExplicit: false,
        mouthPartID: null,
        mouthExplicit: false,
        currentExpression: 'default',
        activeBlinkOverride: null,  // { open, half, closed } | null
        activeLipSyncOverride: null // { a, i, u, e, o, n } | null
    };

    const BLINK_KEYWORDS = ['eye', 'eyes', 'eyelid', 'blink', '目'];
    const MOUTH_KEYWORDS = ['mouth', 'lip', 'viseme', '口'];

    function resetMappingState() {
        Object.assign(mappingState, {
            blinkPartID: null, blinkExplicit: false,
            mouthPartID: null, mouthExplicit: false,
            currentExpression: 'default',
            activeBlinkOverride: null, activeLipSyncOverride: null
        });
    }

    /** 走っているタイマーを全部止める。読み直し・停止・リセットで共通。 */
    function stopTimers() {
        window.animationIntervals.forEach(clearInterval);
        window.timeouts.forEach(clearTimeout);
        window.animationIntervals = [];
        window.timeouts = [];
        if (transformRafId !== null) { cancelAnimationFrame(transformRafId); transformRafId = null; }
        transformSprites = [];
    }

    // JSZip のロードチェック
    if (typeof JSZip === 'undefined') {
        const jsZipScript = document.createElement('script');
        jsZipScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js";
        document.head.appendChild(jsZipScript);
        jsZipScript.onload = function () {
            console.log("JSZip loaded via dynamic script");
            initPlayer();
        };
    } else {
        initPlayer();
    }

    function initPlayer() {
        // 公開関数
        window.EMGPlayer = {
            loadEmgFromCDN: loadEmgFromCDN,
            // ローカルの File / Blob を直接読む。fetch できない
            // （ユーザーが選んだ・ドロップした）ファイル向け。
            loadEmgFromFile: loadEmgFromBlob,
            toggleAnimation: toggleAnimation,
            resetAnimation: resetAnimation,
            // 読み込んだアトラスの Object URL（textureFile -> URL）。
            // 中身を見せる側（アトラス表示など）が同じ画像を二重に展開しないで済むように公開する。
            getTextures: () => ({ ...textureUrls }),
            // パーツ単位の上書き（ファイルの内容は変えず、見え方と動きだけ止める）
            showPart: setPartShown,
            // レイヤー 1 枚の表示。(partID, フレーム識別子) は frameName があると
            // 1 枚を指さないので、宣言順の通し番号（data-layer-index）で指す。
            showLayer: (layerIndex, shown) => {
                const el = document.querySelector(`div.layer[data-layer-index="${layerIndex}"]`);
                if (el) setLayerVisible(el, shown);
            },
            setPartPlaying: setPartPlaying,
            isPartPlaying: partID => !isPartPaused(partID),
            // switch パーツの表示コマを選ぶ。識別子は frameName ?? textureID。
            setFrame: switchTexture,
            // v0.3.0: mapping.json による外部制御API
            setBlinkState: applyBlinkState,
            setViseme: applyViseme,
            setExpression: applyExpression,
            // v0.5.0: プリセット適用
            setPreset: applyPreset
        };
    }

    // 展開済みアトラスの Object URL。読み直すたびに revoke しないと、
    // 何度も読み込むページ（ビューアやデモ）で画像がメモリに残り続ける。
    // v0.1.0 互換の経路は同じ URL を "default" とファイル名の 2 か所に入れるので、
    // 捨てるときは重複を除くこと。
    let textureUrls = {};

    /**
     * 読み込みの結果を知らせる。`window` に飛ばすので、プレイヤーを
     * 単に `<script>` で読んだページからも拾える。
     *   emg:loaded { source, data, mapping, textures, version, containerId }
     *   emg:error  { source, error }
     */
    function emit(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    /*
     * 読み込みの通し番号。読み込みは非同期なので、前のものが終わる前に次を
     * 頼まれることがある（デモを続けて押す、読み込み中にファイルを落とす）。
     * 遅れて終わった古いほうが後から画面を書き換えると、レイヤーは新しい
     * ファイル・パーツ一覧は古いファイル、という混ざった状態になる。
     * 番号は「頼まれた順」に取り、差し替える直前に自分が最新か確かめる。
     */
    let loadTicket = 0;

    /**
     * 読み込みの進み具合を伝える（`emg:progress`）。
     *
     * `detail` は `{ source, phase, ratio }`。`phase` は `download`（取得）か
     * `extract`（ZIP からアトラスを取り出す）。`ratio` は 0〜1 で、
     * 長さが分からないときは `null`。
     *
     * 大きいファイルは表示までに十数秒かかり、その間ページは止まって見えます。
     * **古い読み込みの進捗は出しません**（`ticket` を照合する）。続けて
     * デモを押したときに、捨てるほうの数字で表示が巻き戻るため。
     */
    function emitProgress(ticket, source, phase, ratio) {
        if (ticket !== loadTicket) return;
        emit('emg:progress', { source, phase, ratio });
    }

    /**
     * 本文を読みながら進捗を出す。`Content-Length` が無ければ `ratio` は null。
     *
     * `response.blob()` を一息に待つのと結果は同じで、途中経過が取れる点だけが違う。
     */
    async function readBodyWithProgress(response, ticket, source) {
        const total = Number(response.headers.get('content-length')) || 0;
        if (!response.body || !total) {
            emitProgress(ticket, source, 'download', null);
            return await response.blob();
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            emitProgress(ticket, source, 'download', Math.min(1, received / total));
        }
        return new Blob(chunks, { type: response.headers.get('content-type') || '' });
    }

    async function loadEmgFromCDN(url, containerId = "layerContainer") {
        const ticket = ++loadTicket;
        try {
            console.log(`Loading EMG from: ${url}`);
            emitProgress(ticket, url, 'download', 0);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const body = await readBodyWithProgress(response, ticket, url);
            return await loadEmgFromBlob(body, containerId, url, ticket);
        } catch (error) {
            // 例外を投げ直さないのは、この関数を await せずに呼ぶ既存の埋め込みが
            // unhandled rejection を出すようになってしまうため。失敗は emg:error で伝える。
            console.error("Failed to load EMG:", error);
            emit('emg:error', { source: url, error });
            return false;
        }
    }

    async function loadEmgFromBlob(blob, containerId = "layerContainer", source = null, ticket = ++loadTicket) {
        const label = source ?? (blob && blob.name) ?? '(blob)';
        try {
            /*
             * 読めると分かるまで、いま表示しているものには手を付けない。
             * 先に消してしまうと、EMG でないファイルを渡されたときに
             * 画面だけ壊れて「何も出ていないのに理由が分からない」状態になる。
             * 差し替えは下の「ここから差し替え」以降でまとめて行う。
             */
            const zip = new JSZip();
            const zipContent = await zip.loadAsync(blob);

            // data.json を探す (ルートにあると仮定、あるいは .json で終わるファイル)
            const jsonFile = Object.keys(zipContent.files).find(name => name.endsWith("data.json")) ||
                Object.keys(zipContent.files).find(name => name.endsWith(".json") && !name.endsWith("mapping.json"));

            if (!jsonFile) {
                throw new Error("この .emg には data.json がありません（ZIP の中身が EMG ではないようです）");
            }

            const jsonText = await zipContent.files[jsonFile].async("text");
            const data = JSON.parse(jsonText);
            const version = data.version || "0.1.0";

            console.log(`EMG Version: ${version}`);

            // v0.4.0 §2.2: mapping やテクスチャの展開より前に判定する
            checkRequiredExtensions(data);

            // mapping.json (任意のコンパニオンファイル。無ければ無視する)
            let mapping = null;
            const mappingFile = Object.keys(zipContent.files).find(name => name.endsWith("mapping.json"));
            if (mappingFile) {
                try {
                    mapping = JSON.parse(await zipContent.files[mappingFile].async("text"));
                    console.log("mapping.json loaded:", mapping.avatarId);
                } catch (e) {
                    console.warn("Failed to parse mapping.json, ignoring:", e);
                    mapping = null;
                }
            }

            // 追い越されていたら、重いアトラスの展開に入る前にやめる。
            // （差し替え直前にもう一度照合する。下の「ここから差し替え」）
            if (ticket !== loadTicket) {
                console.log(`Load of '${label}' superseded by a newer load`);
                return false;
            }

            /*
             * アトラスの展開。**ここでもまだ画面にも window にも触らない。**
             *
             * 8192px 級のアトラスだと十数秒〜かかり、その間に利用者が別のファイルを
             * 選ぶ余地が十分にある。以前はこの手前で 1 度だけ照合して、そのあと
             * 展開・描画・emit を無条件に続けていたため、先に始まって後に終わった
             * ほうが、あとから来たファイルの表示を上書きしていた。
             * 症状は「パーツ一覧は新しいファイル、名前と絵は古いファイル、
             * アトラスは食い違って何も映らない」。
             */
            const textureBlobs = {};

            if (data.textures && Array.isArray(data.textures)) {
                // ここが一番長い。8192px 級のアトラスだと数秒〜十数秒かかるので、
                // JSZip の onUpdate をそのまま進捗として出す。複数枚あるときは
                // 「何枚目の何%」を全体の比に直す。
                const texCount = data.textures.length;
                for (const [i, texMeta] of data.textures.entries()) {
                    const fileName = texMeta.textureFile;
                    const fileInZip = Object.keys(zipContent.files).find(name => name.endsWith(fileName));
                    if (fileInZip) {
                        const blob = await zipContent.files[fileInZip].async("blob",
                            m => emitProgress(ticket, label, 'extract', (i + m.percent / 100) / texCount));
                        textureBlobs[fileName] = URL.createObjectURL(blob);
                    }
                }
            } else {
                // Fallback for v0.1.0 or simple structure
                const textureFiles = Object.keys(zipContent.files).filter(name => /\.(png|jpg|jpeg)$/i.test(name));
                for (const tf of textureFiles) {
                    const blob = await zipContent.files[tf].async("blob");
                    // パス区切り除去してファイル名だけにする簡易処理
                    const fileName = tf.split('/').pop();
                    textureBlobs[fileName] = URL.createObjectURL(blob);
                    // 0.1.0互換のため、デフォルトキーとしても登録
                    textureBlobs["default"] = textureBlobs[fileName];
                }
            }

            // ---- ここから差し替え ----
            // 展開の途中で追い越されていたら、ここで捨てる。作った Object URL は
            // 誰にも渡っていないので、放っておくとそのままリークする。
            if (ticket !== loadTicket) {
                console.log(`Load of '${label}' superseded by a newer load`);
                for (const url of new Set(Object.values(textureBlobs))) URL.revokeObjectURL(url);
                return false;
            }

            stopTimers();
            resetMappingState();
            // 前のファイルで消した／止めたパーツの指定は持ち越さない。
            hiddenParts.clear();
            pausedParts.clear();
            window.isAnimationRunning = true;
            window.jsonData = data;
            window.emgVersion = version;
            window.emgMapping = mapping;

            // 前のアトラスは、新しいものを作り終えてから捨てる。
            const previous = textureUrls;
            textureUrls = textureBlobs;
            for (const url of new Set(Object.values(previous))) URL.revokeObjectURL(url);

            renderLayers(data, textureBlobs, containerId);

            // mapping.json のパーツ役割解決（mapping が無ければ両方 null のまま）
            resolvePartRoles();

            startAnimation();

            emit('emg:loaded', {
                source: label,
                data: window.jsonData,
                mapping: window.emgMapping,
                textures: { ...textureUrls },
                version: window.emgVersion,
                containerId
            });
            return true;

        } catch (error) {
            console.error("Failed to load EMG:", error);
            emit('emg:error', { source: label, error });
            return false;
        }
    }

    // ------------------------------------------------------------------
    // v0.4.0 互換性規則（emg-json-spec-0.4.0.md 1〜2 章）
    // ------------------------------------------------------------------

    // この実装が理解する機能識別子（emg-extensions-registry.md）。
    // v0.4.0 の範囲では 1 つも実装していないため空。
    // EMG_frame_name:   v0.5.0 §2 の frameName に対応済み。
    // EMG_switch_none: v0.5.0 §4.3 の「switch を初期状態で非表示」に対応済み。
    // EMG_layer_transform: 0.5.3 §7.4.1 の targetLayer に対応済み。
    //   applyTransformToPart がフレーム識別子で対象レイヤーを絞る。
    const SUPPORTED_EXTENSIONS = new Set(
        ['EMG_frame_name', 'EMG_switch_none', 'EMG_layer_transform']);

    // blendMode（v0.4.0 §5.1 の 16 語 + 0.5.4 §10.11 の `plus-lighter`）。
    // このプレイヤーはレイヤーを div で描くので、値名がそのまま CSS の
    // `mix-blend-mode` に通る。**canvas と違い CSS は `plus-lighter` を持つ**ので、
    // 加算も色だけを足しつつアルファを保てる（§10.11.2 が要求する形）。
    // 定義済みでない値は `normal` として描く（§5.2）。
    const BLEND_MODES = new Set([
        'multiply', 'screen', 'overlay', 'darken', 'lighten',
        'color-dodge', 'color-burn', 'hard-light', 'soft-light',
        'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
        'plus-lighter',
    ]);
    const blendModeOf = m => (m && BLEND_MODES.has(m)) ? m : 'normal';

    // v0.5.0 §1.1: レイヤーのフレーム識別子。frameName が無ければ textureID と同一なので、
    // 従来のファイルでは解決結果が変わらない。
    // 参照の突き合わせは textureID ではなく必ずこちらで行う。
    function frameId(layer) {
        return layer.frameName != null ? layer.frameName : layer.textureID;
    }

    // F5: 未知の識別子が 1 つでもあれば読み込みを拒否する。
    // 理解できない拡張を黙って無視すると誤った絵になるため、明示的に失敗させる。
    function checkRequiredExtensions(jsonData) {
        const required = Array.isArray(jsonData.requiredExtensions) ? jsonData.requiredExtensions : [];
        const unknown = required.filter(e => !SUPPORTED_EXTENSIONS.has(e));
        if (unknown.length > 0) {
            throw new Error(
                `この .emg は未対応の機能を要求しています: ${unknown.join(', ')}。プレイヤーの更新が必要です。`);
        }
    }

    // F2: 未知の type は default を持つなら switch、持たないなら static として扱う。
    // 生の type で分岐すると、未知の値でパーツが消えるか全レイヤーが重なる。
    function resolvePartType(part) {
        if (part.type === 'static' || part.type === 'switch') return part.type;
        return part.default != null ? 'switch' : 'static';
    }

    // F3 / F4: 未知の値は既定へ倒す。trigger は「自律発火しない」側が安全。
    function resolveSequenceType(sequence) {
        const t = sequence && sequence.type;
        return (t === 'ordered' || t === 'random_hold') ? t : 'ordered';
    }

    function resolveTriggerType(trigger) {
        const t = trigger && trigger.type;
        return (t === 'auto_loop' || t === 'random_interval' || t === 'external') ? t : 'external';
    }

    // 4.2: fps は v0.4.0 で任意になった。不在時は 12。
    function resolveFps(sprite) {
        return (typeof sprite.fps === 'number' && sprite.fps > 0) ? sprite.fps : 12;
    }

    // ------------------------------------------------------------------
    // v0.5.0 §7: トランスフォーム
    // ------------------------------------------------------------------

    // 実行中のトランスフォーム sprite。requestAnimationFrame で毎フレーム評価する。
    let transformSprites = [];
    let transformRafId = null;
    let transformStart = 0;

    /** §7.5: cubic は Catmull-Rom に固定（制御点を持たない）。 */
    function catmullRom(p0, p1, p2, p3, u) {
        const u2 = u * u, u3 = u2 * u;
        return 0.5 * (2 * p1 + (-p0 + p2) * u
            + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
            + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    }

    /** §7.2: トラックの時刻 t（秒）における値。範囲外は端の値を保持する。 */
    function trackValueAt(track, t) {
        const keys = track.keys ?? [];
        if (keys.length === 0) return 0;
        if (keys.length === 1 || t <= keys[0].t) return keys[0].v;
        if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;

        let i = 0;
        while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
        const k0 = keys[i], k1 = keys[i + 1];
        const span = k1.t - k0.t;
        const u = span <= 0 ? 0 : (t - k0.t) / span;

        const interp = ['step', 'linear', 'cubic'].includes(track.interpolation)
            ? track.interpolation : 'linear';
        if (interp === 'step') return k0.v;
        if (interp === 'cubic') {
            return catmullRom(
                keys[Math.max(i - 1, 0)].v, k0.v, k1.v,
                keys[Math.min(i + 2, keys.length - 1)].v, u);
        }
        return k0.v + (k1.v - k0.v) * u;
    }

    /** §7.6 / §7.7: loop / pingpong / phaseOffset を解決して変換を求める。 */
    function resolveTransformAt(sprite, time) {
        const tracks = sprite.tracks ?? [];
        const r = { translate_x: 0, translate_y: 0, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 };
        if (tracks.length === 0) return r;

        const duration = sprite.duration > 0 ? sprite.duration
            : Math.max(0, ...tracks.flatMap(tr => (tr.keys ?? []).map(k => k.t)));
        let local = Math.max(0, time - (sprite.phaseOffset ?? 0));

        let t = 0;
        if (duration > 0) {
            const loop = ['once', 'loop', 'pingpong'].includes(sprite.loop) ? sprite.loop : 'loop';
            if (loop === 'once') t = Math.min(local, duration);
            else if (loop === 'pingpong') {
                const cycle = local % (2 * duration);
                t = cycle <= duration ? cycle : 2 * duration - cycle;
            } else t = local % duration;
        }

        for (const track of tracks) {
            if (track.path in r) r[track.path] = trackValueAt(track, t);
        }
        return r;
    }

    /**
     * §7.4: アンカーを原点へ移動 → scale → rotate → 戻す → translate、最後に opacity。
     * CSS の transform は右から左に適用されるため、記述順は逆にする。
     * transform-origin をアンカー（キャンバス座標）からレイヤー相対へ直して渡す。
     *
     * §7.4.1: targetLayer があれば、そのフレーム識別子を持つレイヤーだけが対象になる。
     * 一致するものが複数ありうる（frameName でまとめた組はまとめて動く）。
     * アンカーはレイヤーごとに独立しているため、絞り込んでも 1 枚ずつ読む点は変わらない。
     */
    function applyTransformToPart(partID, tf, targetLayer) {
        let layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        if (targetLayer != null) {
            layers = Array.prototype.filter.call(
                layers, el => el.dataset.frameId === targetLayer);
        }
        layers.forEach(el => {
            const ax = parseFloat(el.dataset.anchorX ?? '0') - parseFloat(el.dataset.baseX ?? '0');
            const ay = parseFloat(el.dataset.anchorY ?? '0') - parseFloat(el.dataset.baseY ?? '0');
            el.style.transformOrigin = `${ax}px ${ay}px`;
            el.style.transform =
                `translate(${tf.translate_x}px, ${tf.translate_y}px) ` +
                `rotate(${tf.rotation}deg) scale(${tf.scale_x}, ${tf.scale_y})`;
            const base = parseFloat(el.dataset.baseOpacity ?? '1');
            el.style.opacity = String(base * tf.opacity);
        });
    }

    /**
     * 時刻は sprite ごとに持ち、止めているパーツの分だけ進めない。
     * 開始時刻からの経過で出すと、止めても裏で時間が進み、戻した瞬間に飛ぶ。
     */
    function startTransformLoop() {
        if (transformSprites.length === 0) return;
        transformStart = performance.now();
        const tick = () => {
            if (!window.isAnimationRunning) { transformRafId = null; return; }
            const now = performance.now();
            const delta = Math.min((now - transformStart) / 1000, 0.1);   // タブ復帰時の飛びを抑える
            transformStart = now;
            for (const sp of transformSprites) {
                if (!pausedParts.has(sp.targetPartID)) sp._time = (sp._time ?? 0) + delta;
                applyTransformToPart(
                    sp.targetPartID, resolveTransformAt(sp, sp._time ?? 0), sp.targetLayer);
            }
            transformRafId = requestAnimationFrame(tick);
        };
        transformRafId = requestAnimationFrame(tick);
    }

    /**
     * 新しく作ったレイヤー div の初期値。
     *
     * **合成モードもここで入れること。** 以前は呼び出し側が
     * `mixBlendMode` を設定してからこれを呼んでいたため、既定値の `normal` で
     * 上書きされて合成モードが一切効かず、加算やスクリーンで乗せるはずの
     * エフェクトが素のまま重なって絵が暗くなっていた。引数で受け取れば
     * 順序に依存しない。
     */
    function applyLayerStyles(element, layer) {
        element.style.position = "absolute";
        element.style.backgroundRepeat = "no-repeat";
        element.style.backgroundSize = "cover"; // あるいはピクセル指定
        element.style.opacity = "1";
        // v0.4.0 §5 / 0.5.4 §10.11。未知の値は normal（§5.2）。
        element.style.mixBlendMode = blendModeOf(layer && layer.blendMode);
    }

    // ------------------------------------------------------------------
    // 外から掛ける「パーツ単位の上書き」
    //
    // ファイルが決めた状態（switch のどのフレームを出すか、sprite が回っているか）
    // とは別の層として持つ。混ぜると、消したパーツの上を sprite が次のコマで
    // 塗り直して勝手に復活する。
    // ------------------------------------------------------------------

    const hiddenParts = new Set();   // 利用者が消したパーツ
    const pausedParts = new Set();   // 利用者が止めたパーツ

    // 表示/非表示は display で行う。
    // 以前は opacity:0 で隠していたが、それだと (1) 非表示レイヤーも合成対象として残り
    // （senti は 36 レイヤー中 18 枚が常時非表示）、(2) レイヤー固有の不透明度
    // （data.json の layer.opacity）を上書きしてしまい反映できなかった。
    // opacity は layer.opacity 専用に使う。
    //
    // ファイル側が決めた「出すつもりかどうか」は dataset.on に残す。display だけだと、
    // パーツを消している間に切り替わったコマが分からず、再表示で古いコマに戻る。
    function setLayerVisible(el, visible) {
        el.dataset.on = visible ? '1' : '0';
        el.style.display = (visible && !hiddenParts.has(el.dataset.partId)) ? 'block' : 'none';
    }

    /** パーツごと消す / 戻す。戻したときはその時点のコマが出る。 */
    function setPartShown(partID, shown) {
        if (shown) hiddenParts.delete(partID); else hiddenParts.add(partID);
        document.querySelectorAll(`div[data-part-id="${partID}"]`).forEach(el => {
            el.style.display = (shown && el.dataset.on !== '0') ? 'block' : 'none';
        });
    }

    /** パーツごとに動きを止める / 動かす。止めた位置のコマと変形を保つ。 */
    function setPartPlaying(partID, playing) {
        if (playing) pausedParts.delete(partID); else pausedParts.add(partID);
    }

    function isPartPaused(partID) {
        return pausedParts.has(partID);
    }

    function renderLayers(jsonData, textureBlobs, containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container element '${containerId}' not found`);
            return;
        }
        container.innerHTML = '';

        let containerWidth = jsonData.baseCanvasWidth || 1920;
        let containerHeight = jsonData.baseCanvasHeight || 1080;
        container.style.width = `${containerWidth}px`;
        container.style.height = `${containerHeight}px`;
        container.style.position = 'relative';
        container.style.overflow = 'hidden';

        // レイヤーの通し番号。(partID, フレーム識別子) はレイヤーを一意に指さない
        // （frameName で複数レイヤーが同じ識別子を共有する）ので、
        // 1 枚を名指ししたい側のために宣言順の番号を振っておく。
        let layerIndex = 0;

        if (jsonData.parts) {
            // v0.2.2+ render logic
            jsonData.parts.forEach(part => {
                const partType = resolvePartType(part);   // v0.4.0 F2
                // v0.5.0 §4: defaultVisible は static / switch の両方で初期状態を決める。
                // switch では「初期状態でどのフレームも表示しない」を意味する（§4.3）。
                // チークや青ざめのように、排他バリエーションでありながら
                // 「どれも出ていない」のが常態である対象のための状態。
                const partVisible = part.defaultVisible !== false;
                // パーツコンテナを作成（必要に応じて）
                // レイヤーを展開
                part.layers.forEach(layer => {
                    const div = document.createElement('div');
                    div.classList.add('layer');
                    div.dataset.partId = part.partID;
                    div.dataset.type = partType;
                    div.dataset.layerIndex = String(layerIndex++);
                    div.id = layer.textureID; // 後方互換のため維持
                    // textureID はパーツ間で重複しうる（senti では "01" が Mouth/Eyes/Eyebrows に存在）ため、
                    // 切り替えの一致判定には id ではなく data 属性を使う。
                    div.dataset.textureId = layer.textureID;
                    // v0.5.0: 切り替えの単位はフレーム識別子（frameName ?? textureID）
                    div.dataset.frameId = frameId(layer);
                    // v0.5.0 §7.4: transform-origin を求めるためアンカーと基準位置を持つ。
                    // anchor は不在時 basePosition と同値（v0.4.0 §3.1）。
                    div.dataset.baseX = String(layer.basePosition_x);
                    div.dataset.baseY = String(layer.basePosition_y);
                    div.dataset.anchorX = String(layer.anchor_x ?? layer.basePosition_x);
                    div.dataset.anchorY = String(layer.anchor_y ?? layer.basePosition_y);
                    applyLayerStyles(div, layer);

                    div.style.width = `${layer.width}px`;
                    div.style.height = `${layer.height}px`;
                    div.style.left = `${layer.basePosition_x}px`;
                    div.style.top = `${layer.basePosition_y}px`;
                    div.style.zIndex = layer.textureZIndex || 0;

                    // テクスチャ適用
                    const texFile = layer.textureFile || jsonData.textures?.[0]?.textureFile || "default";
                    // textureFile名がパスを含む場合もあるので、textureBlobsのキーとマッチさせる工夫が必要
                    // ここでは簡易的に textureBlobs のキーをそのまま使用
                    let blobUrl = textureBlobs[texFile] || textureBlobs["default"];

                    // アトラス内の座標計算
                    // background-image: url(...)
                    // background-position: -x -y
                    // background-size: textureWidth textureHeight

                    if (blobUrl) {
                        div.style.backgroundImage = `url('${blobUrl}')`;
                        div.style.backgroundPosition = `-${layer.x}px -${layer.y}px`;

                        // テクスチャの全体サイズが必要
                        // jsonData.textures から探す
                        let texMeta = jsonData.textures?.find(t => t.textureFile === texFile);
                        if (!texMeta && jsonData.textures?.length > 0) texMeta = jsonData.textures[0];

                        // v0.1.0 互換
                        // TextureNum: [{ canvasWidth, canvasHeight }]
                        const texW = texMeta ? texMeta.width : (jsonData.TextureNum?.[0]?.canvasWidth || 2048);
                        const texH = texMeta ? texMeta.height : (jsonData.TextureNum?.[0]?.canvasHeight || 2048);

                        div.style.backgroundSize = `${texW}px ${texH}px`;
                    }

                    // レイヤー固有の不透明度（未指定なら 1）
                    const baseOpacity = (typeof layer.opacity === 'number') ? layer.opacity : 1;
                    div.dataset.baseOpacity = String(baseOpacity);
                    div.style.opacity = String(baseOpacity);

                    // type: switch の場合、default でないものは非表示
                    setLayerVisible(div,
                        partVisible && (partType !== 'switch' || frameId(layer) === part.default));

                    container.appendChild(div);
                });
            });
        } else if (jsonData.layers) {
            // v0.1.0 render logic (Reference existing code)
            const blobUrl = textureBlobs["default"];
            if (!blobUrl) return;

            jsonData.layers.forEach(layer => {
                const div = document.createElement('div');
                div.classList.add('layer');
                div.dataset.layerIndex = String(layerIndex++);
                applyLayerStyles(div);

                if (layer.imgType === 'Texture') {
                    div.id = layer.textureID;
                } else if (layer.imgType === 'Sprite') {
                    div.id = layer.assignID;
                }

                div.style.width = `${layer.width}px`;
                div.style.height = `${layer.height}px`;
                div.style.left = `${layer.basePosition_x}px`;
                div.style.top = `${layer.basePosition_y}px`;
                div.style.backgroundImage = `url('${blobUrl}')`;
                div.style.backgroundPosition = `-${layer.x}px -${layer.y}px`;
                div.style.backgroundSize = `${jsonData.TextureNum[0].canvasWidth}px ${jsonData.TextureNum[0].canvasHeight}px`;
                div.style.zIndex = layer.textureZIndex || 0;

                container.appendChild(div);
            });
        }
    }

    // ------------------------------------------------------------------
    // mapping.json (v0.3.0): パーツ役割解決・状態解決・外部制御API
    // 詳細な規範ロジックは emg-mapping-spec.md を参照
    // ------------------------------------------------------------------

    function findPartByKeyword(parts, keywords) {
        return parts.find(part =>
            resolvePartType(part) === 'switch' &&
            keywords.some(kw => part.partID.toLowerCase().includes(kw.toLowerCase()))
        );
    }

    function resolvePartRoles() {
        mappingState.blinkPartID = null;
        mappingState.blinkExplicit = false;
        mappingState.mouthPartID = null;
        mappingState.mouthExplicit = false;

        const parts = window.jsonData?.parts;
        if (!parts) return;

        const mapping = window.emgMapping;
        const base = mapping?.baseMapping;

        let blinkPartID = null;
        let blinkExplicit = false;
        let mouthPartID = null;
        let mouthExplicit = false;

        if (base) {
            // 1. blinkParts（フラットモード）のいずれかの値と一致するパーツ
            if (base.blinkParts) {
                const targets = Object.values(base.blinkParts).filter(Boolean);
                const found = parts.find(p => targets.includes(p.partID));
                if (found) { blinkPartID = found.partID; blinkExplicit = true; }
            }
            // 2. blinkPartKey と一致するパーツ
            if (!blinkPartID && base.blinkPartKey) {
                const found = parts.find(p => p.partID === base.blinkPartKey);
                if (found) { blinkPartID = found.partID; blinkExplicit = true; }
            }

            if (base.lipSyncParts) {
                const targets = Object.values(base.lipSyncParts).filter(Boolean);
                const found = parts.find(p => targets.includes(p.partID));
                if (found) { mouthPartID = found.partID; mouthExplicit = true; }
            }
            if (!mouthPartID && base.lipSyncPartKey) {
                const found = parts.find(p => p.partID === base.lipSyncPartKey);
                if (found) { mouthPartID = found.partID; mouthExplicit = true; }
            }
        }

        // 3/4. ヒューリスティックキーワードによるフォールバック（明示指定ではない = Explicit フラグは立てない）
        if (!blinkPartID) {
            const found = findPartByKeyword(parts, BLINK_KEYWORDS);
            if (found) blinkPartID = found.partID;
        }
        if (!mouthPartID) {
            const found = findPartByKeyword(parts, MOUTH_KEYWORDS);
            if (found) mouthPartID = found.partID;
        }

        // 5. blink役とmouth役の両方に該当する場合は mouth を優先
        if (blinkPartID && blinkPartID === mouthPartID) {
            blinkPartID = null;
            blinkExplicit = false;
        }

        mappingState.blinkPartID = blinkPartID;
        mappingState.blinkExplicit = blinkExplicit;
        mappingState.mouthPartID = mouthPartID;
        mappingState.mouthExplicit = mouthExplicit;
    }

    function findPart(partID) {
        return window.jsonData?.parts?.find(p => p.partID === partID) || null;
    }

    function applyBlinkState(state) {
        // state: 'open' | 'half' | 'closed'
        const mapping = window.emgMapping;
        const base = mapping?.baseMapping;
        const partID = mappingState.blinkPartID;
        if (!base || !partID) return;

        const part = findPart(partID);
        let textureID = null;

        // 表情オーバーライドが優先
        const override = mappingState.activeBlinkOverride;
        if (override && override[state]) {
            textureID = override[state];
        } else if (base.blinkParts) {
            // フラットモード: 状態に対応するパーツ自体を表示/非表示
            const targetPartID = base.blinkParts[state];
            if (targetPartID) {
                Object.values(base.blinkParts).filter(Boolean).forEach(pid => {
                    setPartVisible(pid, pid === targetPartID);
                });
            }
            return;
        } else if (base.blink && base.blink[state]) {
            textureID = base.blink[state];
        } else if (part && part.layers.length === 3) {
            // 既知の制限: 位置的フォールバックは3レイヤー構成のパーツにのみ適用
            const order = { open: 0, half: 1, closed: 2 };
            textureID = part.layers[order[state]]?.textureID || null;
        }

        if (textureID) switchTexture(partID, textureID);
    }

    function applyViseme(vowel) {
        // vowel: 'a' | 'i' | 'u' | 'e' | 'o' | 'n'
        const mapping = window.emgMapping;
        const base = mapping?.baseMapping;
        const partID = mappingState.mouthPartID;
        if (!base || !partID) return;

        const part = findPart(partID);

        const override = mappingState.activeLipSyncOverride;
        if (override && override[vowel]) {
            switchTexture(partID, override[vowel]);
            return;
        }

        if (base.lipSyncParts) {
            const targetPartID = base.lipSyncParts[vowel];
            if (targetPartID) {
                Object.values(base.lipSyncParts).filter(Boolean).forEach(pid => {
                    setPartVisible(pid, pid === targetPartID);
                });
            }
            return;
        }

        let textureID = base.lipSync?.[vowel] || base.lipSync?.open || null;

        if (!textureID && part) {
            // textureID に母音名を含むレイヤーを検索
            const found = part.layers.find(l => l.textureID.toLowerCase().includes(vowel));
            if (found) textureID = found.textureID;
        }
        if (!textureID && part) {
            textureID = part.default || part.layers[0]?.textureID || null;
        }

        if (textureID) switchTexture(partID, textureID);
    }

    function resolveExpressionsMap() {
        return window.emgMapping?.expressions || {};
    }

    function applyExpression(name) {
        const expressions = resolveExpressionsMap();
        const expr = expressions[name] || expressions['default'] || {};
        mappingState.currentExpression = expressions[name] ? name : 'default';

        // v0.5.0 §5.3: presetID を先に適用する。expr.parts が後から上書きするため優先される。
        if (expr.presetID) applyPreset(expr.presetID);

        // parts: partID -> 表示するレイヤーIDの配列
        if (expr.parts) {
            Object.entries(expr.parts).forEach(([partID, layerIDs]) => {
                if (!Array.isArray(layerIDs) || layerIDs.length === 0) return;
                const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
                layers.forEach(el => {
                    setLayerVisible(el, layerIDs.includes(el.dataset.frameId));
                });
            });
        }

        // eyebrow: partID "eyebrow" を持つパーツへの単一レイヤー指定として扱う
        if (expr.eyebrow) {
            switchTexture('eyebrow', expr.eyebrow);
        }

        // other: 個々のレイヤーIDを直接表示（同じパーツの他レイヤーは非表示にする）
        if (Array.isArray(expr.other)) {
            expr.other.forEach(layerID => {
                const el = document.querySelector(`div.layer[data-frame-id="${layerID}"]`);
                if (el && el.dataset.partId) {
                    switchTexture(el.dataset.partId, layerID);
                }
            });
        }

        // この表情専用の blink / lipSync 差し替え
        mappingState.activeBlinkOverride = expr.overrides?.blink || null;
        mappingState.activeLipSyncOverride = expr.overrides?.lipSync || null;
    }

    // v0.5.0 §4: パーツ全体が非表示か（レイヤーが 1 枚も表示されていない状態）
    // 見るのは display ではなく dataset.on。利用者が手で消しただけのパーツを
    // ここで拾うと、§4.5 の「非表示のパーツは sprite を発火しない」に引っかかって
    // 再表示しても二度と動かなくなる。
    function isPartHidden(partID) {
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        if (layers.length === 0) return false;
        return [...layers].every(el => el.dataset.on === '0');
    }

    /**
     * v0.5.0 §5.2: プリセットを適用する。
     * parts / toggles に現れない partID の状態は変更しない。
     */
    function applyPreset(presetID) {
        const preset = (window.jsonData?.presets ?? []).find(p => p.presetID === presetID);
        if (!preset) {
            console.warn(`preset '${presetID}' が見つかりません`);
            return;
        }
        for (const [partID, frame] of Object.entries(preset.parts ?? {})) {
            switchTexture(partID, frame);
        }
        for (const [partID, visible] of Object.entries(preset.toggles ?? {})) {
            setPartVisible(partID, visible);
        }
    }

    function setPartVisible(partID, visible) {
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        layers.forEach(el => {
            setLayerVisible(el, visible);
        });
    }

    function startAnimation() {
        if (!window.isAnimationRunning) return;
        if (!window.jsonData) return;

        stopTimers();

        // v0.5.0 §7: tracks を持つ sprite は毎フレーム評価する経路へ回す。
        transformSprites = (window.jsonData.sprites ?? [])
            .filter(sp => Array.isArray(sp.tracks) && sp.tracks.length > 0)
            .filter(sp => !isPartHidden(sp.targetPartID));

        // §7.4.1 規則 2: targetLayer は対象パーツに実在するフレーム識別子でなければならない。
        // 一致しなければ動きが丸ごと消えるだけで絵は成立するので、拒否せず警告に留める。
        for (const sp of transformSprites) {
            if (sp.targetLayer == null) continue;
            const found = document.querySelector(
                `div[data-part-id="${sp.targetPartID}"][data-frame-id="${sp.targetLayer}"]`);
            if (!found) {
                console.warn(
                    `Sprite '${sp.spriteID}': targetLayer '${sp.targetLayer}' が ` +
                    `パーツ '${sp.targetPartID}' に存在しません。この変換は何にも適用されません。`);
            }
        }
        startTransformLoop();

        if (window.jsonData.sprites) {
            window.jsonData.sprites.forEach(sprite => {
                // mapping.json との共存ルール: 明示的に blink/lipSync 対象指定されたパーツは
                // sprites[] 側の自律発火を行ってはならない (MUST NOT trigger)
                // v0.5.0 §4.5: 非表示のパーツを対象とする sprite は発火してはならない
                if (isPartHidden(sprite.targetPartID)) {
                    console.log(`Sprite '${sprite.spriteID}' suppressed: part '${sprite.targetPartID}' is hidden`);
                    return;
                }
                if (
                    (sprite.targetPartID === mappingState.blinkPartID && mappingState.blinkExplicit) ||
                    (sprite.targetPartID === mappingState.mouthPartID && mappingState.mouthExplicit)
                ) {
                    console.log(`Sprite '${sprite.spriteID}' suppressed: targetPartID '${sprite.targetPartID}' is under mapping.json control`);
                    return;
                }
                handleSprite(sprite);
            });
        }
    }

    function handleSprite(sprite) {
        // v0.2.2 structured sprite
        const { spriteID, targetPartID, sequence, trigger } = sprite;
        // tracks のみを持つ sprite はトランスフォーム経路が扱う（§7.8 で併用は許容）
        if (!sequence) return;

        // Target Parts
        // partIDに属する全レイヤーのElementを取得しておく
        if (!targetPartID) return;

        // v0.4.0: 未知の列挙値と fps 不在をここで正規化してから使う（F3 / F4 / 4.2）
        const sequenceType = resolveSequenceType(sequence);
        const triggerType = trigger ? resolveTriggerType(trigger) : null;
        const frameMs = 1000 / resolveFps(sprite);

        // v0.5.0 §6.1: keys と frames は排他。keys があればそちらを使う。
        const keys = Array.isArray(sequence.keys) && sequence.keys.length > 0 ? sequence.keys : null;
        const frames = keys ? keys.map(k => k.frame) : (sequence.frames ?? []);

        const runSequence = () => {
            // sequence.type: "ordered", "random_hold"
            if (sequenceType === 'ordered') {
                if (keys) playKeyedSequence(targetPartID, keys, triggerType === 'auto_loop');
                else playOrderedSequence(targetPartID, frames, frameMs, triggerType === 'auto_loop');
            } else if (sequenceType === 'random_hold') {
                const pick = frames[Math.floor(Math.random() * frames.length)];
                switchTexture(targetPartID, pick);
            }
        };

        // Trigger logic
        if (!trigger) return; // External only

        if (triggerType === 'auto_loop') {
            // すぐに開始してループ
            if (sequenceType === 'ordered') {
                if (keys) playKeyedSequence(targetPartID, keys, true);
                else playOrderedSequence(targetPartID, frames, frameMs, true);
            } else {
                // random_hold loop? not meaningful usually, basically static random
                runSequence();
            }
        } else if (triggerType === 'random_interval') {
            const scheduleNext = () => {
                if (!window.isAnimationRunning) return;
                if (pausedParts.has(targetPartID)) { later(scheduleNext, HOLD_MS); return; }
                const min = trigger.intervalMin || 1.0;
                const max = trigger.intervalMax || 5.0;
                const delay = (min + Math.random() * (max - min)) * 1000;

                const tm = setTimeout(() => {
                    runSequence();
                    scheduleNext();
                }, delay);
                window.timeouts.push(tm);
            };
            scheduleNext();
        }
    }

    function switchTexture(partID, textureID) {
        // partIDを持つ全レイヤーを探し、textureIDに一致するものだけ表示
        // v0.5.0 §2.2: 選ばれたフレーム識別子を持つレイヤーを *すべて* 表示する。
        // frameName の無いファイルでは 1 枚しか一致しないため従来と同じ挙動になる。
        const layers = document.querySelectorAll(`div[data-part-id="${partID}"]`);
        layers.forEach(el => {
            setLayerVisible(el, el.dataset.frameId === textureID);
        });
    }

    /** 止めているパーツの間だけ待つ。止めた時点のコマを保つ。 */
    const HOLD_MS = 100;
    function later(fn, ms) {
        const tm = setTimeout(fn, ms);
        window.timeouts.push(tm);
    }

    /**
     * v0.5.0 §6: 不等間隔のキー列を再生する。
     * 各キーの t（秒・再生開始からの絶対時刻）でフレームを切り替える。
     * 尺は最後のキーの t（§6.4）。
     *
     * キーごとに 1 本ずつタイマーを張るのではなく 1 本の鎖にしてある。
     * まとめて張ると、途中で止めたときに待っているタイマーを持てず、
     * 再開したときに溜まった分が一度に発火する。
     */
    function playKeyedSequence(partID, keys, loop) {
        if (!Array.isArray(keys) || keys.length === 0) return;

        let i = 0;
        const step = () => {
            if (!window.isAnimationRunning) return;
            if (pausedParts.has(partID)) { later(step, HOLD_MS); return; }

            switchTexture(partID, keys[i].frame);
            const isLast = i === keys.length - 1;
            if (isLast && !loop) return;
            // 最後のキーから先頭へ戻る間隔は、尺（最後のキーの t）から最後のキーまでの残り。
            const wait = isLast ? 0 : (keys[i + 1].t - keys[i].t) * 1000;
            i = isLast ? 0 : i + 1;
            later(step, Math.max(wait, 0));
        };
        step();
    }

    function playOrderedSequence(partID, frames, frameInterval, loop) {
        let idx = 0;

        function nextFrame() {
            if (!window.isAnimationRunning) return;
            if (pausedParts.has(partID)) { later(nextFrame, HOLD_MS); return; }
            if (idx >= frames.length) {
                if (loop) {
                    idx = 0;
                } else {
                    return; // End of sequence
                }
            }

            switchTexture(partID, frames[idx]);
            idx++;

            const tm = setTimeout(nextFrame, frameInterval);
            window.timeouts.push(tm);
        }
        nextFrame();
    }

    function toggleAnimation() {
        window.isAnimationRunning = !window.isAnimationRunning;
        const button = document.getElementById('toggleAnimationButton');
        if (button) {
            button.textContent = window.isAnimationRunning ? "アニメーション一時停止" : "アニメーション再開";
        }

        if (window.isAnimationRunning) {
            startAnimation();
        } else {
            stopTimers();
        }
    }

    function resetAnimation() {
        window.isAnimationRunning = false;
        stopTimers();

        const container = document.getElementById('layerContainer');
        if (container) {
            container.innerHTML = '';
        }
    }

})();
