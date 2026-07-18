import { describe, expect, it } from "vitest";
import { createDefaultSceneLibrary, normalizeSceneTransform, parseSceneLibrary, sceneLibrarySchema } from "../src/index.js";

const id = "91d80ee3-1a6d-45d5-a0ca-f50c53dc1a25";

describe("scene library", () => {
  it("creates a valid default stage", () => {
    const library = createDefaultSceneLibrary(id);
    expect(library.activeSceneId).toBe(id);
    expect(library.scenes[0].background).toEqual({ kind: "gradient", preset: "violet" });
  });

  it("falls back safely when persisted state is invalid", () => {
    expect(parseSceneLibrary({ version: 1, activeSceneId: "missing", scenes: [] }, id).scenes).toHaveLength(1);
  });

  it("rejects duplicate IDs and missing active scenes", () => {
    const scene = createDefaultSceneLibrary(id).scenes[0];
    expect(sceneLibrarySchema.safeParse({ version: 1, activeSceneId: id, scenes: [scene, scene] }).success).toBe(false);
  });

  it("clamps renderer transforms to safe visible ranges", () => {
    const normalized = normalizeSceneTransform({ scale: 99, positionX: -4, rotation: 999, mirror: true }, { scale: 1, positionX: 0, positionY: 0, rotation: 0, mirror: false });
    expect(normalized).toEqual({ scale: 3, positionX: -1, positionY: 0, rotation: 180, mirror: true });
  });
});
