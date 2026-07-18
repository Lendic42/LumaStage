import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import type { Live2DModel as Live2DModelType, Cubism4InternalModel } from "pixi-live2d-display/cubism4";
import { TrackingEngine } from "@lumastage/tracking-core";
import type { TrackingFrame } from "@lumastage/protocol";
import type { ImportedHotkey, ImportedModel, SceneTransform, VtsParameterInjection } from "../../shared/bridge";

interface Props {
  model: ImportedModel | null;
  frame: TrackingFrame;
  calibrationNonce: number;
  hotkeyRequest: { nonce: number; hotkey: ImportedHotkey } | null;
  parameterInjection: { nonce: number; value: VtsParameterInjection } | null;
  sceneTransform: SceneTransform;
  onReady(ready: boolean): void;
  onError(message: string | null): void;
}

let coreLoadPromise: Promise<void> | undefined;

function hasCubismCore(): boolean {
  return "Live2DCubismCore" in window;
}

function loadCubismCore(): Promise<void> {
  if (hasCubismCore()) return Promise.resolve();
  if (coreLoadPromise) return coreLoadPromise;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "lumastage-core://runtime/live2dcubismcore.min.js";
    script.onload = () => hasCubismCore() ? resolve() : reject(new Error("Cubism Core loaded without its expected global API"));
    script.onerror = () => reject(new Error("Install the official Live2D Cubism Core for Web to render this model"));
    document.head.appendChild(script);
  }).catch((error): never => {
    coreLoadPromise = undefined;
    throw error;
  });
  coreLoadPromise = loading;
  return loading;
}

export function Live2DStage({ model: imported, frame, calibrationNonce, hotkeyRequest, parameterInjection, sceneTransform, onReady, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef(new TrackingEngine());
  const hotkeyHandlerRef = useRef<((hotkey: ImportedHotkey) => Promise<void>) | null>(null);
  const sceneTransformRef = useRef(sceneTransform);
  const fitHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    sceneTransformRef.current = sceneTransform;
    fitHandlerRef.current?.();
  }, [sceneTransform]);

  useEffect(() => {
    engineRef.current.ingest(frame);
  }, [frame]);

  useEffect(() => {
    engineRef.current.setVTubeParameterMappings(imported?.vTubeParameterMappings ?? []);
  }, [imported]);

  useEffect(() => {
    if (calibrationNonce > 0) engineRef.current.calibrate();
  }, [calibrationNonce]);

  useEffect(() => {
    if (!hotkeyRequest) return;
    if (!hotkeyHandlerRef.current) {
      onError("Model renderer is not ready for hotkeys");
      return;
    }
    void hotkeyHandlerRef.current(hotkeyRequest.hotkey).catch((reason) => {
      onError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [hotkeyRequest, onError]);

  useEffect(() => {
    if (!parameterInjection) return;
    engineRef.current.injectVTubeParameters(parameterInjection.value.parameters, parameterInjection.value.mode);
  }, [parameterInjection]);

  useEffect(() => {
    if (!imported || !canvasRef.current || !containerRef.current) {
      onReady(false);
      return;
    }

    let disposed = false;
    let app: Application | undefined;
    let liveModel: Live2DModelType<Cubism4InternalModel> | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const start = async () => {
      onReady(false);
      onError(null);
      await loadCubismCore();
      const { Live2DModel } = await import("pixi-live2d-display/cubism4");
      if (disposed || !canvasRef.current || !containerRef.current) return;

      app = new Application({
        view: canvasRef.current,
        resizeTo: containerRef.current,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2)
      });

      liveModel = await Live2DModel.from(imported.manifestUrl, {
        autoUpdate: false,
        autoFocus: false,
        autoHitTest: true
      }) as Live2DModelType<Cubism4InternalModel>;
      if (disposed || !app) {
        liveModel.destroy({ children: true, texture: true, baseTexture: true });
        return;
      }

      const fit = () => {
        if (!liveModel || !containerRef.current) return;
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        const sourceWidth = liveModel.internalModel.width;
        const sourceHeight = liveModel.internalModel.height;
        const transform = sceneTransformRef.current;
        const scale = Math.min(width / sourceWidth, height / sourceHeight) * 0.88 * transform.scale;
        liveModel.scale.set(transform.mirror ? -scale : scale, scale);
        liveModel.anchor.set(0.5, 0.5);
        liveModel.position.set(width / 2 + width * transform.positionX * 0.5, height / 2 + height * (0.04 + transform.positionY * 0.5));
        liveModel.rotation = transform.rotation * Math.PI / 180;
      };
      fitHandlerRef.current = fit;

      const eventedInternalModel = liveModel.internalModel as Cubism4InternalModel & {
        on(event: "beforeModelUpdate", listener: () => void): void;
      };
      eventedInternalModel.on("beforeModelUpdate", () => {
        const values = engineRef.current.tick();
        for (const [parameterId, value] of Object.entries(values)) {
          liveModel?.internalModel.coreModel.setParameterValueById(parameterId, value);
        }
      });
      app.ticker.add(() => liveModel?.update(app?.ticker.deltaMS ?? 16.67));
      liveModel.on("hit", (areas: string[]) => {
        if (areas.length > 0) void liveModel?.motion("TapBody");
      });
      app.stage.addChild(liveModel);
      hotkeyHandlerRef.current = async (hotkey) => {
        if (!liveModel) throw new Error("Model renderer is not ready");
        const action = hotkey.action.toLowerCase();
        const requestedFile = hotkey.file.replaceAll("\\", "/").split("/").pop()?.toLowerCase();
        if (action.includes("expression")) {
          const expression = imported.expressions.find((item) => {
            const file = item.file.replaceAll("\\", "/").split("/").pop()?.toLowerCase();
            return file === requestedFile || item.name.toLowerCase() === hotkey.file.toLowerCase();
          });
          if (!expression) throw new Error(`Expression for hotkey “${hotkey.name}” was not found`);
          await liveModel.expression(expression.name);
          return;
        }
        if (action.includes("animation") || action.includes("motion")) {
          for (const [group, files] of Object.entries(imported.motionGroups)) {
            const index = files.findIndex((file) => file.replaceAll("\\", "/").split("/").pop()?.toLowerCase() === requestedFile);
            if (index >= 0) {
              await liveModel.motion(group, index, 3);
              return;
            }
          }
          throw new Error(`Motion for hotkey “${hotkey.name}” was not found`);
        }
        throw new Error(`VTube Studio hotkey action “${hotkey.action}” is not supported yet`);
      };
      resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(containerRef.current);
      fit();
      onReady(true);
    };

    void start().catch((reason) => {
      if (!disposed) {
        onReady(false);
        onError(reason instanceof Error ? reason.message : String(reason));
      }
    });

    return () => {
      disposed = true;
      hotkeyHandlerRef.current = null;
      fitHandlerRef.current = null;
      resizeObserver?.disconnect();
      if (liveModel && !liveModel.destroyed) liveModel.destroy({ children: true, texture: true, baseTexture: true });
      app?.destroy(false, { children: false, texture: false, baseTexture: false });
    };
  }, [imported, onError, onReady]);

  return <div ref={containerRef} className="live2d-layer"><canvas ref={canvasRef} /></div>;
}
