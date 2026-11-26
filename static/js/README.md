# NCV viewer – module layout

Replace the old single script with:

    <script type="module" src="/static/js/main.js"></script>

(keep your existing importmap for `three` / `three/addons/`, and the global `Chart` and `numeric` scripts.)

| File | Responsibility |
|---|---|
| main.js | entry point, init order |
| state.js | one shared mutable `state` object (replaces the old top-level `let`s) |
| config.js / dom.js / utils.js / ui.js | constants, cached DOM refs, pure helpers, loader/progress/dropdown helpers |
| scene.js / camera.js / arrows.js / gui.js | renderer + render loop, camera pose/pan/zoom, PCA arrows, lil-gui panel |
| neurons.js | `VisualizateNeurons()` split into collect/build steps, plus `clearScene()` |
| spikes.js / playback.js | spike flash/fade, timeline, start/pause/restart, sliders |
| histogram.js / recording.js | Chart.js histogram, WebM recording |
| connections.js / popup.js / labels.js | CA3→CA1 wires, hover popup, type/region tables |
| selection.js | region / layer / neuron-type checkbox logic (table-driven) |
| circuits.js / activity.js / uploads.js | built-in circuits, activity loading + chunk dropdown, chunked uploads |

## Behaviour kept on purpose
- Layer 19 un-ticks [106,107,108,111] but ticks [108,114] (see LAYER_NT_UNSELECT_OVERRIDE).
- `stopButton.disable = true` typo (no effect) – still there in activity.js / uploads.js.
- Colour-picker change while a built-in/uploaded network is shown re-runs VisualizateNeurons with `flag=true`, which appends to the position arrays again.

## Small deliberate changes
- Render loop starts once (was one new rAF loop per redraw).
- Selection listeners attach once (were re-attached on every change).
- PCA failure no longer crashes VisualizateNeurons; resize before first load no longer throws.
- HDF upload used `file.total_neuros` (typo → NaN); now `total_neurons`.
- Per-frame gid→index map is built once per network (`state.gidIndexMap`).
- Removed dead code (unused statsBadgePlugin, texturePath, totalX/Y/Z, etc.).

## Performance changes (Mouse Circuit)
- Load: removed the 100 ms artificial delay per layer file (28 files = ~2.8 s).
- Rendering is on-demand: the scene (drawn twice per frame for the inset) is only redrawn when the camera, data, size/colour or window changes, or while recording. Idle CPU/GPU use drops to ~0.
- Layer/region/type ticks: redraws are coalesced to one rebuild per animation frame (one click used to trigger several full rebuilds).
- Rebuild is O(N) with typed arrays and Set lookups (no per-neuron toString / push(...spread)), ShaderMaterial is compiled once and reused.
- PCA arrows: covariance accumulated in one pass (was N x 3 arrays-of-arrays + numeric.dot); only the 3x3 eigen-solve uses numeric.
- Removed per-neuron objects: originalColors is filled lazily, gid->position Vector3 map replaced by a lazy gid->index map.
- Hover: raycast at most once per frame, skipped while dragging and when the pointer is not over the canvas. Clicks on the UI no longer raycast.
- Connections: wires use scratch vectors, and old geometry/material are disposed on redraw (was leaking).
- Spikes: no GPU buffer upload on ticks where nothing is firing or fading.

## Performance changes (Human and uploaded circuits)

- Human / uploaded data is converted straight into pre-sized typed arrays (`Float32Array` positions, colours, sizes; `Float64Array` gIDs), and the raw per-neuron objects (`state.NetworkArray`) are released after the build.
- Spike animation uploads only the changed GPU ranges (`gpu.js`: `markRange` / `markFull` / `endFrame`) instead of whole buffers every frame; `fadeSpikes` returns early when nothing is transitioning.
- Hover and click picking use a uniform-grid ray march (`picking.js`) for clouds of 200k+ points; hover is throttled to one pick per animation frame and skipped while dragging.
- Pixel ratio drops to 1 above 1M neurons (fill-rate bound); PCA for the arrows samples at most 200k points.
- Colour pickers no longer trigger a rebuild for human/uploaded circuits (they are coloured by cell type); repeat `VisualizateNeurons()` calls are no-ops once the data is released.
- SONATA `neuron_class` is a `Float32Array`; per-file 100 ms delay removed.

## Performance changes (spike colours) and loader timing

- `uploads.js`: every upload sends a `batchId`; CSV slices chosen together are merged by the server (network slices concatenated in natural file-name order, duplicate ids kept once; activity slices concatenated and sorted by time), a later upload replaces the previous one.
- Uploaded network CSVs: the cell_type column is used when present; without it several slices are classified by gid (1..261844 excitatory, 261845..288027 inhibitory) and a single file keeps the default percentage (90.909533 % excitatory, e.g. 5280000 -> 4800023 / 479977). `neurons.js` uses each record's own cell_type.
- `playback.js`: steps are paced by the wall clock (one step per `stepDuration` ms, min 4 ms); ticks delayed by slow frames are caught up (max 50 steps / 10 ms per tick) so heavy rendering no longer slows the simulated time down.
- `recording.js`: records 1920x1080 (view scaled to fit, centred), 30 fps, 16 Mbps. MP4 is recorded directly when the browser supports it; otherwise the WebM is converted to H.264 MP4 by the server (`/api/convert_to_mp4/`, needs ffmpeg) and saved as WebM only if that fails. While recording the render loop renders at 30 fps only when something changed and copies each finished frame via `state.postRender`.
- `spikes.js`: only spiking neurons are processed (typed active list, swap-remove); original colour comes from the `originalColor` attribute; no per-gid Maps/objects, no `delete` on sparse arrays; simulation logs store numbers and are formatted only when downloaded.
- Spikes are drawn by a small overlay `THREE.Points` that holds only the currently spiking neurons (same material, drawn after the base cloud). The base cloud is never modified by playback, so a burst uploads a few MB per frame instead of re-uploading the whole colour and size buffers (84 MB at 5.28M neurons). The overlay is uploaded once per rendered frame via `state.preRender`, and is disposed with the network (`disposeSpikes`). `Firing_Neuron_Size` only sets `state.spikeNeuronSize`.
- Hover end restores the correct colour (spike colour while still spiking, original otherwise) via `restoreColor()`; `state.originalColors` is gone.
- Timeline scrubbing no longer loops over all vertices twice; the histogram cursor redraws at most once per frame.
- `ui.js`: loader shows live "Elapsed … · phase · download %" and a toast with the exact time of each phase (server, download, parse, build). `fetchJson()` streams the response and uses the real `Content-Length`; `startFakeProgress` was removed.
- Loader (`ui.js`): a stage list (Upload, Server processing, Download, Parse, Build 3D) with a tick and exact time per stage, ONE overall progress percentage that never goes backwards (weighted by stage; written to `#progress-percentage`, so the page's `--pct` bar follows it), and a status line with step number, elapsed time, MB, speed and ETA of the running transfer. `showLoader({ upload, build })` declares the expected stages; `startPhase(label)` picks the stage; `setProgress("NN%")` is the progress of the running stage; `setTransfer(done, total)` feeds speed/ETA. Styles are injected by `ui.js`.
