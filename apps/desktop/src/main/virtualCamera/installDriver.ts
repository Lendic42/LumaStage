import { app, dialog, shell } from "electron";
import { copyFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isUnityCaptureInstalled } from "./unityCapture.js";

const execFileAsync = promisify(execFile);

const FILTER_FILES = ["UnityCaptureFilter32.dll", "UnityCaptureFilter64.dll"] as const;

/** Bundled Install folder: prod = resources/unity-capture next to app.asar */
export function getBundledUnityCaptureDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "unity-capture");
  }
  // electron-vite dev/build: files live under apps/desktop/resources
  const fromMain = join(__dirname, "../../resources/unity-capture");
  if (existsSync(fromMain)) return fromMain;
  return join(app.getAppPath(), "resources", "unity-capture");
}

export function getManagedUnityCaptureDir(): string {
  return join(app.getPath("userData"), "unity-capture");
}

async function ensureManagedCopy(): Promise<string> {
  const bundled = getBundledUnityCaptureDir();
  const managed = getManagedUnityCaptureDir();
  await mkdir(managed, { recursive: true });

  for (const file of FILTER_FILES) {
    const from = join(bundled, file);
    const to = join(managed, file);
    if (!existsSync(from)) {
      throw new Error(`Bundled driver file missing: ${file}. Reinstall LumaStage.`);
    }
    await copyFile(from, to);
  }

  // Also copy install scripts for manual fallback
  for (const file of ["Install-LumaStage-Camera.bat", "Uninstall-LumaStage-Camera.bat", "Install.bat", "Uninstall.bat"]) {
    const from = join(bundled, file);
    if (existsSync(from)) {
      await copyFile(from, join(managed, file));
    }
  }

  return managed;
}

/**
 * Elevated regsvr32 of bundled filters as "LumaStage Camera".
 * One UAC prompt; DLLs live under %AppData%/LumaStage/unity-capture so the path stays stable.
 */
export async function installVirtualCameraDriver(): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== "win32") {
    return { ok: false, message: "Virtual camera driver install is Windows-only." };
  }

  let managed: string;
  try {
    managed = await ensureManagedCopy();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const dll32 = join(managed, "UnityCaptureFilter32.dll");
  const dll64 = join(managed, "UnityCaptureFilter64.dll");
  await access(dll32);
  await access(dll64);

  // PowerShell elevated one-shot: unregister old + register with LumaStage name
  // Paths with spaces are quoted carefully for -ArgumentList
  const ps = `
$ErrorActionPreference = 'Stop'
$dll32 = '${dll32.replace(/'/g, "''")}'
$dll64 = '${dll64.replace(/'/g, "''")}'
$arg = '/s'
# Unregister previous (ignore errors)
Start-Process -FilePath regsvr32 -ArgumentList @('/u','/s', $dll32) -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue
Start-Process -FilePath regsvr32 -ArgumentList @('/u','/s', $dll64) -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue
# Register with custom device name
$p32 = Start-Process -FilePath regsvr32 -ArgumentList @('/s', $dll32, '/i:UnityCaptureName=LumaStage Camera') -Wait -PassThru -WindowStyle Hidden
$p64 = Start-Process -FilePath regsvr32 -ArgumentList @('/s', $dll64, '/i:UnityCaptureName=LumaStage Camera') -Wait -PassThru -WindowStyle Hidden
if ($p64.ExitCode -ne 0 -and $p32.ExitCode -ne 0) { exit 1 }
exit 0
`.trim();

  const encoded = Buffer.from(ps, "utf16le").toString("base64");

  try {
    // Elevate entire PowerShell with RunAs — single UAC yes
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'`
      ],
      { windowsHide: true, timeout: 120_000 }
    );
  } catch (error) {
    // User may cancel UAC
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Driver install failed or was cancelled (UAC). ${msg}`
    };
  }

  // Give registry a moment
  await new Promise((r) => setTimeout(r, 400));

  if (isUnityCaptureInstalled()) {
    return {
      ok: true,
      message: "Virtual camera installed. Device name: “LumaStage Camera”. Turn on Virtual Cam, then pick it in Discord/Zoom."
    };
  }

  // Fallback: open the .bat so user sees console output
  const bat = join(managed, "Install-LumaStage-Camera.bat");
  if (existsSync(bat)) {
    await shell.openPath(bat);
    return {
      ok: false,
      message: "Opened Install-LumaStage-Camera.bat — approve UAC, then press Virtual Cam again."
    };
  }

  return {
    ok: false,
    message: "Install finished but the camera device was not detected. Reboot Windows and try again."
  };
}

export async function promptInstallVirtualCameraDriver(): Promise<{ ok: boolean; message: string }> {
  const result = await dialog.showMessageBox({
    type: "info",
    title: "Install LumaStage Camera",
    message: "Install virtual webcam driver once?",
    detail:
      "LumaStage will register a system camera “LumaStage Camera” (character + transparent background).\n\n" +
      "Windows will ask for Administrator permission once.\n" +
      "Driver files stay inside LumaStage app data (no Desktop folder).",
    buttons: ["Install now", "Cancel"],
    defaultId: 0,
    cancelId: 1
  });
  if (result.response !== 0) {
    return { ok: false, message: "Install cancelled." };
  }
  return installVirtualCameraDriver();
}
