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
| `.model3.json`, textures, physics, expressions, motions | Full through installed official Core | Renderer integrated; live Core verification pending |
| Common VTube Studio parameter mappings | Import with standard-ID fallback | Implemented for documented/common tracking inputs |
| VTube Studio hotkeys and scenes | Best effort; unsupported actions reported | Metadata import implemented; execution UI pending |
| VTube Studio plugin WebSocket API | Compatible subset, expanded by tests | Planned |
| Encrypted/locked models | Respect protection; no bypass | By design |

### VTube Studio sidecars

VTube Studio's official manual confirms that the human-readable `*.vtube.json` beside a model stores its setup, but does not publish a stable schema. LumaStage therefore uses tolerant parsing: known mapping/hotkey fields are imported, extra fields are accepted, and the source file is never rewritten during import. Parameter settings preserve input/output ranges, clamping, custom `OutputLive2D` IDs and smoothing.

Known tracking inputs currently include face angles/position, per-eye open and gaze, mouth open/smile, brows, cheek puff, angry face, mouth X and tongue. Unknown inputs remain visible to future mapping-editor work rather than being guessed.

