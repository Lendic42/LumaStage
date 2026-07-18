/**
 * Windows virtual webcam via Unity Capture shared memory (RGBA + alpha).
 * Device: "LumaStage Camera" after bundled driver install (not OBS).
 * https://github.com/schellingb/UnityCapture (MIT)
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export const VIRTUAL_CAMERA_DEFAULT = {
  width: 1280,
  height: 720,
  fps: 30
} as const;

export const VIRTUAL_CAMERA_DEVICE_NAME = "LumaStage Camera";

const MAX_SHARED_IMAGE_SIZE = 3840 * 2160 * 4 * 2;
const HEADER_BYTES = 32;

export type VirtualCameraStatus = {
  active: boolean;
  backend: "unity-capture" | "none";
  deviceName: string | null;
  width: number;
  height: number;
  fps: number;
  error: string | null;
  driverInstalled: boolean;
  framesSent: number;
};

export interface VirtualCameraWriter {
  readonly backend: "unity-capture";
  readonly deviceName: string;
  readonly width: number;
  readonly height: number;
  sendRgba(frame: Buffer, width: number, height: number): void;
  close(): void;
}

type WinFn = (...args: unknown[]) => unknown;

function loadKoffi(): {
  load: (name: string) => { func: (sig: string) => WinFn };
} | null {
  if (process.platform !== "win32") return null;
  try {
    const require = createRequire(import.meta.url);
    return require("koffi") as { load: (name: string) => { func: (sig: string) => WinFn } };
  } catch {
    return null;
  }
}

function queryRegDefault(key: string): string | null {
  try {
    const out = execFileSync("reg", ["query", key, "/ve"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const match = out.match(/REG_SZ\s+(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const UNITY_CAPTURE_CLSID_KEYS = [
  "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70010}",
  "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70011}",
  "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70000}",
  "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70020}"
];

export function isUnityCaptureInstalled(): boolean {
  if (process.platform !== "win32") return false;
  for (const key of UNITY_CAPTURE_CLSID_KEYS) {
    const dll = queryRegDefault(`${key}\\InprocServer32`);
    if (!dll) continue;
    if (!existsSync(dll)) continue;
    return true;
  }
  return false;
}

export function createUnityCaptureWriter(options?: {
  width?: number;
  height?: number;
  capNum?: number;
}): VirtualCameraWriter {
  if (process.platform !== "win32") {
    throw new Error("Virtual camera is only available on Windows right now");
  }
  const koffi = loadKoffi();
  if (!koffi) {
    throw new Error("Native module koffi failed to load");
  }
  if (!isUnityCaptureInstalled()) {
    throw new Error("driver-missing");
  }

  const width = options?.width ?? VIRTUAL_CAMERA_DEFAULT.width;
  const height = options?.height ?? VIRTUAL_CAMERA_DEFAULT.height;
  const capNum = options?.capNum ?? 0;
  const suffix = capNum === 0 ? "" : String(capNum);
  const nameMutex = `UnityCapture_Mutx${suffix}`;
  const nameWant = `UnityCapture_Want${suffix}`;
  const nameSent = `UnityCapture_Sent${suffix}`;
  const nameData = `UnityCapture_Data${suffix}`;

  const kernel32 = koffi.load("kernel32.dll");
  const OpenMutexA = kernel32.func("uintptr OpenMutexA(uint32 flags, int inherit, str name)");
  const CreateMutexA = kernel32.func("uintptr CreateMutexA(void *sa, int owner, str name)");
  const CreateEventA = kernel32.func("uintptr CreateEventA(void *sa, int manual, int initial, str name)");
  const OpenEventA = kernel32.func("uintptr OpenEventA(uint32 access, int inherit, str name)");
  const CreateFileMappingA = kernel32.func(
    "uintptr CreateFileMappingA(uintptr file, void *sa, uint32 protect, uint32 maxHi, uint32 maxLo, str name)"
  );
  const OpenFileMappingA = kernel32.func("uintptr OpenFileMappingA(uint32 access, int inherit, str name)");
  const MapViewOfFile = kernel32.func("void *MapViewOfFile(uintptr mapping, uint32 access, uint32 hi, uint32 lo, size_t nbytes)");
  const UnmapViewOfFile = kernel32.func("int UnmapViewOfFile(void *base)");
  const CloseHandle = kernel32.func("int CloseHandle(uintptr h)");
  const WaitForSingleObject = kernel32.func("uint32 WaitForSingleObject(uintptr h, uint32 ms)");
  const ReleaseMutex = kernel32.func("int ReleaseMutex(uintptr h)");
  const SetEvent = kernel32.func("int SetEvent(uintptr h)");
  const GetLastError = kernel32.func("uint32 GetLastError()");
  // Write Node Buffer into native mapped view (koffi.view is not available in all builds)
  const RtlMoveMemory = kernel32.func("void RtlMoveMemory(void *dest, void *src, size_t length)");

  const SYNCHRONIZE = 0x00100000;
  const EVENT_MODIFY_STATE = 0x0002;
  const FILE_MAP_WRITE = 0x0002;
  const FILE_MAP_ALL_ACCESS = 0xf001f;
  const PAGE_READWRITE = 0x04;
  const INFINITE = 0xffffffff;
  // x64: must be -1 (all bits set). 0xFFFFFFFF fails with ERROR_INVALID_HANDLE (6).
  const INVALID_HANDLE_VALUE = -1;

  const mapBytes = HEADER_BYTES + MAX_SHARED_IMAGE_SIZE;

  let hMutex = Number(OpenMutexA(SYNCHRONIZE, 0, nameMutex) || 0);
  if (!hMutex) hMutex = Number(CreateMutexA(null, 0, nameMutex) || 0);

  let hWant = Number(CreateEventA(null, 0, 0, nameWant) || 0);
  let hSent = Number(OpenEventA(EVENT_MODIFY_STATE, 0, nameSent) || 0);
  if (!hSent) hSent = Number(CreateEventA(null, 0, 0, nameSent) || 0);

  let hMap = Number(OpenFileMappingA(FILE_MAP_ALL_ACCESS, 0, nameData) || 0);
  if (!hMap) {
    hMap = Number(CreateFileMappingA(INVALID_HANDLE_VALUE, null, PAGE_READWRITE, 0, mapBytes, nameData) || 0);
  }

  if (!hMutex || !hWant || !hSent || !hMap) {
    const err = Number(GetLastError() || 0);
    throw new Error(
      `Could not open virtual camera shared memory (Win32 error ${err}). ` +
        `Settings → Install virtual camera driver (one UAC prompt).`
    );
  }

  const viewPtr = MapViewOfFile(hMap, FILE_MAP_WRITE, 0, 0, mapBytes);
  if (!viewPtr) {
    const err = Number(GetLastError() || 0);
    throw new Error(`MapViewOfFile failed (Win32 error ${err})`);
  }

  let closed = false;
  // Staging buffer: header + pixel payload, then one RtlMoveMemory into the view
  const staging = Buffer.allocUnsafe(HEADER_BYTES + width * height * 4);
  staging.writeUInt32LE(MAX_SHARED_IMAGE_SIZE, 0);

  let deviceName = VIRTUAL_CAMERA_DEVICE_NAME;
  for (const key of UNITY_CAPTURE_CLSID_KEYS) {
    const name = queryRegDefault(key);
    if (name && /lumastage/i.test(name)) {
      deviceName = name;
      break;
    }
    if (name && /unity video capture/i.test(name)) deviceName = name;
  }

  return {
    backend: "unity-capture",
    deviceName,
    width,
    height,
    sendRgba(frame: Buffer, frameW: number, frameH: number) {
      if (closed) return;
      const w = frameW;
      const h = frameH;
      const dataSize = w * h * 4;
      if (frame.length < dataSize || dataSize > MAX_SHARED_IMAGE_SIZE) return;

      // Header (SharedMemHeader)
      staging.writeUInt32LE(MAX_SHARED_IMAGE_SIZE, 0);
      staging.writeInt32LE(w, 4);
      staging.writeInt32LE(h, 8);
      staging.writeInt32LE(w, 12); // stride in pixels
      staging.writeInt32LE(0, 16); // FORMAT_UINT8
      staging.writeInt32LE(1, 20); // RESIZEMODE_LINEAR
      staging.writeInt32LE(0, 24); // no mirror
      staging.writeInt32LE(2_147_483_647, 28); // keep last frame while idle

      // Vertical flip into staging after header
      const row = w * 4;
      for (let y = 0; y < h; y++) {
        frame.copy(staging, HEADER_BYTES + y * row, (h - 1 - y) * row, (h - y) * row);
      }

      const total = HEADER_BYTES + dataSize;
      WaitForSingleObject(hMutex, INFINITE);
      try {
        // koffi accepts Node Buffer as void* source
        RtlMoveMemory(viewPtr, staging, total);
      } finally {
        ReleaseMutex(hMutex);
      }
      SetEvent(hSent);
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        UnmapViewOfFile(viewPtr);
      } catch {
        /* ignore */
      }
      CloseHandle(hMutex);
      CloseHandle(hWant);
      CloseHandle(hSent);
      CloseHandle(hMap);
    }
  };
}
