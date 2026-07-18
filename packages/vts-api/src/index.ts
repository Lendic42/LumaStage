import { randomUUID } from "node:crypto";
import { z } from "zod";

const requestSchema = z.object({
  apiName: z.literal("VTubeStudioPublicAPI"),
  apiVersion: z.literal("1.0"),
  requestID: z.string().min(1).max(64).regex(/^[\x20-\x7E]+$/).optional(),
  messageType: z.string().min(1).max(128),
  data: z.unknown().optional()
}).passthrough();

export interface VtsApiSession {
  authenticated: boolean;
  sessionID?: string;
  pluginName?: string;
  pluginDeveloper?: string;
  subscriptions?: Map<VtsEventName, Record<string, unknown>>;
}

export const supportedVtsEvents = [
  "TestEvent", "ModelLoadedEvent", "TrackingStatusChangedEvent", "BackgroundChangedEvent",
  "ModelConfigChangedEvent", "ModelMovedEvent", "HotkeyTriggeredEvent", "ItemEvent"
] as const;
export type VtsEventName = typeof supportedVtsEvents[number];

export interface VtsHotkey {
  name: string;
  type: string;
  description?: string;
  file: string;
  hotkeyID: string;
}

export interface VtsCurrentModel {
  modelName: string;
  modelID: string;
  vtsModelName: string;
  vtsModelIconName: string;
  live2DModelName: string;
  loadedAt: number;
  numberOfLive2DParameters: number;
  numberOfLive2DArtmeshes: number;
  hasPhysicsFile: boolean;
  numberOfTextures: number;
  textureResolution: number;
  hotkeys: VtsHotkey[];
}

export interface VtsAvailableModel {
  modelName: string;
  modelID: string;
  vtsModelName: string;
  vtsModelIconName: string;
}

export interface VtsExpressionState {
  name: string;
  file: string;
  active: boolean;
  usedInHotkeys: Array<{ name: string; id: string }>;
  parameters: Array<{ name: string; value: number }>;
}

export interface VtsParameter {
  name: string;
  addedBy?: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
}

export interface VtsInjectedParameter {
  id: string;
  value: number;
  weight?: number;
}

export interface VtsCustomParameterDefinition {
  parameterName: string;
  explanation: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface VtsSceneItem {
  fileName: string;
  instanceID: string;
  order: number;
  type: "PNG" | "JPG" | "GIF" | "AnimationFolder" | "Live2D" | "Unknown";
  censored: boolean;
  flipped: boolean;
  locked: boolean;
  smoothing: number;
  framerate: number;
  frameCount: number;
  currentFrame: number;
  pinnedToModel: boolean;
  pinnedModelID: string;
  pinnedArtMeshID: string;
  groupName: string;
  sceneName: string;
  fromWorkshop: boolean;
}

export interface VtsItemLoadInput {
  fileName: string;
  positionX: number;
  positionY: number;
  size: number;
  rotation: number;
  order: number;
  failIfOrderTaken: boolean;
  smoothing: number;
  censored: boolean;
  flipped: boolean;
  locked: boolean;
  unloadWhenPluginDisconnects: boolean;
}

export interface VtsItemMoveInput {
  itemInstanceID: string;
  positionX?: number;
  positionY?: number;
  size?: number;
  rotation?: number;
  order?: number;
  setFlip: boolean;
  flip: boolean;
}

export interface VtsModelMoveInput {
  timeInSeconds: number;
  valuesAreRelativeToModel: boolean;
  positionX?: number;
  positionY?: number;
  rotation?: number;
  size?: number;
}

export interface VtsArtMeshMatcher {
  tintAll: boolean;
  artMeshNumber: number[];
  nameExact: string[];
  nameContains: string[];
  tagExact: string[];
  tagContains: string[];
}

export interface VtsColorTint {
  colorR: number;
  colorG: number;
  colorB: number;
  colorA: number;
  mixWithSceneLightingColor: number;
}

export interface VtsPhysicsGroup {
  groupID: string;
  groupName: string;
  strengthMultiplier: number;
  windMultiplier: number;
}

export interface VtsPhysicsState {
  modelHasPhysics: boolean;
  physicsSwitchedOn: boolean;
  usingLegacyPhysics: boolean;
  physicsFPSSetting: number;
  baseStrength: number;
  baseWind: number;
  overridePluginName: string;
  physicsGroups: VtsPhysicsGroup[];
}

export interface VtsPhysicsOverride {
  id: string;
  value: number;
  setBaseValue: boolean;
  overrideSeconds: number;
}

export interface VtsApiHost {
  version: string;
  startedAt: number;
  allowedPluginCount(): number;
  connectedPluginCount(): number;
  requestToken(pluginName: string, pluginDeveloper: string, pluginIcon?: string): Promise<string | undefined>;
  authenticate(pluginName: string, pluginDeveloper: string, token: string): Promise<boolean>;
  currentModel(): VtsCurrentModel | undefined;
  availableModels(): Promise<VtsAvailableModel[]>;
  loadModel(modelID: string): Promise<"loaded" | "unloaded" | "not-found">;
  modelPosition(): { positionX: number; positionY: number; rotation: number; size: number };
  moveModel(input: VtsModelMoveInput): Promise<boolean>;
  artMeshes(): { names: string[]; tags: string[] };
  tintArtMeshes(sessionID: string, tint: VtsColorTint, matcher: VtsArtMeshMatcher): Promise<string[]>;
  physicsState(): VtsPhysicsState;
  setPhysicsOverrides(sessionID: string, pluginName: string, strength: VtsPhysicsOverride[], wind: VtsPhysicsOverride[]): Promise<"ok" | "controlled" | "invalid-group">;
  faceFound(): boolean;
  triggerHotkey(hotkeyIDOrName: string): Promise<string | undefined>;
  expressionStates(): VtsExpressionState[];
  activateExpression(expressionFile: string, active: boolean, fadeTime: number): Promise<boolean>;
  inputParameters(): { defaultParameters: VtsParameter[]; customParameters: VtsParameter[] };
  live2DParameters(): VtsParameter[];
  injectParameterData(parameters: VtsInjectedParameter[], mode: "set" | "add", faceFound?: boolean): Promise<string[]>;
  createCustomParameter(pluginName: string, pluginDeveloper: string, parameter: VtsCustomParameterDefinition): Promise<"created" | "owned-by-other" | "limit">;
  deleteCustomParameter(pluginName: string, pluginDeveloper: string, parameterName: string): Promise<"deleted" | "not-found" | "owned-by-other">;
  listItems(): { items: VtsSceneItem[]; availableItemFiles: Array<{ fileName: string; type: VtsSceneItem["type"]; loadedCount: number }>; availableSpots: number[] };
  loadItem(pluginName: string, pluginDeveloper: string, sessionID: string, input: VtsItemLoadInput): Promise<{ item?: VtsSceneItem; error?: "not-found" | "limit" | "order" }>;
  unloadItems(pluginName: string, pluginDeveloper: string, input: { unloadAllInScene: boolean; unloadAllLoadedByThisPlugin: boolean; allowOthers: boolean; instanceIDs: string[]; fileNames: string[] }): Promise<VtsSceneItem[]>;
  moveItems(inputs: VtsItemMoveInput[]): Promise<Array<{ itemInstanceID: string; success: boolean; errorID: number }>>;
}

type JsonObject = Record<string, unknown>;

function response(messageType: string, requestID: string, data: JsonObject): JsonObject {
  return { apiName: "VTubeStudioPublicAPI", apiVersion: "1.0", timestamp: Date.now(), messageType, requestID, data };
}

function error(requestID: string, errorID: number, message: string): JsonObject {
  return response("APIError", requestID, { errorID, message });
}

function objectData(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === "string" ? data[key] as string : undefined;
}

function subscriptions(session: VtsApiSession): Map<VtsEventName, Record<string, unknown>> {
  session.subscriptions ??= new Map();
  return session.subscriptions;
}

function stringArray(value: unknown, max = 64): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || item.length > 256)) return undefined;
  return value as string[];
}

function validatedEventConfig(eventName: VtsEventName, value: unknown): Record<string, unknown> | undefined {
  const config = objectData(value);
  if (eventName === "TestEvent") {
    const message = config.testMessageForEvent;
    if (message !== undefined && (typeof message !== "string" || message.length > 32)) return undefined;
    return message === undefined ? {} : { testMessageForEvent: message };
  }
  if (eventName === "ModelLoadedEvent") {
    const modelID = stringArray(config.modelID);
    return modelID ? { modelID } : undefined;
  }
  if (eventName === "HotkeyTriggeredEvent") {
    if (config.onlyForAction !== undefined && typeof config.onlyForAction !== "string") return undefined;
    if (config.ignoreHotkeysTriggeredByAPI !== undefined && typeof config.ignoreHotkeysTriggeredByAPI !== "boolean") return undefined;
    return {
      onlyForAction: typeof config.onlyForAction === "string" ? config.onlyForAction : "",
      ignoreHotkeysTriggeredByAPI: config.ignoreHotkeysTriggeredByAPI === true
    };
  }
  if (eventName === "ItemEvent") {
    const itemInstanceIDs = stringArray(config.itemInstanceIDs);
    const itemFileNames = stringArray(config.itemFileNames);
    return itemInstanceIDs && itemFileNames ? { itemInstanceIDs, itemFileNames } : undefined;
  }
  return {};
}

export function vtsSessionAcceptsEvent(session: VtsApiSession, eventName: VtsEventName, data: Record<string, unknown>): boolean {
  const config = session.subscriptions?.get(eventName);
  if (!session.authenticated || !config) return false;
  if (eventName === "ModelLoadedEvent") {
    const filters = config.modelID as string[] | undefined;
    return !filters?.length || filters.includes(String(data.modelID ?? ""));
  }
  if (eventName === "HotkeyTriggeredEvent") {
    if (config.ignoreHotkeysTriggeredByAPI === true && data.hotkeyTriggeredByAPI === true) return false;
    const only = config.onlyForAction;
    return typeof only !== "string" || !only || only === data.hotkeyAction;
  }
  if (eventName === "ItemEvent") {
    const ids = config.itemInstanceIDs as string[] | undefined;
    const files = config.itemFileNames as string[] | undefined;
    if (!ids?.length && !files?.length) return true;
    const idMatches = ids?.includes(String(data.itemInstanceID ?? "")) ?? false;
    const fileName = String(data.itemFileName ?? "");
    const fileMatches = files?.some((fragment) => fileName.includes(fragment)) ?? false;
    return idMatches || fileMatches;
  }
  return true;
}

export function createVtsEventMessage(eventName: VtsEventName, data: Record<string, unknown>): JsonObject {
  return response(eventName, randomUUID(), data);
}

export async function handleVtsApiRequest(raw: string, session: VtsApiSession, host: VtsApiHost): Promise<JsonObject> {
  let request: z.infer<typeof requestSchema>;
  try {
    if (raw.length > 1024 * 1024) return error(randomUUID(), 2, "JSON payload exceeds 1 MiB");
    request = requestSchema.parse(JSON.parse(raw));
  } catch (reason) {
    return error(randomUUID(), 2, reason instanceof Error ? reason.message : "Invalid JSON request");
  }

  const requestID = request.requestID ?? randomUUID();
  const data = objectData(request.data);

  if (request.messageType === "APIStateRequest") {
    return response("APIStateResponse", requestID, {
      active: true,
      vTubeStudioVersion: host.version,
      currentSessionAuthenticated: session.authenticated
    });
  }

  if (request.messageType === "AuthenticationTokenRequest") {
    const pluginName = stringField(data, "pluginName");
    const pluginDeveloper = stringField(data, "pluginDeveloper");
    if (!pluginName || pluginName.length < 3 || pluginName.length > 32) return error(requestID, 52, "Plugin name must be between 3 and 32 characters");
    if (!pluginDeveloper || pluginDeveloper.length < 3 || pluginDeveloper.length > 32) return error(requestID, 53, "Plugin developer must be between 3 and 32 characters");
    const token = await host.requestToken(pluginName, pluginDeveloper, stringField(data, "pluginIcon"));
    return token
      ? response("AuthenticationTokenResponse", requestID, { authenticationToken: token })
      : error(requestID, 50, "User has denied API access for this plugin");
  }

  if (request.messageType === "AuthenticationRequest") {
    const pluginName = stringField(data, "pluginName");
    const pluginDeveloper = stringField(data, "pluginDeveloper");
    const token = stringField(data, "authenticationToken");
    if (!token) return error(requestID, 100, "Authentication token is missing");
    if (!pluginName) return error(requestID, 101, "Plugin name is missing");
    if (!pluginDeveloper) return error(requestID, 102, "Plugin developer is missing");
    session.authenticated = await host.authenticate(pluginName, pluginDeveloper, token);
    if (session.authenticated) {
      session.pluginName = pluginName;
      session.pluginDeveloper = pluginDeveloper;
    } else {
      session.subscriptions?.clear();
    }
    return response("AuthenticationResponse", requestID, {
      authenticated: session.authenticated,
      reason: session.authenticated ? "Token valid. The plugin is authenticated for this session." : "Token invalid or access revoked."
    });
  }

  if (!session.authenticated) return error(requestID, 8, "This request requires authentication");

  if (request.messageType === "EventSubscriptionRequest") {
    if (typeof data.subscribe !== "boolean") return error(requestID, 800, "Event subscribe field must be a boolean");
    const eventName = stringField(data, "eventName") ?? "";
    const current = subscriptions(session);
    if (!data.subscribe && !eventName) {
      current.clear();
    } else {
      if (!(supportedVtsEvents as readonly string[]).includes(eventName)) return error(requestID, 801, `Unknown or unsupported event: ${eventName}`);
      const typedName = eventName as VtsEventName;
      if (data.subscribe) {
        const config = validatedEventConfig(typedName, data.config);
        if (!config) return error(requestID, 802, `Invalid config for event: ${eventName}`);
        current.set(typedName, config);
      } else {
        current.delete(typedName);
      }
    }
    return response("EventSubscriptionResponse", requestID, {
      subscribedEventCount: current.size,
      subscribedEvents: [...current.keys()]
    });
  }

  if (request.messageType === "StatisticsRequest") {
    return response("StatisticsResponse", requestID, {
      uptime: Math.max(0, Date.now() - host.startedAt),
      framerate: 60,
      vTubeStudioVersion: host.version,
      allowedPlugins: host.allowedPluginCount(),
      connectedPlugins: host.connectedPluginCount(),
      startedWithSteam: false,
      windowWidth: 0,
      windowHeight: 0,
      windowIsFullscreen: false
    });
  }

  const model = host.currentModel();
  if (request.messageType === "CurrentModelRequest") {
    return response("CurrentModelResponse", requestID, model ? {
      modelLoaded: true,
      modelName: model.modelName,
      modelID: model.modelID,
      vtsModelName: model.vtsModelName,
      vtsModelIconName: model.vtsModelIconName,
      live2DModelName: model.live2DModelName,
      modelLoadTime: 0,
      timeSinceModelLoaded: Math.max(0, Date.now() - model.loadedAt),
      numberOfLive2DParameters: model.numberOfLive2DParameters,
      numberOfLive2DArtmeshes: model.numberOfLive2DArtmeshes,
      hasPhysicsFile: model.hasPhysicsFile,
      numberOfTextures: model.numberOfTextures,
      textureResolution: model.textureResolution,
      modelPosition: host.modelPosition()
    } : {
      modelLoaded: false, modelName: "", modelID: "", vtsModelName: "", vtsModelIconName: "", live2DModelName: "",
      modelLoadTime: 0, timeSinceModelLoaded: 0, numberOfLive2DParameters: 0, numberOfLive2DArtmeshes: 0,
      hasPhysicsFile: false, numberOfTextures: 0, textureResolution: 0,
      modelPosition: { positionX: 0, positionY: 0, rotation: 0, size: 0 }
    });
  }

  if (request.messageType === "AvailableModelsRequest") {
    const models = await host.availableModels();
    return response("AvailableModelsResponse", requestID, {
      numberOfModels: models.length,
      availableModels: models.map((available) => ({ ...available, modelLoaded: available.modelID === model?.modelID }))
    });
  }

  if (request.messageType === "ModelLoadRequest") {
    const modelID = stringField(data, "modelID");
    if (modelID === undefined || modelID.length > 256) return error(requestID, 150, "Model ID is missing or invalid");
    const loaded = await host.loadModel(modelID);
    return loaded === "not-found"
      ? error(requestID, 151, "Model ID was not found")
      : response("ModelLoadResponse", requestID, { modelID });
  }

  if (request.messageType === "MoveModelRequest") {
    if (!model) return error(requestID, 154, "No model is currently loaded");
    if (typeof data.timeInSeconds !== "number" || !Number.isFinite(data.timeInSeconds) || data.timeInSeconds < 0 || data.timeInSeconds > 2) return error(requestID, 155, "Model move time must be between 0 and 2 seconds");
    if (typeof data.valuesAreRelativeToModel !== "boolean") return error(requestID, 156, "valuesAreRelativeToModel must be a boolean");
    const ranged = (key: string, min: number, max: number): number | undefined | null => {
      const value = data[key];
      if (value === undefined) return undefined;
      return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
    };
    const positionX = ranged("positionX", -1000, 1000), positionY = ranged("positionY", -1000, 1000);
    const rotation = ranged("rotation", -360, 360), size = ranged("size", -100, 100);
    if (positionX === null || positionY === null || rotation === null || size === null) return error(requestID, 157, "Model move values are outside supported ranges");
    const moved = await host.moveModel({ timeInSeconds: data.timeInSeconds, valuesAreRelativeToModel: data.valuesAreRelativeToModel, positionX, positionY, rotation, size });
    return moved ? response("MoveModelResponse", requestID, {}) : error(requestID, 154, "No model is currently loaded");
  }

  if (request.messageType === "ArtMeshListRequest") {
    const meshes = model ? host.artMeshes() : { names: [], tags: [] };
    return response("ArtMeshListResponse", requestID, {
      modelLoaded: Boolean(model), numberOfArtMeshNames: meshes.names.length, numberOfArtMeshTags: meshes.tags.length,
      artMeshNames: meshes.names, artMeshTags: meshes.tags
    });
  }

  if (request.messageType === "ColorTintRequest") {
    if (!model) return error(requestID, 600, "No model is currently loaded");
    const color = objectData(data.colorTint), rawMatcher = objectData(data.artMeshMatcher);
    const channel = (key: string): number | undefined => typeof color[key] === "number" && Number.isInteger(color[key]) && color[key] >= 0 && color[key] <= 255 ? color[key] as number : undefined;
    const colorR = channel("colorR"), colorG = channel("colorG"), colorB = channel("colorB"), colorA = channel("colorA");
    if (colorR === undefined || colorG === undefined || colorB === undefined || colorA === undefined) return error(requestID, 601, "Tint RGBA channels must be integers between 0 and 255");
    const mix = color.mixWithSceneLightingColor === undefined ? 1 : color.mixWithSceneLightingColor;
    if (typeof mix !== "number" || !Number.isFinite(mix) || mix < 0 || mix > 1) return error(requestID, 602, "Scene-lighting tint mix must be between 0 and 1");
    const numbers = rawMatcher.artMeshNumber === undefined ? [] : rawMatcher.artMeshNumber;
    if (!Array.isArray(numbers) || numbers.length > 1024 || numbers.some((value) => !Number.isInteger(value) || value < 0)) return error(requestID, 603, "ArtMesh number matcher is invalid");
    const nameExact = stringArray(rawMatcher.nameExact, 1024), nameContains = stringArray(rawMatcher.nameContains, 1024);
    const tagExact = stringArray(rawMatcher.tagExact, 1024), tagContains = stringArray(rawMatcher.tagContains, 1024);
    if (!nameExact || !nameContains || !tagExact || !tagContains) return error(requestID, 603, "ArtMesh matcher is invalid");
    const matched = await host.tintArtMeshes(session.sessionID ?? "", { colorR, colorG, colorB, colorA, mixWithSceneLightingColor: mix }, {
      tintAll: rawMatcher.tintAll === true, artMeshNumber: numbers as number[], nameExact, nameContains, tagExact, tagContains
    });
    return response("ColorTintResponse", requestID, { matchedArtMeshes: matched.length });
  }

  if (request.messageType === "GetCurrentModelPhysicsRequest") {
    const physics = host.physicsState();
    return response("GetCurrentModelPhysicsResponse", requestID, {
      modelLoaded: Boolean(model), modelName: model?.modelName ?? "", modelID: model?.modelID ?? "",
      modelHasPhysics: Boolean(model) && physics.modelHasPhysics, physicsSwitchedOn: Boolean(model) && physics.physicsSwitchedOn,
      usingLegacyPhysics: physics.usingLegacyPhysics, physicsFPSSetting: physics.physicsFPSSetting,
      baseStrength: physics.baseStrength, baseWind: physics.baseWind,
      apiPhysicsOverrideActive: Boolean(physics.overridePluginName), apiPhysicsOverridePluginName: physics.overridePluginName,
      physicsGroups: model ? physics.physicsGroups : []
    });
  }

  if (request.messageType === "SetCurrentModelPhysicsRequest") {
    if (!model) return error(requestID, 700, "No model is currently loaded");
    const parseOverrides = (value: unknown): VtsPhysicsOverride[] | undefined => {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > 128) return undefined;
      const output: VtsPhysicsOverride[] = [];
      for (const entry of value) {
        if (!entry || typeof entry !== "object") return undefined;
        const item = entry as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.value !== "number" || !Number.isFinite(item.value) || typeof item.setBaseValue !== "boolean" || typeof item.overrideSeconds !== "number" || !Number.isFinite(item.overrideSeconds)) return undefined;
        output.push({ id: item.id, value: item.value, setBaseValue: item.setBaseValue, overrideSeconds: Math.max(0.5, Math.min(5, item.overrideSeconds)) });
      }
      return output;
    };
    const strength = parseOverrides(data.strengthOverrides), wind = parseOverrides(data.windOverrides);
    if (!strength || !wind || strength.length + wind.length === 0) return error(requestID, 701, "Physics overrides are missing or invalid");
    const normalized = (items: VtsPhysicsOverride[]) => items.map((item) => ({ ...item, value: Math.max(0, Math.min(item.setBaseValue ? 100 : 2, item.value)) }));
    const result = await host.setPhysicsOverrides(session.sessionID ?? "", session.pluginName ?? "", normalized(strength), normalized(wind));
    if (result === "controlled") return error(requestID, 702, "Physics is controlled by another plugin");
    if (result === "invalid-group") return error(requestID, 703, "Physics group was not found in the current model");
    return response("SetCurrentModelPhysicsResponse", requestID, {});
  }

  if (request.messageType === "HotkeysInCurrentModelRequest") {
    return response("HotkeysInCurrentModelResponse", requestID, {
      modelLoaded: Boolean(model),
      modelName: model?.modelName ?? "",
      modelID: model?.modelID ?? "",
      availableHotkeys: (model?.hotkeys ?? []).map((hotkey) => ({
        name: hotkey.name,
        type: hotkey.type,
        description: hotkey.description ?? hotkey.type,
        file: hotkey.file,
        hotkeyID: hotkey.hotkeyID,
        keyCombination: [],
        onScreenButtonID: -1
      }))
    });
  }

  if (request.messageType === "HotkeyTriggerRequest") {
    if (!model) return error(requestID, 201, "No model is currently loaded");
    const requestedHotkey = stringField(data, "hotkeyID");
    if (!requestedHotkey) return error(requestID, 202, "Hotkey ID or name was not found in the model");
    const triggeredID = await host.triggerHotkey(requestedHotkey);
    return triggeredID
      ? response("HotkeyTriggerResponse", requestID, { hotkeyID: triggeredID })
      : error(requestID, 202, "Hotkey ID or name was not found in the model");
  }

  if (request.messageType === "ExpressionStateRequest") {
    const expressionFile = stringField(data, "expressionFile") ?? "";
    if (expressionFile && (!expressionFile.toLowerCase().endsWith(".exp3.json") || expressionFile.length > 256)) return error(requestID, 300, "Expression filename is invalid");
    const states = host.expressionStates();
    const selected = expressionFile ? states.filter((expression) => expression.file === expressionFile) : states;
    if (expressionFile && selected.length === 0) return error(requestID, 301, "Expression was not found in the current model");
    const details = data.details === true;
    return response("ExpressionStateResponse", requestID, {
      modelLoaded: Boolean(model), modelName: model?.modelName ?? "", modelID: model?.modelID ?? "",
      expressions: selected.map((expression) => ({
        name: expression.name, file: expression.file, active: expression.active,
        deactivateWhenKeyIsLetGo: false, autoDeactivateAfterSeconds: false, secondsRemaining: 0,
        usedInHotkeys: details ? expression.usedInHotkeys : [], parameters: details ? expression.parameters : []
      }))
    });
  }

  if (request.messageType === "ExpressionActivationRequest") {
    if (!model) return error(requestID, 302, "No model is currently loaded");
    const expressionFile = stringField(data, "expressionFile");
    if (!expressionFile || !expressionFile.toLowerCase().endsWith(".exp3.json") || expressionFile.length > 256) return error(requestID, 300, "Expression filename is invalid");
    if (typeof data.active !== "boolean") return error(requestID, 303, "Expression active field must be a boolean");
    const requestedFadeTime = data.fadeTime === undefined ? 0.25 : data.fadeTime;
    if (typeof requestedFadeTime !== "number" || !Number.isFinite(requestedFadeTime)) return error(requestID, 304, "Expression fade time is invalid");
    const activated = await host.activateExpression(expressionFile, data.active, Math.max(0, Math.min(2, requestedFadeTime)));
    return activated ? response("ExpressionActivationResponse", requestID, {}) : error(requestID, 301, "Expression was not found in the current model");
  }

  if (request.messageType === "FaceFoundRequest") {
    return response("FaceFoundResponse", requestID, { found: host.faceFound() });
  }

  if (request.messageType === "InputParameterListRequest") {
    const parameters = host.inputParameters();
    return response("InputParameterListResponse", requestID, {
      modelLoaded: Boolean(model),
      modelName: model?.modelName ?? "",
      modelID: model?.modelID ?? "",
      customParameters: parameters.customParameters,
      defaultParameters: parameters.defaultParameters
    });
  }

  if (request.messageType === "ParameterCreationRequest") {
    const parameterName = stringField(data, "parameterName");
    const explanation = stringField(data, "explanation") ?? "";
    if (!parameterName || !/^[A-Za-z0-9]{4,32}$/.test(parameterName)) return error(requestID, 400, "Parameter name must be 4-32 alphanumeric characters");
    if (explanation.length > 256) return error(requestID, 401, "Parameter explanation is too long");
    const min = data.min;
    const max = data.max;
    const defaultValue = data.defaultValue;
    const validNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
    if (!validNumber(min) || !validNumber(max) || !validNumber(defaultValue) || (min as number) >= (max as number) || (defaultValue as number) < (min as number) || (defaultValue as number) > (max as number)) {
      return error(requestID, 401, "Parameter min, max, or default value is invalid");
    }
    const result = await host.createCustomParameter(session.pluginName!, session.pluginDeveloper!, {
      parameterName, explanation, min: min as number, max: max as number, defaultValue: defaultValue as number
    });
    if (result === "owned-by-other") return error(requestID, 402, "A parameter with this name belongs to another plugin");
    if (result === "limit") return error(requestID, 403, "Custom parameter limit reached");
    return response("ParameterCreationResponse", requestID, { parameterName });
  }

  if (request.messageType === "ParameterDeletionRequest") {
    const parameterName = stringField(data, "parameterName");
    if (!parameterName) return error(requestID, 410, "Parameter name is missing");
    const result = await host.deleteCustomParameter(session.pluginName!, session.pluginDeveloper!, parameterName);
    if (result === "not-found") return error(requestID, 411, "Custom parameter was not found");
    if (result === "owned-by-other") return error(requestID, 412, "Custom parameter belongs to another plugin");
    return response("ParameterDeletionResponse", requestID, { parameterName });
  }

  if (request.messageType === "ItemListRequest") {
    const listed = host.listItems();
    const onlyFileName = stringField(data, "onlyItemsWithFileName") ?? "";
    const onlyInstanceID = stringField(data, "onlyItemsWithInstanceID") ?? "";
    const filtered = listed.items.filter((item) => (!onlyFileName || item.fileName === onlyFileName) && (!onlyInstanceID || item.instanceID === onlyInstanceID));
    return response("ItemListResponse", requestID, {
      itemsInSceneCount: listed.items.length,
      totalItemsAllowedCount: 60,
      canLoadItemsRightNow: true,
      availableSpots: data.includeAvailableSpots === true ? listed.availableSpots : [],
      itemInstancesInScene: data.includeItemInstancesInScene === true ? filtered : [],
      availableItemFiles: data.includeAvailableItemFiles === true ? listed.availableItemFiles : []
    });
  }

  if (request.messageType === "ItemLoadRequest") {
    const fileName = stringField(data, "fileName");
    if (!fileName) return error(requestID, 1100, "Item filename is missing");
    if (typeof data.customDataBase64 === "string" && data.customDataBase64.length > 0) return error(requestID, 1101, "Custom-data items require a separate permission and are not supported yet");
    const number = (key: string, fallback: number) => data[key] === undefined ? fallback : data[key];
    const positionX = number("positionX", 0), positionY = number("positionY", 0), size = number("size", 0.32), rotation = number("rotation", 0), order = number("order", 1), smoothing = number("smoothing", 0), fadeTime = number("fadeTime", 0);
    if ([positionX, positionY, size, rotation, order, smoothing, fadeTime].some((value) => typeof value !== "number" || !Number.isFinite(value))) return error(requestID, 1102, "Item load values are invalid");
    if (Math.abs(positionX as number) > 1000 || Math.abs(positionY as number) > 1000 || (size as number) < 0 || (size as number) > 1 || (smoothing as number) < 0 || (smoothing as number) > 1 || (fadeTime as number) < 0 || (fadeTime as number) > 2 || !Number.isInteger(order) || (order as number) < -30 || (order as number) > 30 || order === 0) return error(requestID, 1102, "Item load values are outside supported ranges");
    const loaded = await host.loadItem(session.pluginName!, session.pluginDeveloper!, session.sessionID ?? "", {
      fileName, positionX: positionX as number, positionY: positionY as number, size: size as number, rotation: rotation as number,
      order: order as number, failIfOrderTaken: data.failIfOrderTaken === true, smoothing: smoothing as number,
      censored: data.censored === true, flipped: data.flipped === true, locked: data.locked === true,
      unloadWhenPluginDisconnects: data.unloadWhenPluginDisconnects === true
    });
    if (loaded.error === "not-found") return error(requestID, 1103, "Item file was not found");
    if (loaded.error === "limit") return error(requestID, 1104, "Scene item limit reached");
    if (loaded.error === "order") return error(requestID, 1105, "Requested item order is already taken");
    return response("ItemLoadResponse", requestID, { instanceID: loaded.item!.instanceID, fileName: loaded.item!.fileName });
  }

  if (request.messageType === "ItemUnloadRequest") {
    const instanceIDs = stringArray(data.instanceIDs);
    const fileNames = stringArray(data.fileNames);
    if (!instanceIDs || !fileNames) return error(requestID, 1110, "Item unload filters are invalid");
    const unloaded = await host.unloadItems(session.pluginName!, session.pluginDeveloper!, {
      unloadAllInScene: data.unloadAllInScene === true,
      unloadAllLoadedByThisPlugin: data.unloadAllLoadedByThisPlugin === true,
      allowOthers: data.allowUnloadingItemsLoadedByUserOrOtherPlugins === true,
      instanceIDs, fileNames
    });
    return response("ItemUnloadResponse", requestID, { unloadedItems: unloaded.map((item) => ({ instanceID: item.instanceID, fileName: item.fileName })) });
  }

  if (request.messageType === "ItemMoveRequest") {
    if (!Array.isArray(data.itemsToMove) || data.itemsToMove.length === 0) return error(requestID, 1120, "No items were provided to move");
    const inputs: VtsItemMoveInput[] = [];
    for (const rawItem of data.itemsToMove.slice(0, 64)) {
      if (!rawItem || typeof rawItem !== "object") return error(requestID, 1121, "Item move entry is invalid");
      const item = rawItem as Record<string, unknown>;
      if (typeof item.itemInstanceID !== "string") return error(requestID, 1121, "Item instance ID is missing");
      const optionalNumber = (key: string): number | undefined => typeof item[key] === "number" && Number.isFinite(item[key]) && (item[key] as number) > -1000 ? item[key] as number : undefined;
      inputs.push({
        itemInstanceID: item.itemInstanceID,
        positionX: optionalNumber("positionX"), positionY: optionalNumber("positionY"), size: optionalNumber("size"), rotation: optionalNumber("rotation"),
        order: optionalNumber("order"), setFlip: item.setFlip === true, flip: item.flip === true
      });
    }
    return response("ItemMoveResponse", requestID, { movedItems: await host.moveItems(inputs) });
  }

  if (request.messageType === "ParameterValueRequest") {
    const name = stringField(data, "name");
    const parameters = host.inputParameters();
    const parameter = [...parameters.defaultParameters, ...parameters.customParameters].find((candidate) => candidate.name === name);
    return parameter
      ? response("ParameterValueResponse", requestID, parameter as unknown as JsonObject)
      : error(requestID, 500, "Input parameter was not found");
  }

  if (request.messageType === "Live2DParameterListRequest") {
    return response("Live2DParameterListResponse", requestID, {
      modelLoaded: Boolean(model),
      modelName: model?.modelName ?? "",
      modelID: model?.modelID ?? "",
      parameters: model ? host.live2DParameters().map(({ addedBy: _addedBy, ...parameter }) => parameter) : []
    });
  }

  if (request.messageType === "InjectParameterDataRequest") {
    const mode = data.mode === undefined ? "set" : data.mode;
    if (mode !== "set" && mode !== "add") return error(requestID, 455, "Injection mode must be set or add");
    if (!Array.isArray(data.parameterValues) || data.parameterValues.length === 0) return error(requestID, 450, "No parameter data was provided");
    const parameters: VtsInjectedParameter[] = [];
    for (const item of data.parameterValues) {
      if (typeof item !== "object" || item === null) return error(requestID, 451, "Injected parameter value is invalid");
      const value = item as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.value !== "number" || !Number.isFinite(value.value) || Math.abs(value.value) > 1_000_000) {
        return error(requestID, 451, "Injected parameter ID or value is invalid");
      }
      if (value.weight !== undefined && (typeof value.weight !== "number" || !Number.isFinite(value.weight) || value.weight < 0 || value.weight > 1)) {
        return error(requestID, 452, "Injected parameter weight is invalid");
      }
      parameters.push({ id: value.id, value: value.value, weight: value.weight as number | undefined });
    }
    const missing = await host.injectParameterData(parameters, mode, typeof data.faceFound === "boolean" ? data.faceFound : undefined);
    return missing.length === 0
      ? response("InjectParameterDataResponse", requestID, {})
      : error(requestID, 453, `Input parameter not found: ${missing.join(", ")}`);
  }

  return error(requestID, 7, `Unsupported request type: ${request.messageType}`);
}
