/**
 * Windows virtual webcam via Unity Capture shared memory (RGBA + alpha).
 * Device name: "Unity Video Capture" after free driver install.
 * https://github.com/schellingb/UnityCapture — NOT OBS.
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export const VIRTUAL_CAMERA_DEFAULT = {
  width: 1280,
  height: 720,
  fps: 30
} as const;

const MAX_SHARED_IMAGE_SIZE = 3840 * 2160 * 4 * 2;

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

type KoffiModule = {
  load(name: string): {
    func(sig: string): (...args: never[]) => unknown;
  };
  view(ptr: unknown, length: number): ArrayBuffer;
};

function loadKoffi(): KoffiModule | null {
  if (process.platform !== "win32") return null;
  try {
    const require = createRequire(import.meta.url);
    return require("koffi") as KoffiModule;
  } catch {
    return null;
  }
}

/** Detect Unity Capture DirectShow filter registration. */
export function isUnityCaptureInstalled(): boolean {
  if (process.platform !== "win32") return false;
  // x64 CLSID slots from UnityCaptureFilter / pyvirtualcam
  const keys = [
    "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70010}",
    "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70011}",
    "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70000}",
    "HKCR\\CLSID\\{5C2CD55C-92AD-4999-8666-912BD3E70020}"
  ];
  for (const key of keys) {
    try {
      execFileSync("reg", ["query", key], { stdio: "ignore", windowsHide: true });
      return true;
    } catch {
      // continue
    }
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
    throw new Error("Unity Capture driver is not installed");
  }

  const width = options?.width ?? VIRTUAL_CAMERA_DEFAULT.width;
  const height = options?.height ?? VIRTUAL_CAMERA_DEFAULT.height;
  const capNum = options?.capNum ?? 0;

  // shared.inl: CapNum 0 uses NUL so names end without digit
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

  const SYNCHRONIZE = 0x00100000;
  const EVENT_MODIFY_STATE = 0x0002;
  const FILE_MAP_WRITE = 0x0002;
  const FILE_MAP_ALL_ACCESS = 0xf001f;
  const PAGE_READWRITE = 0x04;
  const INFINITE = 0xffffffff;
  // (HANDLE)-1 for CreateFileMapping pagefile-backed section
  const INVALID_HANDLE_VALUE = 0xffffffff;

  const headerBytes = 32;
  const mapBytes = headerBytes + MAX_SHARED_IMAGE_SIZE;

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
    throw new Error("Could not create Unity Capture shared memory. Reinstall Unity Capture (Install.bat as admin).");
  }

  const viewPtr = MapViewOfFile(hMap, FILE_MAP_WRITE, 0, 0, mapBytes);
  if (!viewPtr) {
    throw new Error("MapViewOfFile failed for virtual camera buffer");
  }

  const ab = koffi.view(viewPtr, mapBytes);
  const mem = Buffer.from(ab);
  mem.writeUInt32LE(MAX_SHARED_IMAGE_SIZE, 0);

  let closed = false;
  const flipScratch = Buffer.allocUnsafe(width * height * 4);

  return {
    backend: "unity-capture",
    deviceName: "Unity Video Capture",
    width,
    height,
    sendRgba(frame: Buffer, frameW: number, frameH: number) {
      if (closed) return;
      const w = frameW;
      const h = frameH;
      const dataSize = w * h * 4;
      if (frame.length < dataSize || dataSize > MAX_SHARED_IMAGE_SIZE) return;

      // Flip vertically (DirectShow often expects bottom-up relative to canvas top-down)
      const row = w * 4;
      for (let y = 0; y < h; y++) {
        frame.copy(flipScratch, y * row, (h - 1 - y) * row, (h - y) * row);
      }

      WaitForSingleObject(hMutex, INFINITE);
      try {
        mem.writeUInt32LE(MAX_SHARED_IMAGE_SIZE, 0);
        mem.writeInt32LE(w, 4);
        mem.writeInt32LE(h, 8);
        mem.writeInt32LE(w, 12); // stride in pixels
        mem.writeInt32LE(0, 16); // FORMAT_UINT8
        mem.writeInt32LE(1, 20); // RESIZEMODE_LINEAR
        mem.writeInt32LE(0, 24); // no mirror
        mem.writeInt32LE(2_147_483_647, 28); // keep last frame
        flipScratch.copy(mem, headerBytes, 0, dataSize);
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
