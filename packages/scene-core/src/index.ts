import { z } from "zod";

export const gradientPresetSchema = z.enum(["violet", "sunset", "ocean", "studio", "transparent"]);
export type GradientPreset = z.infer<typeof gradientPresetSchema>;

export const sceneTransformSchema = z.object({
  scale: z.number().finite().min(0.2).max(3),
  positionX: z.number().finite().min(-1).max(1),
  positionY: z.number().finite().min(-1).max(1),
  rotation: z.number().finite().min(-180).max(180),
  mirror: z.boolean()
});

export const sceneBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gradient"), preset: gradientPresetSchema }),
  z.object({ kind: z.literal("color"), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ kind: z.literal("image"), imagePath: z.string().min(1).max(4096) })
]);

export const scenePresetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(48),
  background: sceneBackgroundSchema,
  transform: sceneTransformSchema,
  modelDirectory: z.string().min(1).max(4096).optional(),
  modelName: z.string().min(1).max(256).optional()
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
export type SceneLibrary = z.infer<typeof sceneLibrarySchema>;

export function createDefaultSceneLibrary(id: string): SceneLibrary {
  const scene: ScenePreset = {
    id,
    name: "Main Stage",
    background: { kind: "gradient", preset: "violet" },
    transform: { scale: 1, positionX: 0, positionY: 0, rotation: 0, mirror: false }
  };
  return sceneLibrarySchema.parse({ version: 1, activeSceneId: id, scenes: [scene] });
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
    positionX: clamp(input.positionX, current.positionX, -1, 1),
    positionY: clamp(input.positionY, current.positionY, -1, 1),
    rotation: clamp(input.rotation, current.rotation, -180, 180),
    mirror: typeof input.mirror === "boolean" ? input.mirror : current.mirror
  };
}
