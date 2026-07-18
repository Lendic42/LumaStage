import { z } from "zod";

export const gradientPresetSchema = z.enum(["violet", "sunset", "ocean", "studio", "transparent"]);
export type GradientPreset = z.infer<typeof gradientPresetSchema>;

export const sceneTransformSchema = z.object({
  scale: z.number().finite().min(0.2).max(3),
  positionX: z.number().finite().min(-1000).max(1000),
  positionY: z.number().finite().min(-1000).max(1000),
  rotation: z.number().finite().min(-180).max(180),
  mirror: z.boolean()
});

export const sceneBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gradient"), preset: gradientPresetSchema }),
  z.object({ kind: z.literal("color"), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ kind: z.literal("image"), imagePath: z.string().min(1).max(4096) })
]);

export const sceneItemPinSchema = z.object({
  modelID: z.string().min(1).max(256),
  artMeshID: z.string().min(1).max(256),
  angleRelativeTo: z.enum(["RelativeToWorld", "RelativeToModel", "RelativeToPinPosition"]),
  angle: z.number().finite().min(-3600).max(3600),
  vertexID1: z.number().int().nonnegative(),
  vertexID2: z.number().int().nonnegative(),
  vertexID3: z.number().int().nonnegative(),
  vertexWeight1: z.number().finite().min(0).max(1),
  vertexWeight2: z.number().finite().min(0).max(1),
  vertexWeight3: z.number().finite().min(0).max(1)
}).refine((pin) => Math.abs(pin.vertexWeight1 + pin.vertexWeight2 + pin.vertexWeight3 - 1) <= 1e-5, {
  message: "Pin vertex weights must add up to one"
});

export const sceneItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().min(1).max(256),
  filePath: z.string().min(1).max(4096),
  type: z.enum(["PNG", "JPG", "GIF"]),
  positionX: z.number().finite().min(-1000).max(1000),
  positionY: z.number().finite().min(-1000).max(1000),
  size: z.number().finite().min(0).max(1),
  rotation: z.number().finite().min(-3600).max(3600),
  order: z.number().int().min(-30).max(30).refine((value) => value !== 0),
  flipped: z.boolean(),
  locked: z.boolean(),
  censored: z.boolean(),
  smoothing: z.number().finite().min(0).max(1),
  opacity: z.number().finite().min(0).max(1).default(1),
  pin: sceneItemPinSchema.optional(),
  unloadWhenPluginDisconnects: z.boolean().default(false),
  ownerKey: z.string().max(128).optional(),
  ownerSessionID: z.string().max(128).optional()
});

export const scenePresetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(48),
  background: sceneBackgroundSchema,
  transform: sceneTransformSchema,
  items: z.array(sceneItemSchema).max(60).default([]),
  modelDirectory: z.string().min(1).max(4096).optional(),
  modelName: z.string().min(1).max(256).optional()
}).superRefine((scene, context) => {
  if (new Set(scene.items.map((item) => item.id)).size !== scene.items.length) context.addIssue({ code: "custom", path: ["items"], message: "Item IDs must be unique" });
  if (new Set(scene.items.map((item) => item.order)).size !== scene.items.length) context.addIssue({ code: "custom", path: ["items"], message: "Item orders must be unique" });
});

export const sceneLibrarySchema = z.object({
  version: z.literal(1),
  activeSceneId: z.string().uuid(),
  scenes: z.array(scenePresetSchema).min(1).max(64)
}).superRefine((library, context) => {
  if (!library.scenes.some((scene) => scene.id === library.activeSceneId)) {
    context.addIssue({ code: "custom", path: ["activeSceneId"], message: "Active scene must exist" });
  }
  if (new Set(library.scenes.map((scene) => scene.id)).size !== library.scenes.length) {
    context.addIssue({ code: "custom", path: ["scenes"], message: "Scene IDs must be unique" });
  }
});

export type SceneTransform = z.infer<typeof sceneTransformSchema>;
export type SceneBackground = z.infer<typeof sceneBackgroundSchema>;
export type ScenePreset = z.infer<typeof scenePresetSchema>;
export type SceneItem = z.infer<typeof sceneItemSchema>;
export type SceneItemPin = z.infer<typeof sceneItemPinSchema>;
export type SceneLibrary = z.infer<typeof sceneLibrarySchema>;

export function createDefaultSceneLibrary(id: string): SceneLibrary {
  const scene: ScenePreset = {
    id,
    name: "Main Stage",
    background: { kind: "gradient", preset: "violet" },
    transform: { scale: 1, positionX: 0, positionY: 0, rotation: 0, mirror: false },
    items: []
  };
  return sceneLibrarySchema.parse({ version: 1, activeSceneId: id, scenes: [scene] });
}

export function normalizeSceneItemTransform(input: Partial<Pick<SceneItem, "positionX" | "positionY" | "size" | "rotation" | "flipped" | "locked" | "opacity">>, current: SceneItem): SceneItem {
  const clamp = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    ...current,
    positionX: clamp(input.positionX, current.positionX, -1000, 1000),
    positionY: clamp(input.positionY, current.positionY, -1000, 1000),
    size: clamp(input.size, current.size, 0, 1),
    rotation: clamp(input.rotation, current.rotation, -3600, 3600),
    opacity: clamp(input.opacity, current.opacity, 0, 1),
    flipped: typeof input.flipped === "boolean" ? input.flipped : current.flipped,
    locked: typeof input.locked === "boolean" ? input.locked : current.locked
  };
}

export function parseSceneLibrary(input: unknown, fallbackId: string): SceneLibrary {
  const parsed = sceneLibrarySchema.safeParse(input);
  return parsed.success ? parsed.data : createDefaultSceneLibrary(fallbackId);
}

export function normalizeSceneTransform(input: Partial<SceneTransform>, current: SceneTransform): SceneTransform {
  const clamp = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    scale: clamp(input.scale, current.scale, 0.2, 3),
    positionX: clamp(input.positionX, current.positionX, -1000, 1000),
    positionY: clamp(input.positionY, current.positionY, -1000, 1000),
    rotation: clamp(input.rotation, current.rotation, -180, 180),
    mirror: typeof input.mirror === "boolean" ? input.mirror : current.mirror
  };
}
