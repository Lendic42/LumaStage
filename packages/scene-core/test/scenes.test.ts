import { describe, expect, it } from "vitest";
import { createDefaultSceneLibrary, normalizeSceneItemTransform, normalizeSceneTransform, parseSceneLibrary, sceneLibrarySchema, type SceneItem } from "../src/index.js";

const id = "91d80ee3-1a6d-45d5-a0ca-f50c53dc1a25";

describe("scene library", () => {
  it("creates a valid default stage", () => {
    const library = createDefaultSceneLibrary(id);
    expect(library.activeSceneId).toBe(id);
    expect(library.scenes[0].background).toEqual({ kind: "gradient", preset: "violet" });
    expect(library.scenes[0].items).toEqual([]);
  });

  it("falls back safely when persisted state is invalid", () => {
    expect(parseSceneLibrary({ version: 1, activeSceneId: "missing", scenes: [] }, id).scenes).toHaveLength(1);
  });

  it("rejects duplicate IDs and missing active scenes", () => {
    const scene = createDefaultSceneLibrary(id).scenes[0];
    expect(sceneLibrarySchema.safeParse({ version: 1, activeSceneId: id, scenes: [scene, scene] }).success).toBe(false);
  });

  it("supports VTS off-screen coordinates while clamping scale and rotation", () => {
    const normalized = normalizeSceneTransform({ scale: 99, positionX: -4, rotation: 999, mirror: true }, { scale: 1, positionX: 0, positionY: 0, rotation: 0, mirror: false });
    expect(normalized).toEqual({ scale: 3, positionX: -4, positionY: 0, rotation: 180, mirror: true });
  });

  it("migrates older scene documents with no items", () => {
    const legacy = createDefaultSceneLibrary(id);
    const scene = { ...legacy.scenes[0] } as Record<string, unknown>;
    delete scene.items;
    expect(parseSceneLibrary({ ...legacy, scenes: [scene] }, id).scenes[0].items).toEqual([]);
  });

  it("clamps visual item transforms", () => {
    const item: SceneItem = { id, fileName: "hat.png", filePath: "/tmp/hat.png", type: "PNG", positionX: 0, positionY: 0, size: 0.32, rotation: 0, order: 1, flipped: false, locked: false, censored: false, smoothing: 0, opacity: 1, unloadWhenPluginDisconnects: false };
    const output = normalizeSceneItemTransform({ positionX: 5000, size: 0, rotation: -9000, opacity: 2, flipped: true }, item);
    expect(output).toMatchObject({ positionX: 1000, size: 0, rotation: -3600, opacity: 1, flipped: true });
  });

  it("persists a validated barycentric ArtMesh pin", () => {
    const library = createDefaultSceneLibrary(id);
    library.scenes[0].items.push({
      id, fileName: "hat.png", filePath: "/tmp/hat.png", type: "PNG", positionX: 0, positionY: 0,
      size: 0.32, rotation: 0, order: 1, flipped: false, locked: false, censored: false, smoothing: 0,
      opacity: 1, unloadWhenPluginDisconnects: false,
      pin: {
        modelID: "haru", artMeshID: "HairFront", angleRelativeTo: "RelativeToPinPosition", angle: 12,
        vertexID1: 0, vertexID2: 1, vertexID3: 2, vertexWeight1: 0.2, vertexWeight2: 0.3, vertexWeight3: 0.5
      }
    });
    expect(parseSceneLibrary(library, id).scenes[0].items[0].pin?.artMeshID).toBe("HairFront");
    library.scenes[0].items[0].pin!.vertexWeight3 = 0.6;
    expect(parseSceneLibrary(library, id).scenes[0].items).toEqual([]);
  });
});
