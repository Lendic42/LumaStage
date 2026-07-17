import { z } from "zod";

export const LUMALINK_PROTOCOL = 1 as const;

const finiteNumber = z.number().finite();
const unitNumber = finiteNumber.min(0).max(1);

export const helloMessageSchema = z.object({
  type: z.literal("hello"),
  protocol: z.literal(LUMALINK_PROTOCOL),
  deviceId: z.string().min(1).max(128),
  deviceName: z.string().min(1).max(128),
  appVersion: z.string().min(1).max(32),
  token: z.string().max(256).optional()
});

export const trackingFrameSchema = z.object({
  type: z.literal("tracking"),
  protocol: z.literal(LUMALINK_PROTOCOL),
  sequence: z.number().int().nonnegative(),
  capturedAt: z.number().int().nonnegative(),
  faceFound: z.boolean(),
  head: z.object({
    pitch: finiteNumber,
    yaw: finiteNumber,
    roll: finiteNumber,
    positionX: finiteNumber,
    positionY: finiteNumber,
    positionZ: finiteNumber
  }),
  gaze: z.object({
    x: finiteNumber.min(-1).max(1),
    y: finiteNumber.min(-1).max(1)
  }),
  blendShapes: z.record(z.string().min(1).max(64), unitNumber)
});

export const helloAcceptedSchema = z.object({
  type: z.literal("hello-accepted"),
  protocol: z.literal(LUMALINK_PROTOCOL),
  deviceToken: z.string().min(32).max(256).optional()
});

export const pairingRequiredSchema = z.object({
  type: z.literal("pairing-required"),
  protocol: z.literal(LUMALINK_PROTOCOL),
  message: z.string().min(1).max(256)
});

export const lumaLinkMessageSchema = z.discriminatedUnion("type", [
  helloMessageSchema,
  trackingFrameSchema
]);

export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type TrackingFrame = z.infer<typeof trackingFrameSchema>;
export type LumaLinkMessage = z.infer<typeof lumaLinkMessageSchema>;
export type HelloAccepted = z.infer<typeof helloAcceptedSchema>;
export type PairingRequired = z.infer<typeof pairingRequiredSchema>;
export type LumaLinkServerMessage = HelloAccepted | PairingRequired;

export function parseLumaLinkMessage(input: string): LumaLinkMessage {
  if (input.length > 64 * 1024) {
    throw new Error("LumaLink message exceeds 64 KiB");
  }
  return lumaLinkMessageSchema.parse(JSON.parse(input));
}

export function parseLumaLinkServerMessage(input: string): LumaLinkServerMessage {
  if (input.length > 4 * 1024) throw new Error("LumaLink server message exceeds 4 KiB");
  const parsed = JSON.parse(input);
  return parsed.type === "hello-accepted" ? helloAcceptedSchema.parse(parsed) : pairingRequiredSchema.parse(parsed);
}
