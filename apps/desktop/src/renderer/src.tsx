import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TrackingFrame } from "@lumastage/protocol";
import { mapARKitToVTubeInputs } from "@lumastage/tracking-core";
import type { DesktopStatus, ImportedHotkey, ImportedModel, LumaStageBridge, ModelLibrary, PluginAuthorizationRequest, SceneItem, SceneItemUpdate, SceneLibrary, SceneTransform, SceneUpdate, SceneWorkspace, VtsArtMeshTintState, VtsExpressionActivation, VtsModelMoveAnimation, VtsParameterInjection, VtsPhysicsControl, VTubeParameterMapping } from "../shared/bridge";
import type { CubismCoreStatus } from "../shared/bridge";
import { Live2DStage } from "./components/Live2DStage";
import "./style.css";

declare global {
  interface Window {
    lumastage: LumaStageBridge;
  }
}

const neutral: TrackingFrame = {
  type: "tracking",
  protocol: 1,
  sequence: 0,
  capturedAt: 0,
  faceFound: false,
  head: { pitch: 0, yaw: 0, roll: 0, positionX: 0, positionY: 0, positionZ: 0 },
  gaze: { x: 0, y: 0 },
  blendShapes: {}
};

const neutralSceneTransform: SceneTransform = { scale: 1, positionX: 0, positionY: 0, rotation: 0, mirror: false };
const gradientBackgrounds = {
  violet: "radial-gradient(circle at 50% 55%, #4c3d86 0, #211d3b 38%, #10131e 74%)",
  sunset: "radial-gradient(circle at 70% 25%, #ff9166 0, #7b386f 33%, #17182a 72%)",
  ocean: "radial-gradient(circle at 42% 38%, #2bb7c9 0, #174b72 34%, #101827 74%)",
  studio: "radial-gradient(circle at 50% 42%, #3b4055 0, #202331 38%, #11131d 76%)",
  transparent: "transparent"
} as const;

function AvatarPreview({ frame }: { frame: TrackingFrame }) {
  const jaw = frame.blendShapes.jawOpen ?? 0;
  const blinkLeft = frame.blendShapes.eyeBlinkLeft ?? 0;
  const blinkRight = frame.blendShapes.eyeBlinkRight ?? 0;
  const smile = ((frame.blendShapes.mouthSmileLeft ?? 0) + (frame.blendShapes.mouthSmileRight ?? 0)) / 2;
  const pupilTransform = `translate(${Math.max(-1, Math.min(1, frame.gaze.x)) * 7}px, ${Math.max(-1, Math.min(1, -frame.gaze.y)) * 5}px)`;
  const transform = `translate(${frame.head.yaw * 42}px, ${frame.head.pitch * 32}px) rotate(${frame.head.roll * -35}deg)`;
  return (
    <div className="avatar-wrap" style={{ transform }}>
      <div className="avatar-halo" />
      <div className="avatar-hair" />
      <div className="avatar-face">
        <div className="eye left" style={{ transform: `scaleY(${Math.max(0.08, 1 - blinkLeft)})` }}><i style={{ transform: pupilTransform }} /></div>
        <div className="eye right" style={{ transform: `scaleY(${Math.max(0.08, 1 - blinkRight)})` }}><i style={{ transform: pupilTransform }} /></div>
        <div className="mouth" style={{ height: 5 + jaw * 30 + smile * 3, width: 28 + jaw * 10 + smile * 13, borderRadius: `${8 + smile * 18}px ${8 + smile * 18}px ${55 + smile * 35}% ${55 + smile * 35}%` }} />
      </div>
      <div className="avatar-body" />
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(1, value));
  return <div className="meter"><span>{label}</span><div><i style={{ width: `${normalized * 100}%` }} /></div><b>{normalized.toFixed(2)}</b></div>;
}

function hotkeyDisplayName(hotkey: ImportedHotkey): string {
  if (hotkey.name.trim()) return hotkey.name;
  const fileName = hotkey.file.replaceAll("\\", "/").split("/").pop() ?? "";
  return fileName.replace(/\.(?:motion3|exp3)\.json$/i, "") || hotkey.action;
}

const mappingInputNames = [
  "FaceAngleX", "FaceAngleY", "FaceAngleZ", "FacePositionX", "FacePositionY", "FacePositionZ",
  "EyeOpenLeft", "EyeOpenRight", "EyeLeftX", "EyeLeftY", "EyeRightX", "EyeRightY",
  "MouthOpen", "MouthSmile", "VoiceVolumePlusMouthOpen", "MouthX", "Brows", "BrowLeftY",
  "BrowRightY", "CheekPuff", "FaceAngry", "TongueOut", "MousePositionX", "MousePositionY"
];

function MappingEditor({ model, frame, onClose, onSaved }: { model: ImportedModel; frame: TrackingFrame; onClose(): void; onSaved(model: ImportedModel): void }) {
  const [draft, setDraft] = useState<VTubeParameterMapping[]>(() => model.vTubeParameterMappings.map((mapping) => ({ ...mapping })));
  const [capture, setCapture] = useState<{ index: number; min: number; max: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const liveInputs = useMemo(() => mapARKitToVTubeInputs(frame), [frame]);

  useEffect(() => {
    if (!capture) return;
    const mapping = draft[capture.index];
    const value = mapping ? liveInputs[mapping.input] : undefined;
    if (value === undefined || !Number.isFinite(value)) return;
    setCapture((current) => current && current.index === capture.index
      ? { ...current, min: Math.min(current.min, value), max: Math.max(current.max, value) }
      : current);
  }, [capture?.index, draft, liveInputs]);

  const update = (index: number, patch: Partial<VTubeParameterMapping>) => {
    setDraft((mappings) => mappings.map((mapping, candidate) => candidate === index ? { ...mapping, ...patch } : mapping));
  };
  const finishCapture = () => {
    if (!capture) return;
    if (capture.max - capture.min >= 0.001) update(capture.index, { inputRangeLower: capture.min, inputRangeUpper: capture.max });
    else setSaveError("Move this facial input through its range before stopping capture.");
    setCapture(null);
  };
  const save = async () => {
    setSaveError(null);
    try { onSaved(await window.lumastage.updateModelMappings(draft)); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const reset = async () => {
    setSaveError(null);
    try { onSaved(await window.lumastage.resetModelMappings()); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const addMapping = () => setDraft((mappings) => [...mappings, {
    name: "New mapping", input: "MouthOpen", inputRangeLower: 0, inputRangeUpper: 1,
    outputRangeLower: 0, outputRangeUpper: 1, clampInput: true, clampOutput: true,
    outputLive2D: "ParamMouthOpenY", smoothing: 10
  }]);

  return <div className="modal-backdrop mapping-backdrop"><section className="mapping-modal">
    <div className="mapping-header"><div><small>TRACKING CALIBRATION</small><h2>Model mappings</h2><p>Connect the iPhone, capture your natural movement range, then map it to this model’s Live2D parameters.</p></div><button className="modal-close" onClick={onClose}>×</button></div>
    <datalist id="mapping-inputs">{mappingInputNames.map((name) => <option key={name} value={name} />)}</datalist>
    <div className="mapping-list">{draft.map((mapping, index) => {
      const live = liveInputs[mapping.input];
      const isCapturing = capture?.index === index;
      return <article className={`mapping-card${isCapturing ? " capturing" : ""}`} key={`${mapping.outputLive2D}-${index}`}>
        <div className="mapping-title"><input aria-label="Mapping name" value={mapping.name} onChange={(event) => update(index, { name: event.target.value })} /><button onClick={() => { if (capture?.index === index) setCapture(null); setDraft((mappings) => mappings.filter((_, candidate) => candidate !== index)); }}>Remove</button></div>
        <div className="mapping-route"><label>Face input<input list="mapping-inputs" value={mapping.input} onChange={(event) => update(index, { input: event.target.value })} /></label><span>→</span><label>Live2D output<input value={mapping.outputLive2D} onChange={(event) => update(index, { outputLive2D: event.target.value })} /></label><div className="live-value"><small>LIVE</small><b>{live === undefined ? "—" : live.toFixed(3)}</b></div></div>
        <div className="mapping-numbers"><label>Input min<input type="number" step="0.01" value={mapping.inputRangeLower} onChange={(event) => update(index, { inputRangeLower: Number(event.target.value) })} /></label><label>Input max<input type="number" step="0.01" value={mapping.inputRangeUpper} onChange={(event) => update(index, { inputRangeUpper: Number(event.target.value) })} /></label><label>Output min<input type="number" step="0.01" value={mapping.outputRangeLower} onChange={(event) => update(index, { outputRangeLower: Number(event.target.value) })} /></label><label>Output max<input type="number" step="0.01" value={mapping.outputRangeUpper} onChange={(event) => update(index, { outputRangeUpper: Number(event.target.value) })} /></label><label>Smoothing<input type="number" min="0" max="1000" step="1" value={mapping.smoothing} onChange={(event) => update(index, { smoothing: Number(event.target.value) })} /></label></div>
        <div className="mapping-options"><label><input type="checkbox" checked={mapping.clampInput} onChange={(event) => update(index, { clampInput: event.target.checked })} /> Clamp input</label><label><input type="checkbox" checked={mapping.clampOutput} onChange={(event) => update(index, { clampOutput: event.target.checked })} /> Clamp output</label><button className={isCapturing ? "capture active" : "capture"} disabled={!frame.faceFound || live === undefined} onClick={() => isCapturing ? finishCapture() : setCapture({ index, min: live ?? 0, max: live ?? 0 })}>{isCapturing ? `Stop · ${capture.min.toFixed(2)}…${capture.max.toFixed(2)}` : "● Capture input range"}</button></div>
      </article>;
    })}</div>
    {saveError && <p className="mapping-error">{saveError}</p>}
    <div className="mapping-footer"><button className="secondary" onClick={addMapping}>＋ Add mapping</button><span /><button className="secondary" disabled={!model.hasCustomMappings} onClick={() => void reset()}>Reset imported</button><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={() => void save()}>Save mappings</button></div>
  </section></div>;
}

type AppView = "stage" | "models" | "tracking" | "settings";

function ModelsView({ library, model, onImport, onLoad }: { library: ModelLibrary; model: ImportedModel | null; onImport(): void; onLoad(modelID: string): void }) {
  return <div className="view-page">
    <section className="view-hero models-hero"><div><small>VTS-COMPATIBLE LIBRARY</small><h2>Your models, ready to perform</h2><p>Imported Cubism and VTube Studio folders stay available here. Switch models without selecting the folder again.</p></div><button className="hero-action" onClick={onImport}>＋ Import model</button></section>
    {library.models.length ? <section className="model-grid">{library.models.map((entry, index) => <article className={`model-card${entry.active ? " active" : ""}`} key={entry.modelID}>
      <div className={`model-art tone-${index % 4}`}><span>{entry.modelName.trim().slice(0, 2).toUpperCase() || "2D"}</span>{entry.active && <b>LIVE</b>}</div>
      <div className="model-card-body"><small>{entry.vTubeModelName || "Cubism model"}</small><h3>{entry.modelName}</h3><p>{entry.active && model ? `${model.textureCount} textures · ${model.expressionCount} expressions · ${model.motionCount} motions` : "Compatible model saved in your local library"}</p><button className={entry.active ? "secondary current" : "primary"} disabled={entry.active} onClick={() => onLoad(entry.modelID)}>{entry.active ? "✓ On stage" : "Use on stage"}</button></div>
    </article>)}</section> : <section className="empty-library"><div>◇</div><h2>No models imported yet</h2><p>Select the folder containing a <code>*.model3.json</code> file or an exported VTube Studio model.</p><button className="hero-action" onClick={onImport}>Choose model folder</button></section>}
  </div>;
}

function TrackingView({ frame, status, model, onCalibrate, onEditMappings }: { frame: TrackingFrame; status: DesktopStatus; model: ImportedModel | null; onCalibrate(): void; onEditMappings(): void }) {
  const inputs = mapARKitToVTubeInputs(frame);
  const smile = ((frame.blendShapes.mouthSmileLeft ?? 0) + (frame.blendShapes.mouthSmileRight ?? 0)) / 2;
  const signals = [
    ["Yaw", Math.abs(inputs.FaceAngleX ?? 0) / 30], ["Pitch", Math.abs(inputs.FaceAngleY ?? 0) / 30], ["Roll", Math.abs(inputs.FaceAngleZ ?? 0) / 30],
    ["Blink L", 1 - (inputs.EyeOpenLeft ?? 1)], ["Blink R", 1 - (inputs.EyeOpenRight ?? 1)], ["Gaze X", Math.abs(inputs.EyeLeftX ?? 0)],
    ["Gaze Y", Math.abs(inputs.EyeLeftY ?? 0)], ["Mouth", frame.blendShapes.jawOpen ?? 0], ["Smile", smile]
  ] as const;
  return <div className="view-page">
    <section className={`tracking-hero${frame.faceFound ? " online" : ""}`}><div className="face-orbit"><div>⌁</div><i /></div><div><small>TRUEDEPTH LINK</small><h2>{frame.faceFound ? "Face tracking is live" : status.connectedDevices ? "iPhone connected — find your face" : "Connect your iPhone tracker"}</h2><p>{status.connectedDevices ? `${status.connectedDevices} secure tracker connection${status.connectedDevices === 1 ? "" : "s"} · frame ${frame.sequence || "idle"}` : <>Enter pairing code <strong>{status.pairingCode}</strong> in the LumaStage iPhone app.</>}</p></div><div className="tracking-actions"><button className="hero-action" disabled={!frame.faceFound} onClick={onCalibrate}>◎ Calibrate</button>{model && <button className="ghost-action" onClick={onEditMappings}>Edit mappings</button>}</div></section>
    <section className="signal-grid">{signals.map(([label, value]) => <article className="signal-card" key={label}><div><span>{label}</span><b>{Math.max(0, Math.min(1, value)).toFixed(2)}</b></div><div className="large-meter"><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div></article>)}</section>
    <section className="privacy-strip"><div>♢</div><p><b>Private by design</b><br />Only animation values are sent over your local network. LumaStage does not stream or save the camera image.</p><code>ws://local:{status.port}</code></section>
  </div>;
}

function SettingsView({ coreStatus, coreInstalling, status, onInstallCore, onForgetTrackers, onForgetPlugins }: { coreStatus: CubismCoreStatus; coreInstalling: boolean; status: DesktopStatus; onInstallCore(): void; onForgetTrackers(): void; onForgetPlugins(): void }) {
  const coreLabel = coreStatus.available ? "Compatible Core installed" : coreStatus.installed ? "Incompatible Core detected" : "Cubism Core is missing";
  return <div className="view-page">
    <section className="view-hero settings-hero"><div><small>LOCAL & OPEN</small><h2>Studio settings</h2><p>Renderer, tracker and plugin access stay under your control on this computer.</p></div></section>
    <section className="settings-grid">
      <article className="setting-card featured"><div className="setting-icon">◇</div><div><small>LIVE2D RENDERER</small><h3>{coreLabel}</h3><p>{coreStatus.available ? "Official Cubism Core is ready for compatible Live2D models." : "Install the official compatible Cubism Core directly from Live2D."}</p>{!coreStatus.available && <button className="hero-action" disabled={coreInstalling} onClick={onInstallCore}>{coreInstalling ? "Downloading from Live2D…" : coreStatus.installed ? "Replace with compatible Core" : "Install Cubism Core"}</button>}</div><span className={`status-badge${coreStatus.available ? " good" : " warn"}`}>{coreStatus.available ? "READY" : "ACTION"}</span></article>
      <article className="setting-card"><div className="setting-icon">⌁</div><div><small>IPHONE TRACKER</small><h3>Port {status.port}</h3><p>{status.connectedDevices} connected · {status.trustedDevices} paired device{status.trustedDevices === 1 ? "" : "s"}</p>{status.trustedDevices > 0 && <button className="text-action" onClick={onForgetTrackers}>Forget paired devices</button>}</div></article>
      <article className="setting-card"><div className="setting-icon">◫</div><div><small>VTS PLUGIN API</small><h3>127.0.0.1:{status.vtsApiPort}</h3><p>{status.vtsApiActive ? "Local compatibility API is active." : "The compatibility API is unavailable."} {status.allowedPlugins} allowed plugin{status.allowedPlugins === 1 ? "" : "s"}.</p>{status.allowedPlugins > 0 && <button className="text-action" onClick={onForgetPlugins}>Revoke plugin permissions</button>}</div><span className={`status-badge${status.vtsApiActive ? " good" : " warn"}`}>{status.vtsApiActive ? "ACTIVE" : "OFFLINE"}</span></article>
      <article className="setting-card"><div className="setting-icon">↗</div><div><small>STREAM OUTPUT</small><h3>Transparent capture</h3><p>Use the Transparent button on Stage for a clean OBS or screen-capture source.</p></div></article>
    </section>
  </div>;
}

function App() {
  const [frame, setFrame] = useState(neutral);
  const [status, setStatus] = useState<DesktopStatus>({ port: 39510, connectedDevices: 0, pairingCode: "------", trustedDevices: 0, vtsApiPort: 8001, vtsApiActive: false, allowedPlugins: 0 });
  const [model, setModel] = useState<ImportedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [coreStatus, setCoreStatus] = useState<CubismCoreStatus>({ available: false });
  const [coreInstalling, setCoreInstalling] = useState(false);
  const [calibrationNonce, setCalibrationNonce] = useState(0);
  const [overlayMode, setOverlayMode] = useState(false);
  const [hotkeyRequest, setHotkeyRequest] = useState<{ nonce: number; hotkey: ImportedHotkey } | null>(null);
  const [pluginRequests, setPluginRequests] = useState<PluginAuthorizationRequest[]>([]);
  const [parameterInjection, setParameterInjection] = useState<{ nonce: number; value: VtsParameterInjection } | null>(null);
  const [expressionRequest, setExpressionRequest] = useState<{ nonce: number; value: VtsExpressionActivation } | null>(null);
  const [artMeshTint, setArtMeshTint] = useState<VtsArtMeshTintState>({ artMeshColors: {} });
  const [physicsControl, setPhysicsControl] = useState<VtsPhysicsControl>({ baseStrength: 50, baseWind: 0, groups: {} });
  const [modelMove, setModelMove] = useState<{ nonce: number; value: VtsModelMoveAnimation } | null>(null);
  const [sceneLibrary, setSceneLibrary] = useState<SceneLibrary | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const itemElements = useRef(new Map<string, HTMLImageElement>());
  const [mappingEditorOpen, setMappingEditorOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>("stage");
  const [modelLibrary, setModelLibrary] = useState<ModelLibrary>({ models: [] });

  useEffect(() => {
    const offFrame = window.lumastage.onTrackingFrame(setFrame);
    const offStatus = window.lumastage.onDesktopStatus(setStatus);
    const offPluginRequest = window.lumastage.onPluginAuthorizationRequest((request) => setPluginRequests((items) => [...items, request]));
    const offVtsHotkey = window.lumastage.onVtsHotkeyTrigger((hotkey) => setHotkeyRequest({ nonce: Date.now(), hotkey }));
    const offParameterInjection = window.lumastage.onVtsParameterInjection((value) => setParameterInjection({ nonce: Date.now(), value }));
    const offExpressionActivation = window.lumastage.onVtsExpressionActivation((value) => setExpressionRequest({ nonce: Date.now(), value }));
    const offArtMeshTint = window.lumastage.onVtsArtMeshTint(setArtMeshTint);
    const offPhysicsControl = window.lumastage.onVtsPhysicsControl(setPhysicsControl);
    const offModelMove = window.lumastage.onVtsModelMove((value) => setModelMove({ nonce: Date.now(), value }));
    const offSceneWorkspace = window.lumastage.onSceneWorkspaceChanged((workspace) => { setSceneLibrary(workspace.library); setModel(workspace.model); void window.lumastage.getModelLibrary().then(setModelLibrary); });
    void window.lumastage.getDesktopStatus().then(setStatus);
    void window.lumastage.getCubismCoreStatus().then(setCoreStatus);
    void window.lumastage.getModelLibrary().then(setModelLibrary).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    void window.lumastage.getSceneWorkspace().then((workspace) => { setSceneLibrary(workspace.library); setModel(workspace.model); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { offFrame(); offStatus(); offPluginRequest(); offVtsHotkey(); offParameterInjection(); offExpressionActivation(); offArtMeshTint(); offPhysicsControl(); offModelMove(); offSceneWorkspace(); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && overlayMode) void toggleOverlay(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayMode]);

  const connectionLabel = useMemo(() => status.connectedDevices > 0 ? "iPhone connected" : "Waiting for iPhone", [status]);
  const activeScene = sceneLibrary?.scenes.find((scene) => scene.id === sceneLibrary.activeSceneId);
  const selectedItem = activeScene?.items.find((item) => item.id === selectedItemId) ?? null;
  const applyPinnedItemLayout = useCallback((itemID: string, layout: { x: number; y: number; rotation: number }) => {
    const element = itemElements.current.get(itemID);
    if (!element) return;
    const item = activeScene?.items.find((candidate) => candidate.id === itemID);
    if (!item?.pin) return;
    element.style.left = `${layout.x}px`;
    element.style.top = `${layout.y}px`;
    element.style.transform = `translate(-50%, -50%) rotate(${layout.rotation}deg) scaleX(${item.flipped ? -1 : 1})`;
  }, [activeScene]);
  useEffect(() => {
    if (selectedItemId && activeScene?.items.some((item) => item.id === selectedItemId)) return;
    setSelectedItemId(activeScene?.items[0]?.id ?? null);
  }, [activeScene, selectedItemId]);
  const applyWorkspace = (workspace: SceneWorkspace) => { setSceneLibrary(workspace.library); setModel(workspace.model); void window.lumastage.getModelLibrary().then(setModelLibrary); };
  const updateActiveScene = async (update: SceneUpdate) => {
    if (!activeScene) return;
    try { applyWorkspace(await window.lumastage.updateScene(activeScene.id, update)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const updateSelectedItem = async (update: SceneItemUpdate) => {
    if (!activeScene || !selectedItem) return;
    try { applyWorkspace(await window.lumastage.updateSceneItem(activeScene.id, selectedItem.id, update)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const startItemDrag = (event: React.PointerEvent<HTMLImageElement>, item: SceneItem) => {
    if (!activeScene || overlayMode) return;
    setSelectedItemId(item.id);
    if (item.locked || item.pin) return;
    event.preventDefault();
    const stage = event.currentTarget.closest(".stage")?.getBoundingClientRect();
    if (!stage) return;
    const origin = { x: event.clientX, y: event.clientY, positionX: item.positionX, positionY: item.positionY };
    let nextX = item.positionX;
    let nextY = item.positionY;
    const move = (pointer: PointerEvent) => {
      nextX = origin.positionX + (pointer.clientX - origin.x) * 2 / stage.width;
      nextY = origin.positionY - (pointer.clientY - origin.y) * 2 / stage.height;
      setSceneLibrary((library) => library ? { ...library, scenes: library.scenes.map((scene) => scene.id === activeScene.id ? { ...scene, items: scene.items.map((candidate) => candidate.id === item.id ? { ...candidate, positionX: nextX, positionY: nextY } : candidate) } : scene) } : library);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      void window.lumastage.updateSceneItem(activeScene.id, item.id, { positionX: nextX, positionY: nextY }).then(applyWorkspace).catch((reason) => setError(String(reason)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };
  const importModel = async () => {
    setError(null);
    try {
      const imported = await window.lumastage.importModel();
      setModel(imported);
      if (imported) { applyWorkspace(await window.lumastage.getSceneWorkspace()); setActiveView("models"); }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const loadLibraryModel = async (modelID: string) => {
    setError(null);
    try { applyWorkspace(await window.lumastage.loadModelFromLibrary(modelID)); setActiveView("stage"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const installCore = async () => {
    setRendererError(null);
    setCoreInstalling(true);
    try {
      const status = await window.lumastage.installCubismCore();
      if (status) {
        setCoreStatus(status);
        if (model) setModel({ ...model });
      }
    } catch (reason) {
      setRendererError(reason instanceof Error ? reason.message : String(reason));
    } finally { setCoreInstalling(false); }
  };
  const toggleOverlay = async (enabled = !overlayMode) => {
    try { setOverlayMode(await window.lumastage.setOverlayMode(enabled)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const triggerHotkey = (hotkey: ImportedHotkey) => {
    setHotkeyRequest({ nonce: Date.now(), hotkey });
    void window.lumastage.notifyLocalHotkey(hotkey.id);
  };
  const resolvePluginRequest = async (approved: boolean) => {
    const request = pluginRequests[0];
    if (!request) return;
    await window.lumastage.resolvePluginAuthorization(request.id, approved);
    setPluginRequests((items) => items.slice(1));
  };
  const stageStyle = useMemo<React.CSSProperties>(() => {
    if (overlayMode) return { background: "transparent" };
    const background = activeScene?.background;
    if (!background) return {};
    if (background.kind === "gradient") return { background: gradientBackgrounds[background.preset] };
    if (background.kind === "color") return { background: background.color };
    return { backgroundImage: `linear-gradient(#07091222, #07091222), url("${background.imageUrl}?scene=${activeScene.id}")`, backgroundSize: "cover", backgroundPosition: "center" };
  }, [activeScene, overlayMode]);

  return <main className={`shell${overlayMode ? " overlay" : ""}`}>
    <aside className="rail">
      <div className="logo"><div>LS</div><span>Luma<br />Stage</span></div>
      <nav>{(["stage", "models", "tracking", "settings"] as const).map((view) => <button key={view} className={activeView === view ? "active" : ""} aria-current={activeView === view ? "page" : undefined} onClick={() => setActiveView(view)}>{view === "stage" ? "◈" : view === "models" ? "◇" : view === "tracking" ? "⌁" : "⚙"}<span>{view[0].toUpperCase() + view.slice(1)}</span></button>)}</nav>
      <div className="version">v0.1</div>
    </aside>

    <section className="workspace">
      <header><div><small>{activeView === "stage" ? "LIVE WORKSPACE" : activeView === "models" ? "MODEL LIBRARY" : activeView === "tracking" ? "FACIAL CAPTURE" : "PREFERENCES"}</small><h1>{activeView[0].toUpperCase() + activeView.slice(1)}</h1></div><div className={`connection ${status.connectedDevices ? "online" : ""}`}><i />{connectionLabel}<span>:{status.port}</span></div></header>
      {activeView === "stage" && <div className="stage-grid">
        <section className="stage-card">
          <div className="stage-toolbar"><span>{activeScene?.name ?? "Main Stage"} · {model?.name ?? "Preview avatar"}</span><div><button onClick={() => void updateActiveScene({ transform: neutralSceneTransform })}>⌖ Fit</button><button onClick={() => void toggleOverlay()}>{overlayMode ? "Exit overlay" : "▣ Transparent"}</button></div></div>
          <div className="stage" style={stageStyle}>
            <div className="grid" />
            {activeScene?.items.map((item) => <img
              key={item.id}
              ref={(element) => { if (element) itemElements.current.set(item.id, element); else itemElements.current.delete(item.id); }}
              className={`scene-item${selectedItemId === item.id && !overlayMode ? " selected" : ""}${item.locked ? " locked" : ""}${item.pin ? " pinned" : ""}`}
              src={`${item.imageUrl}?item=${item.id}`}
              alt={item.fileName}
              draggable={false}
              onPointerDown={(event) => startItemDrag(event, item)}
              style={{ left: `${(item.positionX + 1) * 50}%`, top: `${(1 - item.positionY) * 50}%`, width: `${item.size * 100}%`, opacity: item.opacity, zIndex: item.order > 0 ? 4 : 1, transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scaleX(${item.flipped ? -1 : 1})`, pointerEvents: overlayMode ? "none" : "auto" }}
            />)}
            {!rendererReady && <AvatarPreview frame={frame} />}
            <Live2DStage model={model} frame={frame} calibrationNonce={calibrationNonce} hotkeyRequest={hotkeyRequest} parameterInjection={parameterInjection} expressionRequest={expressionRequest} artMeshTint={artMeshTint} physicsControl={physicsControl} modelMove={modelMove} sceneTransform={activeScene?.transform ?? neutralSceneTransform} pinnedItems={activeScene?.items.filter((item) => item.pin) ?? []} onPinnedItemLayout={applyPinnedItemLayout} onReady={setRendererReady} onError={setRendererError} />
            <div className="tracking-pill"><i className={frame.faceFound ? "online" : ""} />{frame.faceFound ? "Face tracked" : rendererReady ? "Model ready" : "Neutral preview"}</div>
            {overlayMode && <button className="exit-overlay" onClick={() => void toggleOverlay(false)}>Exit overlay · Esc</button>}
          </div>
        </section>

        <aside className="inspector">
          {activeScene && <section className="panel scene-panel"><div className="panel-heading"><h3>Scenes</h3><button className="tiny-add" onClick={() => void window.lumastage.createScene().then(applyWorkspace).catch((reason) => setError(String(reason)))}>＋ New</button></div><div className="scene-tabs">{sceneLibrary?.scenes.map((scene) => <button key={scene.id} className={scene.id === activeScene.id ? "active" : ""} onClick={() => void window.lumastage.activateScene(scene.id).then(applyWorkspace).catch((reason) => setError(String(reason)))}>{scene.name}</button>)}</div><label className="scene-name">Scene name<input value={activeScene.name} maxLength={48} onChange={(event) => setSceneLibrary((library) => library ? { ...library, scenes: library.scenes.map((scene) => scene.id === activeScene.id ? { ...scene, name: event.target.value } : scene) } : library)} onBlur={(event) => void updateActiveScene({ name: event.target.value || "Scene" })} /></label><div className="background-row"><button className="bg-dot violet" title="Violet" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "violet" } })} /><button className="bg-dot sunset" title="Sunset" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "sunset" } })} /><button className="bg-dot ocean" title="Ocean" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "ocean" } })} /><button className="bg-dot studio" title="Studio" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "studio" } })} /><input aria-label="Scene background color" type="color" value={activeScene.background.kind === "color" ? activeScene.background.color : "#29233f"} onChange={(event) => void updateActiveScene({ background: { kind: "color", color: event.target.value } })} /><button className="image-pick" onClick={() => void window.lumastage.chooseSceneBackground(activeScene.id).then((workspace) => workspace && applyWorkspace(workspace)).catch((reason) => setError(String(reason)))}>▧ Image</button></div><div className="transform-grid"><label>Scale <b>{activeScene.transform.scale.toFixed(2)}×</b><input type="range" min="0.2" max="3" step="0.01" value={activeScene.transform.scale} onChange={(event) => void updateActiveScene({ transform: { scale: Number(event.target.value) } })} /></label><label>X <b>{Math.round(activeScene.transform.positionX * 100)}</b><input type="range" min="-1" max="1" step="0.01" value={activeScene.transform.positionX} onChange={(event) => void updateActiveScene({ transform: { positionX: Number(event.target.value) } })} /></label><label>Y <b>{Math.round(activeScene.transform.positionY * 100)}</b><input type="range" min="-1" max="1" step="0.01" value={activeScene.transform.positionY} onChange={(event) => void updateActiveScene({ transform: { positionY: Number(event.target.value) } })} /></label><label>Rotate <b>{Math.round(activeScene.transform.rotation)}°</b><input type="range" min="-180" max="180" step="1" value={activeScene.transform.rotation} onChange={(event) => void updateActiveScene({ transform: { rotation: Number(event.target.value) } })} /></label></div><div className="scene-actions"><button className={activeScene.transform.mirror ? "active" : ""} onClick={() => void updateActiveScene({ transform: { mirror: !activeScene.transform.mirror } })}>⇋ Mirror</button><button disabled={(sceneLibrary?.scenes.length ?? 0) < 2} onClick={() => void window.lumastage.deleteScene(activeScene.id).then(applyWorkspace).catch((reason) => setError(String(reason)))}>Delete</button></div></section>}
          {activeScene && <section className="panel item-panel">
            <div className="panel-heading"><h3>Scene items</h3><button className="tiny-add" onClick={() => void window.lumastage.chooseSceneItem(activeScene.id).then((workspace) => workspace && applyWorkspace(workspace)).catch((reason) => setError(String(reason)))}>＋ Image</button></div>
            {activeScene.items.length ? <>
              <div className="item-tabs">{activeScene.items.map((item) => <button key={item.id} className={item.id === selectedItemId ? "active" : ""} onClick={() => setSelectedItemId(item.id)}><img src={`${item.imageUrl}?thumb=${item.id}`} alt="" /><span>{item.fileName}</span></button>)}</div>
              {selectedItem && <>
                {selectedItem.pin && <p className="pin-status">⌖ Pinned to <b>{selectedItem.pin.artMeshID}</b></p>}
                <div className="transform-grid">
                  <label>Size <b>{selectedItem.size.toFixed(2)}</b><input type="range" min="0.01" max="1" step="0.01" value={selectedItem.size} onChange={(event) => void updateSelectedItem({ size: Number(event.target.value) })} /></label>
                  <label>Opacity <b>{Math.round(selectedItem.opacity * 100)}%</b><input type="range" min="0" max="1" step="0.01" value={selectedItem.opacity} onChange={(event) => void updateSelectedItem({ opacity: Number(event.target.value) })} /></label>
                  <label>X <b>{selectedItem.pin ? "ArtMesh" : selectedItem.positionX.toFixed(2)}</b><input disabled={Boolean(selectedItem.pin)} type="range" min="-1.5" max="1.5" step="0.01" value={selectedItem.positionX} onChange={(event) => void updateSelectedItem({ positionX: Number(event.target.value) })} /></label>
                  <label>Y <b>{selectedItem.pin ? "ArtMesh" : selectedItem.positionY.toFixed(2)}</b><input disabled={Boolean(selectedItem.pin)} type="range" min="-1.5" max="1.5" step="0.01" value={selectedItem.positionY} onChange={(event) => void updateSelectedItem({ positionY: Number(event.target.value) })} /></label>
                  <label>Rotate <b>{selectedItem.pin ? selectedItem.pin.angleRelativeTo.replace("RelativeTo", "") : `${Math.round(selectedItem.rotation)}°`}</b><input disabled={Boolean(selectedItem.pin)} type="range" min="-180" max="180" step="1" value={selectedItem.rotation} onChange={(event) => void updateSelectedItem({ rotation: Number(event.target.value) })} /></label>
                </div>
                <div className="scene-actions">
                  <button className={selectedItem.flipped ? "active" : ""} onClick={() => void updateSelectedItem({ flipped: !selectedItem.flipped })}>⇋ Flip</button>
                  <button className={selectedItem.locked ? "active" : ""} onClick={() => void updateSelectedItem({ locked: !selectedItem.locked })}>{selectedItem.locked ? "🔒 Locked" : "Lock"}</button>
                  {selectedItem.pin && <button onClick={() => void window.lumastage.unpinSceneItem(activeScene.id, selectedItem.id).then(applyWorkspace).catch((reason) => setError(String(reason)))}>Unpin</button>}
                  <button onClick={() => void window.lumastage.deleteSceneItem(activeScene.id, selectedItem.id).then(applyWorkspace).catch((reason) => setError(String(reason)))}>Delete</button>
                </div>
              </>}
            </> : <p className="empty-items">Add PNG, JPG or GIF props. Plugins can control the same item layer.</p>}
          </section>}
          <section className="panel model-panel"><small>ACTIVE MODEL</small><h2>{model?.vTubeModelName ?? model?.name ?? "No model loaded"}</h2><p>{model ? `${model.textureCount} textures · ${model.expressionCount} expressions · ${model.motionCount} motions${model.vTubeParameterMappings.length ? ` · ${model.vTubeParameterMappings.length} VTS mappings${model.hasCustomMappings ? " · tuned" : ""}` : ""}` : "Import a Cubism/VTube Studio model folder to begin."}</p>{model?.missingFiles.length ? <p className="error">Missing: {model.missingFiles.join(", ")}</p> : null}{coreStatus.installed && !coreStatus.compatible && <p className="error">Installed Cubism Core is incompatible with this renderer. Replace it with the official compatible 5.x build.</p>}<button className="primary" onClick={importModel}>＋ Import model folder</button>{model && <button className="secondary" onClick={() => setMappingEditorOpen(true)}>⌁ Edit tracking mappings</button>}{!coreStatus.available && <button className="secondary" disabled={coreInstalling} onClick={installCore}>{coreInstalling ? "Downloading from Live2D…" : coreStatus.installed ? "↻ Replace with compatible Cubism Core" : "↓ Install Cubism Core automatically"}</button>}{rendererError && <p className="error">{rendererError}</p>}{error && <p className="error">{error}</p>}</section>
          <section className="panel"><div className="panel-heading"><h3>Live signals</h3><span>{frame.sequence ? `#${frame.sequence}` : "idle"}</span></div><Meter label="Mouth" value={frame.blendShapes.jawOpen ?? 0} /><Meter label="Blink L" value={frame.blendShapes.eyeBlinkLeft ?? 0} /><Meter label="Blink R" value={frame.blendShapes.eyeBlinkRight ?? 0} /><Meter label="Smile" value={((frame.blendShapes.mouthSmileLeft ?? 0) + (frame.blendShapes.mouthSmileRight ?? 0)) / 2} /><button className="secondary" disabled={!frame.faceFound} onClick={() => setCalibrationNonce((value) => value + 1)}>◎ Calibrate neutral pose</button></section>
          {model?.vTubeHotkeys.length ? <section className="panel"><div className="panel-heading"><h3>Model hotkeys</h3><span>{model.vTubeHotkeys.length}</span></div><div className="hotkeys">{model.vTubeHotkeys.map((hotkey, index) => <button key={hotkey.id || `${hotkey.name}-${index}`} disabled={!hotkey.isActive} onClick={() => triggerHotkey(hotkey)}><span>{hotkeyDisplayName(hotkey)}</span><small>{hotkey.triggers.length ? hotkey.triggers.join(" + ") : hotkey.action}</small></button>)}</div></section> : null}
          <section className="panel hint"><div>⌁</div><p><b>Connect Tracker</b><br />Enter pairing code <strong>{status.pairingCode}</strong> on the iPhone. Only paired devices can stream.{status.trustedDevices > 0 && <button className="trust-reset" onClick={() => void window.lumastage.forgetTrustedDevices()}>Forget {status.trustedDevices} paired device{status.trustedDevices === 1 ? "" : "s"}</button>}</p></section>
          <section className="panel hint"><div>◫</div><p><b>Plugin API</b><br /><code>127.0.0.1:{status.vtsApiPort}</code> · {status.vtsApiActive ? "active" : "unavailable"}{status.allowedPlugins > 0 && <button className="trust-reset" onClick={() => void window.lumastage.forgetPluginAccess()}>Revoke {status.allowedPlugins} plugin permission{status.allowedPlugins === 1 ? "" : "s"}</button>}</p></section>
        </aside>
      </div>}
      {activeView === "models" && <ModelsView library={modelLibrary} model={model} onImport={() => void importModel()} onLoad={(modelID) => void loadLibraryModel(modelID)} />}
      {activeView === "tracking" && <TrackingView frame={frame} status={status} model={model} onCalibrate={() => setCalibrationNonce((value) => value + 1)} onEditMappings={() => setMappingEditorOpen(true)} />}
      {activeView === "settings" && <SettingsView coreStatus={coreStatus} coreInstalling={coreInstalling} status={status} onInstallCore={() => void installCore()} onForgetTrackers={() => void window.lumastage.forgetTrustedDevices()} onForgetPlugins={() => void window.lumastage.forgetPluginAccess()} />}
    </section>
    {(error || rendererError) && <div className="error-toast" role="alert">{error ?? rendererError}<button aria-label="Dismiss error" onClick={() => { setError(null); setRendererError(null); }}>×</button></div>}
    {mappingEditorOpen && model && <MappingEditor model={model} frame={frame} onClose={() => setMappingEditorOpen(false)} onSaved={(saved) => { setModel(saved); setMappingEditorOpen(false); }} />}
    {pluginRequests[0] && <div className="modal-backdrop"><section className="plugin-modal"><div className="plugin-mark">◫</div><small>PLUGIN API REQUEST</small><h2>Allow “{pluginRequests[0].pluginName}”?</h2><p>Developer: {pluginRequests[0].pluginDeveloper}</p><p className="modal-note">This local plugin will be able to read model/tracking state and trigger supported model hotkeys. You can revoke access later.</p><div><button className="secondary" onClick={() => void resolvePluginRequest(false)}>Deny</button><button className="primary" onClick={() => void resolvePluginRequest(true)}>Allow plugin</button></div></section></div>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
