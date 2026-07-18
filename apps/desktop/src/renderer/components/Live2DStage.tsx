import { useEffect, useRef } from "react";
import { Application, ENV, Point, settings } from "pixi.js";
import "@pixi/unsafe-eval";
import type { Live2DModel as Live2DModelType, Cubism4InternalModel } from "pixi-live2d-display/cubism4";
import { TrackingEngine } from "@lumastage/tracking-core";
import type { TrackingFrame } from "@lumastage/protocol";
import type { ImportedHotkey, ImportedModel, SceneItem, SceneTransform, VtsArtMeshTintState, VtsExpressionActivation, VtsModelMoveAnimation, VtsParameterInjection, VtsPhysicsControl } from "../../shared/bridge";

interface Props {
  model: ImportedModel | null;
  frame: TrackingFrame;
  calibrationNonce: number;
  hotkeyRequest: { nonce: number; hotkey: ImportedHotkey } | null;
  parameterInjection: { nonce: number; value: VtsParameterInjection } | null;
  expressionRequest: { nonce: number; value: VtsExpressionActivation } | null;
  artMeshTint: VtsArtMeshTintState;
  physicsControl: VtsPhysicsControl;
  modelMove: { nonce: number; value: VtsModelMoveAnimation } | null;
  sceneTransform: SceneTransform;
  pinnedItems: SceneItem[];
  onPinnedItemLayout(itemID: string, layout: { x: number; y: number; rotation: number }): void;
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

export function Live2DStage({ model: imported, frame, calibrationNonce, hotkeyRequest, parameterInjection, expressionRequest, artMeshTint, physicsControl, modelMove, sceneTransform, pinnedItems, onPinnedItemLayout, onReady, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef(new TrackingEngine());
  const hotkeyHandlerRef = useRef<((hotkey: ImportedHotkey) => Promise<void>) | null>(null);
  const expressionHandlerRef = useRef<((activation: VtsExpressionActivation) => Promise<void>) | null>(null);
  const sceneTransformRef = useRef(sceneTransform);
  const fitHandlerRef = useRef<(() => void) | null>(null);
  const artMeshTintRef = useRef(artMeshTint);
  const physicsControlRef = useRef(physicsControl);
  const pinnedItemsRef = useRef(pinnedItems);
  const pinnedLayoutHandlerRef = useRef(onPinnedItemLayout);

  useEffect(() => { artMeshTintRef.current = artMeshTint; }, [artMeshTint]);
  useEffect(() => { physicsControlRef.current = physicsControl; }, [physicsControl]);
  useEffect(() => { pinnedItemsRef.current = pinnedItems; }, [pinnedItems]);
  useEffect(() => { pinnedLayoutHandlerRef.current = onPinnedItemLayout; }, [onPinnedItemLayout]);

  useEffect(() => {
    sceneTransformRef.current = sceneTransform;
    fitHandlerRef.current?.();
  }, [sceneTransform]);

  useEffect(() => {
    if (!modelMove) return;
    const { from, to, durationMs } = modelMove.value;
    if (durationMs <= 0) {
      sceneTransformRef.current = to;
      fitHandlerRef.current?.();
      return;
    }
    const startedAt = performance.now();
    let animationFrame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const interpolate = (start: number, end: number) => start + (end - start) * eased;
      sceneTransformRef.current = {
        scale: interpolate(from.scale, to.scale), positionX: interpolate(from.positionX, to.positionX),
        positionY: interpolate(from.positionY, to.positionY), rotation: interpolate(from.rotation, to.rotation), mirror: to.mirror
      };
      fitHandlerRef.current?.();
      if (progress < 1) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [modelMove]);

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
    if (!expressionRequest) return;
    if (!expressionHandlerRef.current) {
      onError("Model renderer is not ready for expressions");
      return;
    }
    void expressionHandlerRef.current(expressionRequest.value).catch((reason) => onError(reason instanceof Error ? reason.message : String(reason)));
  }, [expressionRequest, onError]);

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

      // Some Intel/virtualized WebGL drivers report zero texture units during Pixi's
      // dynamic shader probe. Live2D uses its own renderer, so the reliable single-
      // texture batch path avoids that invalid probe without affecting Cubism drawables.
      settings.PREFER_ENV = ENV.WEBGL_LEGACY;

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
      const artMeshNames = liveModel.internalModel.getDrawableIDs();
      const cubismModel = liveModel.internalModel.coreModel as unknown as {
        getDrawableVertexCount(drawableIndex: number): number;
        getDrawableVertexIndices(drawableIndex: number): Uint16Array;
      };
      await window.lumastage.reportArtMeshes(imported.directory, artMeshNames.map((id, drawableIndex) => ({
        id,
        vertexCount: cubismModel.getDrawableVertexCount(drawableIndex),
        indices: Array.from(cubismModel.getDrawableVertexIndices(drawableIndex))
      })));
      const core = liveModel.internalModel.coreModel as unknown as { getModel(): { drawables: { multiplyColors?: Float32Array } } };
      const drawables = core.getModel().drawables;
      const physics = liveModel.internalModel.physics as unknown as {
        getOption?(): { wind: { x: number; y: number } };
        setOptions?(options: { wind: { x: number; y: number } }): void;
        _physicsRig?: {
          settings: Array<{ baseOutputIndex: number; outputCount: number }>;
          outputs: Array<{ weight: number }>;
        };
      } | undefined;
      const defaultPhysicsWeights = physics?._physicsRig?.outputs.map((output) => output.weight) ?? [];
      app.ticker.add(() => {
        liveModel?.update(app?.ticker.deltaMS ?? 16.67);
        if (!liveModel) return;
        const colors = drawables.multiplyColors;
        if (colors) for (let index = 0; index < artMeshNames.length; index += 1) {
          const color = artMeshTintRef.current.artMeshColors[artMeshNames[index]] ?? { colorR: 255, colorG: 255, colorB: 255, colorA: 255 };
          colors[index * 4] = color.colorR / 255;
          colors[index * 4 + 1] = color.colorG / 255;
          colors[index * 4 + 2] = color.colorB / 255;
          colors[index * 4 + 3] = color.colorA / 255;
        }
        if (physics) {
          const control = physicsControlRef.current;
          const options = physics.getOption?.();
          if (options) {
            options.wind.x = control.baseWind / 100;
            physics.setOptions?.(options);
          }
          const rig = physics._physicsRig;
          if (rig) rig.settings.forEach((setting, groupIndex) => {
            const group = imported.physicsGroups[groupIndex];
            const groupControl = group ? control.groups[group.id] : undefined;
            const multiplier = (groupControl?.strengthMultiplier ?? 1) * (control.baseWind > 0 ? groupControl?.windMultiplier ?? 1 : 1);
            for (let offset = 0; offset < setting.outputCount; offset += 1) {
              const outputIndex = setting.baseOutputIndex + offset;
              if (rig.outputs[outputIndex]) rig.outputs[outputIndex].weight = (defaultPhysicsWeights[outputIndex] ?? rig.outputs[outputIndex].weight) * (control.baseStrength / 50) * multiplier;
            }
          });
        }
        for (const item of pinnedItemsRef.current) {
          const pin = item.pin;
          if (!pin) continue;
          let vertices: Float32Array;
          try { vertices = liveModel.internalModel.getDrawableVertices(pin.artMeshID); } catch { continue; }
          const ids = [pin.vertexID1, pin.vertexID2, pin.vertexID3];
          if (ids.some((vertexID) => vertexID * 2 + 1 >= vertices.length)) continue;
          const weights = [pin.vertexWeight1, pin.vertexWeight2, pin.vertexWeight3];
          const localX = ids.reduce((sum, vertexID, index) => sum + vertices[vertexID * 2] * weights[index], 0);
          const localY = ids.reduce((sum, vertexID, index) => sum + vertices[vertexID * 2 + 1] * weights[index], 0);
          const point = liveModel.toGlobal(new Point(localX, localY));
          const first = liveModel.toGlobal(new Point(vertices[ids[0] * 2], vertices[ids[0] * 2 + 1]));
          const second = liveModel.toGlobal(new Point(vertices[ids[1] * 2], vertices[ids[1] * 2 + 1]));
          const pinAngle = Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI;
          const rotation = pin.angleRelativeTo === "RelativeToModel"
            ? pin.angle + sceneTransformRef.current.rotation
            : pin.angleRelativeTo === "RelativeToPinPosition" ? pin.angle + pinAngle : pin.angle;
          pinnedLayoutHandlerRef.current(item.id, { x: point.x, y: point.y, rotation });
        }
      });
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
          if (hotkey.motionGroup !== undefined && hotkey.motionIndex !== undefined) {
            const started = await liveModel.motion(hotkey.motionGroup, hotkey.motionIndex, 3);
            if (!started) throw new Error(`Motion for hotkey “${hotkey.name || hotkey.file}” could not be started`);
            return;
          }
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
      expressionHandlerRef.current = async (activation) => {
        if (!liveModel) throw new Error("Model renderer is not ready");
        const requested = activation.file.replaceAll("\\", "/").split("/").pop()?.toLowerCase();
        const expression = imported.expressions.find((item) => item.file.replaceAll("\\", "/").split("/").pop()?.toLowerCase() === requested);
        if (!expression) throw new Error(`Expression “${activation.file}” was not found`);
        if (activation.active) {
          await liveModel.expression(expression.name);
        } else {
          const internal = liveModel.internalModel as Cubism4InternalModel & { motionManager: { expressionManager?: { resetExpression(): void } } };
          internal.motionManager.expressionManager?.resetExpression();
        }
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
      expressionHandlerRef.current = null;
      fitHandlerRef.current = null;
      resizeObserver?.disconnect();
      if (liveModel && !liveModel.destroyed) liveModel.destroy({ children: true, texture: true, baseTexture: true });
      app?.destroy(false, { children: false, texture: false, baseTexture: false });
    };
  }, [imported, onError, onReady]);

  return <div ref={containerRef} className="live2d-layer"><canvas ref={canvasRef} /></div>;
}
