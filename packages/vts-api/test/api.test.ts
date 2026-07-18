import { describe, expect, it } from "vitest";
import { createVtsEventMessage, handleVtsApiRequest, vtsSessionAcceptsEvent, type VtsApiHost, type VtsApiSession } from "../src/index.js";

function request(messageType: string, data?: unknown): string {
  return JSON.stringify({ apiName: "VTubeStudioPublicAPI", apiVersion: "1.0", requestID: "test", messageType, data });
}

function host(): VtsApiHost {
  let postProcessing = { active: true, activePreset: "", presets: ["Dreamy"], values: { ColorGrading_Strength: 0, Bloom_Strength: 0 } };
  return {
    version: "0.1.0",
    startedAt: Date.now() - 1000,
    allowedPluginCount: () => 1,
    connectedPluginCount: () => 1,
    requestToken: async () => "token-123",
    authenticate: async (_name, _developer, token) => token === "token-123",
    currentModel: () => ({
      modelName: "Haru", modelID: "haru", vtsModelName: "Haru.vtube.json", vtsModelIconName: "", live2DModelName: "Haru.model3.json",
      loadedAt: Date.now() - 500, numberOfLive2DParameters: 20, numberOfLive2DArtmeshes: 0, hasPhysicsFile: true,
      numberOfTextures: 2, textureResolution: 0,
      hotkeys: [{ name: "Smile", type: "ToggleExpression", file: "smile.exp3.json", hotkeyID: "smile" }]
    }),
    availableModels: async () => [{ modelName: "Haru", modelID: "haru", vtsModelName: "Haru.vtube.json", vtsModelIconName: "" }],
    loadModel: async (modelID) => modelID === "haru" ? "loaded" : modelID === "" ? "unloaded" : "not-found",
    modelPosition: () => ({ positionX: 0.1, positionY: -0.2, rotation: 12, size: 5 }),
    moveModel: async () => true,
    artMeshes: () => ({ names: ["HairFront", "Mouth"], tags: ["hair", "face"] }),
    tintArtMeshes: async () => ["Mouth"],
    physicsState: () => ({
      modelHasPhysics: true, physicsSwitchedOn: true, usingLegacyPhysics: false, physicsFPSSetting: -1,
      baseStrength: 50, baseWind: 0, overridePluginName: "",
      physicsGroups: [{ groupID: "PhysicsSetting1", groupName: "Hair", strengthMultiplier: 1, windMultiplier: 1 }]
    }),
    setPhysicsOverrides: async (_sessionID, _pluginName, strength) => strength.some((item) => !item.setBaseValue && item.id === "missing") ? "invalid-group" : "ok",
    faceFound: () => true,
    triggerHotkey: async (id) => id.toLowerCase() === "smile" ? "smile" : undefined,
    expressionStates: () => [{ name: "smile", file: "smile.exp3.json", active: false, usedInHotkeys: [{ name: "Smile", id: "smile" }], parameters: [{ name: "ParamMouthForm", value: 1 }] }],
    activateExpression: async (file) => file === "smile.exp3.json",
    inputParameters: () => ({
      defaultParameters: [{ name: "FaceAngleX", addedBy: "VTube Studio", value: 12, min: -30, max: 30, defaultValue: 0 }],
      customParameters: []
    }),
    live2DParameters: () => [{ name: "ParamAngleX", value: 12, min: -30, max: 30, defaultValue: 0 }],
    injectParameterData: async (parameters) => parameters.filter((parameter) => parameter.id === "Missing").map((parameter) => parameter.id),
    createCustomParameter: async (_name, _developer, parameter) => parameter.parameterName === "TakenParam" ? "owned-by-other" : "created",
    deleteCustomParameter: async (_name, _developer, parameterName) => parameterName === "MyParam" ? "deleted" : "not-found",
    listItems: () => ({
      items: [{ fileName: "hat.png", instanceID: "item-1", order: 1, type: "PNG", censored: false, flipped: false, locked: false, smoothing: 0, framerate: 0, frameCount: -1, currentFrame: -1, pinnedToModel: false, pinnedModelID: "", pinnedArtMeshID: "", groupName: "", sceneName: "Main", fromWorkshop: false }],
      availableItemFiles: [{ fileName: "hat.png", type: "PNG", loadedCount: 1 }], availableSpots: [-1, 2]
    }),
    loadItem: async (_name, _developer, _sessionID, input) => input.fileName === "hat.png" ? { item: { fileName: "hat.png", instanceID: "item-2", order: input.order, type: "PNG", censored: false, flipped: false, locked: false, smoothing: 0, framerate: 0, frameCount: -1, currentFrame: -1, pinnedToModel: false, pinnedModelID: "", pinnedArtMeshID: "", groupName: "", sceneName: "Main", fromWorkshop: false } } : { error: "not-found" },
    unloadItems: async () => [{ fileName: "hat.png", instanceID: "item-1", order: 1, type: "PNG", censored: false, flipped: false, locked: false, smoothing: 0, framerate: 0, frameCount: -1, currentFrame: -1, pinnedToModel: false, pinnedModelID: "", pinnedArtMeshID: "", groupName: "", sceneName: "Main", fromWorkshop: false }],
    moveItems: async (inputs) => inputs.map((input) => ({ itemInstanceID: input.itemInstanceID, success: true, errorID: -1 })),
    pinItem: async (input) => input.itemInstanceID === "missing" ? { error: "item-not-found" } : {
      item: { fileName: "hat.png", instanceID: input.itemInstanceID, order: 1, type: "PNG", censored: false, flipped: false, locked: false, smoothing: 0, framerate: 0, frameCount: -1, currentFrame: -1, pinnedToModel: input.pin, pinnedModelID: input.pin ? "haru" : "", pinnedArtMeshID: input.pin ? "HairFront" : "", groupName: "", sceneName: "Main", fromWorkshop: false }
    },
    postProcessingState: () => postProcessing,
    updatePostProcessing: async (input) => {
      if (input.preset !== undefined && input.preset !== "" && !postProcessing.presets.includes(input.preset)) return { error: "preset-not-found" };
      postProcessing = {
        ...postProcessing,
        active: input.active ?? postProcessing.active,
        activePreset: input.preset ?? (input.values ? "" : postProcessing.activePreset),
        values: { ...(input.resetOthers ? {} : postProcessing.values), ...input.values }
      };
      return postProcessing;
    }
  };
}

describe("VTube Studio API compatibility core", () => {
  it("reports API state before authentication", async () => {
    const session: VtsApiSession = { authenticated: false };
    const output = await handleVtsApiRequest(request("APIStateRequest"), session, host());
    expect(output.messageType).toBe("APIStateResponse");
    expect((output.data as Record<string, unknown>).currentSessionAuthenticated).toBe(false);
  });

  it("issues a token and authenticates a matching plugin session", async () => {
    const session: VtsApiSession = { authenticated: false };
    const token = await handleVtsApiRequest(request("AuthenticationTokenRequest", { pluginName: "Test Plugin", pluginDeveloper: "LumaStage Tests" }), session, host());
    expect(token.messageType).toBe("AuthenticationTokenResponse");
    const authenticated = await handleVtsApiRequest(request("AuthenticationRequest", { pluginName: "Test Plugin", pluginDeveloper: "LumaStage Tests", authenticationToken: "token-123" }), session, host());
    expect((authenticated.data as Record<string, unknown>).authenticated).toBe(true);
    expect(session.authenticated).toBe(true);
  });

  it("requires authentication for model data", async () => {
    const output = await handleVtsApiRequest(request("CurrentModelRequest"), { authenticated: false }, host());
    expect(output.messageType).toBe("APIError");
    expect((output.data as Record<string, unknown>).errorID).toBe(8);
  });

  it("returns current model hotkeys and triggers by case-insensitive name", async () => {
    const session: VtsApiSession = { authenticated: true };
    const list = await handleVtsApiRequest(request("HotkeysInCurrentModelRequest"), session, host());
    expect((list.data as { availableHotkeys: unknown[] }).availableHotkeys).toHaveLength(1);
    const trigger = await handleVtsApiRequest(request("HotkeyTriggerRequest", { hotkeyID: "SMILE" }), session, host());
    expect(trigger.messageType).toBe("HotkeyTriggerResponse");
  });

  it("lists, loads, and unloads available models", async () => {
    const session: VtsApiSession = { authenticated: true };
    const listed = await handleVtsApiRequest(request("AvailableModelsRequest"), session, host());
    expect((listed.data as { availableModels: Array<{ modelLoaded: boolean }> }).availableModels[0].modelLoaded).toBe(true);
    expect((await handleVtsApiRequest(request("ModelLoadRequest", { modelID: "haru" }), session, host())).messageType).toBe("ModelLoadResponse");
    expect((await handleVtsApiRequest(request("ModelLoadRequest", { modelID: "missing" }), session, host())).messageType).toBe("APIError");
    expect((await handleVtsApiRequest(request("ModelLoadRequest", { modelID: "" }), session, host())).messageType).toBe("ModelLoadResponse");
  });

  it("reports and activates expressions with optional details", async () => {
    const session: VtsApiSession = { authenticated: true };
    const listed = await handleVtsApiRequest(request("ExpressionStateRequest", { details: true }), session, host());
    expect((listed.data as { expressions: Array<{ parameters: unknown[] }> }).expressions[0].parameters).toHaveLength(1);
    const activated = await handleVtsApiRequest(request("ExpressionActivationRequest", { expressionFile: "smile.exp3.json", active: true, fadeTime: 5 }), session, host());
    expect(activated.messageType).toBe("ExpressionActivationResponse");
    const invalid = await handleVtsApiRequest(request("ExpressionActivationRequest", { expressionFile: "missing.exp3.json", active: true }), session, host());
    expect(invalid.messageType).toBe("APIError");
  });

  it("moves the model and rejects out-of-range transforms", async () => {
    const session: VtsApiSession = { authenticated: true };
    const moved = await handleVtsApiRequest(request("MoveModelRequest", { timeInSeconds: 0.2, valuesAreRelativeToModel: false, positionX: 0.1, size: -22.5 }), session, host());
    expect(moved.messageType).toBe("MoveModelResponse");
    const invalid = await handleVtsApiRequest(request("MoveModelRequest", { timeInSeconds: 3, valuesAreRelativeToModel: false }), session, host());
    expect(invalid.messageType).toBe("APIError");
  });

  it("lists and tints ArtMeshes with official matcher fields", async () => {
    const session: VtsApiSession = { authenticated: true, sessionID: "session" };
    const listed = await handleVtsApiRequest(request("ArtMeshListRequest"), session, host());
    expect((listed.data as { numberOfArtMeshNames: number }).numberOfArtMeshNames).toBe(2);
    const tinted = await handleVtsApiRequest(request("ColorTintRequest", {
      colorTint: { colorR: 255, colorG: 150, colorB: 0, colorA: 255 },
      artMeshMatcher: { tintAll: false, nameContains: ["mouth"] }
    }), session, host());
    expect((tinted.data as { matchedArtMeshes: number }).matchedArtMeshes).toBe(1);
  });

  it("reports physics and validates temporary overrides", async () => {
    const session: VtsApiSession = { authenticated: true, sessionID: "session", pluginName: "Test Plugin" };
    const state = await handleVtsApiRequest(request("GetCurrentModelPhysicsRequest"), session, host());
    expect((state.data as { physicsGroups: unknown[] }).physicsGroups).toHaveLength(1);
    const set = await handleVtsApiRequest(request("SetCurrentModelPhysicsRequest", {
      strengthOverrides: [{ id: "PhysicsSetting1", value: 1.5, setBaseValue: false, overrideSeconds: 2 }]
    }), session, host());
    expect(set.messageType).toBe("SetCurrentModelPhysicsResponse");
    const invalid = await handleVtsApiRequest(request("SetCurrentModelPhysicsRequest", { strengthOverrides: [] }), session, host());
    expect(invalid.messageType).toBe("APIError");
  });

  it("reports the tracker face state", async () => {
    const output = await handleVtsApiRequest(request("FaceFoundRequest"), { authenticated: true }, host());
    expect((output.data as Record<string, unknown>).found).toBe(true);
  });

  it("lists and reads tracking and Live2D parameters", async () => {
    const session: VtsApiSession = { authenticated: true };
    const inputs = await handleVtsApiRequest(request("InputParameterListRequest"), session, host());
    expect((inputs.data as { defaultParameters: unknown[] }).defaultParameters).toHaveLength(1);
    const value = await handleVtsApiRequest(request("ParameterValueRequest", { name: "FaceAngleX" }), session, host());
    expect((value.data as Record<string, unknown>).value).toBe(12);
    const live2D = await handleVtsApiRequest(request("Live2DParameterListRequest"), session, host());
    expect((live2D.data as { parameters: unknown[] }).parameters).toHaveLength(1);
  });

  it("validates and injects parameter data", async () => {
    const session: VtsApiSession = { authenticated: true };
    const injected = await handleVtsApiRequest(request("InjectParameterDataRequest", {
      mode: "set", parameterValues: [{ id: "FaceAngleX", value: 20, weight: 0.5 }]
    }), session, host());
    expect(injected.messageType).toBe("InjectParameterDataResponse");
    const missing = await handleVtsApiRequest(request("InjectParameterDataRequest", {
      parameterValues: [{ id: "Missing", value: 1 }]
    }), session, host());
    expect((missing.data as Record<string, unknown>).errorID).toBe(453);
  });

  it("subscribes, replaces config, and unsubscribes event sessions", async () => {
    const session: VtsApiSession = { authenticated: true };
    const subscribed = await handleVtsApiRequest(request("EventSubscriptionRequest", {
      eventName: "HotkeyTriggeredEvent", subscribe: true, config: { onlyForAction: "ToggleExpression", ignoreHotkeysTriggeredByAPI: true }
    }), session, host());
    expect(subscribed.messageType).toBe("EventSubscriptionResponse");
    expect((subscribed.data as { subscribedEvents: string[] }).subscribedEvents).toEqual(["HotkeyTriggeredEvent"]);
    expect(vtsSessionAcceptsEvent(session, "HotkeyTriggeredEvent", { hotkeyAction: "ToggleExpression", hotkeyTriggeredByAPI: false })).toBe(true);
    expect(vtsSessionAcceptsEvent(session, "HotkeyTriggeredEvent", { hotkeyAction: "ToggleExpression", hotkeyTriggeredByAPI: true })).toBe(false);
    await handleVtsApiRequest(request("EventSubscriptionRequest", { eventName: "HotkeyTriggeredEvent", subscribe: false }), session, host());
    expect(session.subscriptions?.size).toBe(0);
    await handleVtsApiRequest(request("EventSubscriptionRequest", { eventName: "TestEvent", subscribe: true }), session, host());
    await handleVtsApiRequest(request("AuthenticationRequest", { pluginName: "Test Plugin", pluginDeveloper: "LumaStage Tests", authenticationToken: "wrong" }), session, host());
    expect(session.subscriptions?.size).toBe(0);
  });

  it("validates event configs and emits the official event envelope", async () => {
    const session: VtsApiSession = { authenticated: true };
    const invalid = await handleVtsApiRequest(request("EventSubscriptionRequest", {
      eventName: "TestEvent", subscribe: true, config: { testMessageForEvent: "x".repeat(33) }
    }), session, host());
    expect(invalid.messageType).toBe("APIError");
    const event = createVtsEventMessage("TrackingStatusChangedEvent", { faceFound: true, leftHandFound: false, rightHandFound: false });
    expect(event.messageType).toBe("TrackingStatusChangedEvent");
    expect(event.apiName).toBe("VTubeStudioPublicAPI");
  });

  it("applies model and item event filters", async () => {
    const session: VtsApiSession = { authenticated: true };
    await handleVtsApiRequest(request("EventSubscriptionRequest", {
      eventName: "ModelLoadedEvent", subscribe: true, config: { modelID: ["haru"] }
    }), session, host());
    await handleVtsApiRequest(request("EventSubscriptionRequest", {
      eventName: "ItemEvent", subscribe: true, config: { itemInstanceIDs: ["one"], itemFileNames: ["hat"] }
    }), session, host());
    expect(vtsSessionAcceptsEvent(session, "ModelLoadedEvent", { modelID: "haru" })).toBe(true);
    expect(vtsSessionAcceptsEvent(session, "ModelLoadedEvent", { modelID: "other" })).toBe(false);
    expect(vtsSessionAcceptsEvent(session, "ItemEvent", { itemInstanceID: "two", itemFileName: "red-hat.png" })).toBe(true);
    expect(vtsSessionAcceptsEvent(session, "ItemEvent", { itemInstanceID: "two", itemFileName: "glasses.png" })).toBe(false);
  });

  it("creates and deletes plugin-owned custom parameters", async () => {
    const session: VtsApiSession = { authenticated: true, pluginName: "Test Plugin", pluginDeveloper: "LumaStage Tests" };
    const created = await handleVtsApiRequest(request("ParameterCreationRequest", {
      parameterName: "MyParam", explanation: "A test input", min: -1, max: 1, defaultValue: 0
    }), session, host());
    expect(created.messageType).toBe("ParameterCreationResponse");
    const invalid = await handleVtsApiRequest(request("ParameterCreationRequest", {
      parameterName: "bad name", min: -1, max: 1, defaultValue: 0
    }), session, host());
    expect(invalid.messageType).toBe("APIError");
    const deleted = await handleVtsApiRequest(request("ParameterDeletionRequest", { parameterName: "MyParam" }), session, host());
    expect(deleted.messageType).toBe("ParameterDeletionResponse");
  });

  it("lists, loads, moves, and unloads visual scene items", async () => {
    const session: VtsApiSession = { authenticated: true, pluginName: "Test Plugin", pluginDeveloper: "LumaStage Tests" };
    const listed = await handleVtsApiRequest(request("ItemListRequest", { includeAvailableSpots: true, includeItemInstancesInScene: true, includeAvailableItemFiles: true }), session, host());
    expect((listed.data as { itemInstancesInScene: unknown[] }).itemInstancesInScene).toHaveLength(1);
    const loaded = await handleVtsApiRequest(request("ItemLoadRequest", { fileName: "hat.png", positionX: 0.2, positionY: 0.1, size: 0.32, rotation: 10, order: 2 }), session, host());
    expect(loaded.messageType).toBe("ItemLoadResponse");
    const moved = await handleVtsApiRequest(request("ItemMoveRequest", { itemsToMove: [{ itemInstanceID: "item-2", positionX: -0.3, setFlip: true, flip: true }] }), session, host());
    expect((moved.data as { movedItems: Array<{ success: boolean }> }).movedItems[0].success).toBe(true);
    const unloaded = await handleVtsApiRequest(request("ItemUnloadRequest", { instanceIDs: ["item-1"], fileNames: [], allowUnloadingItemsLoadedByUserOrOtherPlugins: true }), session, host());
    expect((unloaded.data as { unloadedItems: unknown[] }).unloadedItems).toHaveLength(1);
  });

  it("pins and unpins items using official ArtMesh pin modes", async () => {
    const session: VtsApiSession = { authenticated: true };
    const pinned = await handleVtsApiRequest(request("ItemPinRequest", {
      pin: true, itemInstanceID: "item-1", angleRelativeTo: "RelativeToModel", sizeRelativeTo: "RelativeToWorld", vertexPinType: "Provided",
      pinInfo: { modelID: "haru", artMeshID: "HairFront", angle: 15, size: 0.3, vertexID1: 0, vertexID2: 1, vertexID3: 2, vertexWeight1: 0.2, vertexWeight2: 0.3, vertexWeight3: 0.5 }
    }), session, host());
    expect(pinned.messageType).toBe("ItemPinResponse");
    expect((pinned.data as { isPinned: boolean }).isPinned).toBe(true);
    const unpinned = await handleVtsApiRequest(request("ItemPinRequest", { pin: false, itemInstanceID: "item-1" }), session, host());
    expect((unpinned.data as { isPinned: boolean }).isPinned).toBe(false);
    const invalidWeights = await handleVtsApiRequest(request("ItemPinRequest", {
      pin: true, itemInstanceID: "item-1", angleRelativeTo: "RelativeToWorld", sizeRelativeTo: "RelativeToWorld", vertexPinType: "Provided",
      pinInfo: { size: 0.3, vertexID1: 0, vertexID2: 1, vertexID3: 2, vertexWeight1: 0.2, vertexWeight2: 0.2, vertexWeight3: 0.2 }
    }), session, host());
    expect((invalidWeights.data as { errorID: number }).errorID).toBe(1054);
    const missing = await handleVtsApiRequest(request("ItemPinRequest", { pin: false, itemInstanceID: "missing" }), session, host());
    expect((missing.data as { errorID: number }).errorID).toBe(1050);
  });

  it("lists supported post-processing effects with normalized filters", async () => {
    const output = await handleVtsApiRequest(request("PostProcessingListRequest", {
      fillPostProcessingPresetsArray: true, fillPostProcessingEffectsArray: true, effectIDFilter: ["color_grading", "BLOOM"]
    }), { authenticated: true }, host());
    expect(output.messageType).toBe("PostProcessingListResponse");
    expect((output.data as { effectCountAfterFilter: number }).effectCountAfterFilter).toBe(2);
    expect((output.data as { postProcessingEffects: Array<{ enumID: string }> }).postProcessingEffects.map((effect) => effect.enumID)).toEqual(["ColorGrading", "Bloom"]);
    expect((output.data as { postProcessingPresets: string[] }).postProcessingPresets).toEqual(["Dreamy"]);
  });

  it("updates, clamps, and validates post-processing config values", async () => {
    const apiHost = host();
    const updated = await handleVtsApiRequest(request("PostProcessingUpdateRequest", {
      postProcessingOn: true, setPostProcessingValues: true, postProcessingFadeTime: 0.5,
      postProcessingValues: [{ configID: "color-grading_brightness", configValue: "150" }, { configID: "Bloom_Strength", configValue: "0.8" }]
    }), { authenticated: true }, apiHost);
    expect(updated.messageType).toBe("PostProcessingUpdateResponse");
    expect(apiHost.postProcessingState().values.ColorGrading_Brightness).toBe(100);
    expect((updated.data as { activeEffectCount: number }).activeEffectCount).toBe(1);
    const duplicate = await handleVtsApiRequest(request("PostProcessingUpdateRequest", {
      setPostProcessingValues: true, postProcessingValues: [{ configID: "Bloom_Strength", configValue: "1" }, { configID: "bloom-strength", configValue: "0" }]
    }), { authenticated: true }, apiHost);
    expect((duplicate.data as { errorID: number }).errorID).toBe(1205);
    const missingPreset = await handleVtsApiRequest(request("PostProcessingUpdateRequest", {
      setPostProcessingPreset: true, presetToSet: "Missing"
    }), { authenticated: true }, apiHost);
    expect((missingPreset.data as { errorID: number }).errorID).toBe(1203);
  });
});
