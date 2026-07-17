import { access, readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const referencedFile = z.string().min(1).max(1024);
const namedReference = z.object({ Name: z.string().min(1), File: referencedFile }).passthrough();
const motionReference = z.object({ File: referencedFile }).passthrough();

export const model3Schema = z.object({
  Version: z.number().int().min(3),
  FileReferences: z.object({
    Moc: referencedFile,
    Textures: z.array(referencedFile).default([]),
    Physics: referencedFile.optional(),
    Pose: referencedFile.optional(),
    DisplayInfo: referencedFile.optional(),
    UserData: referencedFile.optional(),
    Expressions: z.array(namedReference).default([]),
    Motions: z.record(z.string(), z.array(motionReference)).default({})
  }).passthrough(),
  Groups: z.array(z.object({
    Target: z.string(),
    Name: z.string(),
    Ids: z.array(z.string())
  }).passthrough()).default([]),
  HitAreas: z.array(z.object({ Id: z.string(), Name: z.string() }).passthrough()).default([])
}).passthrough();

const vTubeParameterSchema = z.object({
  Folder: z.string().default(""),
  Name: z.string().default(""),
  Input: z.string().min(1),
  InputRangeLower: z.number(),
  InputRangeUpper: z.number(),
  OutputRangeLower: z.number(),
  OutputRangeUpper: z.number(),
  ClampInput: z.boolean().default(true),
  ClampOutput: z.boolean().default(true),
  OutputLive2D: z.string().min(1),
  Smoothing: z.number().default(0)
}).passthrough();

const vTubeHotkeySchema = z.object({
  HotkeyID: z.string().default(""),
  Name: z.string().default(""),
  Action: z.string().default("Unset"),
  File: z.string().default(""),
  Folder: z.string().default("")
}).passthrough();

export const vTubeStudioSchema = z.object({
  Version: z.number().int().nonnegative().optional(),
  Name: z.string().optional(),
  ModelID: z.string().optional(),
  FileReferences: z.object({
    Icon: z.string().default(""),
    Model: z.string().default(""),
    IdleAnimation: z.string().default(""),
    IdleAnimationWhenTrackingLost: z.string().default("")
  }).passthrough().optional(),
  ParameterSettings: z.array(vTubeParameterSchema).default([]),
  Hotkeys: z.array(vTubeHotkeySchema).default([])
}).passthrough();

export interface VTubeParameterMapping {
  name: string;
  input: string;
  inputRangeLower: number;
  inputRangeUpper: number;
  outputRangeLower: number;
  outputRangeUpper: number;
  clampInput: boolean;
  clampOutput: boolean;
  outputLive2D: string;
  smoothing: number;
}

export interface VTubeHotkey {
  id: string;
  name: string;
  action: string;
  file: string;
  folder: string;
}

export interface VTubeStudioSetup {
  path: string;
  version?: number;
  name?: string;
  modelId?: string;
  iconPath?: string;
  idleAnimationPath?: string;
  parameterMappings: VTubeParameterMapping[];
  hotkeys: VTubeHotkey[];
}

export interface CubismModelSummary {
  directory: string;
  manifestPath: string;
  name: string;
  version: number;
  mocPath: string;
  texturePaths: string[];
  physicsPath?: string;
  posePath?: string;
  displayInfoPath?: string;
  userDataPath?: string;
  expressions: Array<{ name: string; path: string }>;
  motionGroups: Record<string, string[]>;
  eyeBlinkParameters: string[];
  lipSyncParameters: string[];
  hitAreas: Array<{ id: string; name: string }>;
  missingFiles: string[];
  vTubeStudio?: VTubeStudioSetup;
}

function safeAssetPath(root: string, reference: string): string {
  if (isAbsolute(reference)) throw new Error(`Absolute model asset path is not allowed: ${reference}`);
  const output = resolve(root, reference);
  const fromRoot = relative(root, output);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Model asset path escapes its folder: ${reference}`);
  }
  return output;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function inspectCubismModelFolder(directory: string): Promise<CubismModelSummary> {
  const root = resolve(directory);
  const entries = await readdir(root, { withFileTypes: true });
  const manifests = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".model3.json"));
  if (manifests.length === 0) throw new Error("No .model3.json file found in the selected folder");
  if (manifests.length > 1) throw new Error("Multiple .model3.json files found; select a folder containing one model");

  const manifestPath = resolve(root, manifests[0].name);
  const model = model3Schema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const refs = model.FileReferences;
  const mocPath = safeAssetPath(root, refs.Moc);
  const texturePaths = refs.Textures.map((path) => safeAssetPath(root, path));
  const expressions = refs.Expressions.map((item) => ({ name: item.Name, path: safeAssetPath(root, item.File) }));
  const motionGroups = Object.fromEntries(Object.entries(refs.Motions).map(([group, motions]) => [group, motions.map((motion) => safeAssetPath(root, motion.File))]));
  const optional = (path?: string) => path ? safeAssetPath(root, path) : undefined;
  const allPaths = [mocPath, ...texturePaths, ...expressions.map((item) => item.path), ...Object.values(motionGroups).flat(), optional(refs.Physics), optional(refs.Pose), optional(refs.DisplayInfo), optional(refs.UserData)].filter((path): path is string => Boolean(path));
  const missingFiles = (await Promise.all(allPaths.map(async (path) => [path, await exists(path)] as const))).filter(([, present]) => !present).map(([path]) => relative(root, path));
  const groupIds = (name: string) => model.Groups.filter((group) => group.Target === "Parameter" && group.Name === name).flatMap((group) => group.Ids);
  const vTubeEntries = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".vtube.json"));
  const preferredVTube = vTubeEntries.find((entry) => entry.name.slice(0, -".vtube.json".length).toLowerCase() === basename(manifests[0].name, ".model3.json").toLowerCase()) ?? vTubeEntries[0];
  let vTubeStudio: VTubeStudioSetup | undefined;
  if (preferredVTube) {
    const path = resolve(root, preferredVTube.name);
    const setup = vTubeStudioSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const fileRefs = setup.FileReferences;
    vTubeStudio = {
      path,
      version: setup.Version,
      name: setup.Name,
      modelId: setup.ModelID,
      iconPath: fileRefs?.Icon ? safeAssetPath(root, fileRefs.Icon) : undefined,
      idleAnimationPath: fileRefs?.IdleAnimation ? safeAssetPath(root, fileRefs.IdleAnimation) : undefined,
      parameterMappings: setup.ParameterSettings.map((mapping) => ({
        name: mapping.Name,
        input: mapping.Input,
        inputRangeLower: mapping.InputRangeLower,
        inputRangeUpper: mapping.InputRangeUpper,
        outputRangeLower: mapping.OutputRangeLower,
        outputRangeUpper: mapping.OutputRangeUpper,
        clampInput: mapping.ClampInput,
        clampOutput: mapping.ClampOutput,
        outputLive2D: mapping.OutputLive2D,
        smoothing: mapping.Smoothing
      })),
      hotkeys: setup.Hotkeys.map((hotkey) => ({ id: hotkey.HotkeyID, name: hotkey.Name, action: hotkey.Action, file: hotkey.File, folder: hotkey.Folder }))
    };
  }

  return {
    directory: root,
    manifestPath,
    name: basename(manifests[0].name, ".model3.json"),
    version: model.Version,
    mocPath,
    texturePaths,
    physicsPath: optional(refs.Physics),
    posePath: optional(refs.Pose),
    displayInfoPath: optional(refs.DisplayInfo),
    userDataPath: optional(refs.UserData),
    expressions,
    motionGroups,
    eyeBlinkParameters: groupIds("EyeBlink"),
    lipSyncParameters: groupIds("LipSync"),
    hitAreas: model.HitAreas.map((area) => ({ id: area.Id, name: area.Name })),
    missingFiles,
    vTubeStudio
  };
}
