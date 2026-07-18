import { BrowserWindow, dialog, shell } from "electron";
import {
  createUnityCaptureWriter,
  isUnityCaptureInstalled,
  VIRTUAL_CAMERA_DEFAULT,
  type VirtualCameraStatus,
  type VirtualCameraWriter
} from "./unityCapture.js";

const UNITY_CAPTURE_RELEASES = "https://github.com/schellingb/UnityCapture/releases";

let writer: VirtualCameraWriter | undefined;
let lastError: string | null = null;
let framesSent = 0;

export function getVirtualCameraStatus(): VirtualCameraStatus {
  const driverInstalled = process.platform === "win32" ? isUnityCaptureInstalled() : false;
  return {
    active: Boolean(writer),
    backend: writer?.backend ?? "none",
    deviceName: writer?.deviceName ?? null,
    width: writer?.width ?? VIRTUAL_CAMERA_DEFAULT.width,
    height: writer?.height ?? VIRTUAL_CAMERA_DEFAULT.height,
    fps: VIRTUAL_CAMERA_DEFAULT.fps,
    error: lastError,
    driverInstalled,
    framesSent
  };
}

export async function startVirtualCamera(parent?: BrowserWindow | null): Promise<VirtualCameraStatus> {
  stopVirtualCamera();
  lastError = null;
  framesSent = 0;

  if (process.platform !== "win32") {
    lastError = "Virtual camera is currently Windows-only (character + transparent background).";
    return getVirtualCameraStatus();
  }

  if (!isUnityCaptureInstalled()) {
    lastError = "driver-missing";
    const win = parent ?? BrowserWindow.getFocusedWindow() ?? undefined;
    const result = await dialog.showMessageBox({
      type: "info",
      title: "LumaStage Virtual Camera",
      message: "Install free virtual camera driver (once)",
      detail:
        "LumaStage will appear as a webcam with your character on a transparent background.\n\n" +
        "1. Download Unity Capture (free, not OBS)\n" +
        "2. Run Install.bat as Administrator\n" +
        "3. Restart LumaStage → Virtual Cam\n" +
        "4. In Discord/Zoom pick camera: “Unity Video Capture”",
      buttons: ["Open download page", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      ...(win ? { } : {})
    });
    // attach to parent when available
    void win;
    if (result.response === 0) {
      await shell.openExternal(UNITY_CAPTURE_RELEASES);
    }
    return getVirtualCameraStatus();
  }

  try {
    writer = createUnityCaptureWriter({
      width: VIRTUAL_CAMERA_DEFAULT.width,
      height: VIRTUAL_CAMERA_DEFAULT.height
    });
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    writer = undefined;
  }
  return getVirtualCameraStatus();
}

export function stopVirtualCamera(): VirtualCameraStatus {
  writer?.close();
  writer = undefined;
  return getVirtualCameraStatus();
}

/** RGBA frame of the character only (transparent pixels where there is no model). */
export function pushVirtualCameraFrame(payload: {
  width: number;
  height: number;
  rgba: Buffer | Uint8Array | ArrayBuffer;
}): boolean {
  if (!writer) return false;
  const buffer = Buffer.isBuffer(payload.rgba)
    ? payload.rgba
    : Buffer.from(payload.rgba instanceof ArrayBuffer ? new Uint8Array(payload.rgba) : payload.rgba);
  try {
    writer.sendRgba(buffer, payload.width, payload.height);
    framesSent += 1;
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}
