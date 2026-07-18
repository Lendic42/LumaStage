import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep, join } from "node:path";
import { pathToFileURL } from "node:url";
import Bonjour from "bonjour-service";
import { WebSocketServer, type WebSocket } from "ws";
import { parseLumaLinkMessage, type HelloMessage, type TrackingFrame } from "@lumastage/protocol";
import { inspectCubismModelFolder } from "@lumastage/model-compat";
import { applyVTubeParameterMappingsToInputs, mapARKitToVTubeInputs } from "@lumastage/tracking-core";
import { createVtsEventMessage, handleVtsApiRequest, vtsSessionAcceptsEvent, type VtsApiHost, type VtsApiSession, type VtsCurrentModel, type VtsCustomParameterDefinition, type VtsEventName, type VtsParameter } from "@lumastage/vts-api";
import { createDefaultSceneLibrary, normalizeSceneTransform, parseSceneLibrary, type SceneLibrary as StoredSceneLibrary, type ScenePreset as StoredScenePreset } from "@lumastage/scene-core";
import type { CubismCoreStatus, DesktopStatus, ImportedHotkey, ImportedModel, PluginAuthorizationRequest, SceneLibrary, ScenePreset, SceneUpdate, SceneWorkspace, VtsParameterInjection } from "../shared/bridge.js";

protocol.registerSchemesAsPrivileged([
  { scheme: "lumastage-model", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "lumastage-core", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: "lumastage-background", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
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
const pluginSessions = new Map<WebSocket, VtsApiSession>();
const pendingPluginApprovals = new Map<string, { resolve(approved: boolean): void; timeout: NodeJS.Timeout }>();
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
    modelName: scene.modelName
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
  activeModelRoot = undefined;
  activeApiModel = undefined;
  activeImportedModel = undefined;
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

async function authorizeHello(hello: HelloMessage): Promise<{ deviceToken?: string } | undefined> {
  const storedHash = trustedDevices.get(hello.deviceId);
  if (hello.token && storedHash && hashesMatch(hashToken(hello.token), storedHash)) return {};
  if (hello.token === pairingCode) return { deviceToken: await trustDevice(hello.deviceId) };
  return undefined;
}

function cubismCorePath(): string {
  return join(app.getPath("userData"), "runtime", "live2dcubismcore.min.js");
}

async function coreStatus(): Promise<CubismCoreStatus> {
  try {
    const source = await readFile(cubismCorePath(), "utf8");
    const version = source.match(/Cubism\s*(?:Core)?\s*v?([0-9]+(?:\.[0-9]+){1,3})/i)?.[1];
    return { available: source.includes("Live2DCubismCore"), version };
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
    size: Math.max(-100, Math.min(100, (transform.scale - 1) * 50))
  };
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

function publishStatus(): void {
  const status: DesktopStatus = {
    port: TRACKING_PORT,
    connectedDevices: clients.size,
    pairingCode,
    trustedDevices: trustedDevices.size,
    vtsApiPort: VTS_API_PORT,
    vtsApiActive,
    allowedPlugins: pluginTokens.size
  };
  broadcast("desktop-status", status);
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
  server = new WebSocketServer({ port: TRACKING_PORT, maxPayload: 64 * 1024 });
  server.on("connection", (socket) => {
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

  bonjour = new Bonjour();
  service = bonjour.publish({
    name: `LumaStage on ${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "Desktop"}`,
    type: "lumastage",
    protocol: "tcp",
    port: TRACKING_PORT,
    txt: { protocol: "1", app: app.getVersion() }
  });
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
    modelPosition: currentModelPosition,
    faceFound: () => injectedFaceFound && injectedFaceFound.expiresAt >= Date.now() ? injectedFaceFound.value : latestTrackingFrame?.faceFound ?? false,
    triggerHotkey: async (hotkeyIDOrName) => {
      const hotkey = activeApiModel?.hotkeys.find((candidate) =>
        candidate.hotkeyID === hotkeyIDOrName || candidate.name.toLowerCase() === hotkeyIDOrName.toLowerCase()
      );
      if (!hotkey) return undefined;
      const trigger: ImportedHotkey = { id: hotkey.hotkeyID, name: hotkey.name, action: hotkey.type, file: hotkey.file, folder: "" };
      broadcast("vts-hotkey-trigger", trigger);
      sendVtsEvent("HotkeyTriggeredEvent", hotkeyEventData(hotkey, true));
      return hotkey.hotkeyID;
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
    deleteCustomParameter
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
    const apiSession: VtsApiSession = { authenticated: false };
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
  activeModelRoot = model.directory;
  const imported: ImportedModel = {
    directory: model.directory,
    manifestPath: model.manifestPath,
    name: model.name,
    mocPath: model.mocPath,
    textureCount: model.texturePaths.length,
    expressionCount: model.expressions.length,
    motionCount: Object.values(model.motionGroups).flat().length,
    expressions: model.expressions.map((expression) => ({ name: expression.name, file: relative(model.directory, expression.path) })),
    motionGroups: Object.fromEntries(Object.entries(model.motionGroups).map(([group, paths]) => [group, paths.map((path) => relative(model.directory, path))])),
    missingFiles: model.missingFiles,
    manifestUrl: `lumastage-model://active/${encodeURIComponent(basename(model.manifestPath))}`,
    vTubeModelName: model.vTubeStudio?.name,
    vTubeParameterMappings: model.vTubeStudio?.parameterMappings ?? [],
    vTubeHotkeys: model.vTubeStudio?.hotkeys ?? []
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
      transform: { scale: 1, positionX: 0, positionY: 0, rotation: 0, mirror: false }
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
  ipcMain.handle("install-cubism-core", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select the official Live2D Cubism Core for Web",
      properties: ["openFile"],
      filters: [{ name: "Live2D Cubism Core", extensions: ["js"] }]
    });
    const sourcePath = result.filePaths[0];
    if (result.canceled || !sourcePath) return null;
    const sourceStat = await stat(sourcePath);
    if (sourceStat.size > 16 * 1024 * 1024) throw new Error("Cubism Core file is unexpectedly large");
    const source = await readFile(sourcePath, "utf8");
    if (!source.includes("Live2DCubismCore")) throw new Error("The selected file is not Live2D Cubism Core for Web");
    await mkdir(join(app.getPath("userData"), "runtime"), { recursive: true });
    await copyFile(sourcePath, cubismCorePath());
    return coreStatus();
  });
  ipcMain.handle("set-overlay-mode", (event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Overlay mode must be a boolean");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Window is no longer available");
    window.setAlwaysOnTop(enabled, "floating");
    window.setHasShadow(!enabled);
    return enabled;
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
  await Promise.all([loadTrustedDevices(), loadPluginAccess(), loadCustomParameters(), loadScenes()]);
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
});
