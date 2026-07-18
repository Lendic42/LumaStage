import type { TrackingFrame } from "@lumastage/protocol";

export interface ImportedModel {
  directory: string;
  manifestPath: string;
  name: string;
  mocPath?: string;
  textureCount: number;
  expressionCount: number;
  motionCount: number;
  expressions: Array<{ name: string; file: string }>;
  motionGroups: Record<string, string[]>;
  missingFiles: string[];
  manifestUrl: string;
  vTubeModelName?: string;
  vTubeParameterMappings: Array<{
    name: string;
    input: string;
    inputRangeLower: number;
    inputRangeUpper: number;
    outputRangeLower: number;
    outputRangeUpper: number;
    clampInput: boolean;
    clampOutput: boolean;
    outputLive2D: string;
    smoothing: number;
  }>;
  vTubeHotkeys: ImportedHotkey[];
}

export interface ImportedHotkey {
  id: string;
  name: string;
  action: string;
  file: string;
  folder: string;
}

export interface CubismCoreStatus {
  available: boolean;
  version?: string;
}

export interface SceneTransform {
  scale: number;
  positionX: number;
  positionY: number;
  rotation: number;
  mirror: boolean;
}

export type SceneBackground =
  | { kind: "gradient"; preset: "violet" | "sunset" | "ocean" | "studio" | "transparent" }
  | { kind: "color"; color: string }
  | { kind: "image"; imageUrl: string };

export interface ScenePreset {
  id: string;
  name: string;
  background: SceneBackground;
  transform: SceneTransform;
  modelName?: string;
}

export interface SceneLibrary {
  version: 1;
  activeSceneId: string;
  scenes: ScenePreset[];
}

export interface SceneWorkspace {
  library: SceneLibrary;
  model: ImportedModel | null;
}

export interface SceneUpdate {
  name?: string;
  background?: Exclude<SceneBackground, { kind: "image" }>;
  transform?: Partial<SceneTransform>;
}

export interface PluginAuthorizationRequest {
  id: string;
  pluginName: string;
  pluginDeveloper: string;
  pluginIcon?: string;
}

export interface VtsParameterInjection {
  parameters: Array<{ id: string; value: number; weight?: number }>;
  mode: "set" | "add";
  faceFound?: boolean;
}

export interface DesktopStatus {
  port: number;
  connectedDevices: number;
  pairingCode: string;
  trustedDevices: number;
  vtsApiPort: number;
  vtsApiActive: boolean;
  allowedPlugins: number;
}

export interface LumaStageBridge {
  onTrackingFrame(listener: (frame: TrackingFrame) => void): () => void;
  onDesktopStatus(listener: (status: DesktopStatus) => void): () => void;
  onPluginAuthorizationRequest(listener: (request: PluginAuthorizationRequest) => void): () => void;
  onVtsHotkeyTrigger(listener: (hotkey: ImportedHotkey) => void): () => void;
  onVtsParameterInjection(listener: (injection: VtsParameterInjection) => void): () => void;
  importModel(): Promise<ImportedModel | null>;
  getSceneWorkspace(): Promise<SceneWorkspace>;
  createScene(name?: string): Promise<SceneWorkspace>;
  activateScene(id: string): Promise<SceneWorkspace>;
  updateScene(id: string, update: SceneUpdate): Promise<SceneWorkspace>;
  chooseSceneBackground(id: string): Promise<SceneWorkspace | null>;
  deleteScene(id: string): Promise<SceneWorkspace>;
  getCubismCoreStatus(): Promise<CubismCoreStatus>;
  installCubismCore(): Promise<CubismCoreStatus | null>;
  setOverlayMode(enabled: boolean): Promise<boolean>;
  forgetTrustedDevices(): Promise<boolean>;
  resolvePluginAuthorization(id: string, approved: boolean): Promise<boolean>;
  forgetPluginAccess(): Promise<boolean>;
  notifyLocalHotkey(hotkeyID: string): Promise<boolean>;
}
