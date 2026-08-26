# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This is a monorepo for **EMG (easy Movable Graphic)**, a lightweight, engine-agnostic format for distributing part-based 2D character art (eyes/mouth swaps, texture-atlas rendering) so the same avatar can be played back in a browser, OBS, AviUtl, Ren'Py, or Unity without re-authoring. An `.emg` file is a ZIP containing `data.json` (parts/layers/textures/sprites metadata) plus one or more texture atlas PNGs.

There is no root build system — each subdirectory below is an **independent npm/Unity/Ren'Py project** with its own `package.json` (or none). Always `cd` into the relevant subdirectory before running install/dev/build commands; there is no workspace tooling tying them together.

| Directory | What it is | Stack |
|---|---|---|
| `emg-packer/` | Electron desktop app: loads a PSD (or `.kra`), lets the user assign `partID`/`type` per layer, packs a texture atlas, and exports a `.emg` file. **`emg-editor` forked from this at v0.1.5** — see "Two packer codebases" below | Electron + Vite (electron-vite) + React + TypeScript, `ag-psd` |
| `emg-editor/` | Fork of `emg-packer` at v0.1.5, renamed and versioned independently (0.2.0). The product that gets developed further: parts-level editing, multi-source import, animation authoring. **Its `services/` is a copy, not a share** | same as `emg-packer` |
| `emg-web-runtime/` | Browser app for playing/authoring EMG avatars (states, variants, undo history) — WIP. Note `npm run build` runs `tsc` first, so a type error blocks deployment entirely (this silently broke Pages for ~6 months) | Vite + React + TypeScript + styled-components |
| `emg-lite/` | Spec + adapter + tools for **EMG-lite** (`.emgl`), a *separate*, simpler 5-slot avatar IR (base/mouthOpen/mouthClosed/eyesOpen/eyesClosed) distinct from full EMG — see "Two coexisting specs" below | Spec docs + `adapter/png-adapter.ts` + `tools/emg-viewer` (Vite + Electron) |
| `emg-cdn/` | Deployable reference player (`emg-player.0.1.0.js`, `.0.2.2.js`, `.0.3.0.js` — **0.3.0 is current**, adds `mapping.json`) and demo page | Vanilla JS + JSZip, no build step |
| `emg-unity-importer/` | Unity Editor/Runtime package that imports `.emg` files (`EmgImporter.cs`, `EmgController.cs`, `EmgData.cs`, `EmgMapping.cs`) — WIP, never compiled (no Unity here) | C# (Unity Editor/Runtime asmdefs) |
| `emg-renpy/` | Ren'Py loader script (`emg_loader.rpy`) for playing EMG avatars inside a Ren'Py game | Ren'Py `.rpy` |
| `emg-godot/` | Godot 4.x loader (`emg_avatar.gd`, `class_name EmgAvatar`) — written but **never run** (no Godot editor here) | GDScript |
| `emg-ymm4/` | YMM4 (ゆっくりムービーメーカー4) Tachie plugin loading `.emg` — **builds and runs; verified in the real app** (display, blink, vowel lip-sync, layer-picker UI). See "emg-ymm4" below | C# `net10.0-windows`; `Emg.Core/` sub-library is YMM4-independent |
| `emg-web-packer/` | Browser-only PSD/KRA → `.emg` converter (no server, no install). Reuses **`emg-packer`**'s services via a Vite alias rather than copying them — it stays on `emg-packer`, not `emg-editor` — see its `README.md` | Vite + React + TypeScript |
| `aviutl-for-egml/` | Electron/React app that imports EMG-lite assets and exports AviUtl `.exo` project/timeline data | Electron + Vite + React + TypeScript + Tailwind + Zustand |
| `develop/` | Standalone integration/dev HTML+CSS+JS sandbox (no build) | Vanilla |
| `doc/` | Spec/design docs (packer, Ren'Py, Unity importer, upstream contribution plans, YMM4 verification) — **intentionally gitignored, local-only**, not part of the tracked repo for other clones | Markdown |
| `samples/` | Sample EMG data (`avatar.json`, `states.json`, `senti.emg`, assets) | Data |

Top-level spec docs: `emg-json-spec.md` (full EMG v0.3.0 JSON schema, normative — `data.json` root structure), `emg-mapping-spec.md` (v0.3.0 `mapping.json` companion-file schema for expression/blink/lip-sync semantics), and `emg-spec-intent.md` (design rationale — read this to understand *why* a field exists, not just what it is).

`emg-json-spec-0.4.0.md` and `emg-json-spec-0.5.0.md` are **draft delta specs**, each defined against the previous version rather than replacing it — v0.3.0 stays the single baseline.

- **0.4.0** adds no expressive power. It adds the compatibility rules v0.3.0 never had (how to treat unknown fields and unknown enum values), `requiredExtensions[]`, and `layers[].anchor_*`, and relaxes `sprites[].fps` to optional. This is groundwork that has to ship *before* implementations are widely distributed, because a forward-compatibility rule cannot retroactively change binaries already in the wild. Its §9.2 experiment (measuring how the existing six consumers actually react to unknown values) must be run before its §1.2 wording is settled.
`emg-spec-diff-0.3.0-to-0.4.0.md` compares the two side by side — read it before touching a consumer, since the F2 rule (unknown `parts[].type` resolves by whether the part has a `default`) is the one change that alters rendering behaviour.

`emg-extensions-registry.md` is the single list of feature identifiers usable in `requiredExtensions[]`. Identifiers accrue across versions, so they live here rather than in any one spec. The rule that matters: declare an identifier only when an implementation that ignores the feature would draw the *wrong* picture — never when it merely fails to animate or leaves a toggle on. Two entries: `EMG_frame_name` and `EMG_switch_none`.

- **0.5.0** adds the expressiveness: `frameName` (layers that switch together), `control`, `defaultVisible` (independent toggles), `presets[]`, `sequence.keys[]` (non-uniform timing), and `tracks[]` (transforms). Its load-bearing idea is the **frame identifier** — `frameName` if present, else `textureID` — which every reference resolves against, including `mapping.json`'s; that is what lets `frameName` exist without changing the meaning of any older file. §7 (transforms) is separable and costs more to implement than §2–6 combined, so shipping §2–6 alone is still conformant.

A consolidated, non-normative field reference for the whole v0.5.0 surface (every field with the version that introduced it) is published as an artifact rather than kept in the repo; ask the user for the link if you need it.

## Read this first — the spec facts everything depends on

Before touching any producer or consumer, know these. **Each one has already caused a real bug in this repo**, and none of them are guessable from the code.

1. **`static` vs `switch` is the branch point in all six consumers.** `static` draws every layer in the part; `switch` draws exactly one frame. Getting this wrong on one part silently produces a wrong picture, not an error — a group of differentials treated as `static` stacks all variants on top of each other, and a multi-layer body treated as `switch` renders one layer out of ten.
2. **The frame identifier is `frameName ?? textureID`.** Every reference resolves against it: `parts[].default`, `sequence.frames[]`, `sequence.keys[].frame`, `presets[].parts`, and `mapping.json`'s blink/lipSync entries. Never resolve a reference as a bare `textureID`.
3. **A layer is only unique as `(partID, frame identifier)`.** `textureID` repeats across parts in real files (`"01"` exists in `Mouth`, `Eyes` and `Eyebrows` in senti). Storing a bare `textureID` picks whichever part is enumerated first — that is the "eyebrows are blinking" bug.
4. **Two coordinate systems.** `x`/`y`/`width`/`height` are **atlas pixels** (where to sample); `basePosition_x`/`_y` are **canvas coordinates** (where to draw).
5. **`textureZIndex` is a single file-wide order, drawn ascending (back to front).** Never draw part-by-part — that breaks overlaps that cross parts. Equal values are undefined in order.
6. **Never branch on `version`** (rule B1) — decide structure by field presence. Real files lie: `yuriko.emg` claims `0.2.2` while holding the pre-0.2 flat schema.
7. **`requiredExtensions[]` is declared only when ignoring the feature would draw the *wrong* picture** — never for "does not animate" or "toggle stays on". Over-declaring locks out working implementations for no reason.
8. **`mapping.json` takes control of the parts it explicitly names.** A `sprites[]` entry with the same `targetPartID` must not self-trigger (omit `trigger`, which means "must not autoplay").
9. **One texture atlas is the premise, not a preference.** All sources pack into a single atlas; split to multiple only when 8192px genuinely cannot hold it, and tell the user when that happens.

## Spec versioning until alpha

**Until the alpha release, the spec is revised in place within `0.5.x` — `0.5.1`, `0.5.2`, … Do not open `0.6.0`.**

This is deliberate. Nothing is publicly distributed yet, so this is the only window in which a forward-compatibility rule, an enum's meaning, or a normative "MUST ignore" can still be corrected without stranding files already in the wild. That is the entire reason 0.4.0 exists as its own version, and the reason its §9.2 measurement had to run before its §1.2 wording was settled. Once alpha ships, the freedom is gone.

Consequences:

- A revision **amends `emg-json-spec-0.5.0.md`** and gets a dated row in its version-history table saying what changed and what was retracted. The 2026-08-25 change (extending `defaultVisible` to `switch`, adding `EMG_switch_none`) is the first such revision, and retracted a "MUST ignore" clause from the initial draft — exactly the kind of change that becomes impossible after alpha.
- Producers write the current `0.5.x` into `version`; consumers still must not branch on it (rule 6 above). `EmgGenerator` currently emits `0.5.0` in both packers.
- **A revision that changes rendering behaviour must land in all six consumers plus both packers in the same pass.** There is no build-time check for this drift, and `emg-packer` / `emg-editor` / `emg-web-packer` are three separate producer code paths (see "Two packer codebases").
- `tools/emg-validate.js` and `emg-extensions-registry.md` are part of the same pass — a new rule that the validator does not check is a rule that will be broken silently.

## Common commands

Each JS/TS project uses its own `package.json` in its own directory (`npm install` once per project you touch):

```bash
# emg-packer (Electron packer app) / emg-editor (its fork; same commands)
cd emg-packer   # or: cd emg-editor
npm install
npm run dev      # electron-vite dev — launches the Electron app
npm run build    # electron-vite build
npm run electron:build   # electron-vite build && electron-builder (produces installer)

# emg-web-runtime (browser avatar runtime/editor)
cd emg-web-runtime
npm install
npm run dev      # vite dev server
npm run build    # tsc && vite build

# aviutl-for-egml (EMG-lite -> AviUtl exporter)
cd aviutl-for-egml
npm install
npm run dev
npm run build     # tsc && vite build && electron-builder
npm run lint      # eslint . --ext ts,tsx --max-warnings 0

# emg-lite/tools/emg-viewer (EMG-lite viewer/editor, Electron)
cd emg-lite/tools/emg-viewer
npm install
npm run dev
npm run build
npm run electron:dev   # concurrently runs vite dev + electron
npm run dist:exe       # build + electron-builder --win
```

There is **no test suite** in this repository (no `*.test.*`/`*.spec.*` files, no `test` script in any `package.json`) and no root linter — treat manual verification (running the relevant Electron/Vite app) as the way to check a change. `aviutl-for-egml` is the only project with an `eslint` script.

`emg-unity-importer` is a Unity package (no npm build) — changes are verified by importing the package into a Unity project. `emg-renpy` and `emg-cdn` have no build step; `emg-cdn` is served as static files and `emg-renpy`'s `.rpy` is loaded directly by Ren'Py.

```bash
# emg-ymm4 (YMM4 plugin) — needs .NET 10 SDK + a local YMM4 install
cd emg-ymm4
cp Directory.Build.props.sample Directory.Build.props   # then set YMM4DirPath
dotnet build emg-ymm4.slnx    # post-build copies the DLLs into YMM4's user/plugin/
```

### Deployment

One workflow (`.github/workflows/github-pages.yml`) handles GitHub Pages. It publishes:

```
/          → emg-cdn        /runtime/  → emg-web-runtime        /packer/  → emg-web-packer
```

To take the site down again, swap the build steps for the "準備中" placeholder
(`.github/pages-placeholder/index.html`) — see the comment at the top of the workflow.

Pages background you need before touching this:
- The repo's Pages **cannot be disabled via the API** (`DELETE .../pages` → 422 "not allowed"),
  which is why the site is neutralised by swapping its content rather than turning it off.
- Pages source was switched from `legacy` (gh-pages branch) to `build_type: workflow`.
  The stale `gh-pages` branch is intentionally **left in place as a rollback path**.
- `pxrllc/NewScopeDaily` is a **separate repo with its own independent Pages site**;
  nothing here affects it (verified). There is no `pxrllc.github.io` org site.

## Architecture notes

### The EMG format (v0.3.0) — what the tools produce/consume

An `.emg` file is a ZIP: `data.json` + `texture.png` (or `texture_0.png`, `texture_1.png`, ... if split across multiple atlases), plus an optional `mapping.json` companion file (v0.3.0+, see below). Root JSON shape (`data.json`):

```
version, baseCanvasWidth, baseCanvasHeight,
textures: [{ textureFile, width, height }],
parts:    [{ partID, type: 'static'|'switch', default?, layers: [...] }],
sprites:  [{ spriteID, targetPartID, sequence, trigger? }]
```

- **`static` vs `switch`** parts is a load-bearing distinction throughout every consumer (packer, web runtime, Unity importer, Ren'Py loader, CDN player): `static` parts always render; `switch` parts render exactly one of their `layers` at a time, chosen by `default` or external control.
- **`sprites[].trigger.type`** is `auto_loop` (player-driven loop), `random_interval` (player-driven, randomized timing), or `external` (driven by host code — e.g. lip sync).
- Layer positions are given twice: `x/y/width/height` are **atlas-pixel coordinates** (where to sample from the texture), `basePosition_x/basePosition_y` are **canvas coordinates** (where to draw it). Don't confuse the two when touching packing/rendering code.
- `emg-json-spec.md` is the normative schema reference for `data.json`; `emg-spec-intent.md` explains *why* (texture atlasing for draw-call reduction, `partID` decoupled from PSD layer names so artists can rename freely, `static`/`switch` split to keep player logic simple, etc.) — consult it before proposing schema changes.
- **`mapping.json`** (optional companion file, v0.3.0+, spec'd in `emg-mapping-spec.md`) adds expression/blink/lip-sync *semantics* on top of `data.json`'s structural `parts[]`/`layers[]`. It is **implemented in every consumer**: `emg-cdn/emg-player.0.3.0.js`, `emg-web-runtime`, `emg-unity-importer`, `emg-godot`, `emg-ymm4`. Where a `partID` is explicitly targeted by `mapping.json`'s blink/lipSync mapping, any `sprites[]` entry with the same `targetPartID` MUST NOT self-trigger; `mapping.json` takes control of that part instead.

### Real-world `.emg` files break naive assumptions

Test files in `emg-packer/asset/` (gitignored) are the ground truth for what actually ships, and they are messier than the spec examples. Check against them before trusting a heuristic:

- **`textureID` is often just a number** (`"14"`, `"24"`, `"15_1"`), so nothing can be inferred from layer names. Any "guess the vowel/closed-eye from the name" logic must degrade to *disabled*, never to a wrong guess.
- **The same `textureID` repeats across parts.** In `himari3.emg`, `"1"`–`"5"` exist in 眉/口/目 and `"6"`–`"14"` in 口/目. **A layer reference is only unique as `(partID, textureID)`** — storing a bare `textureID` picks whichever part is enumerated first (this caused a real "eyebrows are blinking" bug).
- **z-order is inverted in every file exported before the traversal-order fix** (`himari3.emg` gives the body the frontmost `textureZIndex`; so do `senti_02.emg` and `senti_030.emg`). Root cause is the `ag-psd` child ordering described under "emg-packer internals". `emg-ymm4` exposes a "Z-Index反転" toggle to work around such files. Confirmed again in `senti_02.emg`, where drawing in spec order (ascending = back to front) puts the body over the face; the fix applied to the bundled demo was to **normalise the file** (`z' = maxZ - z`) rather than add another toggle.
- **A whole avatar may be a single `switch` part** (`senti.emg`: 36 layers, one part), so per-part role detection finds nothing. This is a **producer-side defect, already fixed**: `recalculateMeta()` used to walk only `root.children`, collapsing every nested group into one part; commit `e4306a7` made it recurse. Files exported before that fix stay broken — the correctly-parted export of the same character is `senti_02.emg` (`Body`/`arms`/`Mouth`/`Blushs`/`Eyes`/`Eyebrows`/`Character`), which is what `emg-cdn/assets/senti-demo.emg` is built from. **Re-export such files rather than teaching consumers to cope**; the alternative is layer-level (`textureID`) filtering inside a `static` part, which nothing in this repo implements.
- A `version` field can lie: `yuriko.emg` claimed `0.2.2` while holding the pre-0.2 flat `layers[]`/`uv` schema.
- **Store the atlas PNG uncompressed.** `EmgGenerator` calls `zip.generateAsync({ type: 'blob' })` with no `compression` option, so JSZip's default STORE applies. PNG is already deflated, so re-compressing buys ~0.3% and costs decode time on every load. Any hand-built `.emg` should match this.

### Reference player (`emg-cdn/emg-player.0.3.0.js`)

- **Visibility is `display`, opacity is data.** Layers are shown/hidden with `display: block|none`
  (`setLayerVisible`); `style.opacity` is reserved for the layer's own `layer.opacity` from
  `data.json`. These were previously the same channel, so per-layer opacity never took effect and
  hidden layers stayed in the compositing tree.
- **Match layers on `dataset.textureId`, not `el.id`.** `textureID` repeats across parts, so
  `div.id` is not unique (senti has `"01"` in `Mouth`, `Eyes` and `Eyebrows`). `div.id` is still set
  for backwards compatibility, but every lookup goes through `data-part-id` + `data-texture-id`.
- The JSON entry is found by `endsWith("data.json")` with a fallback to any non-`mapping.json`
  `.json`, so both `data.json` and `model.json` work.

### Verifying player changes in a browser

The reference player is only meaningfully testable with a **foreground** tab. JSZip's `.async()`
chunks its work across timers, and Chrome throttles timers in hidden tabs to roughly one tick per
minute — a background tab therefore appears to hang while loading, and `Page.captureScreenshot`
times out with "renderer may be frozen". It is neither frozen nor a JSZip bug. Keep the tab
foregrounded (an input action such as click/hover reactivates it) before concluding anything about
load performance. For pure geometry/z-order questions, rendering the composite offline (extract the
zip, draw the layers with any 2D library) is faster and avoids the issue entirely.

### Two coexisting, structurally different specs — don't conflate them

The repo hosts **two separate avatar formats** that share a name prefix but are not interchangeable:

1. **Full EMG** (`.emg`, `emg-json-spec.md`) — the `version`/`textures[]`/`parts[]`/`sprites[]` schema above. Reference player: `emg-cdn/emg-player.0.3.0.js`. Consumed by `emg-packer` (producer), `emg-web-runtime`, `emg-unity-importer`, `emg-renpy`, `emg-godot`, `emg-ymm4`.
2. **EMG-lite** (`.emgl`, spec under `emg-lite/tools/emg-viewer/docs/`) — a simpler 5-slot state IR (`base`/`mouthOpen`/`mouthClosed`/`eyesOpen`/`eyesClosed`) meant as a rendering-agnostic internal representation, not a texture-atlas format. Consumed by `emg-lite/adapter/png-adapter.ts`, `emg-lite/tools/emg-viewer`, and `aviutl-for-egml` (which imports EMG-lite assets to export AviUtl `.exo` timelines).

When working in `emg-lite/` or `aviutl-for-egml/`, you're in the EMG-lite world (5-slot, `AvatarData`/`assetsRoot`/`mapping`), not the full-EMG world (`parts[]`/`textures[]`). Don't confuse EMG-lite's `mapping: Record<string, AvatarLayerMap>` with full EMG's `mapping.json` (`emg-mapping-spec.md`) — same word, unrelated schemas. See `doc/emg_upstream_contribution_plan.md` for the original field-by-field comparison and rationale behind the `mapping.json` extension.

### Two packer codebases — `emg-packer` and `emg-editor`

`emg-editor` was **forked from `emg-packer` at v0.1.5** (2026-08-26) and is now a separate product with its own version line (0.2.0). Everything under "emg-packer internals" below describes both, because the fork was a verbatim copy.

| | `emg-packer` | `emg-editor` |
|---|---|---|
| Role | PSD → `.emg` converter | avatar editor; the one that gets developed further |
| `services/` | the copy `emg-web-packer` aliases | an **independent copy** |
| Browser build | `emg-web-packer` (`@packer` alias) | none |

**`emg-web-packer` still aliases `emg-packer`, not `emg-editor`.** Its `vite.config.ts`, `tsconfig.json` `paths`, `server.fs.allow` and `include` all point at `emg-packer/src/renderer/services`. Do not repoint them without being asked — the browser tool is a *converter*, which is what `emg-packer` is.

**Spec changes and `services/` bug fixes must be applied to both.** A new field, a `requiredExtensions` identifier, or a `TexturePacker`/`EmgGenerator` fix landing in only one of them makes the same PSD produce different `.emg` files. There is no build-time check for this drift; the three copies to keep in step for producer-side spec work are `emg-packer`, `emg-editor`, and `emg-web-packer`'s own `analyze.ts`/`convert.ts`.

### emg-packer internals (PSD → `.emg`)

Applies to `emg-editor` identically unless noted.

Flow: `PsdLoader` (parses PSD via `ag-psd`, injects `_partName` from top-level group names as a starting hint) → user assigns `partID`/`type`/`default` per layer in the UI (`App.tsx` state, `LayerMeta` in `types.ts`) → `TexturePacker` (shelf packing, power-of-two sizing, `startSize = 2048`, `maxSize = 8192`) → `EmgGenerator.createData()`/`generate()` builds the v0.3.0 JSON and zips it with the atlas PNG (plus a `mapping.json` draft from `MappingGenerator`, when blink/mouth parts can be detected) via JSZip.

z-order: `TexturePacker` sorts items by height, so packing order carries no z information. `useEmgPacker` therefore computes the `zIndex` itself and passes it in on `ExportItem`. `EmgGenerator.ts` still carries a long stale comment trail claiming this is unsolved — **the comments are out of date; the caller supplies z-order.**

**`ag-psd` orders `children` bottom-to-top — index 0 is the *backmost* layer**, verified against `sample_senti.psd` (`[0] bg_Color` … `[2] Front_hair`, and inside `Body`, `[0] Cap` … `[10] ribbon`). Since `textureZIndex` is "higher = front", the depth-first traversal index *is* the z value. Both packers used `totalLayers - 1 - index` on the assumption that index 0 was the front, which inverted the stacking order of every file they exported — that is the origin of the inverted-z files below and of `emg-ymm4`'s "Z-Index反転" toggle. Files exported before this fix stay inverted; re-export or normalise them.

**`emg-packer/src/renderer/services/` must stay free of Electron/Node APIs.** It uses only `ag-psd`, `jszip` and browser APIs, which is what lets `emg-web-packer` reuse it verbatim through a Vite alias. Put anything Electron-specific outside `services/`.

**Hidden layers are meaningful, not noise.** A PSD keeps one variant of each differential group visible and the rest hidden. Exporting only visible layers therefore throws away every alternative of a `switch` part — measured on a real file, 17 layers collapsed to 3. The rule both packers follow: `switch` parts export **all** layers (the one that was visible becomes `part.default`), `static` parts export only visible ones.

### emg-ymm4 (YMM4 plugin)

`Emg.Core/` is plain .NET (parsing + blink/lip-sync/expression resolution, no YMM4 types) so it can
be exercised from a console app without YMM4 — do that before testing in the app. `EmgTachiePlugin/`
holds the YMM4-facing code and the Direct2D compositing.

A throwaway console project that `ProjectReference`s `Emg.Core` and prints
`EmgAnimation.Create(...).Summary` plus `EmgStateResolver.ResolveActiveTextures(...)` for a range of
blink/vowel/expression inputs is the fastest way to check a `.emg`. It answers, without launching
YMM4: whether `mapping.json` was picked up, which parts got the blink/mouth roles, whether the
z-order needs the "Z-Index反転" toggle, and whether blink actually changes layer over time.

**Expressions cannot set the eye or mouth part directly.** `ResolveActiveTextures` applies
`expressions[].parts` first and then lets blink and lip-sync overwrite their own parts, so an
expression listing `Eyes` in `parts` silently has no effect. Use `overrides.blink` /
`overrides.lipSync` for those; `parts` is for everything else (eyebrows, blush, …). The reference
JS player behaves the same way.

**YMM4's plugin API is undocumented; get facts by decompiling the real DLLs** rather than guessing:

```bash
dotnet tool install -g ilspycmd
ilspycmd -t "YukkuriMovieMaker.Plugin.Tachie.Psd.PsdTachieSource" \
  "F:/YukkuriMovieMaker_v4/YukkuriMovieMaker.Plugin.Tachie.Psd.dll"
```
The bundled PSD Tachie plugin is the best reference implementation. Guessing produced several real
bugs here; each of these was only settled by decompiling:

- **`ITachieSource2` is what you want.** Its `Update(TachieSourceDescription desc)` supplies
  `desc.MouthShape` (`Silent/A/I/U/E/O`) and `desc.VoiceVolume` (`-1.0` means "no speech").
  The older 8-arg `ITachieSource.Update` only gets a single `kuchipaku` double — with it, **vowel
  lip-sync is impossible**. (`doc/emg-ymm4-plugin-verification.md` concluded vowel lip-sync was
  unachievable; that conclusion is **wrong** and this is why.)
- **`Vortice.Mathematics.Rect(x, y, width, height)`** — *not* `(left, top, right, bottom)`.
  Passing `x + width` inflated every source rect and bled neighbouring atlas regions into the frame.
- **Output must be centred**: `TransformMatrix = CreateTranslation(-w/2, -h/2) * …`, or the art sits
  off-screen (YMM4 positions around the image centre).
- `CreateCompatibleRenderTarget` needs an explicit `B8G8R8A8_UNorm` + `Premultiplied` pixel format
  on some display adapters, otherwise it throws `0x88982F80`.
- Property editors: `bool` needs `[ToggleSlider]`, enums need `[EnumComboBox]` — `[Display]` alone
  renders nothing. A custom editor implements `PropertyEditorAttribute` +
  `IPropertyEditorForTachieParameterAttribute`, and YMM4 then injects `CharacterParameter` so the
  editor can reach the `.emg` path (see `Editors/EmgLayerEditorAttribute.cs`).
- Blink timing must be derived from `tachieTime` alone (no `Random`, no wall clock) so scrubbing the
  timeline is stable. `string.GetHashCode()` is **per-process randomised** — using it as a seed makes
  re-exports differ; `Emg.Core` has a stable FNV-1a hash for this.
- Anything cached against the composited frame must include **every** input in its cache key. A
  missing key silently freezes the picture (this is how the "Z-Index反転 toggle does nothing" bug
  happened).

**YMM4 locks the plugin DLLs while running**, so the post-build copy fails with MSB3027 unless YMM4
is closed. Ask the user to close it rather than retrying.

### Licensing

Apache 2.0 (`LICENSE.md`); MIT-licensed third-party deps are listed per-project in `NOTICE.md`. Dual-licensing with MIT is noted as "under consideration" — don't assume it's settled.
