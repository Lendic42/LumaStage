import { describe, expect, it } from "vitest";
import { LUMALINK_PROTOCOL, parseLumaLinkMessage, parseLumaLinkServerMessage } from "../src/index.js";

describe("LumaLink protocol", () => {
  it("accepts a valid tracking frame", () => {
    const frame = parseLumaLinkMessage(JSON.stringify({
      type: "tracking",
      protocol: LUMALINK_PROTOCOL,
      sequence: 7,
      capturedAt: 1234,
      faceFound: true,
      head: { pitch: 0.1, yaw: -0.2, roll: 0, positionX: 0, positionY: 0, positionZ: -0.4 },
      gaze: { x: 0.25, y: -0.1 },
      blendShapes: { jawOpen: 0.72, eyeBlinkLeft: 0.1 }
    }));

    expect(frame.type).toBe("tracking");
  });

  it("rejects coefficients outside the ARKit unit range", () => {
    expect(() => parseLumaLinkMessage(JSON.stringify({
      type: "tracking",
      protocol: 1,
      sequence: 1,
      capturedAt: 1,
      faceFound: true,
      head: { pitch: 0, yaw: 0, roll: 0, positionX: 0, positionY: 0, positionZ: 0 },
      gaze: { x: 0, y: 0 },
      blendShapes: { jawOpen: 1.5 }
    }))).toThrow();
  });

  it("rejects unsupported protocol versions", () => {
    expect(() => parseLumaLinkMessage(JSON.stringify({
      type: "hello", protocol: 99, deviceId: "phone", deviceName: "iPhone", appVersion: "1.0"
    }))).toThrow();
  });

  it("rejects messages larger than 64 KiB before parsing", () => {
    expect(() => parseLumaLinkMessage(" ".repeat(64 * 1024 + 1))).toThrow(/64 KiB/);
  });
});

describe("LumaLink server messages", () => {
  it("accepts a pairing response with a durable device token", () => {
    const message = parseLumaLinkServerMessage(JSON.stringify({
      type: "hello-accepted",
      protocol: 1,
      deviceToken: "a".repeat(64)
    }));
    expect(message.type).toBe("hello-accepted");
  });

  it("rejects unknown server messages", () => {
    expect(() => parseLumaLinkServerMessage('{"type":"nope"}')).toThrow();
  });
});
