# Compatibility and Live2D licensing

## Target import compatibility

The compatibility target is a normal exported Cubism model folder containing `*.model3.json`, `*.moc3`, textures, physics, expressions, motions, pose and user-data files. LumaStage will also read VTube Studio sidecar files for parameter mappings, hotkeys and display metadata when those fields can be mapped safely.

Compatibility does **not** mean copying VTube Studio code, decrypting protected models or bypassing model-author restrictions. Models remain subject to their authors' licenses.

## Why Cubism Core is separate

Live2D publishes the Cubism SDK framework source under its own terms, but the binary Cubism Core used to evaluate `.moc3` files is proprietary. A VTuber tracking application is classified by Live2D as an expandable application and requires review and a special publication agreement before a public release that bundles the SDK.

Therefore:

- this repository contains only code we can publish under GPL-3.0-only;
- CI and source builds must work without committing proprietary Cubism binaries;
- developers/users may install an official compatible Cubism Core separately after accepting Live2D's terms;
- no release will claim full model-rendering support until the applicable Live2D publication permission is resolved.

This preserves honest open-source licensing while still building real compatibility around the official runtime.

## Compatibility matrix

| Capability | Target | Status |
| --- | --- | --- |
| Cubism 3/4/5 model folder discovery | Full | Implemented and tested on official Haru sample |
| `.model3.json`, textures, physics, expressions, motions | Full through installed official Core | Packaged renderer verified on the supplied NITORUDRAW model with compatible official Core |
| Common VTube Studio parameter mappings | Import, tune and reset with standard-ID fallback | Implemented with live visual editor and per-model persistence |
| VTube Studio expression/motion hotkeys | Best effort; unsupported actions reported | Imported and executable; standalone VTS motions outside `model3.json`, labels and global trigger keys are supported |
| VTube Studio scenes/model-changing hotkeys | Best effort | Planned |
| LumaStage scene presets | Native equivalent | Implemented with model binding, backgrounds and transforms |
| VTube Studio plugin authentication/state/statistics | Compatible subset | Implemented and packaged-runtime tested on localhost:8001 |
| Current model, face-found and model hotkey API | Compatible subset | Implemented; hotkeys limited to supported imported actions |
| Available model list and model load/unload API | Compatible subset | Implemented with persistent private model library and scene update |
| Model movement API | Compatible subset | Absolute/relative transforms, official ranges and timed interpolation implemented |
| ArtMesh list and tint API | Compatible subset | Real renderer Drawable IDs, UserData tags, case-insensitive matchers and disconnect cleanup implemented |
| Physics read/override API | Compatible subset | Physics groups, single-plugin ownership, base/group override timers and cleanup implemented |
| Expression state and activation API | Compatible subset | Implemented with parsed expression parameter details and renderer activation |
| Input/Live2D parameter reads and timed parameter injection | Compatible subset | Implemented with set/add, weights and one-second expiry |
| VTube Studio event subscriptions | Compatible subset | Implemented for test, model, tracking, background, movement, hotkey and item event types |
| Custom tracking parameter creation/deletion | Compatible subset | Implemented with persistence, ownership, limits and revocation cleanup |
| PNG/JPG/GIF scene items and list/load/move/unload API | Compatible subset | Implemented with live canvas, persistent file catalog, ordering and disconnect cleanup |
| ArtMesh item pin/unpin API | Compatible subset | Provided/Center/Random triangle selection, barycentric deformation following, angle/size modes and official 1050-1054 errors implemented |
| Post-processing list/update API | Compatible subset | Six rendered effect groups, 14 official config IDs, normalized filters/IDs, native presets, fades, persistence and official 1150/1201-1205 validation implemented |
| Custom-data, animated-folder and Live2D item APIs | Incremental compatibility | Planned |
| Remaining VTube Studio plugin API | Incremental compatibility | Advanced item animation/sorting, interactive ArtMesh selection, hotkey configuration, remaining post-processing configs and additional events remain |
| Encrypted/locked models | Respect protection; no bypass | By design |

### VTube Studio sidecars

VTube Studio's official manual confirms that the human-readable `*.vtube.json` beside a model stores its setup, but does not publish a stable schema. LumaStage therefore uses tolerant parsing: known mapping/hotkey fields are imported, extra fields are accepted, and the source file is never rewritten during import. Parameter settings preserve input/output ranges, clamping, custom `OutputLive2D` IDs and smoothing.

Known tracking inputs currently include face angles/position, per-eye open and gaze, mouth open/smile, brows, cheek puff, angry face, mouth X and tongue. Unknown inputs remain editable rather than being guessed. The visual mapping editor records live input ranges, validates finite limits and keeps overrides in app user data under a SHA-256 model key; it never rewrites the model author's sidecar.

Some VTube Studio packages keep `TriggerAnimation` files under `motions/` while storing only the basename in `*.vtube.json` and omitting them from `model3.json`. LumaStage resolves those paths inside the model boundary, reports missing files normally, and injects a synthetic runtime-only motion group into the manifest response. The model's source files are never changed. Original trigger keys are registered when the sidecar marks the hotkey active/global; unsupported or OS-reserved combinations remain available as visible buttons.

### Post-processing

The native Effects screen and plugin API share one persistent state. The current rendered subset covers ColorGrading, Bloom, Vignette, ChromaticAberration, BlurEffects and Grain using the official effect/config identifiers published by DenchiSoft. IDs are matched case-insensitively with `_` and `-` ignored, numeric values are clamped to the official ranges, duplicate normalized IDs are rejected and updates accept the official 0–2 second fade interval. LumaStage reports only the configs it actually renders rather than pretending to support the full VTube Studio effects catalog.
