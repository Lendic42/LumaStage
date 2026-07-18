import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TrackingFrame } from "@lumastage/protocol";
import type { DesktopStatus, ImportedHotkey, ImportedModel, LumaStageBridge, PluginAuthorizationRequest, SceneLibrary, SceneTransform, SceneUpdate, SceneWorkspace, VtsParameterInjection } from "../shared/bridge";
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
  const transform = `translate(${frame.head.yaw * 42}px, ${frame.head.pitch * 32}px) rotate(${frame.head.roll * -35}deg)`;
  return (
    <div className="avatar-wrap" style={{ transform }}>
      <div className="avatar-halo" />
      <div className="avatar-hair" />
      <div className="avatar-face">
        <div className="eye left" style={{ transform: `scaleY(${Math.max(0.08, 1 - blinkLeft)})` }}><i /></div>
        <div className="eye right" style={{ transform: `scaleY(${Math.max(0.08, 1 - blinkRight)})` }}><i /></div>
        <div className="mouth" style={{ height: 5 + jaw * 30, width: 28 + jaw * 10 }} />
      </div>
      <div className="avatar-body" />
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(1, value));
  return <div className="meter"><span>{label}</span><div><i style={{ width: `${normalized * 100}%` }} /></div><b>{normalized.toFixed(2)}</b></div>;
}

function App() {
  const [frame, setFrame] = useState(neutral);
  const [status, setStatus] = useState<DesktopStatus>({ port: 39510, connectedDevices: 0, pairingCode: "------", trustedDevices: 0, vtsApiPort: 8001, vtsApiActive: false, allowedPlugins: 0 });
  const [model, setModel] = useState<ImportedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [coreStatus, setCoreStatus] = useState<CubismCoreStatus>({ available: false });
  const [calibrationNonce, setCalibrationNonce] = useState(0);
  const [overlayMode, setOverlayMode] = useState(false);
  const [hotkeyRequest, setHotkeyRequest] = useState<{ nonce: number; hotkey: ImportedHotkey } | null>(null);
  const [pluginRequests, setPluginRequests] = useState<PluginAuthorizationRequest[]>([]);
  const [parameterInjection, setParameterInjection] = useState<{ nonce: number; value: VtsParameterInjection } | null>(null);
  const [sceneLibrary, setSceneLibrary] = useState<SceneLibrary | null>(null);

  useEffect(() => {
    const offFrame = window.lumastage.onTrackingFrame(setFrame);
    const offStatus = window.lumastage.onDesktopStatus(setStatus);
    const offPluginRequest = window.lumastage.onPluginAuthorizationRequest((request) => setPluginRequests((items) => [...items, request]));
    const offVtsHotkey = window.lumastage.onVtsHotkeyTrigger((hotkey) => setHotkeyRequest({ nonce: Date.now(), hotkey }));
    const offParameterInjection = window.lumastage.onVtsParameterInjection((value) => setParameterInjection({ nonce: Date.now(), value }));
    void window.lumastage.getCubismCoreStatus().then(setCoreStatus);
    void window.lumastage.getSceneWorkspace().then((workspace) => { setSceneLibrary(workspace.library); setModel(workspace.model); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { offFrame(); offStatus(); offPluginRequest(); offVtsHotkey(); offParameterInjection(); };
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
  const applyWorkspace = (workspace: SceneWorkspace) => { setSceneLibrary(workspace.library); setModel(workspace.model); };
  const updateActiveScene = async (update: SceneUpdate) => {
    if (!activeScene) return;
    try { applyWorkspace(await window.lumastage.updateScene(activeScene.id, update)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const importModel = async () => {
    setError(null);
    try {
      const imported = await window.lumastage.importModel();
      setModel(imported);
      if (imported) applyWorkspace(await window.lumastage.getSceneWorkspace());
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const installCore = async () => {
    setRendererError(null);
    try {
      const status = await window.lumastage.installCubismCore();
      if (status) {
        setCoreStatus(status);
        if (model) setModel({ ...model });
      }
    } catch (reason) {
      setRendererError(reason instanceof Error ? reason.message : String(reason));
    }
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
      <nav><button className="active">◈<span>Stage</span></button><button>◇<span>Models</span></button><button>⌁<span>Tracking</span></button><button>⚙<span>Settings</span></button></nav>
      <div className="version">v0.1</div>
    </aside>

    <section className="workspace">
      <header><div><small>LIVE WORKSPACE</small><h1>Stage</h1></div><div className={`connection ${status.connectedDevices ? "online" : ""}`}><i />{connectionLabel}<span>:{status.port}</span></div></header>
      <div className="stage-grid">
        <section className="stage-card">
          <div className="stage-toolbar"><span>{activeScene?.name ?? "Main Stage"} · {model?.name ?? "Preview avatar"}</span><div><button onClick={() => void updateActiveScene({ transform: neutralSceneTransform })}>⌖ Fit</button><button onClick={() => void toggleOverlay()}>{overlayMode ? "Exit overlay" : "▣ Transparent"}</button></div></div>
          <div className="stage" style={stageStyle}><div className="grid" />{!rendererReady && <AvatarPreview frame={frame} />}<Live2DStage model={model} frame={frame} calibrationNonce={calibrationNonce} hotkeyRequest={hotkeyRequest} parameterInjection={parameterInjection} sceneTransform={activeScene?.transform ?? neutralSceneTransform} onReady={setRendererReady} onError={setRendererError} /><div className="tracking-pill"><i className={frame.faceFound ? "online" : ""} />{frame.faceFound ? "Face tracked" : rendererReady ? "Model ready" : "Neutral preview"}</div>{overlayMode && <button className="exit-overlay" onClick={() => void toggleOverlay(false)}>Exit overlay · Esc</button>}</div>
        </section>

        <aside className="inspector">
          {activeScene && <section className="panel scene-panel"><div className="panel-heading"><h3>Scenes</h3><button className="tiny-add" onClick={() => void window.lumastage.createScene().then(applyWorkspace).catch((reason) => setError(String(reason)))}>＋ New</button></div><div className="scene-tabs">{sceneLibrary?.scenes.map((scene) => <button key={scene.id} className={scene.id === activeScene.id ? "active" : ""} onClick={() => void window.lumastage.activateScene(scene.id).then(applyWorkspace).catch((reason) => setError(String(reason)))}>{scene.name}</button>)}</div><label className="scene-name">Scene name<input value={activeScene.name} maxLength={48} onChange={(event) => setSceneLibrary((library) => library ? { ...library, scenes: library.scenes.map((scene) => scene.id === activeScene.id ? { ...scene, name: event.target.value } : scene) } : library)} onBlur={(event) => void updateActiveScene({ name: event.target.value || "Scene" })} /></label><div className="background-row"><button className="bg-dot violet" title="Violet" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "violet" } })} /><button className="bg-dot sunset" title="Sunset" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "sunset" } })} /><button className="bg-dot ocean" title="Ocean" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "ocean" } })} /><button className="bg-dot studio" title="Studio" onClick={() => void updateActiveScene({ background: { kind: "gradient", preset: "studio" } })} /><input aria-label="Scene background color" type="color" value={activeScene.background.kind === "color" ? activeScene.background.color : "#29233f"} onChange={(event) => void updateActiveScene({ background: { kind: "color", color: event.target.value } })} /><button className="image-pick" onClick={() => void window.lumastage.chooseSceneBackground(activeScene.id).then((workspace) => workspace && applyWorkspace(workspace)).catch((reason) => setError(String(reason)))}>▧ Image</button></div><div className="transform-grid"><label>Scale <b>{activeScene.transform.scale.toFixed(2)}×</b><input type="range" min="0.2" max="3" step="0.01" value={activeScene.transform.scale} onChange={(event) => void updateActiveScene({ transform: { scale: Number(event.target.value) } })} /></label><label>X <b>{Math.round(activeScene.transform.positionX * 100)}</b><input type="range" min="-1" max="1" step="0.01" value={activeScene.transform.positionX} onChange={(event) => void updateActiveScene({ transform: { positionX: Number(event.target.value) } })} /></label><label>Y <b>{Math.round(activeScene.transform.positionY * 100)}</b><input type="range" min="-1" max="1" step="0.01" value={activeScene.transform.positionY} onChange={(event) => void updateActiveScene({ transform: { positionY: Number(event.target.value) } })} /></label><label>Rotate <b>{Math.round(activeScene.transform.rotation)}°</b><input type="range" min="-180" max="180" step="1" value={activeScene.transform.rotation} onChange={(event) => void updateActiveScene({ transform: { rotation: Number(event.target.value) } })} /></label></div><div className="scene-actions"><button className={activeScene.transform.mirror ? "active" : ""} onClick={() => void updateActiveScene({ transform: { mirror: !activeScene.transform.mirror } })}>⇋ Mirror</button><button disabled={(sceneLibrary?.scenes.length ?? 0) < 2} onClick={() => void window.lumastage.deleteScene(activeScene.id).then(applyWorkspace).catch((reason) => setError(String(reason)))}>Delete</button></div></section>}
          <section className="panel model-panel"><small>ACTIVE MODEL</small><h2>{model?.vTubeModelName ?? model?.name ?? "No model loaded"}</h2><p>{model ? `${model.textureCount} textures · ${model.expressionCount} expressions · ${model.motionCount} motions${model.vTubeParameterMappings.length ? ` · ${model.vTubeParameterMappings.length} VTS mappings` : ""}` : "Import a Cubism/VTube Studio model folder to begin."}</p>{model?.missingFiles.length ? <p className="error">Missing: {model.missingFiles.join(", ")}</p> : null}<button className="primary" onClick={importModel}>＋ Import model folder</button>{!coreStatus.available && <button className="secondary" onClick={installCore}>Install official Cubism Core</button>}{rendererError && <p className="error">{rendererError}</p>}{error && <p className="error">{error}</p>}</section>
          <section className="panel"><div className="panel-heading"><h3>Live signals</h3><span>{frame.sequence ? `#${frame.sequence}` : "idle"}</span></div><Meter label="Mouth" value={frame.blendShapes.jawOpen ?? 0} /><Meter label="Blink L" value={frame.blendShapes.eyeBlinkLeft ?? 0} /><Meter label="Blink R" value={frame.blendShapes.eyeBlinkRight ?? 0} /><Meter label="Smile" value={((frame.blendShapes.mouthSmileLeft ?? 0) + (frame.blendShapes.mouthSmileRight ?? 0)) / 2} /><button className="secondary" disabled={!frame.faceFound} onClick={() => setCalibrationNonce((value) => value + 1)}>◎ Calibrate neutral pose</button></section>
          {model?.vTubeHotkeys.length ? <section className="panel"><div className="panel-heading"><h3>Model hotkeys</h3><span>{model.vTubeHotkeys.length}</span></div><div className="hotkeys">{model.vTubeHotkeys.map((hotkey, index) => <button key={hotkey.id || `${hotkey.name}-${index}`} onClick={() => triggerHotkey(hotkey)}><span>{hotkey.name || hotkey.action}</span><small>{hotkey.action}</small></button>)}</div></section> : null}
          <section className="panel hint"><div>⌁</div><p><b>Connect Tracker</b><br />Enter pairing code <strong>{status.pairingCode}</strong> on the iPhone. Only paired devices can stream.{status.trustedDevices > 0 && <button className="trust-reset" onClick={() => void window.lumastage.forgetTrustedDevices()}>Forget {status.trustedDevices} paired device{status.trustedDevices === 1 ? "" : "s"}</button>}</p></section>
          <section className="panel hint"><div>◫</div><p><b>Plugin API</b><br /><code>127.0.0.1:{status.vtsApiPort}</code> · {status.vtsApiActive ? "active" : "unavailable"}{status.allowedPlugins > 0 && <button className="trust-reset" onClick={() => void window.lumastage.forgetPluginAccess()}>Revoke {status.allowedPlugins} plugin permission{status.allowedPlugins === 1 ? "" : "s"}</button>}</p></section>
        </aside>
      </div>
    </section>
    {pluginRequests[0] && <div className="modal-backdrop"><section className="plugin-modal"><div className="plugin-mark">◫</div><small>PLUGIN API REQUEST</small><h2>Allow “{pluginRequests[0].pluginName}”?</h2><p>Developer: {pluginRequests[0].pluginDeveloper}</p><p className="modal-note">This local plugin will be able to read model/tracking state and trigger supported model hotkeys. You can revoke access later.</p><div><button className="secondary" onClick={() => void resolvePluginRequest(false)}>Deny</button><button className="primary" onClick={() => void resolvePluginRequest(true)}>Allow plugin</button></div></section></div>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
