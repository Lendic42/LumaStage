import { access, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const MODEL_MANIFEST_SUFFIX = ".model3" + ".json";
const VTUBE_SETUP_SUFFIX = ".vtube" + ".json";

const referencedFile = z.string().min(1).max(1024);
const namedReference = z.object({ Name: z.string().min(1), File: referencedFile }).passthrough();
const motionReference = z.object({ File: referencedFile }).passthrough();
const expression3Schema = z.object({
  Parameters: z.array(z.object({ Id: z.string().min(1).max(256), Value: z.number().finite() }).passthrough()).default([])
}).passthrough();
const userData3Schema = z.object({
  UserData: z.array(z.object({
    Target: z.string(),
    Id: z.string(),
    Value: z.string().default("")
  }).passthrough()).default([])
}).passthrough();
const physics3Schema = z.object({
  PhysicsSettings: z.array(z.object({
    Id: z.string().min(1),
    Name: z.string().nullish().transform((value) => value ?? "")
  }).passthrough()).default([])
}).passthrough();

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
  // VTube Studio stores automatic breath mappings with an empty Input.
  // They are valid setup entries, but are not face-tracking mappings.
  Input: z.string().default(""),
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
  Folder: z.string().default(""),
  Triggers: z.object({
    Trigger1: z.string().default(""),
    Trigger2: z.string().default(""),
    Trigger3: z.string().default("")
  }).passthrough().optional(),
  IsGlobal: z.boolean().default(false),
  IsActive: z.boolean().default(true)
}).passthrough();

export const VTUBE_HOTKEY_MOTION_GROUP = "LumaStageVTubeHotkeys";

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

const editableVTubeParameterMappingSchema = z.object({
  name: z.string().max(128).default(""),
  input: z.string().min(1).max(128),
  inputRangeLower: z.number().finite().min(-1_000_000).max(1_000_000),
  inputRangeUpper: z.number().finite().min(-1_000_000).max(1_000_000),
  outputRangeLower: z.number().finite().min(-1_000_000).max(1_000_000),
  outputRangeUpper: z.number().finite().min(-1_000_000).max(1_000_000),
  clampInput: z.boolean(),
  clampOutput: z.boolean(),
  outputLive2D: z.string().min(1).max(128),
  smoothing: z.number().finite().min(0).max(1_000)
}).refine((mapping) => mapping.inputRangeLower !== mapping.inputRangeUpper, {
  message: "Input range lower and upper values must be different"
});

export function parseEditableVTubeParameterMappings(value: unknown): VTubeParameterMapping[] {
  return z.array(editableVTubeParameterMappingSchema).max(512).parse(value);
}

export interface VTubeHotkey {
  id: string;
  name: string;
  action: string;
  file: string;
  folder: string;
  triggers: string[];
  isGlobal: boolean;
  isActive: boolean;
  motionGroup?: string;
  motionIndex?: number;
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
  artMeshTags: Record<string, string[]>;
  physicsGroups: Array<{ id: string; name: string }>;
  expressions: Array<{ name: string; path: string; parameters: Array<{ name: string; value: number }> }>;
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

async function resolveVTubeAsset(root: string, reference: string, folder: string, conventionalFolder: string): Promise<string> {
  const candidates = [reference];
  if (folder.trim()) candidates.push(`${folder}/${reference}`);
  candidates.push(`${conventionalFolder}/${reference}`);
  const safeCandidates = [...new Set(candidates)].map((candidate) => safeAssetPath(root, candidate));
  for (const candidate of safeCandidates) if (await exists(candidate)) return candidate;
  return safeCandidates[0];
}

async function resolveModelRoot(directory: string): Promise<{ root: string; entries: Dirent<string>[] }> {
  const selectedRoot = resolve(directory);
  const selectedEntries = await readdir(selectedRoot, { withFileTypes: true });
  if (selectedEntries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(MODEL_MANIFEST_SUFFIX))) {
    return { root: selectedRoot, entries: selectedEntries };
  }

  // Downloaded models are often wrapped in one package folder. Search exactly
  // one level down and keep the actual model folder as the asset boundary.
  const candidates: Array<{ root: string; entries: typeof selectedEntries }> = [];
  for (const entry of selectedEntries) {
    if (!entry.isDirectory()) continue;
    const childRoot = resolve(selectedRoot, entry.name);
    const childEntries = await readdir(childRoot, { withFileTypes: true });
    if (childEntries.some((child) => child.isFile() && child.name.toLowerCase().endsWith(MODEL_MANIFEST_SUFFIX))) {
      candidates.push({ root: childRoot, entries: childEntries });
    }
  }
  if (candidates.length === 0) throw new Error("No .model3.json file found in the selected folder or its immediate subfolders");
  if (candidates.length > 1) throw new Error("Multiple model folders found; select the folder containing the model you want to import");
  return candidates[0];
}

export async function inspectCubismModelFolder(directory: string): Promise<CubismModelSummary> {
  const { root, entries } = await resolveModelRoot(directory);
  const manifests = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(MODEL_MANIFEST_SUFFIX));
  if (manifests.length === 0) throw new Error("No .model3.json file found in the selected folder");
  if (manifests.length > 1) throw new Error("Multiple .model3.json files found; select a folder containing one model");

  const manifestPath = resolve(root, manifests[0].name);
  const model = model3Schema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const refs = model.FileReferences;
  const mocPath = safeAssetPath(root, refs.Moc);
  const texturePaths = refs.Textures.map((path) => safeAssetPath(root, path));
  const expressions = await Promise.all(refs.Expressions.map(async (item) => {
    const path = safeAssetPath(root, item.File);
    try {
      const expression = expression3Schema.parse(JSON.parse(await readFile(path, "utf8")));
      return { name: item.Name, path, parameters: expression.Parameters.map((parameter) => ({ name: parameter.Id, value: parameter.Value })) };
    } catch {
      return { name: item.Name, path, parameters: [] };
    }
  }));
  const motionGroups = Object.fromEntries(Object.entries(refs.Motions).map(([group, motions]) => [group, motions.map((motion) => safeAssetPath(root, motion.File))]));
  const optional = (path?: string) => path ? safeAssetPath(root, path) : undefined;
  const userDataPath = optional(refs.UserData);
  const physicsPath = optional(refs.Physics);
  let artMeshTags: Record<string, string[]> = {};
  let physicsGroups: Array<{ id: string; name: string }> = [];
  if (userDataPath && await exists(userDataPath)) {
    try {
      const parsed = userData3Schema.parse(JSON.parse(await readFile(userDataPath, "utf8")));
      artMeshTags = Object.fromEntries(parsed.UserData.filter((entry) => entry.Target.toLowerCase() === "artmesh").map((entry) => [
        entry.Id, [...new Set(entry.Value.split(/\s+/u).filter(Boolean))]
      ]));
    } catch {
      // Invalid optional user data must not prevent an otherwise valid model from loading.
    }
  }
  if (physicsPath && await exists(physicsPath)) {
    try {
      const parsed = physics3Schema.parse(JSON.parse(await readFile(physicsPath, "utf8")));
      physicsGroups = parsed.PhysicsSettings.map((group) => ({ id: group.Id, name: group.Name }));
    } catch {
      // The renderer can still load models whose optional physics metadata is malformed.
    }
  }
  const groupIds = (name: string) => model.Groups.filter((group) => group.Target === "Parameter" && group.Name === name).flatMap((group) => group.Ids);
  const vTubeEntries = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(VTUBE_SETUP_SUFFIX));
  const preferredVTube = vTubeEntries.find((entry) => entry.name.slice(0, -VTUBE_SETUP_SUFFIX.length).toLowerCase() === basename(manifests[0].name, MODEL_MANIFEST_SUFFIX).toLowerCase()) ?? vTubeEntries[0];
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
      parameterMappings: setup.ParameterSettings.filter((mapping) => mapping.Input.length > 0).map((mapping) => ({
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
      hotkeys: setup.Hotkeys.map((hotkey) => ({
        id: hotkey.HotkeyID, name: hotkey.Name, action: hotkey.Action, file: hotkey.File, folder: hotkey.Folder,
        triggers: [hotkey.Triggers?.Trigger1 ?? "", hotkey.Triggers?.Trigger2 ?? "", hotkey.Triggers?.Trigger3 ?? ""].filter(Boolean),
        isGlobal: hotkey.IsGlobal, isActive: hotkey.IsActive
      }))
    };
    const standaloneMotions: string[] = [];
    for (const hotkey of vTubeStudio.hotkeys) {
      if (!hotkey.file || !/(?:animation|motion)/i.test(hotkey.action)) continue;
      const motionPath = await resolveVTubeAsset(root, hotkey.file, hotkey.folder, "motions");
      let motionIndex = standaloneMotions.indexOf(motionPath);
      if (motionIndex < 0) motionIndex = standaloneMotions.push(motionPath) - 1;
      hotkey.motionGroup = VTUBE_HOTKEY_MOTION_GROUP;
      hotkey.motionIndex = motionIndex;
    }
    if (standaloneMotions.length > 0) motionGroups[VTUBE_HOTKEY_MOTION_GROUP] = standaloneMotions;
  }

  const allPaths = [mocPath, ...texturePaths, ...expressions.map((item) => item.path), ...Object.values(motionGroups).flat(), physicsPath, optional(refs.Pose), optional(refs.DisplayInfo), userDataPath].filter((path): path is string => Boolean(path));
  const missingFiles = (await Promise.all(allPaths.map(async (path) => [path, await exists(path)] as const))).filter(([, present]) => !present).map(([path]) => relative(root, path));

  return {
    directory: root,
    manifestPath,
    name: basename(manifests[0].name, MODEL_MANIFEST_SUFFIX),
    version: model.Version,
    mocPath,
    texturePaths,
    physicsPath,
    posePath: optional(refs.Pose),
    displayInfoPath: optional(refs.DisplayInfo),
    userDataPath,
    artMeshTags,
    physicsGroups,
    expressions,
    motionGroups,
    eyeBlinkParameters: groupIds("EyeBlink"),
    lipSyncParameters: groupIds("LipSync"),
    hitAreas: model.HitAreas.map((area) => ({ id: area.Id, name: area.Name })),
    missingFiles,
    vTubeStudio
  };
}
