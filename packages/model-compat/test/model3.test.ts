import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectCubismModelFolder } from "../src/index.js";

async function fixture(manifest: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lumastage-model-"));
  await mkdir(join(root, "textures"));
  await writeFile(join(root, "avatar.moc3"), "test");
  await writeFile(join(root, "textures", "00.png"), "test");
  await writeFile(join(root, "avatar.model3.json"), JSON.stringify(manifest));
  return root;
}

describe("Cubism model folder inspection", () => {
  it("extracts renderer assets and standard parameter groups", async () => {
    const root = await fixture({
      Version: 3,
      FileReferences: { Moc: "avatar.moc3", Textures: ["textures/00.png"] },
      Groups: [
        { Target: "Parameter", Name: "EyeBlink", Ids: ["ParamEyeLOpen", "ParamEyeROpen"] },
        { Target: "Parameter", Name: "LipSync", Ids: ["ParamMouthOpenY"] }
      ],
      HitAreas: [{ Id: "HitAreaHead", Name: "Head" }]
    });
    const model = await inspectCubismModelFolder(root);
    expect(model.texturePaths).toHaveLength(1);
    expect(model.eyeBlinkParameters).toEqual(["ParamEyeLOpen", "ParamEyeROpen"]);
    expect(model.missingFiles).toEqual([]);
  });

  it("rejects asset paths that escape the model folder", async () => {
    const root = await fixture({ Version: 3, FileReferences: { Moc: "../secret.moc3", Textures: [] } });
    await expect(inspectCubismModelFolder(root)).rejects.toThrow(/escapes/);
  });

  it("imports VTube Studio parameter mappings and hotkeys without requiring undocumented fields", async () => {
    const root = await fixture({ Version: 3, FileReferences: { Moc: "avatar.moc3", Textures: ["textures/00.png"] } });
    await writeFile(join(root, "avatar.vtube.json"), JSON.stringify({
      Version: 1,
      Name: "Configured Avatar",
      ModelID: "model-id",
      ParameterSettings: [{
        Name: "Head X", Input: "FaceAngleX", InputRangeLower: -30, InputRangeUpper: 30,
        OutputRangeLower: -20, OutputRangeUpper: 20, ClampInput: true, ClampOutput: true,
        OutputLive2D: "CustomHeadX", Smoothing: 15, FutureField: "preserved by tolerant parser"
      }],
      Hotkeys: [{ HotkeyID: "smile", Name: "Smile", Action: "ToggleExpression", File: "smile.exp3.json" }],
      UnknownFutureSection: { enabled: true }
    }));
    const model = await inspectCubismModelFolder(root);
    expect(model.vTubeStudio?.name).toBe("Configured Avatar");
    expect(model.vTubeStudio?.parameterMappings[0]).toMatchObject({ input: "FaceAngleX", outputLive2D: "CustomHeadX" });
    expect(model.vTubeStudio?.hotkeys[0]).toMatchObject({ action: "ToggleExpression", file: "smile.exp3.json" });
  });
});
