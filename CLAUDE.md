# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This is a monorepo for **EMG (easy Movable Graphic)**, a lightweight, engine-agnostic format for distributing part-based 2D character art (eyes/mouth swaps, texture-atlas rendering) so the same avatar can be played back in a browser, OBS, AviUtl, Ren'Py, or Unity without re-authoring. An `.emg` file is a ZIP containing `data.json` (parts/layers/textures/sprites metadata) plus one or more texture atlas PNGs.

There is no root build system — each subdirectory below is an **independent npm/Unity/Ren'Py project** with its own `package.json` (or none). Always `cd` into the relevant subdirectory before running install/dev/build commands; there is no workspace tooling tying them together.

| Directory | What it is | Stack |
|---|---|---|
| `emg-packer/` | Electron desktop app: loads a PSD (or `.kra`), lets the user assign `partID`/`type` per layer, packs a texture atlas, and exports a `.emg` file | Electron + Vite (electron-vite) + React + TypeScript, `ag-psd` |
| `emg-web-runtime/` | Browser app for playing/authoring EMG avatars (states, variants, undo history) — WIP, deployed to GitHub Pages on push to `main` | Vite + React + TypeScript + styled-components |
| `emg-lite/` | Spec + adapter + tools for **EMG-lite** (`.emgl`), a *separate*, simpler 5-slot avatar IR (base/mouthOpen/mouthClosed/eyesOpen/eyesClosed) distinct from full EMG — see "Two coexisting specs" below | Spec docs + `adapter/png-adapter.ts` + `tools/emg-viewer` (Vite + Electron) |
| `emg-cdn/` | Deployable reference player (`emg-player.0.1.0.js`, `emg-player.0.2.2.js`) and demo page, served via GitHub Pages from repo root config | Vanilla JS + JSZip, no build step |
| `emg-unity-importer/` | Unity Editor/Runtime package that imports `.emg` files (`EmgImporter.cs`, `EmgController.cs`, `EmgData.cs`) — WIP | C# (Unity Editor/Runtime asmdefs) |
| `emg-renpy/` | Ren'Py loader script (`emg_loader.rpy`) for playing EMG avatars inside a Ren'Py game | Ren'Py `.rpy` |
| `aviutl-for-egml/` | Electron/React app that imports EMG-lite assets and exports AviUtl `.exo` project/timeline data | Electron + Vite + React + TypeScript + Tailwind + Zustand |
| `develop/` | Standalone integration/dev HTML+CSS+JS sandbox (no build) | Vanilla |
| `doc/` | Spec documents for the packer, Ren'Py loader, and Unity importer (dated `260219`), plus `emg_upstream_contribution_plan.md` | Markdown |
| `samples/` | Sample EMG data (`avatar.json`, `states.json`, assets) | Data |

Top-level spec docs: `emg-json-spec.md` (full EMG v0.3.0 JSON schema, normative — `data.json` root structure), `emg-mapping-spec.md` (v0.3.0 `mapping.json` companion-file schema for expression/blink/lip-sync semantics), and `emg-spec-intent.md` (design rationale — read this to understand *why* a field exists, not just what it is).

## Common commands

Each JS/TS project uses its own `package.json` in its own directory (`npm install` once per project you touch):

```bash
# emg-packer (Electron packer app)
cd emg-packer
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

### Deployment

Two GitHub Actions workflows deploy to GitHub Pages on push to `main`:
- `Deploy Web Runtime` — triggers only on changes under `emg-web-runtime/**`, builds it, publishes `emg-web-runtime/dist`.
- `Deploy to GitHub Pages` — publishes the `emg-cdn/` directory as-is (no build).

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
- **`mapping.json`** (optional companion file, v0.3.0+, spec'd in `emg-mapping-spec.md`) adds expression/blink/lip-sync *semantics* on top of `data.json`'s structural `parts[]`/`layers[]`. It is spec-only so far — no reference implementation consumes it yet (see below). Where a `partID` is explicitly targeted by `mapping.json`'s blink/lipSync mapping, any `sprites[]` entry with the same `targetPartID` MUST NOT self-trigger; `mapping.json` takes control of that part instead.

### Two coexisting, structurally different specs — don't conflate them

The repo hosts **two separate avatar formats** that share a name prefix but are not interchangeable:

1. **Full EMG** (`.emg`, `emg-json-spec.md`) — the `version`/`textures[]`/`parts[]`/`sprites[]` schema above. Has a working reference player (`emg-cdn/emg-player.0.2.2.js`). Consumed by `emg-packer` (producer), `emg-web-runtime`, `emg-unity-importer`, `emg-renpy`.
2. **EMG-lite** (`.emgl`, spec under `emg-lite/tools/emg-viewer/docs/`) — a simpler 5-slot state IR (`base`/`mouthOpen`/`mouthClosed`/`eyesOpen`/`eyesClosed`) meant as a rendering-agnostic internal representation, not a texture-atlas format. Consumed by `emg-lite/adapter/png-adapter.ts`, `emg-lite/tools/emg-viewer`, and `aviutl-for-egml` (which imports EMG-lite assets to export AviUtl `.exo` timelines).

When working in `emg-lite/` or `aviutl-for-egml/`, you're in the EMG-lite world (5-slot, `AvatarData`/`assetsRoot`/`mapping`), not the full-EMG world (`parts[]`/`textures[]`). Don't confuse EMG-lite's `mapping: Record<string, AvatarLayerMap>` with full EMG's `mapping.json` (`emg-mapping-spec.md`) — same word, unrelated schemas. See `doc/emg_upstream_contribution_plan.md` for the original field-by-field comparison and rationale behind the `mapping.json` extension.

### emg-packer internals (PSD → `.emg`)

Flow: `PsdLoader` (parses PSD via `ag-psd`, injects `_partName` from top-level group names as a starting hint) → user assigns `partID`/`type`/`default` per layer in the UI (`App.tsx` state, `LayerMeta` in `types.ts`) → `TexturePacker` (shelf-packing algorithm, power-of-two atlas sizing, default max 2048×2048) → `EmgGenerator.createData()`/`generate()` builds the v0.2.2 JSON and zips it with the atlas PNG via JSZip.

Known rough edge (see comments in `EmgGenerator.ts` and `doc/emg-packer-spec_260219.md`): `TexturePacker` sorts items by height for packing, so by the time `EmgGenerator` sees `items`, original PSD z-order (front/back) has been lost; `textureZIndex` assignment needs a z-order value threaded through from the original tree traversal in `App.tsx` rather than being recovered inside `EmgGenerator`. Read that TODO trail before touching z-index logic.

### Licensing

Apache 2.0 (`LICENSE.md`); MIT-licensed third-party deps are listed per-project in `NOTICE.md`. Dual-licensing with MIT is noted as "under consideration" — don't assume it's settled.
