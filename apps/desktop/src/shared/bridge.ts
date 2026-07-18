import type { TrackingFrame } from "@lumastage/protocol";

export interface VTubeParameterMapping {
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
}

export interface ImportedModel {
  directory: string;
  manifestPath: string;
  name: string;
  mocPath?: string;
  textureCount: number;
  expressionCount: number;
  motionCount: number;
  expressions: Array<{ name: string; file: string; parameters: Array<{ name: string; value: number }> }>;
  motionGroups: Record<string, string[]>;
  missingFiles: string[];
  manifestUrl: string;
  vTubeModelName?: string;
  vTubeParameterMappings: VTubeParameterMapping[];
  hasCustomMappings: boolean;
  vTubeHotkeys: ImportedHotkey[];
  artMeshTags: Record<string, string[]>;
  physicsGroups: Array<{ id: string; name: string }>;
}

export interface ModelLibraryEntry {
  modelID: string;
  modelName: string;
  vTubeModelName: string;
  vTubeModelIconName: string;
  active: boolean;
}

export interface ModelLibrary {
  models: ModelLibraryEntry[];
  activeModelID?: string;
}

export interface PostProcessingState {
  active: boolean;
  activePreset: string;
  presets: string[];
  values: Record<string, number | boolean | string>;
  fadeTime: number;
}

export interface PostProcessingUpdate {
  active?: boolean;
  preset?: string;
  values?: Record<string, number | boolean | string>;
  resetOthers?: boolean;
  fadeTime?: number;
}

export interface ImportedHotkey {
  id: string;
  name: string;
  action: string;
  file: string;
  folder: string;
  triggers: string[];
  isGlobal: boolean;
  isActive: boolean;
  motionGroup?: string;
  motionIndex?: number;
}

export interface CubismCoreStatus {
  available: boolean;
  installed?: boolean;
  compatible?: boolean;
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
  items: SceneItem[];
  modelName?: string;
}

export interface SceneItem {
  id: string;
  fileName: string;
  imageUrl: string;
  type: "PNG" | "JPG" | "GIF";
  positionX: number;
  positionY: number;
  size: number;
  rotation: number;
  order: number;
  flipped: boolean;
  locked: boolean;
  opacity: number;
  brightness: number;
  animationFramerate: number;
  animationFrame: number;
  animationFrameCount: number;
  animationPlaying: boolean;
  animationAutoStopFrames: number[];
  animationRevision: number;
  pin?: SceneItemPin;
}

export interface SceneItemPin {
  modelID: string;
  artMeshID: string;
  angleRelativeTo: "RelativeToWorld" | "RelativeToModel" | "RelativeToPinPosition";
  angle: number;
  vertexID1: number;
  vertexID2: number;
  vertexID3: number;
  vertexWeight1: number;
  vertexWeight2: number;
  vertexWeight3: number;
}

export interface ArtMeshGeometry {
  id: string;
  vertexCount: number;
  indices: number[];
}

export interface ArtMeshSelectionPrompt {
  id: string;
  pluginName: string;
  text: string;
  help: string;
  requestedArtMeshCount: number;
  artMeshIDs: string[];
  activeArtMeshes: string[];
}

export interface SceneItemUpdate {
  positionX?: number;
  positionY?: number;
  size?: number;
  rotation?: number;
  flipped?: boolean;
  locked?: boolean;
  opacity?: number;
  brightness?: number;
  animationFramerate?: number;
  animationFrame?: number;
  animationPlaying?: boolean;
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

export interface VtsExpressionActivation {
  file: string;
  active: boolean;
  fadeTime: number;
}

export interface VtsArtMeshTintState {
  artMeshColors: Record<string, { colorR: number; colorG: number; colorB: number; colorA: number }>;
}

export interface VtsPhysicsControl {
  baseStrength: number;
  baseWind: number;
  groups: Record<string, { strengthMultiplier: number; windMultiplier: number }>;
}

export interface VtsModelMoveAnimation {
  from: SceneTransform;
  to: SceneTransform;
  durationMs: number;
}

export interface DesktopStatus {
  port: number;
  connectedDevices: number;
  pairingCode: string;
  trustedDevices: number;
  vtsApiPort: number;
  vtsApiActive: boolean;
  allowedPlugins: number;
  /** Reachable IPv4 addresses for manual tracker connect (Wi‑Fi / Ethernet / USB tether). */
  hostAddresses: string[];
}

/** System webcam output: character only, transparent background (not the Transparent overlay). */
export interface VirtualCameraStatus {
  active: boolean;
  backend: "unity-capture" | "none";
  deviceName: string | null;
  width: number;
  height: number;
  fps: number;
  error: string | null;
  driverInstalled: boolean;
  framesSent: number;
}

export interface LumaStageBridge {
  onTrackingFrame(listener: (frame: TrackingFrame) => void): () => void;
  onDesktopStatus(listener: (status: DesktopStatus) => void): () => void;
  onPluginAuthorizationRequest(listener: (request: PluginAuthorizationRequest) => void): () => void;
  onVtsHotkeyTrigger(listener: (hotkey: ImportedHotkey) => void): () => void;
  onVtsParameterInjection(listener: (injection: VtsParameterInjection) => void): () => void;
  onVtsExpressionActivation(listener: (activation: VtsExpressionActivation) => void): () => void;
  onVtsArtMeshTint(listener: (state: VtsArtMeshTintState) => void): () => void;
  onVtsPhysicsControl(listener: (state: VtsPhysicsControl) => void): () => void;
  onVtsModelMove(listener: (move: VtsModelMoveAnimation) => void): () => void;
  onSceneWorkspaceChanged(listener: (workspace: SceneWorkspace) => void): () => void;
  onPostProcessingChanged(listener: (state: PostProcessingState) => void): () => void;
  onArtMeshSelectionRequest(listener: (prompt: ArtMeshSelectionPrompt) => void): () => void;
  getDesktopStatus(): Promise<DesktopStatus>;
  importModel(): Promise<ImportedModel | null>;
  getModelLibrary(): Promise<ModelLibrary>;
  loadModelFromLibrary(modelID: string): Promise<SceneWorkspace>;
  getPostProcessingState(): Promise<PostProcessingState>;
  updatePostProcessing(update: PostProcessingUpdate): Promise<PostProcessingState>;
  resolveArtMeshSelection(id: string, success: boolean, activeArtMeshes: string[]): Promise<boolean>;
  updateModelMappings(mappings: VTubeParameterMapping[]): Promise<ImportedModel>;
  resetModelMappings(): Promise<ImportedModel>;
  getSceneWorkspace(): Promise<SceneWorkspace>;
  createScene(name?: string): Promise<SceneWorkspace>;
  activateScene(id: string): Promise<SceneWorkspace>;
  updateScene(id: string, update: SceneUpdate): Promise<SceneWorkspace>;
  chooseSceneBackground(id: string): Promise<SceneWorkspace | null>;
  deleteScene(id: string): Promise<SceneWorkspace>;
  chooseSceneItem(sceneId: string): Promise<SceneWorkspace | null>;
  updateSceneItem(sceneId: string, itemId: string, update: SceneItemUpdate): Promise<SceneWorkspace>;
  unpinSceneItem(sceneId: string, itemId: string): Promise<SceneWorkspace>;
  deleteSceneItem(sceneId: string, itemId: string): Promise<SceneWorkspace>;
  getCubismCoreStatus(): Promise<CubismCoreStatus>;
  installCubismCore(): Promise<CubismCoreStatus | null>;
  setOverlayMode(enabled: boolean): Promise<boolean>;
  /** Start/stop system virtual webcam (character + transparent bg). */
  setVirtualCamera(enabled: boolean): Promise<VirtualCameraStatus>;
  getVirtualCameraStatus(): Promise<VirtualCameraStatus>;
  /** Push one RGBA frame (character only). */
  pushVirtualCameraFrame(frame: { width: number; height: number; rgba: ArrayBuffer }): Promise<boolean>;
  forgetTrustedDevices(): Promise<boolean>;
  resolvePluginAuthorization(id: string, approved: boolean): Promise<boolean>;
  forgetPluginAccess(): Promise<boolean>;
  notifyLocalHotkey(hotkeyID: string): Promise<boolean>;
  reportArtMeshes(modelDirectory: string, meshes: ArtMeshGeometry[]): Promise<boolean>;
  reportItemAnimationState(itemID: string, state: { frameCount: number; currentFrame: number; framerate: number; animationPlaying: boolean }): Promise<boolean>;
}
