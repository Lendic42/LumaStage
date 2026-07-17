import { contextBridge, ipcRenderer } from "electron";
import type { TrackingFrame } from "@lumastage/protocol";
import type { CubismCoreStatus, DesktopStatus, ImportedModel, LumaStageBridge } from "../shared/bridge.js";

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
  importModel: () => ipcRenderer.invoke("import-model") as Promise<ImportedModel | null>,
  getCubismCoreStatus: () => ipcRenderer.invoke("cubism-core-status") as Promise<CubismCoreStatus>,
  installCubismCore: () => ipcRenderer.invoke("install-cubism-core") as Promise<CubismCoreStatus | null>,
  setOverlayMode: (enabled) => ipcRenderer.invoke("set-overlay-mode", enabled) as Promise<boolean>,
  forgetTrustedDevices: () => ipcRenderer.invoke("forget-trusted-devices") as Promise<boolean>
};

contextBridge.exposeInMainWorld("lumastage", bridge);
