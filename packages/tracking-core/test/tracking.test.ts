import { describe, expect, it } from "vitest";
import type { TrackingFrame } from "@lumastage/protocol";
import { TrackingEngine, applyVTubeParameterMappings, mapARKitToStandardParameters } from "../src/index.js";

function frame(overrides: Partial<TrackingFrame> = {}): TrackingFrame {
  return {
    type: "tracking", protocol: 1, sequence: 1, capturedAt: 1, faceFound: true,
    head: { pitch: 0, yaw: 0, roll: 0, positionX: 0, positionY: 0, positionZ: 0 },
    gaze: { x: 0, y: 0 }, blendShapes: {}, ...overrides
  };
}

describe("ARKit to Live2D mapping", () => {
  it("maps head, blink, mouth and gaze into standard Cubism parameters", () => {
    const values = mapARKitToStandardParameters(frame({
      head: { pitch: -0.275, yaw: 0.325, roll: -0.275, positionX: 0, positionY: 0, positionZ: 0 },
      gaze: { x: 0.4, y: -0.2 },
      blendShapes: { eyeBlinkLeft: 1, eyeBlinkRight: 0.25, jawOpen: 0.8, mouthSmileLeft: 0.6, mouthSmileRight: 0.4 }
    }));
    expect(values.ParamAngleX).toBeCloseTo(19.5);
    expect(values.ParamAngleY).toBeCloseTo(19.64, 1);
    expect(values.ParamAngleZ).toBeCloseTo(18.33, 1);
    expect(values.ParamEyeLOpen).toBe(0);
    expect(values.ParamEyeROpen).toBe(0.75);
    expect(values.ParamMouthOpenY).toBeCloseTo(0.92);
    expect(values.ParamMouthForm).toBe(0.625);
    expect(values.ParamEyeBallX).toBeCloseTo(0.46);
    expect(values.ParamEyeBallY).toBeCloseTo(0.23);
  });

  it("calibrates the current head pose as neutral", () => {
    const engine = new TrackingEngine({ smoothingMs: 0 });
    engine.ingest(frame({ head: { pitch: 0.2, yaw: -0.3, roll: 0.1, positionX: 0, positionY: 0, positionZ: 0 } }), 100);
    expect(engine.calibrate()).toBe(true);
    const next = engine.ingest(frame({ sequence: 2, head: { pitch: 0.2, yaw: -0.3, roll: 0.1, positionX: 0, positionY: 0, positionZ: 0 } }), 101);
    expect(next.ParamAngleX).toBeCloseTo(0);
    expect(next.ParamAngleY).toBeCloseTo(0);
    expect(Math.abs(next.ParamAngleZ)).toBeLessThan(0.1);
  });

  it("smoothly returns to neutral after tracking becomes stale", () => {
    const engine = new TrackingEngine({ smoothingMs: 0, lostTrackingSmoothingMs: 100, staleAfterMs: 50 });
    const tracked = engine.ingest(frame({ head: { pitch: 0, yaw: 0.65, roll: 0, positionX: 0, positionY: 0, positionZ: 0 } }), 100);
    expect(tracked.ParamAngleX).toBe(30);
    const decayed = engine.tick(250);
    expect(decayed.ParamAngleX).toBeGreaterThan(0);
    expect(decayed.ParamAngleX).toBeLessThan(30);
  });

  it("honors VTube Studio input/output ranges for custom model parameters", () => {
    const mapped = applyVTubeParameterMappings(frame({ head: { pitch: 0, yaw: 0.325, roll: 0, positionX: 0, positionY: 0, positionZ: 0 } }), [{
      input: "FaceAngleX", inputRangeLower: -30, inputRangeUpper: 30,
      outputRangeLower: -2, outputRangeUpper: 4, clampInput: true, clampOutput: true,
      outputLive2D: "CustomHeadTurn", smoothing: 0
    }]);
    expect(mapped.CustomHeadTurn).toBeCloseTo(2.95);
  });

  it("uses imported VTube Studio mappings instead of assuming standard IDs", () => {
    const engine = new TrackingEngine({ smoothingMs: 0 });
    engine.setVTubeParameterMappings([{
      input: "MouthOpen", inputRangeLower: 0, inputRangeUpper: 1,
      outputRangeLower: -1, outputRangeUpper: 2, clampInput: true, clampOutput: true,
      outputLive2D: "CustomMouth", smoothing: 0
    }]);
    const values = engine.ingest(frame({ blendShapes: { jawOpen: 0.5 } }), 100);
    expect(values.CustomMouth).toBeCloseTo(0.725);
    expect(values.ParamMouthOpenY).toBeUndefined();
  });

  it("returns VTube eye mappings to open-eye neutral when tracking is lost", () => {
    const engine = new TrackingEngine({ smoothingMs: 0, lostTrackingSmoothingMs: 0, staleAfterMs: 10 });
    engine.setVTubeParameterMappings([{
      input: "EyeOpenLeft", inputRangeLower: 0, inputRangeUpper: 1,
      outputRangeLower: 0, outputRangeUpper: 1, clampInput: true, clampOutput: true,
      outputLive2D: "CustomEyeOpen", smoothing: 0
    }]);
    expect(engine.ingest(frame({ blendShapes: { eyeBlinkLeft: 1 } }), 100).CustomEyeOpen).toBe(0);
    expect(engine.tick(200).CustomEyeOpen).toBe(1);
  });

  it("accepts a restarted tracking session whose sequence begins at one", () => {
    const engine = new TrackingEngine({ smoothingMs: 0 });
    engine.ingest(frame({ sequence: 900, blendShapes: { jawOpen: 1 } }), 100);
    const restarted = engine.ingest(frame({ sequence: 1, blendShapes: { jawOpen: 0.25 } }), 101);
    expect(restarted.ParamMouthOpenY).toBeCloseTo(0.2875);
  });

  it("injects VTube Studio input values through imported model mappings", () => {
    const engine = new TrackingEngine({ smoothingMs: 0, lostTrackingSmoothingMs: 0 });
    engine.setVTubeParameterMappings([{
      input: "MouthOpen", inputRangeLower: 0, inputRangeUpper: 1,
      outputRangeLower: 0, outputRangeUpper: 1, clampInput: true, clampOutput: true,
      outputLive2D: "CustomMouth", smoothing: 0
    }]);
    engine.ingest(frame({ blendShapes: { jawOpen: 0.2 } }), 100);
    engine.injectVTubeParameters([{ id: "MouthOpen", value: 0.8 }], "set", 101);
    expect(engine.tick(101).CustomMouth).toBeCloseTo(0.8);
    expect(engine.tick(1102).CustomMouth).toBe(0);
  });

  it("injects standard VTube input aliases into Cubism parameters", () => {
    const engine = new TrackingEngine({ smoothingMs: 0 });
    engine.ingest(frame(), 100);
    engine.injectVTubeParameters([{ id: "FaceAngleX", value: 20, weight: 0.5 }], "set", 101);
    expect(engine.tick(101).ParamAngleX).toBeCloseTo(10);
  });

  it("keeps the avatar alive with breathing and subtle body sway between face movements", () => {
    const engine = new TrackingEngine({ lostTrackingSmoothingMs: 0 });
    const first = engine.tick(900);
    const second = engine.tick(1800);
    expect(first.ParamBreath).not.toBe(second.ParamBreath);
    expect(first.ParamBodyAngleY).not.toBe(second.ParamBodyAngleY);
    expect(Math.abs(second.ParamBodyAngleX)).toBeGreaterThan(0.1);
  });
});
