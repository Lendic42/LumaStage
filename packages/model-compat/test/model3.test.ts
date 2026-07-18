import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectCubismModelFolder, parseEditableVTubeParameterMappings } from "../src/index.js";

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

  it("finds a model inside a single downloaded package wrapper", async () => {
    const root = await mkdtemp(join(tmpdir(), "lumastage-wrapper-"));
    const modelRoot = join(root, "DownloadedAvatar");
    await mkdir(modelRoot);
    await mkdir(join(modelRoot, "textures"));
    await writeFile(join(modelRoot, "avatar.moc3"), "test");
    await writeFile(join(modelRoot, "textures", "00.png"), "test");
    await writeFile(join(modelRoot, "avatar.model3.json"), JSON.stringify({
      Version: 3,
      FileReferences: { Moc: "avatar.moc3", Textures: ["textures/00.png"] }
    }));

    const model = await inspectCubismModelFolder(root);
    expect(model.directory).toBe(modelRoot);
    expect(model.name).toBe("avatar");
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
      }, {
        Name: "Auto Breath", Input: "", InputRangeLower: 0, InputRangeUpper: 1,
        OutputRangeLower: 0, OutputRangeUpper: 1, OutputLive2D: "ParamBreath", UseBreathing: true
      }],
      Hotkeys: [{ HotkeyID: "smile", Name: "Smile", Action: "ToggleExpression", File: "smile.exp3.json" }],
      UnknownFutureSection: { enabled: true }
    }));
    const model = await inspectCubismModelFolder(root);
    expect(model.vTubeStudio?.name).toBe("Configured Avatar");
    expect(model.vTubeStudio?.parameterMappings[0]).toMatchObject({ input: "FaceAngleX", outputLive2D: "CustomHeadX" });
    expect(model.vTubeStudio?.parameterMappings).toHaveLength(1);
    expect(model.vTubeStudio?.hotkeys[0]).toMatchObject({ action: "ToggleExpression", file: "smile.exp3.json" });
  });
});

describe("editable VTube Studio mappings", () => {
  const mapping = {
    name: "Eye left", input: "EyeOpenLeft", inputRangeLower: 0, inputRangeUpper: 1,
    outputRangeLower: 0, outputRangeUpper: 1.9, clampInput: true, clampOutput: true,
    outputLive2D: "ParamEyeLOpen", smoothing: 10
  };

  it("accepts finite, bounded mapping editor data", () => {
    expect(parseEditableVTubeParameterMappings([mapping])).toEqual([mapping]);
  });

  it("rejects degenerate ranges and unbounded editor payloads", () => {
    expect(() => parseEditableVTubeParameterMappings([{ ...mapping, inputRangeUpper: 0 }])).toThrow(/different/);
    expect(() => parseEditableVTubeParameterMappings([{ ...mapping, smoothing: Number.POSITIVE_INFINITY }])).toThrow();
  });
});
