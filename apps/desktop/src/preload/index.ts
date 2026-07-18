import { contextBridge, ipcRenderer } from "electron";
import type { TrackingFrame } from "@lumastage/protocol";
import type { CubismCoreStatus, DesktopStatus, ImportedHotkey, ImportedModel, LumaStageBridge, PluginAuthorizationRequest, SceneItemUpdate, SceneUpdate, SceneWorkspace, VtsExpressionActivation, VtsParameterInjection, VTubeParameterMapping } from "../shared/bridge.js";

const bridge: LumaStageBridge = {
  onTrackingFrame(listener) {
    const handler = (_event: Electron.IpcRendererEvent, frame: TrackingFrame) => listener(frame);
    ipcRenderer.on("tracking-frame", handler);
    return () => ipcRenderer.removeListener("tracking-frame", handler);
  },
  onDesktopStatus(listener) {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopStatus) => listener(status);
    ipcRenderer.on("desktop-status", handler);
    return () => ipcRenderer.removeListener("desktop-status", handler);
  },
  onPluginAuthorizationRequest(listener) {
    const handler = (_event: Electron.IpcRendererEvent, request: PluginAuthorizationRequest) => listener(request);
    ipcRenderer.on("plugin-authorization-request", handler);
    return () => ipcRenderer.removeListener("plugin-authorization-request", handler);
  },
  onVtsHotkeyTrigger(listener) {
    const handler = (_event: Electron.IpcRendererEvent, hotkey: ImportedHotkey) => listener(hotkey);
    ipcRenderer.on("vts-hotkey-trigger", handler);
    return () => ipcRenderer.removeListener("vts-hotkey-trigger", handler);
  },
  onVtsParameterInjection(listener) {
    const handler = (_event: Electron.IpcRendererEvent, injection: VtsParameterInjection) => listener(injection);
    ipcRenderer.on("vts-parameter-injection", handler);
    return () => ipcRenderer.removeListener("vts-parameter-injection", handler);
  },
  onVtsExpressionActivation(listener) {
    const handler = (_event: Electron.IpcRendererEvent, activation: VtsExpressionActivation) => listener(activation);
    ipcRenderer.on("vts-expression-activation", handler);
    return () => ipcRenderer.removeListener("vts-expression-activation", handler);
  },
  onSceneWorkspaceChanged(listener) {
    const handler = (_event: Electron.IpcRendererEvent, workspace: SceneWorkspace) => listener(workspace);
    ipcRenderer.on("scene-workspace-changed", handler);
    return () => ipcRenderer.removeListener("scene-workspace-changed", handler);
  },
  importModel: () => ipcRenderer.invoke("import-model") as Promise<ImportedModel | null>,
  updateModelMappings: (mappings: VTubeParameterMapping[]) => ipcRenderer.invoke("update-model-mappings", mappings) as Promise<ImportedModel>,
  resetModelMappings: () => ipcRenderer.invoke("reset-model-mappings") as Promise<ImportedModel>,
  getSceneWorkspace: () => ipcRenderer.invoke("get-scene-workspace") as Promise<SceneWorkspace>,
  createScene: (name) => ipcRenderer.invoke("create-scene", name) as Promise<SceneWorkspace>,
  activateScene: (id) => ipcRenderer.invoke("activate-scene", id) as Promise<SceneWorkspace>,
  updateScene: (id, update: SceneUpdate) => ipcRenderer.invoke("update-scene", id, update) as Promise<SceneWorkspace>,
  chooseSceneBackground: (id) => ipcRenderer.invoke("choose-scene-background", id) as Promise<SceneWorkspace | null>,
  deleteScene: (id) => ipcRenderer.invoke("delete-scene", id) as Promise<SceneWorkspace>,
  chooseSceneItem: (sceneId) => ipcRenderer.invoke("choose-scene-item", sceneId) as Promise<SceneWorkspace | null>,
  updateSceneItem: (sceneId, itemId, update: SceneItemUpdate) => ipcRenderer.invoke("update-scene-item", sceneId, itemId, update) as Promise<SceneWorkspace>,
  deleteSceneItem: (sceneId, itemId) => ipcRenderer.invoke("delete-scene-item", sceneId, itemId) as Promise<SceneWorkspace>,
  getCubismCoreStatus: () => ipcRenderer.invoke("cubism-core-status") as Promise<CubismCoreStatus>,
  installCubismCore: () => ipcRenderer.invoke("install-cubism-core") as Promise<CubismCoreStatus | null>,
  setOverlayMode: (enabled) => ipcRenderer.invoke("set-overlay-mode", enabled) as Promise<boolean>,
  forgetTrustedDevices: () => ipcRenderer.invoke("forget-trusted-devices") as Promise<boolean>,
  resolvePluginAuthorization: (id, approved) => ipcRenderer.invoke("resolve-plugin-authorization", id, approved) as Promise<boolean>,
  forgetPluginAccess: () => ipcRenderer.invoke("forget-plugin-access") as Promise<boolean>,
  notifyLocalHotkey: (hotkeyID) => ipcRenderer.invoke("notify-local-hotkey", hotkeyID) as Promise<boolean>
};

contextBridge.exposeInMainWorld("lumastage", bridge);
