import type { TrackingFrame } from "@lumastage/protocol";

export type ParameterValues = Record<string, number>;

export interface TrackingEngineOptions {
  smoothingMs?: number;
  lostTrackingSmoothingMs?: number;
  staleAfterMs?: number;
}

export interface VTubeParameterMapping {
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

interface HeadNeutral {
  pitch: number;
  yaw: number;
  roll: number;
}

const neutralParameters: ParameterValues = {
  ParamAngleX: 0,
  ParamAngleY: 0,
  ParamAngleZ: 0,
  ParamBodyAngleX: 0,
  ParamBodyAngleY: 0,
  ParamBodyAngleZ: 0,
  ParamEyeLOpen: 1,
  ParamEyeROpen: 1,
  ParamEyeBallX: 0,
  ParamEyeBallY: 0,
  ParamMouthOpenY: 0,
  ParamMouthForm: 0,
  ParamBrowLY: 0,
  ParamBrowRY: 0
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function coefficient(frame: TrackingFrame, name: string): number {
  return frame.blendShapes[name] ?? 0;
}

export function mapARKitToStandardParameters(frame: TrackingFrame, neutral?: HeadNeutral): ParameterValues {
  const center = neutral ?? { pitch: 0, yaw: 0, roll: 0 };
  const yaw = frame.head.yaw - center.yaw;
  const pitch = frame.head.pitch - center.pitch;
  const roll = frame.head.roll - center.roll;
  const smile = (coefficient(frame, "mouthSmileLeft") + coefficient(frame, "mouthSmileRight")) / 2;
  const frown = (coefficient(frame, "mouthFrownLeft") + coefficient(frame, "mouthFrownRight")) / 2;
  const browLeft = coefficient(frame, "browInnerUp") + coefficient(frame, "browOuterUpLeft") - coefficient(frame, "browDownLeft");
  const browRight = coefficient(frame, "browInnerUp") + coefficient(frame, "browOuterUpRight") - coefficient(frame, "browDownRight");

  return {
    ParamAngleX: clamp(yaw / 0.65 * 30, -30, 30),
    ParamAngleY: clamp(-pitch / 0.55 * 30, -30, 30),
    ParamAngleZ: clamp(-roll / 0.55 * 30, -30, 30),
    ParamBodyAngleX: clamp(yaw / 0.65 * 10, -10, 10),
    ParamBodyAngleY: clamp(-pitch / 0.55 * 10, -10, 10),
    ParamBodyAngleZ: clamp(-roll / 0.55 * 10, -10, 10),
    ParamEyeLOpen: clamp(1 - coefficient(frame, "eyeBlinkLeft") + coefficient(frame, "eyeWideLeft") * 0.35, 0, 1.35),
    ParamEyeROpen: clamp(1 - coefficient(frame, "eyeBlinkRight") + coefficient(frame, "eyeWideRight") * 0.35, 0, 1.35),
    ParamEyeBallX: clamp(frame.gaze.x, -1, 1),
    ParamEyeBallY: clamp(-frame.gaze.y, -1, 1),
    ParamMouthOpenY: clamp(Math.max(coefficient(frame, "jawOpen"), coefficient(frame, "mouthFunnel") * 0.8), 0, 1),
    ParamMouthForm: clamp(smile - frown, -1, 1),
    ParamBrowLY: clamp(browLeft, -1, 1),
    ParamBrowRY: clamp(browRight, -1, 1)
  };
}

export function mapARKitToVTubeInputs(frame: TrackingFrame, neutral?: HeadNeutral): ParameterValues {
  const standard = mapARKitToStandardParameters(frame, neutral);
  const smile = (coefficient(frame, "mouthSmileLeft") + coefficient(frame, "mouthSmileRight")) / 2;
  const browLeft = standard.ParamBrowLY;
  const browRight = standard.ParamBrowRY;
  return {
    FaceAngleX: standard.ParamAngleX,
    FaceAngleY: standard.ParamAngleY,
    FaceAngleZ: standard.ParamAngleZ,
    FacePositionX: clamp(frame.head.positionX / 0.15, -1, 1),
    FacePositionY: clamp(frame.head.positionY / 0.15, -1, 1),
    FacePositionZ: clamp(frame.head.positionZ / 0.25, -2, 2),
    EyeOpenLeft: standard.ParamEyeLOpen,
    EyeOpenRight: standard.ParamEyeROpen,
    EyeLeftX: standard.ParamEyeBallX,
    EyeLeftY: standard.ParamEyeBallY,
    EyeRightX: standard.ParamEyeBallX,
    EyeRightY: standard.ParamEyeBallY,
    MouthOpen: standard.ParamMouthOpenY,
    MouthSmile: smile,
    VoiceVolumePlusMouthOpen: standard.ParamMouthOpenY,
    BrowLeftY: browLeft,
    BrowRightY: browRight,
    Brows: (browLeft + browRight) / 2,
    CheekPuff: coefficient(frame, "cheekPuff"),
    FaceAngry: (coefficient(frame, "browDownLeft") + coefficient(frame, "browDownRight")) / 2,
    MouthX: coefficient(frame, "mouthRight") - coefficient(frame, "mouthLeft"),
    TongueOut: coefficient(frame, "tongueOut")
  };
}

export function applyVTubeParameterMappings(frame: TrackingFrame, mappings: VTubeParameterMapping[], neutral?: HeadNeutral): ParameterValues {
  const inputs = mapARKitToVTubeInputs(frame, neutral);
  const output: ParameterValues = {};
  for (const mapping of mappings) {
    const input = inputs[mapping.input];
    if (input === undefined) continue;
    const value = applyVTubeMappingValue(input, mapping);
    if (value !== undefined) output[mapping.outputLive2D] = value;
  }
  return output;
}

function applyVTubeMappingValue(input: number, mapping: VTubeParameterMapping): number | undefined {
  if (mapping.inputRangeUpper === mapping.inputRangeLower) return undefined;
  let progress = (input - mapping.inputRangeLower) / (mapping.inputRangeUpper - mapping.inputRangeLower);
  if (mapping.clampInput) progress = clamp(progress, 0, 1);
  let value = mapping.outputRangeLower + progress * (mapping.outputRangeUpper - mapping.outputRangeLower);
  if (mapping.clampOutput) value = clamp(value, Math.min(mapping.outputRangeLower, mapping.outputRangeUpper), Math.max(mapping.outputRangeLower, mapping.outputRangeUpper));
  return value;
}

const neutralVTubeInputs: ParameterValues = {
  FaceAngleX: 0, FaceAngleY: 0, FaceAngleZ: 0,
  FacePositionX: 0, FacePositionY: 0, FacePositionZ: 0,
  EyeOpenLeft: 1, EyeOpenRight: 1,
  EyeLeftX: 0, EyeLeftY: 0, EyeRightX: 0, EyeRightY: 0,
  MouthOpen: 0, MouthSmile: 0, VoiceVolumePlusMouthOpen: 0,
  BrowLeftY: 0, BrowRightY: 0, Brows: 0,
  CheekPuff: 0, FaceAngry: 0, MouthX: 0, TongueOut: 0
};

export class TrackingEngine {
  private readonly smoothingMs: number;
  private readonly lostTrackingSmoothingMs: number;
  private readonly staleAfterMs: number;
  private current: ParameterValues = { ...neutralParameters };
  private target: ParameterValues = { ...neutralParameters };
  private headNeutral?: HeadNeutral;
  private lastFrame?: TrackingFrame;
  private lastReceivedAt = 0;
  private lastTickAt = 0;
  private vTubeMappings: VTubeParameterMapping[] = [];
  private parameterSmoothing = new Map<string, number>();

  constructor(options: TrackingEngineOptions = {}) {
    this.smoothingMs = options.smoothingMs ?? 55;
    this.lostTrackingSmoothingMs = options.lostTrackingSmoothingMs ?? 220;
    this.staleAfterMs = options.staleAfterMs ?? 500;
  }

  ingest(frame: TrackingFrame, receivedAt = Date.now()): ParameterValues {
    this.lastFrame = frame;
    this.lastReceivedAt = receivedAt;
    this.target = frame.faceFound ? this.mapFrame(frame) : this.neutralTarget();
    if (this.lastTickAt === 0) this.lastTickAt = receivedAt;
    return this.tick(receivedAt);
  }

  calibrate(): boolean {
    if (!this.lastFrame?.faceFound) return false;
    this.headNeutral = {
      pitch: this.lastFrame.head.pitch,
      yaw: this.lastFrame.head.yaw,
      roll: this.lastFrame.head.roll
    };
    this.target = this.mapFrame(this.lastFrame);
    return true;
  }

  setVTubeParameterMappings(mappings: VTubeParameterMapping[]): void {
    this.vTubeMappings = mappings.map((mapping) => ({ ...mapping }));
    this.parameterSmoothing = new Map(mappings.map((mapping) => [mapping.outputLive2D, Math.max(0, mapping.smoothing)]));
    this.current = this.neutralTarget();
    this.target = this.lastFrame?.faceFound ? this.mapFrame(this.lastFrame) : this.neutralTarget();
  }

  tick(now = Date.now()): ParameterValues {
    const isFresh = Boolean(this.lastFrame?.faceFound) && now - this.lastReceivedAt <= this.staleAfterMs;
    if (!isFresh) this.target = this.neutralTarget();
    const delta = clamp(now - this.lastTickAt, 0, 100);
    this.lastTickAt = now;
    for (const [id, target] of Object.entries(this.target)) {
      const configuredSmoothing = this.parameterSmoothing.get(id) ?? 0;
      const tau = isFresh ? (configuredSmoothing > 0 ? Math.max(15, configuredSmoothing * 10) : this.smoothingMs) : this.lostTrackingSmoothingMs;
      const alpha = tau <= 0 ? 1 : 1 - Math.exp(-delta / tau);
      this.current[id] = (this.current[id] ?? target) + (target - (this.current[id] ?? target)) * alpha;
    }
    return this.snapshot();
  }

  snapshot(): ParameterValues {
    return { ...this.current };
  }

  private mapFrame(frame: TrackingFrame): ParameterValues {
    return this.vTubeMappings.length > 0
      ? applyVTubeParameterMappings(frame, this.vTubeMappings, this.headNeutral)
      : mapARKitToStandardParameters(frame, this.headNeutral);
  }

  private neutralTarget(): ParameterValues {
    if (this.vTubeMappings.length === 0) return { ...neutralParameters };
    const values: ParameterValues = {};
    for (const mapping of this.vTubeMappings) {
      const input = neutralVTubeInputs[mapping.input];
      if (input === undefined) continue;
      const value = applyVTubeMappingValue(input, mapping);
      if (value !== undefined) values[mapping.outputLive2D] = value;
    }
    return values;
  }
}
