import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, session, shell } from "electron";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { basename, isAbsolute, relative, resolve, sep, join } from "node:path";
import { pathToFileURL } from "node:url";
import Bonjour from "bonjour-service";
import { WebSocketServer, type WebSocket } from "ws";
import { parseLumaLinkMessage, type HelloMessage, type TrackingFrame } from "@lumastage/protocol";
import { inspectCubismModelFolder, parseEditableVTubeParameterMappings, VTUBE_HOTKEY_MOTION_GROUP } from "@lumastage/model-compat";
import { applyVTubeParameterMappingsToInputs, mapARKitToVTubeInputs } from "@lumastage/tracking-core";
import { createVtsEventMessage, handleVtsApiRequest, vtsSessionAcceptsEvent, type VtsApiHost, type VtsApiSession, type VtsArtMeshMatcher, type VtsArtMeshSelectionInput, type VtsArtMeshSelectionResult, type VtsColorTint, type VtsCurrentModel, type VtsCustomParameterDefinition, type VtsEventName, type VtsItemAnimationControlInput, type VtsItemAnimationControlResult, type VtsItemLoadInput, type VtsItemMoveInput, type VtsItemPinInput, type VtsModelMoveInput, type VtsParameter, type VtsPhysicsOverride, type VtsPostProcessingState, type VtsPostProcessingUpdate, type VtsPostProcessingValue, type VtsSceneItem } from "@lumastage/vts-api";
import { createDefaultSceneLibrary, inspectGifAnimation, normalizeSceneItemTransform, normalizeSceneTransform, parseSceneLibrary, type SceneItem as StoredSceneItem, type SceneLibrary as StoredSceneLibrary, type ScenePreset as StoredScenePreset } from "@lumastage/scene-core";
import { getVirtualCameraStatus, pushVirtualCameraFrame, startVirtualCamera, stopVirtualCamera } from "./virtualCamera/index.js";
import type { ArtMeshGeometry, ArtMeshSelectionPrompt, CubismCoreStatus, DesktopStatus, ImportedHotkey, ImportedModel, ModelLibrary, PluginAuthorizationRequest, PostProcessingState, SceneItem, SceneItemUpdate, SceneLibrary, ScenePreset, SceneUpdate, SceneWorkspace, VtsArtMeshTintState, VtsParameterInjection, VtsPhysicsControl, VTubeParameterMapping } from "../shared/bridge.js";

protocol.registerSchemesAsPrivileged([
  { scheme: "lumastage-model", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "lumastage-core", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: "lumastage-background", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "lumastage-item", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

function configuredPort(environmentName: string, fallback: number): number {
  const candidate = Number(process.env[environmentName]);
  return Number.isInteger(candidate) && candidate >= 1024 && candidate <= 65535 ? candidate : fallback;
}

const TRACKING_PORT = configuredPort("LUMASTAGE_TRACKING_PORT", 39510);
const VTS_API_PORT = configuredPort("LUMASTAGE_VTS_API_PORT", 8001);
const pairingCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
interface ClientSession {
  hello: HelloMessage;
  lastSequence: number;
}
const clients = new Map<WebSocket, ClientSession>();
let service: ReturnType<Bonjour["publish"]> | undefined;
let server: WebSocketServer | undefined;
let bonjour: Bonjour | undefined;
let activeModelRoot: string | undefined;
let activeApiModel: VtsCurrentModel | undefined;
let activeImportedModel: ImportedModel | undefined;
const activeExpressionFiles = new Set<string>();
let activeArtMeshNames: string[] = [];
const activeArtMeshGeometry = new Map<string, ArtMeshGeometry>();
const artMeshTints = new Map<string, { sessionID: string; tint: VtsColorTint; updatedAt: number }>();
interface ActivePhysicsOverride extends VtsPhysicsOverride { expiresAt: number }
let physicsController: { sessionID: string; pluginName: string; strength: ActivePhysicsOverride[]; wind: ActivePhysicsOverride[] } | undefined;
let activeDefaultMappings: VTubeParameterMapping[] = [];
const modelMappingOverrides = new Map<string, VTubeParameterMapping[]>();
let modelMappingSaveQueue: Promise<void> = Promise.resolve();
const modelDirectories = new Set<string>();
let modelDirectorySaveQueue: Promise<void> = Promise.resolve();
let sceneLibrary: StoredSceneLibrary = createDefaultSceneLibrary(randomUUID());
let activeBackgroundPath: string | undefined;
let sceneSaveQueue: Promise<void> = Promise.resolve();
let latestTrackingFrame: TrackingFrame | undefined;
let injectedFaceFound: { value: boolean; expiresAt: number } | undefined;
const injectedInputs = new Map<string, { value: number; weight: number; mode: "set" | "add"; expiresAt: number }>();
const trustedDevices = new Map<string, string>();
const pluginTokens = new Map<string, string>();
interface StoredCustomParameter extends VtsParameter { ownerKey: string; explanation: string }
const customParameters = new Map<string, StoredCustomParameter>();
let customParameterSaveQueue: Promise<void> = Promise.resolve();
interface ItemFileEntry { fileName: string; filePath: string; type: "PNG" | "JPG" | "GIF" }
const itemFiles = new Map<string, ItemFileEntry>();
const itemAnimationRuntime = new Map<string, { frameCount: number; currentFrame: number; framerate: number; animationPlaying: boolean }>();
let itemFileSaveQueue: Promise<void> = Promise.resolve();
const postProcessingDefaults: Record<string, VtsPostProcessingValue> = {
  ColorGrading_Strength: 0, ColorGrading_HueShift: 0, ColorGrading_Saturation: 0, ColorGrading_Brightness: 0,
  ColorGrading_Contrast: 0, ColorGrading_Invert: 0, Bloom_Strength: 0, Vignette_Strength: 0, Vignette_Smoothness: 0.9,
  ChromaticAberration_Strength: 0, BlurEffects_Strength: 0, BlurEffects_BasicBlurStrength: 0, Grain_Strength: 0, Grain_Size: 1.7
};
const postProcessingPresets: Record<string, Record<string, VtsPostProcessingValue>> = {
  Dreamy: { ColorGrading_Strength: 1, ColorGrading_HueShift: 8, ColorGrading_Saturation: 18, ColorGrading_Brightness: 4, Bloom_Strength: 0.42, Vignette_Strength: 0.18 },
  Noir: { ColorGrading_Strength: 1, ColorGrading_Saturation: -100, ColorGrading_Contrast: 24, Vignette_Strength: 0.48, Grain_Strength: 0.22 },
  Retro: { ColorGrading_Strength: 1, ColorGrading_HueShift: -12, ColorGrading_Saturation: -18, ColorGrading_Contrast: 14, ChromaticAberration_Strength: 0.3, Grain_Strength: 0.38, Grain_Size: 1.2 }
};
let postProcessingState: VtsPostProcessingState = { active: true, activePreset: "", presets: Object.keys(postProcessingPresets), values: { ...postProcessingDefaults } };
let postProcessingFadeTime = 0;
let postProcessingSaveQueue: Promise<void> = Promise.resolve();
const pluginSessions = new Map<WebSocket, VtsApiSession>();
const pendingPluginApprovals = new Map<string, { resolve(approved: boolean): void; timeout: NodeJS.Timeout }>();
let pendingArtMeshSelection: {
  prompt: ArtMeshSelectionPrompt;
  sessionID: string;
  resolve(result: VtsArtMeshSelectionResult | { error: "busy" }): void;
  timeout: NodeJS.Timeout;
} | undefined;
let vtsApiServer: WebSocketServer | undefined;
let vtsApiActive = false;
let testEventTimer: NodeJS.Timeout | undefined;
const vtsStartedAt = Date.now();

function trustedDevicesPath(): string {
  return join(app.getPath("userData"), "trusted-devices.json");
}

function pluginAccessPath(): string {
  return join(app.getPath("userData"), "plugin-api-access.json");
}

function customParametersPath(): string {
  return join(app.getPath("userData"), "custom-parameters.json");
}

function itemFilesPath(): string {
  return join(app.getPath("userData"), "item-files.json");
}

function modelMappingsPath(): string {
  return join(app.getPath("userData"), "model-mappings.json");
}

function modelDirectoriesPath(): string {
  return join(app.getPath("userData"), "models.json");
}

function postProcessingPath(): string {
  return join(app.getPath("userData"), "post-processing.json");
}

const postProcessingRanges: Record<string, [number, number]> = {
  ColorGrading_Strength: [0, 1], ColorGrading_HueShift: [-180, 180], ColorGrading_Saturation: [-100, 100],
  ColorGrading_Brightness: [-100, 100], ColorGrading_Contrast: [-100, 100], ColorGrading_Invert: [0, 1],
  Bloom_Strength: [0, 1], Vignette_Strength: [0, 1], Vignette_Smoothness: [0, 1], ChromaticAberration_Strength: [0, 1],
  BlurEffects_Strength: [0, 1], BlurEffects_BasicBlurStrength: [0, 1], Grain_Strength: [0, 1], Grain_Size: [0.1, 3]
};

function sanitizedPostProcessingValues(value: unknown): Record<string, VtsPostProcessingValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Post-processing values must be an object");
  const output: Record<string, VtsPostProcessingValue> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const range = postProcessingRanges[key];
    if (!range || typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`Unsupported post-processing value: ${key}`);
    output[key] = Math.min(range[1], Math.max(range[0], raw));
  }
  return output;
}

function publicPostProcessingState(): PostProcessingState {
  return { ...postProcessingState, presets: [...postProcessingState.presets], values: { ...postProcessingState.values }, fadeTime: postProcessingFadeTime };
}

function savePostProcessing(): Promise<void> {
  const payload = `${JSON.stringify({ active: postProcessingState.active, activePreset: postProcessingState.activePreset, values: postProcessingState.values }, null, 2)}\n`;
  const operation = postProcessingSaveQueue.catch(() => undefined).then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(postProcessingPath(), payload, { encoding: "utf8", mode: 0o600 });
  });
  postProcessingSaveQueue = operation;
  return operation;
}

async function loadPostProcessing(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(postProcessingPath(), "utf8")) as Record<string, unknown>;
    const values = sanitizedPostProcessingValues(parsed.values ?? {});
    const activePreset = typeof parsed.activePreset === "string" && (parsed.activePreset === "" || postProcessingPresets[parsed.activePreset]) ? parsed.activePreset : "";
    postProcessingState = { active: parsed.active !== false, activePreset, presets: Object.keys(postProcessingPresets), values: { ...postProcessingDefaults, ...values } };
  } catch {
    postProcessingState = { active: true, activePreset: "", presets: Object.keys(postProcessingPresets), values: { ...postProcessingDefaults } };
  }
}

async function updatePostProcessing(input: VtsPostProcessingUpdate): Promise<VtsPostProcessingState | { error: "preset-not-found" }> {
  let values = input.resetOthers ? { ...postProcessingDefaults } : { ...postProcessingState.values };
  let activePreset = postProcessingState.activePreset;
  if (input.preset !== undefined) {
    if (input.preset && !postProcessingPresets[input.preset]) return { error: "preset-not-found" };
    values = input.preset ? { ...postProcessingDefaults, ...postProcessingPresets[input.preset] } : values;
    activePreset = input.preset;
  }
  if (input.randomizeAll) {
    const chaos = Math.max(0, Math.min(1, input.chaosLevel));
    values = { ...postProcessingDefaults,
      ColorGrading_Strength: 1, ColorGrading_HueShift: (Math.random() * 80 - 40) * chaos, ColorGrading_Saturation: (Math.random() * 90 - 35) * chaos,
      Bloom_Strength: Math.random() * chaos * 0.8, Vignette_Strength: Math.random() * chaos * 0.65,
      ChromaticAberration_Strength: Math.random() * chaos * 0.6, Grain_Strength: Math.random() * chaos * 0.55
    };
    activePreset = "";
  }
  if (input.values) { values = { ...values, ...sanitizedPostProcessingValues(input.values) }; activePreset = ""; }
  postProcessingFadeTime = input.fadeTime;
  postProcessingState = { active: input.active ?? postProcessingState.active, activePreset, presets: Object.keys(postProcessingPresets), values };
  await savePostProcessing();
  broadcast("post-processing-changed", publicPostProcessingState());
  return postProcessingState;
}

function saveModelDirectories(): Promise<void> {
  const payload = `${JSON.stringify([...modelDirectories], null, 2)}\n`;
  const operation = modelDirectorySaveQueue.catch(() => undefined).then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(modelDirectoriesPath(), payload, { encoding: "utf8", mode: 0o600 });
  });
  modelDirectorySaveQueue = operation;
  return operation;
}

async function loadModelDirectories(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(modelDirectoriesPath(), "utf8")) as unknown;
    if (Array.isArray(parsed)) for (const directory of parsed) if (typeof directory === "string" && directory.length <= 4096) modelDirectories.add(directory);
  } catch {
    // First launch or invalid model library.
  }
}

async function backfillModelDirectoriesFromScenes(): Promise<void> {
  for (const scene of sceneLibrary.scenes) if (scene.modelDirectory) modelDirectories.add(scene.modelDirectory);
  await saveModelDirectories();
}

function modelMappingKey(directory: string): string {
  return createHash("sha256").update(directory, "utf8").digest("hex");
}

function saveModelMappingOverrides(): Promise<void> {
  const payload = `${JSON.stringify(Object.fromEntries(modelMappingOverrides), null, 2)}\n`;
  const operation = modelMappingSaveQueue.catch(() => undefined).then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(modelMappingsPath(), payload, { encoding: "utf8", mode: 0o600 });
  });
  modelMappingSaveQueue = operation;
  return operation;
}

async function loadModelMappingOverrides(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(modelMappingsPath(), "utf8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (!/^[a-f0-9]{64}$/.test(key)) continue;
      try { modelMappingOverrides.set(key, parseEditableVTubeParameterMappings(value)); } catch { /* Ignore one invalid model override. */ }
    }
  } catch {
    // First launch or invalid mapping registry.
  }
}

function saveItemFiles(): Promise<void> {
  const payload = `${JSON.stringify(Object.fromEntries(itemFiles), null, 2)}\n`;
  const operation = itemFileSaveQueue.catch(() => undefined).then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(itemFilesPath(), payload, { encoding: "utf8", mode: 0o600 });
  });
  itemFileSaveQueue = operation;
  return operation;
}

async function loadItemFiles(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(itemFilesPath(), "utf8")) as Record<string, unknown>;
    for (const [fileName, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.filePath !== "string" || !["PNG", "JPG", "GIF"].includes(String(entry.type))) continue;
      itemFiles.set(fileName, { fileName, filePath: entry.filePath, type: entry.type as ItemFileEntry["type"] });
    }
  } catch {
    // First launch or invalid item file registry.
  }
}

async function backfillItemFilesFromScenes(): Promise<void> {
  for (const scene of sceneLibrary.scenes) for (const item of scene.items) itemFiles.set(item.fileName, { fileName: item.fileName, filePath: item.filePath, type: item.type });
  await saveItemFiles();
}

function saveCustomParameters(): Promise<void> {
  const payload = `${JSON.stringify(Object.fromEntries(customParameters), null, 2)}\n`;
  const operation = customParameterSaveQueue.catch(() => undefined).then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(customParametersPath(), payload, { encoding: "utf8", mode: 0o600 });
  });
  customParameterSaveQueue = operation;
  return operation;
}

async function loadCustomParameters(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(customParametersPath(), "utf8")) as Record<string, unknown>;
    for (const [name, value] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9]{4,32}$/.test(name) || !value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      if (typeof item.ownerKey !== "string" || typeof item.addedBy !== "string" || typeof item.explanation !== "string") continue;
      if (![item.min, item.max, item.defaultValue].every((number) => typeof number === "number" && Number.isFinite(number))) continue;
      customParameters.set(name, { name, ownerKey: item.ownerKey, addedBy: item.addedBy, explanation: item.explanation, min: item.min as number, max: item.max as number, defaultValue: item.defaultValue as number, value: item.defaultValue as number });
    }
  } catch {
    // First launch or invalid custom parameter registry.
  }
}

async function createCustomParameter(pluginName: string, pluginDeveloper: string, parameter: VtsCustomParameterDefinition): Promise<"created" | "owned-by-other" | "limit"> {
  const ownerKey = pluginKey(pluginName, pluginDeveloper);
  const existing = customParameters.get(parameter.parameterName);
  if (existing && existing.ownerKey !== ownerKey) return "owned-by-other";
  const ownedCount = [...customParameters.values()].filter((item) => item.ownerKey === ownerKey).length;
  if (!existing && (customParameters.size >= 300 || ownedCount >= 100)) return "limit";
  customParameters.set(parameter.parameterName, {
    name: parameter.parameterName, ownerKey, addedBy: pluginName, explanation: parameter.explanation,
    min: parameter.min, max: parameter.max, defaultValue: parameter.defaultValue, value: parameter.defaultValue
  });
  await saveCustomParameters();
  return "created";
}

async function deleteCustomParameter(pluginName: string, pluginDeveloper: string, parameterName: string): Promise<"deleted" | "not-found" | "owned-by-other"> {
  const existing = customParameters.get(parameterName);
  if (!existing) return "not-found";
  if (existing.ownerKey !== pluginKey(pluginName, pluginDeveloper)) return "owned-by-other";
  customParameters.delete(parameterName);
  injectedInputs.delete(parameterName);
  await saveCustomParameters();
  return "deleted";
}

function scenesPath(): string {
  return join(app.getPath("userData"), "scenes.json");
}

function storedActiveScene(): StoredScenePreset {
  return sceneLibrary.scenes.find((scene) => scene.id === sceneLibrary.activeSceneId) ?? sceneLibrary.scenes[0];
}

function publicScene(scene: StoredScenePreset): ScenePreset {
  return {
    id: scene.id,
    name: scene.name,
    background: scene.background.kind === "image"
      ? { kind: "image", imageUrl: scene.id === sceneLibrary.activeSceneId ? "lumastage-background://active/image" : "" }
      : scene.background,
    transform: scene.transform,
    items: scene.items.map(publicSceneItem),
    modelName: scene.modelName
  };
}

function publicSceneItem(item: StoredSceneItem): SceneItem {
  const animation = itemAnimationRuntime.get(item.id);
  return {
    id: item.id, fileName: item.fileName, imageUrl: `lumastage-item://active/${encodeURIComponent(item.id)}`, type: item.type,
    positionX: item.positionX, positionY: item.positionY, size: item.size, rotation: item.rotation, order: item.order,
    flipped: item.flipped, locked: item.locked, opacity: item.opacity, brightness: item.brightness,
    animationFramerate: animation?.framerate ?? item.animationFramerate, animationFrame: animation?.currentFrame ?? item.animationFrame,
    animationFrameCount: item.type === "GIF" ? animation?.frameCount ?? 1 : -1, animationPlaying: animation?.animationPlaying ?? item.animationPlaying,
    animationAutoStopFrames: item.animationAutoStopFrames, animationRevision: item.animationRevision, pin: item.pin
  };
}

function publicSceneLibrary(): SceneLibrary {
  return { version: 1, activeSceneId: sceneLibrary.activeSceneId, scenes: sceneLibrary.scenes.map(publicScene) };
}

function saveScenes(): Promise<void> {
  const payload = `${JSON.stringify(sceneLibrary, null, 2)}\n`;
  const operation = sceneSaveQueue.catch(() => undefined).then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(scenesPath(), payload, { encoding: "utf8", mode: 0o600 });
  });
  sceneSaveQueue = operation;
  return operation;
}

async function loadScenes(): Promise<void> {
  const fallbackId = randomUUID();
  try {
    sceneLibrary = parseSceneLibrary(JSON.parse(await readFile(scenesPath(), "utf8")), fallbackId);
  } catch {
    sceneLibrary = createDefaultSceneLibrary(fallbackId);
  }
  await saveScenes();
  const background = storedActiveScene().background;
  activeBackgroundPath = background.kind === "image" ? background.imagePath : undefined;
}

function clearActiveModel(): void {
  globalShortcut.unregisterAll();
  activeModelRoot = undefined;
  activeApiModel = undefined;
  activeImportedModel = undefined;
  activeDefaultMappings = [];
  activeExpressionFiles.clear();
  activeArtMeshNames = [];
  activeArtMeshGeometry.clear();
  artMeshTints.clear();
  physicsController = undefined;
  publishArtMeshTints();
  publishPhysicsControl();
}

function electronAccelerator(triggers: string[]): string | undefined {
  const mapped = triggers.map((trigger) => {
    const normalized = trigger.trim().toUpperCase();
    if (["CTRL", "CONTROL", "LEFT CONTROL", "RIGHT CONTROL", "COMMANDORCONTROL"].includes(normalized)) return "CommandOrControl";
    if (["SHIFT", "LEFT SHIFT", "RIGHT SHIFT"].includes(normalized)) return "Shift";
    if (["ALT", "OPTION", "LEFT ALT", "RIGHT ALT"].includes(normalized)) return "Alt";
    if (["COMMAND", "LEFT COMMAND", "RIGHT COMMAND", "META"].includes(normalized)) return "Command";
    if (normalized === "SPACE") return "Space";
    if (normalized === "ESC") return "Escape";
    if (/^[A-Z0-9]$/.test(normalized) || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(normalized) || ["TAB", "ENTER", "ESCAPE", "UP", "DOWN", "LEFT", "RIGHT"].includes(normalized)) return normalized;
    return undefined;
  });
  return mapped.length > 0 && mapped.every(Boolean) ? [...new Set(mapped as string[])].join("+") : undefined;
}

function dispatchImportedHotkey(hotkey: ImportedHotkey, triggeredByAPI: boolean): void {
  const apiHotkey = activeApiModel?.hotkeys.find((candidate) => candidate.hotkeyID === hotkey.id);
  if (!apiHotkey) return;
  if (apiHotkey.type.toLowerCase().includes("expression") && apiHotkey.file) {
    if (activeExpressionFiles.has(apiHotkey.file)) activeExpressionFiles.delete(apiHotkey.file); else activeExpressionFiles.add(apiHotkey.file);
  }
  broadcast("vts-hotkey-trigger", hotkey);
  sendVtsEvent("HotkeyTriggeredEvent", hotkeyEventData(apiHotkey, triggeredByAPI));
}

function registerGlobalModelHotkeys(): void {
  globalShortcut.unregisterAll();
  for (const hotkey of activeImportedModel?.vTubeHotkeys ?? []) {
    if (!hotkey.isActive || !hotkey.isGlobal) continue;
    const accelerator = electronAccelerator(hotkey.triggers);
    if (!accelerator) continue;
    try { globalShortcut.register(accelerator, () => dispatchImportedHotkey(hotkey, false)); } catch { /* Invalid or OS-reserved combinations remain available as UI buttons. */ }
  }
}

async function loadActiveSceneModel(): Promise<ImportedModel | null> {
  const scene = storedActiveScene();
  activeBackgroundPath = scene.background.kind === "image" ? scene.background.imagePath : undefined;
  if (!scene.modelDirectory) {
    clearActiveModel();
    return null;
  }
  try {
    return await inspectModelDirectory(scene.modelDirectory);
  } catch {
    clearActiveModel();
    return null;
  }
}

async function sceneWorkspace(reloadModel = false): Promise<SceneWorkspace> {
  const model = reloadModel ? await loadActiveSceneModel() : activeImportedModel ?? null;
  return { library: publicSceneLibrary(), model };
}

function requireSceneId(value: unknown): string {
  if (typeof value !== "string" || !sceneLibrary.scenes.some((scene) => scene.id === value)) throw new Error("Scene does not exist");
  return value;
}

function requireScene(value: unknown): StoredScenePreset {
  const id = requireSceneId(value);
  return sceneLibrary.scenes.find((scene) => scene.id === id)!;
}

function requireSceneItem(scene: StoredScenePreset, value: unknown): StoredSceneItem {
  if (typeof value !== "string") throw new Error("Item ID must be a string");
  const item = scene.items.find((candidate) => candidate.id === value);
  if (!item) throw new Error("Scene item does not exist");
  return item;
}

function imageItemType(path: string): "PNG" | "JPG" | "GIF" | undefined {
  const extension = path.toLowerCase().split(".").pop();
  return extension === "png" ? "PNG" : extension === "jpg" || extension === "jpeg" ? "JPG" : extension === "gif" ? "GIF" : undefined;
}

function availableItemOrder(scene: StoredScenePreset): number | undefined {
  const used = new Set(scene.items.map((item) => item.order));
  return [...Array.from({ length: 30 }, (_, index) => index + 1), ...Array.from({ length: 30 }, (_, index) => -index - 1)].find((order) => !used.has(order));
}

function itemEventData(item: StoredSceneItem, itemEventType: string): Record<string, unknown> {
  return { itemEventType, itemInstanceID: item.id, itemFileName: item.fileName, itemPosition: { x: item.positionX, y: item.positionY } };
}

function vtsSceneItem(item: StoredSceneItem): VtsSceneItem {
  const animation = itemAnimationRuntime.get(item.id);
  return {
    fileName: item.fileName, instanceID: item.id, order: item.order, type: item.type, censored: item.censored,
    flipped: item.flipped, locked: item.locked, smoothing: item.smoothing,
    framerate: item.type === "GIF" ? animation?.framerate ?? item.animationFramerate : 0,
    frameCount: item.type === "GIF" ? animation?.frameCount ?? 1 : -1,
    currentFrame: item.type === "GIF" ? animation?.currentFrame ?? item.animationFrame : -1,
    pinnedToModel: Boolean(item.pin), pinnedModelID: item.pin?.modelID ?? "", pinnedArtMeshID: item.pin?.artMeshID ?? "",
    groupName: "", sceneName: storedActiveScene().name, fromWorkshop: false
  };
}

async function prepareGifAnimation(item: StoredSceneItem): Promise<void> {
  if (item.type !== "GIF") return;
  try {
    const metadata = inspectGifAnimation(await readFile(item.filePath));
    if (!metadata) return;
    itemAnimationRuntime.set(item.id, {
      frameCount: metadata.frameCount,
      currentFrame: Math.min(item.animationFrame, metadata.frameCount - 1),
      framerate: item.animationFramerate,
      animationPlaying: item.animationPlaying
    });
  } catch {
    // The asset protocol/renderer will surface unreadable or invalid image files.
  }
}

async function prepareAllGifAnimations(): Promise<void> {
  await Promise.all(sceneLibrary.scenes.flatMap((scene) => scene.items.map(prepareGifAnimation)));
}

function broadcastSceneWorkspace(): void {
  broadcast("scene-workspace-changed", { library: publicSceneLibrary(), model: activeImportedModel ?? null } satisfies SceneWorkspace);
}

function itemFileCatalog(): Map<string, ItemFileEntry> {
  const catalog = new Map(itemFiles);
  for (const scene of sceneLibrary.scenes) for (const item of scene.items) if (!catalog.has(item.fileName)) catalog.set(item.fileName, { fileName: item.fileName, filePath: item.filePath, type: item.type });
  return catalog;
}

function listVtsItems(): ReturnType<VtsApiHost["listItems"]> {
  const scene = storedActiveScene();
  const used = new Set(scene.items.map((item) => item.order));
  const availableSpots = [...Array.from({ length: 30 }, (_, index) => -30 + index), ...Array.from({ length: 30 }, (_, index) => index + 1)].filter((order) => !used.has(order));
  const catalog = itemFileCatalog();
  return {
    items: scene.items.map(vtsSceneItem), availableSpots,
    availableItemFiles: [...catalog.values()].map((item) => ({ fileName: item.fileName, type: item.type, loadedCount: scene.items.filter((candidate) => candidate.fileName === item.fileName).length }))
  };
}

async function loadVtsItem(pluginName: string, pluginDeveloper: string, ownerSessionID: string, input: VtsItemLoadInput): Promise<{ item?: VtsSceneItem; error?: "not-found" | "limit" | "order" }> {
  const scene = storedActiveScene();
  if (scene.items.length >= 60) return { error: "limit" };
  const source = itemFileCatalog().get(input.fileName);
  if (!source) return { error: "not-found" };
  try {
    const sourceStat = await stat(source.filePath);
    if (!sourceStat.isFile() || sourceStat.size > 20 * 1024 * 1024) return { error: "not-found" };
  } catch {
    return { error: "not-found" };
  }
  const used = new Set(scene.items.map((item) => item.order));
  let order = input.order;
  if (used.has(order)) {
    if (input.failIfOrderTaken) return { error: "order" };
    const candidates = [...Array.from({ length: 30 - order }, (_, index) => order + index + 1), ...listVtsItems().availableSpots];
    const replacement = candidates.find((candidate) => candidate !== 0 && candidate >= -30 && candidate <= 30 && !used.has(candidate));
    if (replacement === undefined) return { error: "limit" };
    order = replacement;
  }
  const item: StoredSceneItem = {
    id: randomUUID(), fileName: source.fileName, filePath: source.filePath, type: source.type,
    positionX: input.positionX, positionY: input.positionY, size: input.size,
    rotation: input.rotation, order, smoothing: input.smoothing, censored: input.censored, flipped: input.flipped,
    locked: input.locked, opacity: 1, brightness: 1, animationFramerate: 30, animationFrame: 0,
    animationPlaying: true, animationAutoStopFrames: [], animationRevision: 0,
    unloadWhenPluginDisconnects: input.unloadWhenPluginDisconnects,
    ownerKey: pluginKey(pluginName, pluginDeveloper), ownerSessionID
  };
  scene.items.push(item);
  await prepareGifAnimation(item);
  await saveScenes();
  broadcastSceneWorkspace();
  sendVtsEvent("ItemEvent", itemEventData(item, "Added"));
  return { item: vtsSceneItem(item) };
}

async function unloadVtsItems(pluginName: string, pluginDeveloper: string, input: { unloadAllInScene: boolean; unloadAllLoadedByThisPlugin: boolean; allowOthers: boolean; instanceIDs: string[]; fileNames: string[] }): Promise<VtsSceneItem[]> {
  const scene = storedActiveScene();
  const owner = pluginKey(pluginName, pluginDeveloper);
  const removed = scene.items.filter((item) => {
    if (!input.allowOthers && item.ownerKey !== owner) return false;
    if (input.unloadAllInScene) return true;
    if (input.unloadAllLoadedByThisPlugin && item.ownerKey === owner) return true;
    return input.instanceIDs.includes(item.id) || input.fileNames.includes(item.fileName);
  });
  if (removed.length === 0) return [];
  const removedIDs = new Set(removed.map((item) => item.id));
  scene.items = scene.items.filter((item) => !removedIDs.has(item.id));
  for (const id of removedIDs) itemAnimationRuntime.delete(id);
  await saveScenes();
  broadcastSceneWorkspace();
  for (const item of removed) sendVtsEvent("ItemEvent", itemEventData(item, "Removed"));
  return removed.map(vtsSceneItem);
}

async function controlVtsItemAnimation(input: VtsItemAnimationControlInput): Promise<VtsItemAnimationControlResult> {
  const item = storedActiveScene().items.find((candidate) => candidate.id === input.itemInstanceID);
  if (!item) return { error: "not-found" };
  const hasAnimationControl = input.framerate !== undefined || input.frame !== undefined || input.setAutoStopFrames || input.setAnimationPlayState;
  if (item.type !== "GIF" && hasAnimationControl) return { error: "simple-image" };
  const runtime = itemAnimationRuntime.get(item.id);
  const frameCount = runtime?.frameCount ?? (item.type === "GIF" ? 1 : -1);
  if (input.autoStopFrames.length > 1024) return { error: "too-many-auto-stop-frames" };
  if (input.frame !== undefined && (input.frame < 0 || input.frame >= frameCount)) return { error: "invalid-frame" };
  if (input.setAutoStopFrames && input.autoStopFrames.some((frame) => frame < 0 || frame >= frameCount)) return { error: "invalid-frame" };
  if (input.brightness !== undefined) item.brightness = Math.max(0, Math.min(1, input.brightness));
  if (input.opacity !== undefined) item.opacity = Math.max(0, Math.min(1, input.opacity));
  if (item.type === "GIF") {
    if (input.framerate !== undefined) item.animationFramerate = Math.max(0.1, Math.min(120, input.framerate));
    if (input.frame !== undefined) item.animationFrame = input.frame;
    if (input.setAutoStopFrames) item.animationAutoStopFrames = [...new Set(input.autoStopFrames)];
    if (input.setAnimationPlayState) item.animationPlaying = input.animationPlayState;
    item.animationRevision += 1;
    itemAnimationRuntime.set(item.id, {
      frameCount, currentFrame: input.frame ?? runtime?.currentFrame ?? item.animationFrame,
      framerate: item.animationFramerate,
      animationPlaying: input.setAnimationPlayState ? input.animationPlayState : runtime?.animationPlaying ?? item.animationPlaying
    });
  }
  await saveScenes();
  broadcastSceneWorkspace();
  sendVtsEvent("ItemEvent", itemEventData(item, "Changed"));
  const current = itemAnimationRuntime.get(item.id);
  return { frame: item.type === "GIF" ? current?.currentFrame ?? item.animationFrame : -1, animationPlaying: item.type === "GIF" ? current?.animationPlaying ?? item.animationPlaying : false };
}

async function moveVtsItems(inputs: VtsItemMoveInput[]): Promise<Array<{ itemInstanceID: string; success: boolean; errorID: number }>> {
  const scene = storedActiveScene();
  const latest = new Map(inputs.map((input) => [input.itemInstanceID, input]));
  const results: Array<{ itemInstanceID: string; success: boolean; errorID: number }> = [];
  for (const input of latest.values()) {
    const item = scene.items.find((candidate) => candidate.id === input.itemInstanceID);
    if (!item || item.locked) { results.push({ itemInstanceID: input.itemInstanceID, success: false, errorID: 1122 }); continue; }
    if (input.order !== undefined && (!Number.isInteger(input.order) || input.order === 0 || input.order < -30 || input.order > 30 || scene.items.some((candidate) => candidate.id !== item.id && candidate.order === input.order))) {
      results.push({ itemInstanceID: input.itemInstanceID, success: false, errorID: 1123 }); continue;
    }
    Object.assign(item, normalizeSceneItemTransform({ ...input, flipped: input.setFlip ? input.flip : item.flipped }, item));
    if (input.order !== undefined) item.order = input.order;
    results.push({ itemInstanceID: item.id, success: true, errorID: -1 });
  }
  if (results.some((result) => result.success)) {
    await saveScenes();
    broadcastSceneWorkspace();
  }
  return results;
}

function triangleMatches(indices: number[], vertexIDs: [number, number, number]): boolean {
  const requested = [...vertexIDs].sort((left, right) => left - right).join(",");
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    if ([indices[offset], indices[offset + 1], indices[offset + 2]].sort((left, right) => left - right).join(",") === requested) return true;
  }
  return false;
}

async function pinVtsItem(input: VtsItemPinInput): ReturnType<VtsApiHost["pinItem"]> {
  const scene = storedActiveScene();
  const item = scene.items.find((candidate) => candidate.id === input.itemInstanceID);
  if (!item) return { error: "item-not-found" };
  if (!input.pin) {
    delete item.pin;
    await saveScenes();
    broadcastSceneWorkspace();
    sendVtsEvent("ItemEvent", itemEventData(item, "Changed"));
    return { item: vtsSceneItem(item) };
  }
  const info = input.pinInfo;
  if (!info || !activeApiModel || (info.modelID && info.modelID !== activeApiModel.modelID)) return { error: "model-not-found" };
  const geometries = [...activeArtMeshGeometry.values()];
  const geometry = info.artMeshID
    ? activeArtMeshGeometry.get(info.artMeshID)
    : geometries.length > 0 ? geometries[Math.floor(Math.random() * geometries.length)] : undefined;
  if (!geometry) return { error: "artmesh-not-found" };
  const triangleCount = Math.floor(geometry.indices.length / 3);
  if (triangleCount === 0) return { error: "invalid-position" };

  let vertexIDs: [number, number, number];
  let weights: [number, number, number];
  if (input.vertexPinType === "Provided") {
    vertexIDs = [info.vertexID1, info.vertexID2, info.vertexID3];
    weights = [info.vertexWeight1, info.vertexWeight2, info.vertexWeight3];
    if (vertexIDs.some((vertexID) => vertexID >= geometry.vertexCount) || !triangleMatches(geometry.indices, vertexIDs) || weights.some((weight) => weight < 0 || weight > 1) || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-5) {
      return { error: "invalid-position" };
    }
  } else {
    const triangleIndex = input.vertexPinType === "Random" ? Math.floor(Math.random() * triangleCount) : Math.floor(triangleCount / 2);
    vertexIDs = [geometry.indices[triangleIndex * 3], geometry.indices[triangleIndex * 3 + 1], geometry.indices[triangleIndex * 3 + 2]];
    if (input.vertexPinType === "Random") {
      const root = Math.sqrt(Math.random()), split = Math.random();
      weights = [1 - root, root * (1 - split), root * split];
    } else {
      weights = [1 / 3, 1 / 3, 1 / 3];
    }
  }

  const resolvedSize = input.sizeRelativeTo === "RelativeToCurrentItemSize" ? item.size + info.size : info.size;
  if (!Number.isFinite(resolvedSize) || resolvedSize < 0 || resolvedSize > 1) return { error: "invalid-position" };
  const angleRelativeTo = input.angleRelativeTo === "RelativeToCurrentItemRotation" ? "RelativeToWorld" : input.angleRelativeTo;
  const angle = input.angleRelativeTo === "RelativeToCurrentItemRotation" ? item.rotation + info.angle : info.angle;
  if (!angleRelativeTo || !Number.isFinite(angle)) return { error: "invalid-mode" };
  item.size = resolvedSize;
  item.pin = {
    modelID: activeApiModel.modelID, artMeshID: geometry.id, angleRelativeTo, angle,
    vertexID1: vertexIDs[0], vertexID2: vertexIDs[1], vertexID3: vertexIDs[2],
    vertexWeight1: weights[0], vertexWeight2: weights[1], vertexWeight3: weights[2]
  };
  await saveScenes();
  broadcastSceneWorkspace();
  sendVtsEvent("ItemEvent", itemEventData(item, "Changed"));
  return { item: vtsSceneItem(item) };
}

async function cleanupDisconnectedPluginItems(apiSession: VtsApiSession): Promise<void> {
  if (!apiSession.sessionID) return;
  const scene = storedActiveScene();
  const removed = scene.items.filter((item) => item.ownerSessionID === apiSession.sessionID && item.unloadWhenPluginDisconnects);
  if (!removed.length) return;
  const ids = new Set(removed.map((item) => item.id));
  scene.items = scene.items.filter((item) => !ids.has(item.id));
  for (const id of ids) itemAnimationRuntime.delete(id);
  await saveScenes();
  broadcastSceneWorkspace();
  for (const item of removed) sendVtsEvent("ItemEvent", itemEventData(item, "Removed"));
}

function pluginKey(name: string, developer: string): string {
  return `${name}\u0000${developer}`;
}

const defaultVtsParameterDefinitions: Array<Omit<VtsParameter, "value" | "addedBy">> = [
  { name: "FaceAngleX", min: -30, max: 30, defaultValue: 0 },
  { name: "FaceAngleY", min: -30, max: 30, defaultValue: 0 },
  { name: "FaceAngleZ", min: -30, max: 30, defaultValue: 0 },
  { name: "FacePositionX", min: -10, max: 10, defaultValue: 0 },
  { name: "FacePositionY", min: -10, max: 10, defaultValue: 0 },
  { name: "FacePositionZ", min: -10, max: 10, defaultValue: 0 },
  { name: "EyeOpenLeft", min: 0, max: 1.5, defaultValue: 1 },
  { name: "EyeOpenRight", min: 0, max: 1.5, defaultValue: 1 },
  { name: "EyeLeftX", min: -1, max: 1, defaultValue: 0 },
  { name: "EyeLeftY", min: -1, max: 1, defaultValue: 0 },
  { name: "EyeRightX", min: -1, max: 1, defaultValue: 0 },
  { name: "EyeRightY", min: -1, max: 1, defaultValue: 0 },
  { name: "MouthOpen", min: 0, max: 1, defaultValue: 0 },
  { name: "MouthSmile", min: 0, max: 1, defaultValue: 0 },
  { name: "VoiceVolumePlusMouthOpen", min: 0, max: 1, defaultValue: 0 },
  { name: "BrowLeftY", min: -1, max: 1, defaultValue: 0 },
  { name: "BrowRightY", min: -1, max: 1, defaultValue: 0 },
  { name: "Brows", min: -1, max: 1, defaultValue: 0 },
  { name: "CheekPuff", min: 0, max: 1, defaultValue: 0 },
  { name: "FaceAngry", min: 0, max: 1, defaultValue: 0 },
  { name: "MouthX", min: -1, max: 1, defaultValue: 0 },
  { name: "TongueOut", min: 0, max: 1, defaultValue: 0 }
];

function currentVtsInputs(now = Date.now()): Record<string, number> {
  const defaults = Object.fromEntries([
    ...defaultVtsParameterDefinitions.map((parameter) => [parameter.name, parameter.defaultValue] as const),
    ...[...customParameters.values()].map((parameter) => [parameter.name, parameter.defaultValue] as const)
  ]);
  const values = latestTrackingFrame ? { ...defaults, ...mapARKitToVTubeInputs(latestTrackingFrame) } : defaults;
  for (const [id, injected] of injectedInputs) {
    if (injected.expiresAt < now) {
      injectedInputs.delete(id);
      continue;
    }
    const base = values[id] ?? 0;
    values[id] = injected.mode === "add" ? base + injected.value * injected.weight : base * (1 - injected.weight) + injected.value * injected.weight;
  }
  return values;
}

function inputParameterLists(): { defaultParameters: VtsParameter[]; customParameters: VtsParameter[] } {
  const values = currentVtsInputs();
  const defaultNames = new Set(defaultVtsParameterDefinitions.map((parameter) => parameter.name));
  const defaultParameters = defaultVtsParameterDefinitions.map((parameter) => ({ ...parameter, addedBy: "VTube Studio", value: values[parameter.name] }));
  const registered = [...customParameters.values()].map((parameter) => ({
    name: parameter.name, addedBy: parameter.addedBy, value: values[parameter.name] ?? parameter.defaultValue,
    min: parameter.min, max: parameter.max, defaultValue: parameter.defaultValue
  }));
  const registeredNames = new Set(registered.map((parameter) => parameter.name));
  const mappedNames = new Set((activeImportedModel?.vTubeParameterMappings ?? []).map((mapping) => mapping.input).filter((name) => !defaultNames.has(name) && !registeredNames.has(name)));
  const mapped = [...mappedNames].map((name) => ({ name, addedBy: "LumaStage model mapping", value: values[name] ?? 0, min: -1_000_000, max: 1_000_000, defaultValue: 0 }));
  return { defaultParameters, customParameters: [...registered, ...mapped] };
}

function live2DParameterList(): VtsParameter[] {
  const inputs = currentVtsInputs();
  const mappings = activeImportedModel?.vTubeParameterMappings ?? [];
  if (mappings.length > 0) {
    const values = applyVTubeParameterMappingsToInputs(inputs, mappings);
    return mappings.map((mapping) => ({
      name: mapping.outputLive2D,
      value: values[mapping.outputLive2D] ?? 0,
      min: Math.min(mapping.outputRangeLower, mapping.outputRangeUpper),
      max: Math.max(mapping.outputRangeLower, mapping.outputRangeUpper),
      defaultValue: 0
    }));
  }
  const aliases: Array<[string, string, number, number, number]> = [
    ["FaceAngleX", "ParamAngleX", -30, 30, 0], ["FaceAngleY", "ParamAngleY", -30, 30, 0], ["FaceAngleZ", "ParamAngleZ", -30, 30, 0],
    ["EyeOpenLeft", "ParamEyeLOpen", 0, 1.5, 1], ["EyeOpenRight", "ParamEyeROpen", 0, 1.5, 1],
    ["EyeLeftX", "ParamEyeBallX", -1, 1, 0], ["EyeLeftY", "ParamEyeBallY", -1, 1, 0],
    ["MouthOpen", "ParamMouthOpenY", 0, 1, 0], ["MouthSmile", "ParamMouthForm", -1, 1, 0],
    ["BrowLeftY", "ParamBrowLY", -1, 1, 0], ["BrowRightY", "ParamBrowRY", -1, 1, 0]
  ];
  return aliases.map(([input, name, min, max, defaultValue]) => ({ name, value: inputs[input], min, max, defaultValue }));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadTrustedDevices(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(trustedDevicesPath(), "utf8")) as Record<string, unknown>;
    for (const [deviceId, tokenHash] of Object.entries(parsed)) {
      if (typeof tokenHash === "string" && /^[a-f0-9]{64}$/i.test(tokenHash)) trustedDevices.set(deviceId, tokenHash);
    }
  } catch {
    // First launch or an invalid local trust file: start with an empty registry.
  }
}

async function trustDevice(deviceId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  trustedDevices.set(deviceId, hashToken(token));
  await saveTrustedDevices();
  return token;
}

async function saveTrustedDevices(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(trustedDevicesPath(), `${JSON.stringify(Object.fromEntries(trustedDevices), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function loadPluginAccess(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(pluginAccessPath(), "utf8")) as Record<string, unknown>;
    for (const [key, tokenHash] of Object.entries(parsed)) {
      if (typeof tokenHash === "string" && /^[a-f0-9]{64}$/i.test(tokenHash)) pluginTokens.set(key, tokenHash);
    }
  } catch {
    // First launch or invalid local plugin access file.
  }
}

async function savePluginAccess(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(pluginAccessPath(), `${JSON.stringify(Object.fromEntries(pluginTokens), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function requestPluginApproval(pluginName: string, pluginDeveloper: string, pluginIcon?: string): Promise<boolean> {
  const id = randomUUID();
  const safeIcon = pluginIcon && pluginIcon.length <= 350_000 ? pluginIcon : undefined;
  const prompt: PluginAuthorizationRequest = { id, pluginName, pluginDeveloper, pluginIcon: safeIcon };
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPluginApprovals.delete(id);
      resolve(false);
    }, 60_000);
    pendingPluginApprovals.set(id, { resolve, timeout });
    broadcast("plugin-authorization-request", prompt);
  });
}

async function issuePluginToken(pluginName: string, pluginDeveloper: string, pluginIcon?: string): Promise<string | undefined> {
  if (!await requestPluginApproval(pluginName, pluginDeveloper, pluginIcon)) return undefined;
  const token = randomBytes(32).toString("hex");
  pluginTokens.set(pluginKey(pluginName, pluginDeveloper), hashToken(token));
  await savePluginAccess();
  publishStatus();
  return token;
}

function normalizePairingToken(token: string | undefined): string {
  if (!token) return "";
  // Accept only digit runs so invisible paste/keyboard junk cannot break Windows pairing.
  return token.replace(/\D/g, "");
}

async function authorizeHello(hello: HelloMessage): Promise<{ deviceToken?: string } | undefined> {
  const storedHash = trustedDevices.get(hello.deviceId);
  if (hello.token && storedHash && hashesMatch(hashToken(hello.token), storedHash)) return {};
  const offered = normalizePairingToken(hello.token);
  if (offered.length === 6 && offered === pairingCode) return { deviceToken: await trustDevice(hello.deviceId) };
  // Fallback exact match for any non-digit device tokens already issued.
  if (hello.token && hello.token === pairingCode) return { deviceToken: await trustDevice(hello.deviceId) };
  console.warn(
    `[LumaStage] Pairing rejected for ${hello.deviceName}: tokenLen=${hello.token?.length ?? 0} digits=${offered.length} expected=${pairingCode}`
  );
  return undefined;
}

function cubismCorePath(): string {
  return join(app.getPath("userData"), "runtime", "live2dcubismcore.min.js");
}

// pixi-live2d-display 0.5 targets the Cubism 5.2 Core ABI. Live2D keeps this
// official compatible build under the versioned /05 path; unversioned Latest
// currently serves Core 6 and does not expose the render-order array expected
// by this renderer adapter.
const LIVE2D_CORE_URL = "https://cubism.live2d.com/sdk-web/core/05/live2dcubismcore.min.js";
const LIVE2D_WEB_SDK_PAGE = "https://www.live2d.com/en/sdk/download/web/";

async function validateAndInstallCubismCore(source: Uint8Array): Promise<CubismCoreStatus> {
  if (source.byteLength === 0 || source.byteLength > 16 * 1024 * 1024) throw new Error("Cubism Core file has an invalid size");
  const text = new TextDecoder().decode(source);
  if (!text.includes("Live2DCubismCore") || !text.includes("Moc")) throw new Error("Downloaded file is not Live2D Cubism Core for Web");
  if (!text.includes("csmGetDrawableRenderOrders")) throw new Error("This Cubism Core version is not compatible. Select Cubism SDK for Web 5.x.");
  await mkdir(join(app.getPath("userData"), "runtime"), { recursive: true });
  await writeFile(cubismCorePath(), source, { mode: 0o600 });
  return coreStatus();
}

async function chooseAndInstallCubismCore(): Promise<CubismCoreStatus | null> {
  const result = await dialog.showOpenDialog({
    title: "Select live2dcubismcore.min.js from the official Cubism SDK for Web",
    properties: ["openFile"], filters: [{ name: "Live2D Cubism Core", extensions: ["js"] }]
  });
  const sourcePath = result.filePaths[0];
  if (result.canceled || !sourcePath) return null;
  return validateAndInstallCubismCore(await readFile(sourcePath));
}

async function installOfficialCubismCore(): Promise<CubismCoreStatus | null> {
  const consent = await dialog.showMessageBox({
    type: "info", title: "Install official Live2D Cubism Core",
    message: "Download and install Cubism Core for Web from Live2D?",
    detail: "Cubism Core is proprietary Live2D software. By downloading or using it, you agree to Live2D's Proprietary Software License Agreement and Open Software License Agreement. LumaStage downloads only live2dcubismcore.min.js from cubism.live2d.com and stores it privately on this computer.",
    buttons: ["Agree and install", "View license page", "Cancel"], defaultId: 0, cancelId: 2, noLink: true
  });
  if (consent.response === 1) { await shell.openExternal(LIVE2D_WEB_SDK_PAGE); return null; }
  if (consent.response !== 0) return null;
  try {
    const response = await net.fetch(LIVE2D_CORE_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`Live2D download returned HTTP ${response.status}`);
    // Electron may leave Response.url empty for net.fetch() even when the
    // request succeeds. Only parse it when present; the requested URL itself
    // is a fixed, trusted Live2D HTTPS endpoint.
    if (response.url && new URL(response.url).hostname !== "cubism.live2d.com") throw new Error("Live2D download redirected to an unexpected host");
    return await validateAndInstallCubismCore(new Uint8Array(await response.arrayBuffer()));
  } catch (reason) {
    const fallback = await dialog.showMessageBox({
      type: "warning", title: "Automatic download failed", message: reason instanceof Error ? reason.message : "Could not download Cubism Core",
      detail: "You can open Live2D's official download page or select live2dcubismcore.min.js if you already downloaded the SDK.",
      buttons: ["Open official page", "Select file", "Cancel"], defaultId: 0, cancelId: 2, noLink: true
    });
    if (fallback.response === 0) { await shell.openExternal(LIVE2D_WEB_SDK_PAGE); return null; }
    return fallback.response === 1 ? chooseAndInstallCubismCore() : null;
  }
}

async function coreStatus(): Promise<CubismCoreStatus> {
  try {
    const source = await readFile(cubismCorePath(), "utf8");
    const version = source.match(/Cubism\s*(?:Core)?\s*v?([0-9]+(?:\.[0-9]+){1,3})/i)?.[1];
    const installed = source.includes("Live2DCubismCore");
    const compatible = installed && source.includes("csmGetDrawableRenderOrders");
    return { available: compatible, installed, compatible, version: version ?? (compatible ? "5.x" : undefined) };
  } catch {
    return { available: false };
  }
}

async function safeModelAssetPath(pathname: string): Promise<string | undefined> {
  if (!activeModelRoot) return undefined;
  const decoded = decodeURIComponent(pathname.replace(/^\/+/, ""));
  if (!decoded || isAbsolute(decoded)) return undefined;
  const candidate = resolve(activeModelRoot, decoded);
  const fromRoot = relative(activeModelRoot, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined;
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(activeModelRoot), realpath(candidate)]);
    const realFromRoot = relative(realRoot, realCandidate);
    if (realFromRoot === ".." || realFromRoot.startsWith(`..${sep}`) || isAbsolute(realFromRoot)) return undefined;
    return realCandidate;
  } catch {
    return undefined;
  }
}

function installAssetProtocols(): void {
  void session.defaultSession.protocol.handle("lumastage-model", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "active") return new Response("Unknown model", { status: 404 });
      const asset = await safeModelAssetPath(url.pathname);
      if (!asset) return new Response("Invalid model asset path", { status: 403 });
      const activeManifest = activeImportedModel ? await realpath(activeImportedModel.manifestPath) : undefined;
      if (activeImportedModel && asset === activeManifest) {
        const manifest = JSON.parse(await readFile(asset, "utf8")) as Record<string, unknown>;
        const refs = manifest.FileReferences && typeof manifest.FileReferences === "object" ? manifest.FileReferences as Record<string, unknown> : {};
        const motions = refs.Motions && typeof refs.Motions === "object" && !Array.isArray(refs.Motions) ? refs.Motions as Record<string, unknown> : {};
        const runtimeMotions = activeImportedModel.motionGroups[VTUBE_HOTKEY_MOTION_GROUP] ?? [];
        if (runtimeMotions.length > 0) motions[VTUBE_HOTKEY_MOTION_GROUP] = runtimeMotions.map((file) => ({ File: file.replaceAll("\\", "/") }));
        refs.Motions = motions;
        manifest.FileReferences = refs;
        return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      return await net.fetch(pathToFileURL(asset).toString());
    } catch {
      return new Response("Model asset not found", { status: 404 });
    }
  });

  void session.defaultSession.protocol.handle("lumastage-core", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "runtime" || url.pathname !== "/live2dcubismcore.min.js") {
      return new Response("Unknown runtime asset", { status: 404 });
    }
    try {
      if (!(await coreStatus()).available) return new Response("Compatible Cubism Core 5.x is not installed", { status: 409 });
      return await net.fetch(pathToFileURL(cubismCorePath()).toString());
    } catch {
      return new Response("Cubism Core is not installed", { status: 404 });
    }
  });

  void session.defaultSession.protocol.handle("lumastage-background", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "active" || url.pathname !== "/image" || !activeBackgroundPath) {
      return new Response("Unknown scene background", { status: 404 });
    }
    try {
      const image = await realpath(activeBackgroundPath);
      const imageStat = await stat(image);
      if (!imageStat.isFile() || imageStat.size > 50 * 1024 * 1024) return new Response("Invalid scene background", { status: 403 });
      return await net.fetch(pathToFileURL(image).toString());
    } catch {
      return new Response("Scene background not found", { status: 404 });
    }
  });

  void session.defaultSession.protocol.handle("lumastage-item", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "active") return new Response("Unknown scene item", { status: 404 });
    let itemId: string;
    try { itemId = decodeURIComponent(url.pathname.replace(/^\/+/, "")); }
    catch { return new Response("Invalid scene item ID", { status: 400 }); }
    const item = storedActiveScene().items.find((candidate) => candidate.id === itemId);
    if (!item) return new Response("Scene item not found", { status: 404 });
    try {
      const image = await realpath(item.filePath);
      const imageStat = await stat(image);
      if (!imageStat.isFile() || imageStat.size > 20 * 1024 * 1024) return new Response("Invalid scene item", { status: 403 });
      return await net.fetch(pathToFileURL(image).toString());
    } catch {
      return new Response("Scene item asset not found", { status: 404 });
    }
  });
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function currentModelPosition(): { positionX: number; positionY: number; rotation: number; size: number } {
  const transform = storedActiveScene().transform;
  return {
    positionX: transform.positionX,
    positionY: -transform.positionY,
    rotation: transform.rotation < 0 ? transform.rotation + 360 : transform.rotation,
    size: Number((transform.scale <= 1 ? (transform.scale - 1) / 0.008 : (transform.scale - 1) / 0.02).toFixed(6))
  };
}

function scaleFromVtsSize(size: number): number {
  return size <= 0 ? 1 + size * 0.008 : 1 + size * 0.02;
}

async function moveVtsModel(input: VtsModelMoveInput): Promise<boolean> {
  if (!activeApiModel) return false;
  const scene = storedActiveScene();
  const from = { ...scene.transform };
  const current = currentModelPosition();
  const value = (next: number | undefined, previous: number) => next === undefined ? previous : input.valuesAreRelativeToModel ? previous + next : next;
  const target = {
    positionX: value(input.positionX, current.positionX),
    positionY: -value(input.positionY, current.positionY),
    rotation: ((value(input.rotation, current.rotation) + 180) % 360 + 360) % 360 - 180,
    scale: scaleFromVtsSize(Math.max(-100, Math.min(100, value(input.size, current.size))))
  };
  scene.transform = normalizeSceneTransform(target, scene.transform);
  await saveScenes();
  broadcast("vts-model-move", { from, to: scene.transform, durationMs: input.timeInSeconds * 1000 });
  broadcastSceneWorkspace();
  sendModelMovedEvent();
  return true;
}

function currentArtMeshTintState(): VtsArtMeshTintState {
  return { artMeshColors: Object.fromEntries([...artMeshTints].map(([name, entry]) => [name, {
    colorR: entry.tint.colorR, colorG: entry.tint.colorG, colorB: entry.tint.colorB, colorA: entry.tint.colorA
  }])) };
}

function publishArtMeshTints(): void {
  broadcast("vts-artmesh-tint", currentArtMeshTintState());
}

function tintVtsArtMeshes(sessionID: string, tint: VtsColorTint, matcher: VtsArtMeshMatcher): string[] {
  const exactNames = matcher.nameExact.map((value) => value.toLowerCase());
  const nameFragments = matcher.nameContains.map((value) => value.toLowerCase());
  const exactTags = matcher.tagExact.map((value) => value.toLowerCase());
  const tagFragments = matcher.tagContains.map((value) => value.toLowerCase());
  const selectedNumbers = new Set(matcher.artMeshNumber);
  const matched = activeArtMeshNames.filter((name, index) => {
    const lowerName = name.toLowerCase();
    const tags = (activeImportedModel?.artMeshTags[name] ?? []).map((tag) => tag.toLowerCase());
    return matcher.tintAll || selectedNumbers.has(index) || exactNames.includes(lowerName) || nameFragments.some((fragment) => lowerName.includes(fragment)) ||
      tags.some((tag) => exactTags.includes(tag) || tagFragments.some((fragment) => tag.includes(fragment)));
  });
  for (const name of matched) {
    if (tint.colorR === 255 && tint.colorG === 255 && tint.colorB === 255 && tint.colorA === 255) artMeshTints.delete(name);
    else artMeshTints.set(name, { sessionID, tint, updatedAt: Date.now() });
  }
  publishArtMeshTints();
  return matched;
}

function requestArtMeshSelection(sessionID: string, pluginName: string, input: VtsArtMeshSelectionInput): Promise<VtsArtMeshSelectionResult | { error: "busy" }> {
  if (pendingArtMeshSelection || BrowserWindow.getAllWindows().length === 0) return Promise.resolve({ error: "busy" });
  const artMeshIDs = [...activeArtMeshNames];
  const id = randomUUID();
  const prompt: ArtMeshSelectionPrompt = {
    id, pluginName,
    text: input.textOverride || `${pluginName} asks you to select ArtMeshes.`,
    help: input.helpOverride || "Select the model layers this plugin may use, then confirm your choice.",
    requestedArtMeshCount: input.requestedArtMeshCount,
    artMeshIDs,
    activeArtMeshes: input.activeArtMeshes.filter((name) => artMeshIDs.includes(name))
  };
  return new Promise((resolveSelection) => {
    const timeout = setTimeout(() => {
      if (pendingArtMeshSelection?.prompt.id !== id) return;
      pendingArtMeshSelection = undefined;
      resolveSelection({ success: false, activeArtMeshes: prompt.activeArtMeshes, inactiveArtMeshes: artMeshIDs.filter((name) => !prompt.activeArtMeshes.includes(name)) });
    }, 5 * 60_000);
    pendingArtMeshSelection = { prompt, sessionID, resolve: resolveSelection, timeout };
    broadcast("artmesh-selection-request", prompt);
  });
}

function resolveArtMeshSelection(id: string, success: boolean, selected: string[]): boolean {
  const pending = pendingArtMeshSelection;
  if (!pending || pending.prompt.id !== id) return false;
  const unique = [...new Set(selected)];
  if ((success && unique.length === 0) || unique.some((name) => !pending.prompt.artMeshIDs.includes(name))) return false;
  if (success && pending.prompt.requestedArtMeshCount > 0 && unique.length !== pending.prompt.requestedArtMeshCount) return false;
  clearTimeout(pending.timeout);
  pendingArtMeshSelection = undefined;
  pending.resolve({ success, activeArtMeshes: unique, inactiveArtMeshes: pending.prompt.artMeshIDs.filter((name) => !unique.includes(name)) });
  return true;
}

function cancelArtMeshSelectionForSession(sessionID: string): void {
  const pending = pendingArtMeshSelection;
  if (!pending || pending.sessionID !== sessionID) return;
  clearTimeout(pending.timeout);
  pendingArtMeshSelection = undefined;
  pending.resolve({
    success: false,
    activeArtMeshes: pending.prompt.activeArtMeshes,
    inactiveArtMeshes: pending.prompt.artMeshIDs.filter((name) => !pending.prompt.activeArtMeshes.includes(name))
  });
}

function activePhysicsOverrides(): typeof physicsController {
  if (!physicsController) return undefined;
  const now = Date.now();
  physicsController.strength = physicsController.strength.filter((item) => item.expiresAt > now);
  physicsController.wind = physicsController.wind.filter((item) => item.expiresAt > now);
  if (physicsController.strength.length + physicsController.wind.length === 0) physicsController = undefined;
  return physicsController;
}

function currentPhysicsControl(): VtsPhysicsControl {
  const control: VtsPhysicsControl = { baseStrength: 50, baseWind: 0, groups: Object.fromEntries((activeImportedModel?.physicsGroups ?? []).map((group) => [group.id, { strengthMultiplier: 1, windMultiplier: 1 }])) };
  const overrides = activePhysicsOverrides();
  for (const item of overrides?.strength ?? []) {
    if (item.setBaseValue) control.baseStrength = item.value;
    else if (control.groups[item.id]) control.groups[item.id].strengthMultiplier = item.value;
  }
  for (const item of overrides?.wind ?? []) {
    if (item.setBaseValue) control.baseWind = item.value;
    else if (control.groups[item.id]) control.groups[item.id].windMultiplier = item.value;
  }
  return control;
}

function publishPhysicsControl(): void {
  broadcast("vts-physics-control", currentPhysicsControl());
}

function setVtsPhysicsOverrides(sessionID: string, pluginName: string, strength: VtsPhysicsOverride[], wind: VtsPhysicsOverride[]): "ok" | "controlled" | "invalid-group" {
  const active = activePhysicsOverrides();
  if (active && active.sessionID !== sessionID) return "controlled";
  const groupIDs = new Set(activeImportedModel?.physicsGroups.map((group) => group.id) ?? []);
  if ([...strength, ...wind].some((item) => !item.setBaseValue && !groupIDs.has(item.id))) return "invalid-group";
  const now = Date.now();
  const timed = (items: VtsPhysicsOverride[]) => items.map((item) => ({ ...item, expiresAt: now + item.overrideSeconds * 1000 }));
  const merge = (previous: ActivePhysicsOverride[], next: ActivePhysicsOverride[]) => {
    const keys = new Set(next.map((item) => `${item.setBaseValue ? "base" : "group"}:${item.id}`));
    return [...previous.filter((item) => !keys.has(`${item.setBaseValue ? "base" : "group"}:${item.id}`)), ...next];
  };
  physicsController = {
    sessionID, pluginName,
    strength: merge(active?.strength ?? [], timed(strength)),
    wind: merge(active?.wind ?? [], timed(wind))
  };
  publishPhysicsControl();
  const timeout = Math.max(...[...strength, ...wind].map((item) => item.overrideSeconds)) * 1000 + 25;
  setTimeout(publishPhysicsControl, timeout);
  return "ok";
}

function cleanupVtsVisualOverrides(sessionID: string): void {
  let tintChanged = false;
  for (const [name, entry] of artMeshTints) if (entry.sessionID === sessionID) { artMeshTints.delete(name); tintChanged = true; }
  if (tintChanged) publishArtMeshTints();
  if (physicsController?.sessionID === sessionID) { physicsController = undefined; publishPhysicsControl(); }
}

function sendVtsEvent(eventName: VtsEventName, data: Record<string, unknown>): void {
  const message = JSON.stringify(createVtsEventMessage(eventName, data));
  for (const [socket, apiSession] of pluginSessions) {
    if (socket.readyState === socket.OPEN && vtsSessionAcceptsEvent(apiSession, eventName, data)) socket.send(message);
  }
}

function currentModelEventData(modelLoaded = Boolean(activeApiModel)): Record<string, unknown> {
  return { modelLoaded, modelName: activeApiModel?.modelName ?? "", modelID: activeApiModel?.modelID ?? "" };
}

async function availableVtsModels(): Promise<Array<{ modelName: string; modelID: string; vtsModelName: string; vtsModelIconName: string }>> {
  const available = new Map<string, { modelName: string; modelID: string; vtsModelName: string; vtsModelIconName: string }>();
  for (const directory of modelDirectories) {
    try {
      const model = await inspectCubismModelFolder(directory);
      const modelID = model.vTubeStudio?.modelId ?? model.name;
      if (!available.has(modelID)) available.set(modelID, {
        modelName: model.vTubeStudio?.name ?? model.name,
        modelID,
        vtsModelName: model.vTubeStudio ? basename(model.vTubeStudio.path) : "",
        vtsModelIconName: model.vTubeStudio?.iconPath ? basename(model.vTubeStudio.iconPath) : ""
      });
    } catch {
      // Missing scene models are omitted from the available model catalog.
    }
  }
  return [...available.values()];
}

async function publicModelLibrary(): Promise<ModelLibrary> {
  const activeModelID = activeApiModel?.modelID;
  return {
    models: (await availableVtsModels()).map((entry) => ({
      modelID: entry.modelID,
      modelName: entry.modelName,
      vTubeModelName: entry.vtsModelName,
      vTubeModelIconName: entry.vtsModelIconName,
      active: entry.modelID === activeModelID
    })),
    ...(activeModelID ? { activeModelID } : {})
  };
}

async function loadVtsModel(modelID: string): Promise<"loaded" | "unloaded" | "not-found"> {
  const previous = activeApiModel;
  const scene = storedActiveScene();
  if (!modelID) {
    delete scene.modelDirectory;
    delete scene.modelName;
    clearActiveModel();
    await saveScenes();
    broadcastSceneWorkspace();
    if (previous) sendVtsEvent("ModelLoadedEvent", { modelLoaded: false, modelName: previous.modelName, modelID: previous.modelID });
    return "unloaded";
  }
  for (const directory of modelDirectories) {
    try {
      const inspected = await inspectCubismModelFolder(directory);
      if ((inspected.vTubeStudio?.modelId ?? inspected.name) !== modelID) continue;
      const imported = await inspectModelDirectory(inspected.directory);
      scene.modelDirectory = imported.directory;
      scene.modelName = imported.vTubeModelName ?? imported.name;
      await saveScenes();
      broadcastSceneWorkspace();
      if (previous && previous.modelID !== activeApiModel?.modelID) sendVtsEvent("ModelLoadedEvent", { modelLoaded: false, modelName: previous.modelName, modelID: previous.modelID });
      sendVtsEvent("ModelLoadedEvent", currentModelEventData(true));
      return "loaded";
    } catch {
      // Keep searching other catalog entries.
    }
  }
  return "not-found";
}

function hotkeyEventData(hotkey: { hotkeyID: string; name: string; type: string; file: string }, triggeredByAPI: boolean): Record<string, unknown> {
  return {
    hotkeyID: hotkey.hotkeyID, hotkeyName: hotkey.name, hotkeyAction: hotkey.type, hotkeyFile: hotkey.file,
    hotkeyTriggeredByAPI: triggeredByAPI, modelID: activeApiModel?.modelID ?? "", modelName: activeApiModel?.modelName ?? "", isLive2DItem: false
  };
}

function sendModelMovedEvent(): void {
  if (!activeApiModel) return;
  sendVtsEvent("ModelMovedEvent", { modelID: activeApiModel.modelID, modelName: activeApiModel.modelName, modelPosition: currentModelPosition() });
}

function isIPv4Family(family: string | number): boolean {
  // Node/Electron may report family as "IPv4" (string) or 4 (number), especially on Windows.
  return family === "IPv4" || family === 4;
}

function isLikelyVirtualAdapter(name: string, address: string): boolean {
  const n = name.toLowerCase();
  if (
    /tailscale|wintun|tun|tap|vpn|happ|docker|vethernet|hyper-v|vmware|virtualbox|wsl|bluetooth|loopback|zerotier|hamachi|radmin|npcap|virtual|pseudo|isatap|teredo/.test(
      n
    )
  ) {
    return true;
  }
  // CGNAT / Tailscale common ranges and APIPA are rarely useful for iPhone Wi‑Fi pairing.
  if (address.startsWith("100.")) return true;
  if (address.startsWith("169.254.")) return true;
  return false;
}

function rankLanAddress(ip: string, virtual: boolean): number {
  if (virtual) return 50;
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  // RFC1918 172.16.0.0/12 (includes many VPN/docker bridges — still better than public/CGNAT)
  const octets = ip.split(".").map(Number);
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return 2;
  if (ip.startsWith("169.254.")) return 40;
  return 30;
}

/** Reachable IPv4 addresses for manual tracker connect, real LAN first; tunnels last. */
function listHostAddresses(): string[] {
  const ranked: { address: string; rank: number }[] = [];
  const seen = new Set<string>();
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || !isIPv4Family(entry.family)) continue;
      if (seen.has(entry.address)) continue;
      seen.add(entry.address);
      const virtual = isLikelyVirtualAdapter(name, entry.address);
      ranked.push({ address: entry.address, rank: rankLanAddress(entry.address, virtual) });
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address)).map((item) => item.address);
}

function ensureWindowsFirewallRule(): void {
  if (process.platform !== "win32") return;
  const ruleName = "LumaStage Tracker";
  const addRule = (): void => {
    execFile(
      "netsh",
      [
        "advfirewall",
        "firewall",
        "add",
        "rule",
        `name=${ruleName}`,
        "dir=in",
        "action=allow",
        "protocol=TCP",
        `localport=${TRACKING_PORT}`,
        "profile=any",
        "enable=yes"
      ],
      (error) => {
        if (error) {
          console.warn(
            `[LumaStage] Could not add Windows Firewall rule for TCP ${TRACKING_PORT} (need admin once). Manual allow: netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${TRACKING_PORT} profile=any`
          );
        } else {
          console.info(`[LumaStage] Windows Firewall allows inbound TCP ${TRACKING_PORT}`);
        }
      }
    );
  };

  execFile("netsh", ["advfirewall", "firewall", "show", "rule", `name=${ruleName}`], (showError, stdout) => {
    if (!showError && typeof stdout === "string" && /Enabled:\s+Yes/i.test(stdout) && new RegExp(String(TRACKING_PORT)).test(stdout)) {
      return;
    }
    // Missing, disabled, or wrong port — try (re)add. Requires elevation on first install.
    if (!showError) {
      execFile("netsh", ["advfirewall", "firewall", "delete", "rule", `name=${ruleName}`], () => addRule());
      return;
    }
    addRule();
  });
}

function desktopStatus(): DesktopStatus {
  return {
    port: TRACKING_PORT,
    connectedDevices: clients.size,
    pairingCode,
    trustedDevices: trustedDevices.size,
    vtsApiPort: VTS_API_PORT,
    vtsApiActive,
    allowedPlugins: pluginTokens.size,
    hostAddresses: listHostAddresses()
  };
}

function publishStatus(): void {
  broadcast("desktop-status", desktopStatus());
}

function acceptFrame(socket: WebSocket, frame: TrackingFrame): void {
  const client = clients.get(socket);
  if (!client || frame.sequence <= client.lastSequence) return;
  client.lastSequence = frame.sequence;
  const previousFaceFound = latestTrackingFrame?.faceFound;
  latestTrackingFrame = frame;
  if (previousFaceFound !== undefined && previousFaceFound !== frame.faceFound) {
    sendVtsEvent("TrackingStatusChangedEvent", { faceFound: frame.faceFound, leftHandFound: false, rightHandFound: false });
  }
  broadcast("tracking-frame", frame);
}

function startTrackingServer(): void {
  // Listen on all IPv4 interfaces so Wi‑Fi, Ethernet, and USB-tether adapters can reach the tracker port.
  server = new WebSocketServer({ host: "0.0.0.0", port: TRACKING_PORT, maxPayload: 64 * 1024 });
  server.on("listening", () => {
    const hosts = listHostAddresses();
    console.info(
      `[LumaStage] Tracker WebSocket listening on 0.0.0.0:${TRACKING_PORT}` +
        (hosts.length ? ` · manual hosts: ${hosts.slice(0, 4).map((h) => `${h}:${TRACKING_PORT}`).join(", ")}` : "")
    );
  });
  server.on("error", (error) => {
    console.error(`[LumaStage] Tracker WebSocket failed on port ${TRACKING_PORT}:`, error);
  });
  server.on("connection", (socket, request) => {
    const remote = request.socket.remoteAddress ?? "unknown";
    console.info(`[LumaStage] Tracker connection from ${remote}`);
    socket.on("message", async (raw, isBinary) => {
      if (isBinary) return socket.close(1003, "Text frames only");
      try {
        const message = parseLumaLinkMessage(raw.toString("utf8"));
        if (message.type === "hello") {
          const authorization = await authorizeHello(message);
          if (!authorization) {
            socket.send(JSON.stringify({ type: "pairing-required", protocol: 1, message: "Enter the six-digit code shown in LumaStage Desktop" }));
            socket.close(1008, "Pairing required");
            return;
          }
          clients.set(socket, { hello: message, lastSequence: -1 });
          socket.send(JSON.stringify({ type: "hello-accepted", protocol: 1, ...authorization }));
          console.info(`[LumaStage] Tracker paired: ${message.deviceName} (${message.deviceId}) from ${remote}`);
          publishStatus();
        } else {
          acceptFrame(socket, message);
        }
      } catch {
        socket.close(1007, "Invalid LumaLink message");
      }
    });
    socket.on("close", () => {
      clients.delete(socket);
      publishStatus();
    });
  });

  ensureWindowsFirewallRule();

  try {
    bonjour = new Bonjour();
    service = bonjour.publish({
      name: `LumaStage on ${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "Desktop"}`,
      type: "lumastage",
      protocol: "tcp",
      port: TRACKING_PORT,
      txt: { protocol: "1", app: app.getVersion() }
    });
  } catch (error) {
    console.warn("[LumaStage] Bonjour advertise failed (manual IP still works):", error);
  }
}

function startVtsApiServer(): void {
  const host: VtsApiHost = {
    version: app.getVersion(),
    startedAt: vtsStartedAt,
    allowedPluginCount: () => pluginTokens.size,
    connectedPluginCount: () => [...pluginSessions.values()].filter((session) => session.authenticated).length,
    requestToken: issuePluginToken,
    authenticate: async (pluginName, pluginDeveloper, token) => {
      const storedHash = pluginTokens.get(pluginKey(pluginName, pluginDeveloper));
      return Boolean(storedHash && hashesMatch(hashToken(token), storedHash));
    },
    currentModel: () => activeApiModel,
    availableModels: availableVtsModels,
    loadModel: loadVtsModel,
    modelPosition: currentModelPosition,
    moveModel: moveVtsModel,
    artMeshes: () => ({
      names: [...activeArtMeshNames],
      tags: [...new Set(Object.values(activeImportedModel?.artMeshTags ?? {}).flat())]
    }),
    tintArtMeshes: async (sessionID, tint, matcher) => tintVtsArtMeshes(sessionID, tint, matcher),
    selectArtMeshes: requestArtMeshSelection,
    physicsState: () => ({
      modelHasPhysics: Boolean(activeApiModel?.hasPhysicsFile), physicsSwitchedOn: Boolean(activeApiModel?.hasPhysicsFile),
      usingLegacyPhysics: false, physicsFPSSetting: -1, baseStrength: 50, baseWind: 0,
      overridePluginName: activePhysicsOverrides()?.pluginName ?? "",
      physicsGroups: (activeImportedModel?.physicsGroups ?? []).map((group) => ({ groupID: group.id, groupName: group.name, strengthMultiplier: 1, windMultiplier: 1 }))
    }),
    setPhysicsOverrides: async (sessionID, pluginName, strength, wind) => setVtsPhysicsOverrides(sessionID, pluginName, strength, wind),
    faceFound: () => injectedFaceFound && injectedFaceFound.expiresAt >= Date.now() ? injectedFaceFound.value : latestTrackingFrame?.faceFound ?? false,
    triggerHotkey: async (hotkeyIDOrName) => {
      const hotkey = activeApiModel?.hotkeys.find((candidate) =>
        candidate.hotkeyID === hotkeyIDOrName || candidate.name.toLowerCase() === hotkeyIDOrName.toLowerCase()
      );
      if (!hotkey) return undefined;
      const importedHotkey = activeImportedModel?.vTubeHotkeys.find((candidate) => candidate.id === hotkey.hotkeyID);
      const trigger: ImportedHotkey = importedHotkey ?? { id: hotkey.hotkeyID, name: hotkey.name, action: hotkey.type, file: hotkey.file, folder: "", triggers: [], isGlobal: false, isActive: true };
      dispatchImportedHotkey(trigger, true);
      return hotkey.hotkeyID;
    },
    expressionStates: () => (activeImportedModel?.expressions ?? []).map((expression) => {
      const file = basename(expression.file);
      return {
        name: expression.name, file, active: activeExpressionFiles.has(file),
        usedInHotkeys: (activeApiModel?.hotkeys ?? []).filter((hotkey) => basename(hotkey.file) === file).map((hotkey) => ({ name: hotkey.name, id: hotkey.hotkeyID })),
        parameters: expression.parameters
      };
    }),
    activateExpression: async (expressionFile, active, fadeTime) => {
      const expression = activeImportedModel?.expressions.find((candidate) => basename(candidate.file) === expressionFile);
      if (!expression) return false;
      if (active) activeExpressionFiles.add(expressionFile); else activeExpressionFiles.delete(expressionFile);
      broadcast("vts-expression-activation", { file: expression.file, active, fadeTime });
      return true;
    },
    inputParameters: inputParameterLists,
    live2DParameters: live2DParameterList,
    injectParameterData: async (parameters, mode, faceFound) => {
      const known = new Set([
        ...defaultVtsParameterDefinitions.map((parameter) => parameter.name),
        ...customParameters.keys(),
        ...(activeImportedModel?.vTubeParameterMappings ?? []).map((mapping) => mapping.input)
      ]);
      const missing = parameters.filter((parameter) => !known.has(parameter.id)).map((parameter) => parameter.id);
      if (missing.length > 0) return missing;
      const now = Date.now();
      for (const parameter of parameters) {
        injectedInputs.set(parameter.id, { value: parameter.value, weight: parameter.weight ?? 1, mode, expiresAt: now + 1000 });
      }
      if (faceFound !== undefined) injectedFaceFound = { value: faceFound, expiresAt: now + 1000 };
      const injection: VtsParameterInjection = { parameters, mode, faceFound };
      broadcast("vts-parameter-injection", injection);
      return [];
    },
    createCustomParameter,
    deleteCustomParameter,
    listItems: listVtsItems,
    loadItem: loadVtsItem,
    unloadItems: unloadVtsItems,
    controlItemAnimation: controlVtsItemAnimation,
    moveItems: moveVtsItems,
    pinItem: pinVtsItem,
    postProcessingState: () => postProcessingState,
    updatePostProcessing
  };

  vtsApiServer = new WebSocketServer({ host: "127.0.0.1", port: VTS_API_PORT, maxPayload: 1024 * 1024 });
  vtsApiServer.on("listening", () => {
    vtsApiActive = true;
    publishStatus();
  });
  vtsApiServer.on("error", () => {
    vtsApiActive = false;
    publishStatus();
  });
  vtsApiServer.on("connection", (socket) => {
    const apiSession: VtsApiSession = { authenticated: false, sessionID: randomUUID() };
    pluginSessions.set(socket, apiSession);
    socket.on("message", async (raw) => {
      try {
        const result = await handleVtsApiRequest(raw.toString("utf8"), apiSession, host);
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(result));
        if (result.messageType === "EventSubscriptionResponse") {
          try {
            const request = JSON.parse(raw.toString("utf8")) as { data?: { eventName?: unknown; subscribe?: unknown } };
            if (request.data?.eventName === "ModelMovedEvent" && request.data.subscribe === true && activeApiModel && socket.readyState === socket.OPEN) {
              const data = { modelID: activeApiModel.modelID, modelName: activeApiModel.modelName, modelPosition: currentModelPosition() };
              socket.send(JSON.stringify(createVtsEventMessage("ModelMovedEvent", data)));
            }
          } catch {
            // The core already validated the request; event priming is best-effort.
          }
        }
        publishStatus();
      } catch (reason) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({
            apiName: "VTubeStudioPublicAPI", apiVersion: "1.0", timestamp: Date.now(), requestID: randomUUID(),
            messageType: "APIError", data: { errorID: 0, message: reason instanceof Error ? reason.message : "Internal server error" }
          }));
        }
      }
    });
    socket.on("close", () => {
      void cleanupDisconnectedPluginItems(apiSession);
      cleanupVtsVisualOverrides(apiSession.sessionID ?? "");
      cancelArtMeshSelectionForSession(apiSession.sessionID ?? "");
      pluginSessions.delete(socket);
      publishStatus();
    });
  });
  testEventTimer = setInterval(() => {
    const counter = Math.floor((Date.now() - vtsStartedAt) / 1000);
    for (const [socket, apiSession] of pluginSessions) {
      const config = apiSession.subscriptions?.get("TestEvent");
      if (!config || socket.readyState !== socket.OPEN) continue;
      const data = { yourTestMessage: typeof config.testMessageForEvent === "string" ? config.testMessageForEvent : "", counter };
      if (vtsSessionAcceptsEvent(apiSession, "TestEvent", data)) socket.send(JSON.stringify(createVtsEventMessage("TestEvent", data)));
    }
  }, 1000);
}

async function inspectModelDirectory(directory: string): Promise<ImportedModel> {
  const model = await inspectCubismModelFolder(directory);
  modelDirectories.add(model.directory);
  await saveModelDirectories();
  activeModelRoot = model.directory;
  activeDefaultMappings = (model.vTubeStudio?.parameterMappings ?? []).map((mapping) => ({ ...mapping }));
  const overriddenMappings = modelMappingOverrides.get(modelMappingKey(model.directory));
  const imported: ImportedModel = {
    directory: model.directory,
    manifestPath: model.manifestPath,
    name: model.name,
    mocPath: model.mocPath,
    textureCount: model.texturePaths.length,
    expressionCount: model.expressions.length,
    motionCount: Object.values(model.motionGroups).flat().length,
    expressions: model.expressions.map((expression) => ({ name: expression.name, file: relative(model.directory, expression.path), parameters: expression.parameters })),
    motionGroups: Object.fromEntries(Object.entries(model.motionGroups).map(([group, paths]) => [group, paths.map((path) => relative(model.directory, path))])),
    missingFiles: model.missingFiles,
    manifestUrl: `lumastage-model://active/${encodeURIComponent(basename(model.manifestPath))}`,
    vTubeModelName: model.vTubeStudio?.name,
    vTubeParameterMappings: (overriddenMappings ?? activeDefaultMappings).map((mapping) => ({ ...mapping })),
    hasCustomMappings: Boolean(overriddenMappings),
    vTubeHotkeys: model.vTubeStudio?.hotkeys ?? [],
    artMeshTags: model.artMeshTags,
    physicsGroups: model.physicsGroups
  };
  activeApiModel = {
    modelName: model.vTubeStudio?.name ?? model.name,
    modelID: model.vTubeStudio?.modelId ?? model.name,
    vtsModelName: model.vTubeStudio ? basename(model.vTubeStudio.path) : "",
    vtsModelIconName: model.vTubeStudio?.iconPath ? basename(model.vTubeStudio.iconPath) : "",
    live2DModelName: basename(model.manifestPath),
    loadedAt: Date.now(),
    numberOfLive2DParameters: Math.max(model.vTubeStudio?.parameterMappings.length ?? 0, model.eyeBlinkParameters.length + model.lipSyncParameters.length),
    numberOfLive2DArtmeshes: 0,
    hasPhysicsFile: Boolean(model.physicsPath),
    numberOfTextures: model.texturePaths.length,
    textureResolution: 0,
    hotkeys: imported.vTubeHotkeys.map((hotkey) => ({
      name: hotkey.name,
      type: hotkey.action,
      description: hotkey.action,
      file: hotkey.file,
      hotkeyID: hotkey.id
    }))
  };
  activeImportedModel = imported;
  activeExpressionFiles.clear();
  activeArtMeshNames = [];
  artMeshTints.clear();
  physicsController = undefined;
  publishArtMeshTints();
  publishPhysicsControl();
  registerGlobalModelHotkeys();
  return imported;
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#00000000",
    transparent: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const allowedDevelopmentUrl = process.env.ELECTRON_RENDERER_URL;
    if (allowedDevelopmentUrl && url.startsWith(allowedDevelopmentUrl)) return;
    if (url.startsWith("file:")) return;
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  window.webContents.once("did-finish-load", publishStatus);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  installAssetProtocols();
  ipcMain.handle("get-desktop-status", desktopStatus);
  ipcMain.handle("import-model", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const previousModel = activeApiModel;
    const model = await inspectModelDirectory(result.filePaths[0]);
    const active = storedActiveScene();
    active.modelDirectory = model.directory;
    active.modelName = model.vTubeModelName ?? model.name;
    await saveScenes();
    if (previousModel && previousModel.modelID !== activeApiModel?.modelID) {
      sendVtsEvent("ModelLoadedEvent", { modelLoaded: false, modelName: previousModel.modelName, modelID: previousModel.modelID });
    }
    sendVtsEvent("ModelLoadedEvent", currentModelEventData(true));
    return model;
  });
  ipcMain.handle("get-model-library", publicModelLibrary);
  ipcMain.handle("load-library-model", async (_event, requestedModelID: unknown) => {
    if (typeof requestedModelID !== "string" || !requestedModelID.trim() || requestedModelID.length > 256) throw new Error("Invalid model ID");
    if (await loadVtsModel(requestedModelID) !== "loaded") throw new Error("Model is no longer available in the library");
    return sceneWorkspace();
  });
  ipcMain.handle("get-post-processing-state", () => publicPostProcessingState());
  ipcMain.handle("update-post-processing", async (_event, requestedUpdate: unknown) => {
    if (!requestedUpdate || typeof requestedUpdate !== "object" || Array.isArray(requestedUpdate)) throw new Error("Invalid post-processing update");
    const update = requestedUpdate as Record<string, unknown>;
    if (update.active !== undefined && typeof update.active !== "boolean") throw new Error("Invalid post-processing active state");
    if (update.preset !== undefined && (typeof update.preset !== "string" || update.preset.length > 128)) throw new Error("Invalid post-processing preset");
    const fadeTime = update.fadeTime === undefined ? 0.2 : update.fadeTime;
    if (typeof fadeTime !== "number" || !Number.isFinite(fadeTime) || fadeTime < 0 || fadeTime > 2) throw new Error("Invalid post-processing fade time");
    const result = await updatePostProcessing({
      active: update.active as boolean | undefined,
      preset: update.preset as string | undefined,
      values: update.values === undefined ? undefined : sanitizedPostProcessingValues(update.values),
      resetOthers: update.resetOthers === true,
      fadeTime,
      randomizeAll: false,
      chaosLevel: 0
    });
    if ("error" in result) throw new Error("Post-processing preset was not found");
    return publicPostProcessingState();
  });
  ipcMain.handle("resolve-artmesh-selection", (_event, requestedID: unknown, requestedSuccess: unknown, requestedActive: unknown) => {
    if (typeof requestedID !== "string" || typeof requestedSuccess !== "boolean" || !Array.isArray(requestedActive) || requestedActive.length > 100_000 || requestedActive.some((name) => typeof name !== "string" || name.length > 256)) return false;
    return resolveArtMeshSelection(requestedID, requestedSuccess, requestedActive as string[]);
  });
  ipcMain.handle("update-model-mappings", async (_event, requestedMappings: unknown) => {
    if (!activeImportedModel || !activeModelRoot) throw new Error("Import a model before editing tracking mappings");
    const mappings = parseEditableVTubeParameterMappings(requestedMappings);
    modelMappingOverrides.set(modelMappingKey(activeModelRoot), mappings.map((mapping) => ({ ...mapping })));
    activeImportedModel = { ...activeImportedModel, vTubeParameterMappings: mappings, hasCustomMappings: true };
    if (activeApiModel) activeApiModel.numberOfLive2DParameters = mappings.length;
    await saveModelMappingOverrides();
    broadcastSceneWorkspace();
    sendVtsEvent("ModelConfigChangedEvent", currentModelEventData(true));
    return activeImportedModel;
  });
  ipcMain.handle("reset-model-mappings", async () => {
    if (!activeImportedModel || !activeModelRoot) throw new Error("Import a model before resetting tracking mappings");
    modelMappingOverrides.delete(modelMappingKey(activeModelRoot));
    activeImportedModel = { ...activeImportedModel, vTubeParameterMappings: activeDefaultMappings.map((mapping) => ({ ...mapping })), hasCustomMappings: false };
    if (activeApiModel) activeApiModel.numberOfLive2DParameters = activeDefaultMappings.length;
    await saveModelMappingOverrides();
    broadcastSceneWorkspace();
    sendVtsEvent("ModelConfigChangedEvent", currentModelEventData(true));
    return activeImportedModel;
  });
  ipcMain.handle("get-scene-workspace", () => sceneWorkspace());
  ipcMain.handle("create-scene", async (_event, requestedName: unknown) => {
    if (sceneLibrary.scenes.length >= 64) throw new Error("Scene limit reached");
    const id = randomUUID();
    const name = typeof requestedName === "string" && requestedName.trim() ? requestedName.trim().slice(0, 48) : `Scene ${sceneLibrary.scenes.length + 1}`;
    const previousModel = activeApiModel;
    sceneLibrary.scenes.push({
      id,
      name,
      background: { kind: "gradient", preset: "studio" },
      transform: { scale: 1, positionX: 0, positionY: 0, rotation: 0, mirror: false },
      items: []
    });
    sceneLibrary.activeSceneId = id;
    clearActiveModel();
    activeBackgroundPath = undefined;
    await saveScenes();
    if (previousModel) sendVtsEvent("ModelLoadedEvent", { modelLoaded: false, modelName: previousModel.modelName, modelID: previousModel.modelID });
    sendVtsEvent("BackgroundChangedEvent", { backgroundName: "studio" });
    return sceneWorkspace();
  });
  ipcMain.handle("activate-scene", async (_event, requestedId: unknown) => {
    const previousModel = activeApiModel;
    sceneLibrary.activeSceneId = requireSceneId(requestedId);
    await saveScenes();
    const workspace = await sceneWorkspace(true);
    if (previousModel && previousModel.modelID !== activeApiModel?.modelID) {
      sendVtsEvent("ModelLoadedEvent", { modelLoaded: false, modelName: previousModel.modelName, modelID: previousModel.modelID });
    }
    if (activeApiModel && previousModel?.modelID !== activeApiModel.modelID) sendVtsEvent("ModelLoadedEvent", currentModelEventData(true));
    const background = storedActiveScene().background;
    sendVtsEvent("BackgroundChangedEvent", { backgroundName: background.kind === "image" ? basename(background.imagePath) : background.kind === "color" ? background.color : background.preset });
    sendModelMovedEvent();
    return workspace;
  });
  ipcMain.handle("update-scene", async (_event, requestedId: unknown, requestedUpdate: unknown) => {
    const id = requireSceneId(requestedId);
    if (!requestedUpdate || typeof requestedUpdate !== "object" || Array.isArray(requestedUpdate)) throw new Error("Invalid scene update");
    const update = requestedUpdate as SceneUpdate;
    const scene = sceneLibrary.scenes.find((item) => item.id === id)!;
    const previousTransform = { ...scene.transform };
    const previousBackground = JSON.stringify(scene.background);
    if (update.name !== undefined) {
      if (typeof update.name !== "string" || !update.name.trim()) throw new Error("Scene name cannot be empty");
      scene.name = update.name.trim().slice(0, 48);
    }
    if (update.transform !== undefined) scene.transform = normalizeSceneTransform(update.transform, scene.transform);
    if (update.background !== undefined) {
      const background = update.background;
      if (background.kind === "color" && /^#[0-9a-fA-F]{6}$/.test(background.color)) scene.background = { kind: "color", color: background.color };
      else if (background.kind === "gradient" && ["violet", "sunset", "ocean", "studio", "transparent"].includes(background.preset)) scene.background = { kind: "gradient", preset: background.preset };
      else throw new Error("Invalid scene background");
      if (id === sceneLibrary.activeSceneId) activeBackgroundPath = undefined;
    }
    await saveScenes();
    if (id === sceneLibrary.activeSceneId && JSON.stringify(scene.transform) !== JSON.stringify(previousTransform)) sendModelMovedEvent();
    if (id === sceneLibrary.activeSceneId && JSON.stringify(scene.background) !== previousBackground) {
      sendVtsEvent("BackgroundChangedEvent", { backgroundName: scene.background.kind === "image" ? basename(scene.background.imagePath) : scene.background.kind === "color" ? scene.background.color : scene.background.preset });
    }
    return sceneWorkspace();
  });
  ipcMain.handle("choose-scene-background", async (_event, requestedId: unknown) => {
    const id = requireSceneId(requestedId);
    const result = await dialog.showOpenDialog({
      title: "Choose a scene background",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
    });
    const imagePath = result.filePaths[0];
    if (result.canceled || !imagePath) return null;
    const imageStat = await stat(imagePath);
    if (!imageStat.isFile() || imageStat.size > 50 * 1024 * 1024) throw new Error("Background image must be smaller than 50 MB");
    const scene = sceneLibrary.scenes.find((item) => item.id === id)!;
    scene.background = { kind: "image", imagePath: await realpath(imagePath) };
    if (id === sceneLibrary.activeSceneId) activeBackgroundPath = scene.background.imagePath;
    await saveScenes();
    if (id === sceneLibrary.activeSceneId) sendVtsEvent("BackgroundChangedEvent", { backgroundName: basename(scene.background.imagePath) });
    return sceneWorkspace();
  });
  ipcMain.handle("choose-scene-item", async (_event, requestedSceneId: unknown) => {
    const scene = requireScene(requestedSceneId);
    if (scene.items.length >= 60) throw new Error("This scene already has 60 items");
    const order = availableItemOrder(scene);
    if (order === undefined) throw new Error("No item order slots are available");
    const result = await dialog.showOpenDialog({
      title: "Add an image item",
      properties: ["openFile"],
      filters: [{ name: "Image items", extensions: ["png", "jpg", "jpeg", "gif"] }]
    });
    const sourcePath = result.filePaths[0];
    if (result.canceled || !sourcePath) return null;
    const type = imageItemType(sourcePath);
    if (!type) throw new Error("Only PNG, JPG, and GIF items are supported");
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size > 20 * 1024 * 1024) throw new Error("Item image must be smaller than 20 MB");
    const canonicalSourcePath = await realpath(sourcePath);
    const existingFile = itemFiles.get(basename(sourcePath));
    if (existingFile && existingFile.filePath !== canonicalSourcePath) throw new Error("An item file with this filename is already in the library");
    const item: StoredSceneItem = {
      id: randomUUID(), fileName: basename(sourcePath), filePath: canonicalSourcePath, type,
      positionX: 0, positionY: 0, size: 0.32, rotation: 0, order, flipped: false, locked: false,
      censored: false, smoothing: 0, opacity: 1, brightness: 1, animationFramerate: 30, animationFrame: 0,
      animationPlaying: true, animationAutoStopFrames: [], animationRevision: 0, unloadWhenPluginDisconnects: false
    };
    scene.items.push(item);
    await prepareGifAnimation(item);
    itemFiles.set(item.fileName, { fileName: item.fileName, filePath: item.filePath, type: item.type });
    await Promise.all([saveScenes(), saveItemFiles()]);
    if (scene.id === sceneLibrary.activeSceneId) sendVtsEvent("ItemEvent", itemEventData(item, "Added"));
    return sceneWorkspace();
  });
  ipcMain.handle("update-scene-item", async (_event, requestedSceneId: unknown, requestedItemId: unknown, requestedUpdate: unknown) => {
    const scene = requireScene(requestedSceneId);
    const item = requireSceneItem(scene, requestedItemId);
    if (!requestedUpdate || typeof requestedUpdate !== "object" || Array.isArray(requestedUpdate)) throw new Error("Invalid item update");
    const wasLocked = item.locked;
    const update = requestedUpdate as SceneItemUpdate;
    Object.assign(item, normalizeSceneItemTransform(update, item));
    if (typeof update.brightness === "number" && Number.isFinite(update.brightness)) item.brightness = Math.max(0, Math.min(1, update.brightness));
    if (item.type === "GIF") {
      const runtime = itemAnimationRuntime.get(item.id);
      if (typeof update.animationFramerate === "number" && Number.isFinite(update.animationFramerate)) item.animationFramerate = Math.max(0.1, Math.min(120, update.animationFramerate));
      if (typeof update.animationFrame === "number" && Number.isInteger(update.animationFrame) && update.animationFrame >= 0 && update.animationFrame < (runtime?.frameCount ?? 1)) item.animationFrame = update.animationFrame;
      if (typeof update.animationPlaying === "boolean") item.animationPlaying = update.animationPlaying;
      if (update.animationFramerate !== undefined || update.animationFrame !== undefined || update.animationPlaying !== undefined) {
        item.animationRevision += 1;
        itemAnimationRuntime.set(item.id, { frameCount: runtime?.frameCount ?? 1, currentFrame: item.animationFrame, framerate: item.animationFramerate, animationPlaying: item.animationPlaying });
      }
    }
    await saveScenes();
    if (scene.id === sceneLibrary.activeSceneId && item.locked !== wasLocked) sendVtsEvent("ItemEvent", itemEventData(item, item.locked ? "Locked" : "Unlocked"));
    return sceneWorkspace();
  });
  ipcMain.handle("unpin-scene-item", async (_event, requestedSceneId: unknown, requestedItemId: unknown) => {
    const scene = requireScene(requestedSceneId);
    const item = requireSceneItem(scene, requestedItemId);
    if (item.pin) {
      delete item.pin;
      await saveScenes();
      if (scene.id === sceneLibrary.activeSceneId) sendVtsEvent("ItemEvent", itemEventData(item, "Changed"));
    }
    return sceneWorkspace();
  });
  ipcMain.handle("delete-scene-item", async (_event, requestedSceneId: unknown, requestedItemId: unknown) => {
    const scene = requireScene(requestedSceneId);
    const item = requireSceneItem(scene, requestedItemId);
    scene.items = scene.items.filter((candidate) => candidate.id !== item.id);
    itemAnimationRuntime.delete(item.id);
    await saveScenes();
    if (scene.id === sceneLibrary.activeSceneId) sendVtsEvent("ItemEvent", itemEventData(item, "Removed"));
    return sceneWorkspace();
  });
  ipcMain.handle("delete-scene", async (_event, requestedId: unknown) => {
    const id = requireSceneId(requestedId);
    if (sceneLibrary.scenes.length === 1) throw new Error("The last scene cannot be deleted");
    const deletingActive = id === sceneLibrary.activeSceneId;
    const previousModel = deletingActive ? activeApiModel : undefined;
    sceneLibrary.scenes = sceneLibrary.scenes.filter((scene) => scene.id !== id);
    if (deletingActive) sceneLibrary.activeSceneId = sceneLibrary.scenes[0].id;
    await saveScenes();
    const workspace = await sceneWorkspace(deletingActive);
    if (deletingActive && previousModel && previousModel.modelID !== activeApiModel?.modelID) {
      sendVtsEvent("ModelLoadedEvent", { modelLoaded: false, modelName: previousModel.modelName, modelID: previousModel.modelID });
    }
    if (deletingActive && activeApiModel && previousModel?.modelID !== activeApiModel.modelID) sendVtsEvent("ModelLoadedEvent", currentModelEventData(true));
    if (deletingActive) sendModelMovedEvent();
    return workspace;
  });
  ipcMain.handle("cubism-core-status", coreStatus);
  ipcMain.handle("install-cubism-core", installOfficialCubismCore);
  ipcMain.handle("set-overlay-mode", (event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Overlay mode must be a boolean");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Window is no longer available");
    window.setAlwaysOnTop(enabled, "floating");
    window.setHasShadow(!enabled);
    return enabled;
  });
  ipcMain.handle("set-virtual-camera", async (event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Virtual camera flag must be a boolean");
    const window = BrowserWindow.fromWebContents(event.sender);
    return enabled ? startVirtualCamera(window) : stopVirtualCamera();
  });
  ipcMain.handle("get-virtual-camera-status", () => getVirtualCameraStatus());
  ipcMain.handle("push-virtual-camera-frame", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const body = payload as { width?: unknown; height?: unknown; rgba?: unknown };
    if (!Number.isInteger(body.width) || !Number.isInteger(body.height) || body.width! < 2 || body.height! < 2 || body.width! > 3840 || body.height! > 2160) return false;
    let rgba: Buffer | Uint8Array | ArrayBuffer;
    if (body.rgba instanceof ArrayBuffer) rgba = body.rgba;
    else if (ArrayBuffer.isView(body.rgba)) rgba = body.rgba.buffer.slice(body.rgba.byteOffset, body.rgba.byteOffset + body.rgba.byteLength);
    else if (Buffer.isBuffer(body.rgba)) rgba = body.rgba;
    else return false;
    return pushVirtualCameraFrame({ width: body.width as number, height: body.height as number, rgba });
  });
  ipcMain.handle("forget-trusted-devices", async () => {
    trustedDevices.clear();
    for (const socket of clients.keys()) socket.close(1008, "Device trust was revoked");
    clients.clear();
    await saveTrustedDevices();
    publishStatus();
    return true;
  });
  ipcMain.handle("resolve-plugin-authorization", (_event, id: unknown, approved: unknown) => {
    if (typeof id !== "string" || typeof approved !== "boolean") throw new Error("Invalid plugin authorization response");
    const pending = pendingPluginApprovals.get(id);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    pendingPluginApprovals.delete(id);
    pending.resolve(approved);
    return true;
  });
  ipcMain.handle("forget-plugin-access", async () => {
    pluginTokens.clear();
    for (const [socket, apiSession] of pluginSessions) {
      if (apiSession.authenticated) {
        apiSession.authenticated = false;
        socket.close(1008, "Plugin access was revoked");
      }
    }
    customParameters.clear();
    injectedInputs.clear();
    await savePluginAccess();
    await saveCustomParameters();
    publishStatus();
    return true;
  });
  ipcMain.handle("notify-local-hotkey", (_event, requestedHotkeyID: unknown) => {
    if (typeof requestedHotkeyID !== "string") throw new Error("Hotkey ID must be a string");
    const hotkey = activeApiModel?.hotkeys.find((candidate) => candidate.hotkeyID === requestedHotkeyID);
    if (!hotkey) return false;
    sendVtsEvent("HotkeyTriggeredEvent", hotkeyEventData(hotkey, false));
    return true;
  });
  ipcMain.handle("report-artmeshes", (_event, modelDirectory: unknown, meshes: unknown) => {
    if (typeof modelDirectory !== "string" || modelDirectory !== activeImportedModel?.directory) return false;
    if (!Array.isArray(meshes) || meshes.length > 100_000) throw new Error("Invalid ArtMesh report");
    const parsed = new Map<string, ArtMeshGeometry>();
    let totalIndices = 0;
    for (const raw of meshes) {
      if (!raw || typeof raw !== "object") throw new Error("Invalid ArtMesh report");
      const mesh = raw as Record<string, unknown>;
      if (typeof mesh.id !== "string" || mesh.id.length === 0 || mesh.id.length > 256 || !Number.isInteger(mesh.vertexCount) || (mesh.vertexCount as number) < 0 || (mesh.vertexCount as number) > 1_000_000 || !Array.isArray(mesh.indices) || mesh.indices.length % 3 !== 0) throw new Error("Invalid ArtMesh geometry");
      if (mesh.indices.some((index) => !Number.isInteger(index) || (index as number) < 0 || (index as number) >= (mesh.vertexCount as number))) throw new Error("Invalid ArtMesh indices");
      totalIndices += mesh.indices.length;
      if (totalIndices > 2_000_000) throw new Error("ArtMesh geometry report is too large");
      parsed.set(mesh.id, { id: mesh.id, vertexCount: mesh.vertexCount as number, indices: [...mesh.indices] as number[] });
    }
    activeArtMeshGeometry.clear();
    for (const [id, geometry] of parsed) activeArtMeshGeometry.set(id, geometry);
    activeArtMeshNames = [...parsed.keys()];
    if (activeApiModel) activeApiModel.numberOfLive2DArtmeshes = activeArtMeshNames.length;
    publishArtMeshTints();
    publishPhysicsControl();
    return true;
  });
  ipcMain.handle("report-item-animation-state", (_event, itemID: unknown, rawState: unknown) => {
    if (typeof itemID !== "string" || !rawState || typeof rawState !== "object" || Array.isArray(rawState)) return false;
    const item = storedActiveScene().items.find((candidate) => candidate.id === itemID);
    if (!item || item.type !== "GIF") return false;
    const state = rawState as Record<string, unknown>;
    if (!Number.isInteger(state.frameCount) || (state.frameCount as number) < 1 || (state.frameCount as number) > 1024 || !Number.isInteger(state.currentFrame) || (state.currentFrame as number) < 0 || (state.currentFrame as number) >= (state.frameCount as number) || typeof state.framerate !== "number" || !Number.isFinite(state.framerate) || state.framerate < 0.1 || state.framerate > 120 || typeof state.animationPlaying !== "boolean") return false;
    itemAnimationRuntime.set(itemID, { frameCount: state.frameCount as number, currentFrame: state.currentFrame as number, framerate: state.framerate, animationPlaying: state.animationPlaying });
    return true;
  });
  await Promise.all([loadTrustedDevices(), loadPluginAccess(), loadCustomParameters(), loadItemFiles(), loadModelMappingOverrides(), loadModelDirectories(), loadScenes(), loadPostProcessing()]);
  await Promise.all([backfillItemFilesFromScenes(), backfillModelDirectoriesFromScenes()]);
  await prepareAllGifAnimations();
  await loadActiveSceneModel();
  startTrackingServer();
  startVtsApiServer();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopVirtualCamera();
  if (testEventTimer) clearInterval(testEventTimer);
  service?.stop();
  bonjour?.destroy();
  server?.close();
  vtsApiServer?.close();
  for (const pending of pendingPluginApprovals.values()) {
    clearTimeout(pending.timeout);
    pending.resolve(false);
  }
  pendingPluginApprovals.clear();
  if (pendingArtMeshSelection) cancelArtMeshSelectionForSession(pendingArtMeshSelection.sessionID);
});
