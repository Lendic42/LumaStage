import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep, join } from "node:path";
import { pathToFileURL } from "node:url";
import Bonjour from "bonjour-service";
import { WebSocketServer, type WebSocket } from "ws";
import { parseLumaLinkMessage, type HelloMessage, type TrackingFrame } from "@lumastage/protocol";
import { inspectCubismModelFolder } from "@lumastage/model-compat";
import type { CubismCoreStatus, DesktopStatus, ImportedModel } from "../shared/bridge.js";

protocol.registerSchemesAsPrivileged([
  { scheme: "lumastage-model", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "lumastage-core", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

const TRACKING_PORT = 39510;
const pairingCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
interface ClientSession {
  hello: HelloMessage;
  lastSequence: number;
}
const clients = new Map<WebSocket, ClientSession>();
let service: ReturnType<Bonjour["publish"]> | undefined;
let server: WebSocketServer | undefined;
let bonjour: Bonjour | undefined;
let activeModelRoot: string | undefined;
const trustedDevices = new Map<string, string>();

function trustedDevicesPath(): string {
  return join(app.getPath("userData"), "trusted-devices.json");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadTrustedDevices(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(trustedDevicesPath(), "utf8")) as Record<string, unknown>;
    for (const [deviceId, tokenHash] of Object.entries(parsed)) {
      if (typeof tokenHash === "string" && /^[a-f0-9]{64}$/i.test(tokenHash)) trustedDevices.set(deviceId, tokenHash);
    }
  } catch {
    // First launch or an invalid local trust file: start with an empty registry.
  }
}

async function trustDevice(deviceId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  trustedDevices.set(deviceId, hashToken(token));
  await saveTrustedDevices();
  return token;
}

async function saveTrustedDevices(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(trustedDevicesPath(), `${JSON.stringify(Object.fromEntries(trustedDevices), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function authorizeHello(hello: HelloMessage): Promise<{ deviceToken?: string } | undefined> {
  const storedHash = trustedDevices.get(hello.deviceId);
  if (hello.token && storedHash && hashesMatch(hashToken(hello.token), storedHash)) return {};
  if (hello.token === pairingCode) return { deviceToken: await trustDevice(hello.deviceId) };
  return undefined;
}

function cubismCorePath(): string {
  return join(app.getPath("userData"), "runtime", "live2dcubismcore.min.js");
}

async function coreStatus(): Promise<CubismCoreStatus> {
  try {
    const source = await readFile(cubismCorePath(), "utf8");
    const version = source.match(/Cubism\s*(?:Core)?\s*v?([0-9]+(?:\.[0-9]+){1,3})/i)?.[1];
    return { available: source.includes("Live2DCubismCore"), version };
  } catch {
    return { available: false };
  }
}

async function safeModelAssetPath(pathname: string): Promise<string | undefined> {
  if (!activeModelRoot) return undefined;
  const decoded = decodeURIComponent(pathname.replace(/^\/+/, ""));
  if (!decoded || isAbsolute(decoded)) return undefined;
  const candidate = resolve(activeModelRoot, decoded);
  const fromRoot = relative(activeModelRoot, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined;
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(activeModelRoot), realpath(candidate)]);
    const realFromRoot = relative(realRoot, realCandidate);
    if (realFromRoot === ".." || realFromRoot.startsWith(`..${sep}`) || isAbsolute(realFromRoot)) return undefined;
    return realCandidate;
  } catch {
    return undefined;
  }
}

function installAssetProtocols(): void {
  void session.defaultSession.protocol.handle("lumastage-model", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "active") return new Response("Unknown model", { status: 404 });
      const asset = await safeModelAssetPath(url.pathname);
      if (!asset) return new Response("Invalid model asset path", { status: 403 });
      return await net.fetch(pathToFileURL(asset).toString());
    } catch {
      return new Response("Model asset not found", { status: 404 });
    }
  });

  void session.defaultSession.protocol.handle("lumastage-core", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "runtime" || url.pathname !== "/live2dcubismcore.min.js") {
      return new Response("Unknown runtime asset", { status: 404 });
    }
    try {
      return await net.fetch(pathToFileURL(cubismCorePath()).toString());
    } catch {
      return new Response("Cubism Core is not installed", { status: 404 });
    }
  });
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function publishStatus(): void {
  const status: DesktopStatus = { port: TRACKING_PORT, connectedDevices: clients.size, pairingCode, trustedDevices: trustedDevices.size };
  broadcast("desktop-status", status);
}

function acceptFrame(socket: WebSocket, frame: TrackingFrame): void {
  const client = clients.get(socket);
  if (!client || frame.sequence <= client.lastSequence) return;
  client.lastSequence = frame.sequence;
  broadcast("tracking-frame", frame);
}

function startTrackingServer(): void {
  server = new WebSocketServer({ port: TRACKING_PORT, maxPayload: 64 * 1024 });
  server.on("connection", (socket) => {
    socket.on("message", async (raw, isBinary) => {
      if (isBinary) return socket.close(1003, "Text frames only");
      try {
        const message = parseLumaLinkMessage(raw.toString("utf8"));
        if (message.type === "hello") {
          const authorization = await authorizeHello(message);
          if (!authorization) {
            socket.send(JSON.stringify({ type: "pairing-required", protocol: 1, message: "Enter the six-digit code shown in LumaStage Desktop" }));
            socket.close(1008, "Pairing required");
            return;
          }
          clients.set(socket, { hello: message, lastSequence: -1 });
          socket.send(JSON.stringify({ type: "hello-accepted", protocol: 1, ...authorization }));
          publishStatus();
        } else {
          acceptFrame(socket, message);
        }
      } catch {
        socket.close(1007, "Invalid LumaLink message");
      }
    });
    socket.on("close", () => {
      clients.delete(socket);
      publishStatus();
    });
  });

  bonjour = new Bonjour();
  service = bonjour.publish({
    name: `LumaStage on ${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "Desktop"}`,
    type: "lumastage",
    protocol: "tcp",
    port: TRACKING_PORT,
    txt: { protocol: "1", app: app.getVersion() }
  });
}

async function inspectModelDirectory(directory: string): Promise<ImportedModel> {
  const model = await inspectCubismModelFolder(directory);
  activeModelRoot = model.directory;
  return {
    directory: model.directory,
    manifestPath: model.manifestPath,
    name: model.name,
    mocPath: model.mocPath,
    textureCount: model.texturePaths.length,
    expressionCount: model.expressions.length,
    motionCount: Object.values(model.motionGroups).flat().length,
    expressions: model.expressions.map((expression) => ({ name: expression.name, file: relative(model.directory, expression.path) })),
    motionGroups: Object.fromEntries(Object.entries(model.motionGroups).map(([group, paths]) => [group, paths.map((path) => relative(model.directory, path))])),
    missingFiles: model.missingFiles,
    manifestUrl: `lumastage-model://active/${encodeURIComponent(basename(model.manifestPath))}`,
    vTubeModelName: model.vTubeStudio?.name,
    vTubeParameterMappings: model.vTubeStudio?.parameterMappings ?? [],
    vTubeHotkeys: model.vTubeStudio?.hotkeys ?? []
  };
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#00000000",
    transparent: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const allowedDevelopmentUrl = process.env.ELECTRON_RENDERER_URL;
    if (allowedDevelopmentUrl && url.startsWith(allowedDevelopmentUrl)) return;
    if (url.startsWith("file:")) return;
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  window.webContents.once("did-finish-load", publishStatus);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  installAssetProtocols();
  ipcMain.handle("import-model", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return inspectModelDirectory(result.filePaths[0]);
  });
  ipcMain.handle("cubism-core-status", coreStatus);
  ipcMain.handle("install-cubism-core", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select the official Live2D Cubism Core for Web",
      properties: ["openFile"],
      filters: [{ name: "Live2D Cubism Core", extensions: ["js"] }]
    });
    const sourcePath = result.filePaths[0];
    if (result.canceled || !sourcePath) return null;
    const sourceStat = await stat(sourcePath);
    if (sourceStat.size > 16 * 1024 * 1024) throw new Error("Cubism Core file is unexpectedly large");
    const source = await readFile(sourcePath, "utf8");
    if (!source.includes("Live2DCubismCore")) throw new Error("The selected file is not Live2D Cubism Core for Web");
    await mkdir(join(app.getPath("userData"), "runtime"), { recursive: true });
    await copyFile(sourcePath, cubismCorePath());
    return coreStatus();
  });
  ipcMain.handle("set-overlay-mode", (event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Overlay mode must be a boolean");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Window is no longer available");
    window.setAlwaysOnTop(enabled, "floating");
    window.setHasShadow(!enabled);
    return enabled;
  });
  ipcMain.handle("forget-trusted-devices", async () => {
    trustedDevices.clear();
    for (const socket of clients.keys()) socket.close(1008, "Device trust was revoked");
    clients.clear();
    await saveTrustedDevices();
    publishStatus();
    return true;
  });
  await loadTrustedDevices();
  startTrackingServer();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  service?.stop();
  bonjour?.destroy();
  server?.close();
});
