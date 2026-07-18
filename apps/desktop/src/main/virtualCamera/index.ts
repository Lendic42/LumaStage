import { BrowserWindow } from "electron";
import {
  createUnityCaptureWriter,
  isUnityCaptureInstalled,
  VIRTUAL_CAMERA_DEFAULT,
  VIRTUAL_CAMERA_DEVICE_NAME,
  type VirtualCameraStatus,
  type VirtualCameraWriter
} from "./unityCapture.js";
import { installVirtualCameraDriver, promptInstallVirtualCameraDriver } from "./installDriver.js";

let writer: VirtualCameraWriter | undefined;
let lastError: string | null = null;
let framesSent = 0;

export function getVirtualCameraStatus(): VirtualCameraStatus {
  const driverInstalled = process.platform === "win32" ? isUnityCaptureInstalled() : false;
  return {
    active: Boolean(writer),
    backend: writer?.backend ?? "none",
    deviceName: writer?.deviceName ?? (driverInstalled ? VIRTUAL_CAMERA_DEVICE_NAME : null),
    width: writer?.width ?? VIRTUAL_CAMERA_DEFAULT.width,
    height: writer?.height ?? VIRTUAL_CAMERA_DEFAULT.height,
    fps: VIRTUAL_CAMERA_DEFAULT.fps,
    error: lastError,
    driverInstalled,
    framesSent
  };
}

export async function startVirtualCamera(_parent?: BrowserWindow | null): Promise<VirtualCameraStatus> {
  stopVirtualCamera();
  lastError = null;
  framesSent = 0;

  if (process.platform !== "win32") {
    lastError = "Virtual camera is currently Windows-only (character + transparent background).";
    return getVirtualCameraStatus();
  }

  if (!isUnityCaptureInstalled()) {
    const install = await promptInstallVirtualCameraDriver();
    if (!install.ok) {
      lastError = install.message;
      return getVirtualCameraStatus();
    }
  }

  try {
    writer = createUnityCaptureWriter({
      width: VIRTUAL_CAMERA_DEFAULT.width,
      height: VIRTUAL_CAMERA_DEFAULT.height
    });
    lastError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Auto-repair: broken registry path → reinstall bundled driver once
    if (message === "driver-missing" || /shared memory|MapViewOfFile|driver/i.test(message)) {
      const repair = await installVirtualCameraDriver();
      if (repair.ok) {
        try {
          writer = createUnityCaptureWriter({
            width: VIRTUAL_CAMERA_DEFAULT.width,
            height: VIRTUAL_CAMERA_DEFAULT.height
          });
          lastError = null;
          return getVirtualCameraStatus();
        } catch (retryError) {
          lastError = retryError instanceof Error ? retryError.message : String(retryError);
          writer = undefined;
          return getVirtualCameraStatus();
        }
      }
      lastError = `${message} · ${repair.message}`;
    } else {
      lastError = message;
    }
    writer = undefined;
  }
  return getVirtualCameraStatus();
}

export function stopVirtualCamera(): VirtualCameraStatus {
  writer?.close();
  writer = undefined;
  return getVirtualCameraStatus();
}

export async function installDriverFromUi(): Promise<VirtualCameraStatus & { installMessage: string }> {
  const result = await promptInstallVirtualCameraDriver();
  const status = getVirtualCameraStatus();
  return { ...status, installMessage: result.message, error: result.ok ? null : result.message };
}

/** RGBA frame of the character only (transparent where there is no model). */
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
