import type { TrackingFrame } from "@lumastage/protocol";

export interface ImportedModel {
  directory: string;
  manifestPath: string;
  name: string;
  mocPath?: string;
  textureCount: number;
  expressionCount: number;
  motionCount: number;
  missingFiles: string[];
  manifestUrl: string;
  vTubeModelName?: string;
  vTubeParameterMappings: Array<{
    name: string;
    input: string;
    inputRangeLower: number;
    inputRangeUpper: number;
    outputRangeLower: number;
    outputRangeUpper: number;
    clampInput: boolean;
    clampOutput: boolean;
    outputLive2D: string;
    smoothing: number;
  }>;
  vTubeHotkeys: Array<{ id: string; name: string; action: string; file: string; folder: string }>;
}

export interface CubismCoreStatus {
  available: boolean;
  version?: string;
}

export interface DesktopStatus {
  port: number;
  connectedDevices: number;
}

export interface LumaStageBridge {
  onTrackingFrame(listener: (frame: TrackingFrame) => void): () => void;
  onDesktopStatus(listener: (status: DesktopStatus) => void): () => void;
  importModel(): Promise<ImportedModel | null>;
  getCubismCoreStatus(): Promise<CubismCoreStatus>;
  installCubismCore(): Promise<CubismCoreStatus | null>;
}
