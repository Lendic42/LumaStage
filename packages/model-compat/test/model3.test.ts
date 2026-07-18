import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectCubismModelFolder, parseEditableVTubeParameterMappings, VTUBE_HOTKEY_MOTION_GROUP } from "../src/index.js";

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

  it("reads expression parameter details for API compatibility", async () => {
    const root = await fixture({
      Version: 3,
      FileReferences: { Moc: "avatar.moc3", Textures: ["textures/00.png"], Expressions: [{ Name: "Smile", File: "smile.exp3.json" }] }
    });
    await writeFile(join(root, "smile.exp3.json"), JSON.stringify({
      Type: "Live2D Expression", Parameters: [{ Id: "ParamMouthForm", Value: 1, Blend: "Add" }]
    }));
    const model = await inspectCubismModelFolder(root);
    expect(model.expressions[0].parameters).toEqual([{ name: "ParamMouthForm", value: 1 }]);
  });

  it("reads ArtMesh tags and physics group metadata", async () => {
    const root = await fixture({
      Version: 3,
      FileReferences: { Moc: "avatar.moc3", Textures: ["textures/00.png"], UserData: "avatar.userdata3.json", Physics: "avatar.physics3.json" }
    });
    await writeFile(join(root, "avatar.userdata3.json"), JSON.stringify({ UserData: [{ Target: "ArtMesh", Id: "HairFront", Value: "hair front\nsoft" }] }));
    await writeFile(join(root, "avatar.physics3.json"), JSON.stringify({ PhysicsSettings: [{ Id: "PhysicsSetting1", Name: null }] }));
    const model = await inspectCubismModelFolder(root);
    expect(model.artMeshTags.HairFront).toEqual(["hair", "front", "soft"]);
    expect(model.physicsGroups).toEqual([{ id: "PhysicsSetting1", name: "" }]);
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
    await mkdir(join(root, "motions"));
    await writeFile(join(root, "motions", "wave.motion3.json"), JSON.stringify({ Version: 3, Meta: { Duration: 1 }, Curves: [] }));
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
      Hotkeys: [{ HotkeyID: "wave", Name: "Wave", Action: "TriggerAnimation", File: "wave.motion3.json", Triggers: { Trigger1: "W", Trigger2: "LEFT SHIFT", Trigger3: "" }, IsGlobal: true }],
      UnknownFutureSection: { enabled: true }
    }));
    const model = await inspectCubismModelFolder(root);
    expect(model.vTubeStudio?.name).toBe("Configured Avatar");
    expect(model.vTubeStudio?.parameterMappings[0]).toMatchObject({ input: "FaceAngleX", outputLive2D: "CustomHeadX" });
    expect(model.vTubeStudio?.parameterMappings).toHaveLength(1);
    expect(model.vTubeStudio?.hotkeys[0]).toMatchObject({ action: "TriggerAnimation", file: "wave.motion3.json", triggers: ["W", "LEFT SHIFT"], isGlobal: true, isActive: true, motionGroup: VTUBE_HOTKEY_MOTION_GROUP, motionIndex: 0 });
    expect(model.motionGroups[VTUBE_HOTKEY_MOTION_GROUP]).toEqual([join(root, "motions", "wave.motion3.json")]);
    expect(model.missingFiles).toEqual([]);
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
