import { describe, expect, it } from "vitest";
import { createVtsEventMessage, handleVtsApiRequest, vtsSessionAcceptsEvent, type VtsApiHost, type VtsApiSession } from "../src/index.js";

function request(messageType: string, data?: unknown): string {
  return JSON.stringify({ apiName: "VTubeStudioPublicAPI", apiVersion: "1.0", requestID: "test", messageType, data });
}

function host(): VtsApiHost {
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
    modelPosition: () => ({ positionX: 0.1, positionY: -0.2, rotation: 12, size: 5 }),
    faceFound: () => true,
    triggerHotkey: async (id) => id.toLowerCase() === "smile" ? "smile" : undefined,
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
    moveItems: async (inputs) => inputs.map((input) => ({ itemInstanceID: input.itemInstanceID, success: true, errorID: -1 }))
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
});
