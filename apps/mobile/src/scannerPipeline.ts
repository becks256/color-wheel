import { decodeColorCode, extractColorCodeFromSvg, type DecodeResult } from '@color-wheel/codec';

export interface ScanDiagnostic {
  stage: 'finder' | 'sampling' | 'decode';
  status: 'pending' | 'ok' | 'failed';
  message: string;
}

export interface ScanResult {
  decoded?: DecodeResult;
  diagnostics: ScanDiagnostic[];
}

export type ReadTextFile = (uri: string) => Promise<string>;

export interface CameraSnapshot {
  uri: string;
  width: number;
  height: number;
}

export interface LiveScannerState {
  isScanning: boolean;
  frameAttempts: number;
  lastFrameAt?: number;
}

export type LiveScannerAction =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'frame-attempt'; capturedAt?: number }
  | { type: 'reset' };

export async function decodeImportedSvg(svg: string): Promise<ScanResult> {
  const diagnostics: ScanDiagnostic[] = [
    { stage: 'finder', status: 'ok', message: 'Read embedded keyhole-bullseye metadata from SVG.' },
    { stage: 'sampling', status: 'ok', message: 'Loaded symbol stream from generated asset metadata.' }
  ];

  try {
    const extracted = extractColorCodeFromSvg(svg);
    const decoded = decodeColorCode(extracted.symbols, extracted.metadata);
    diagnostics.push({ stage: 'decode', status: 'ok', message: `Decoded ${decoded.payloadType} payload with ${decoded.eccLevel} ECC.` });
    return { decoded, diagnostics };
  } catch (error) {
    diagnostics.push({
      stage: 'decode',
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown decode failure.'
    });
    return { diagnostics };
  }
}

export async function decodeImportedSvgDocument(uri: string, readTextFile: ReadTextFile): Promise<ScanResult> {
  try {
    const svg = await readTextFile(uri);
    return decodeImportedSvg(svg);
  } catch (error) {
    return {
      diagnostics: [
        { stage: 'finder', status: 'failed', message: error instanceof Error ? error.message : 'Could not read selected SVG document.' },
        { stage: 'sampling', status: 'pending', message: 'No symbol stream was sampled.' },
        { stage: 'decode', status: 'pending', message: 'Decode did not run.' }
      ]
    };
  }
}

export async function decodeCameraSnapshot(snapshot: CameraSnapshot): Promise<ScanResult> {
  return {
    diagnostics: [
      { stage: 'finder', status: 'ok', message: `Captured camera snapshot ${snapshot.width}x${snapshot.height}.` },
      { stage: 'sampling', status: 'pending', message: `Snapshot stored at ${snapshot.uri}. Pixel sampler is the next scanner component.` },
      { stage: 'decode', status: 'pending', message: 'Waiting for raster finder detection and ring-cell color classification.' }
    ]
  };
}

export function createLiveScannerState(): LiveScannerState {
  return {
    isScanning: false,
    frameAttempts: 0
  };
}

export function nextLiveScannerState(state: LiveScannerState, action: LiveScannerAction): LiveScannerState {
  switch (action.type) {
    case 'start':
      return { ...state, isScanning: true };
    case 'stop':
      return { ...state, isScanning: false };
    case 'frame-attempt':
      return {
        ...state,
        frameAttempts: state.frameAttempts + 1,
        lastFrameAt: action.capturedAt ?? Date.now()
      };
    case 'reset':
      return createLiveScannerState();
  }
}

export function describeCameraPipeline(): ScanDiagnostic[] {
  return [
    { stage: 'finder', status: 'pending', message: 'Detect asymmetric keyhole bullseye in camera frame.' },
    { stage: 'sampling', status: 'pending', message: 'Normalize rotation/scale and sample annular ring cells.' },
    { stage: 'decode', status: 'pending', message: 'Classify base-5 symbols, validate parity/checksum, decompress payload.' }
  ];
}
