import {
  decodeColorCode,
  decodeColorCodeSymbols,
  decodeColorCodeSymbolsFromHeader,
  extractColorCodeFromSvg,
  planRingsFromFinder,
  type CodeMetadata,
  type DecodeResult,
  type RingDefinition
} from '@color-wheel/codec';
import { detectFinderPattern } from './finderDetector';
import { sampleRingSymbols } from './ringSampler';

export interface ScanDiagnostic {
  stage: 'finder' | 'sampling' | 'decode';
  status: 'pending' | 'ok' | 'failed';
  message: string;
}

export interface ScanResult {
  decoded?: DecodeResult;
  diagnostics: ScanDiagnostic[];
}

interface SamplingAttempt {
  sampled: ReturnType<typeof sampleRingSymbols>;
  rings: RingDefinition[];
  centerX: number;
  centerY: number;
  finderRadius: number;
  angleOffset: number;
}

export type ReadTextFile = (uri: string) => Promise<string>;

export interface CameraSnapshot {
  uri: string;
  width: number;
  height: number;
  pixels?: Uint8ClampedArray;
  metadata?: CodeMetadata;
  ringCount?: number;
  maxSamplingAttempts?: number;
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
  if (!snapshot.pixels) {
    return {
      diagnostics: [
        { stage: 'finder', status: 'pending', message: `Captured camera snapshot ${snapshot.width}x${snapshot.height} without pixel data.` },
        { stage: 'sampling', status: 'pending', message: `Snapshot stored at ${snapshot.uri}. JPEG pixel decoding is required before sampling.` },
        { stage: 'decode', status: 'pending', message: 'Waiting for raster finder detection and ring-cell color classification.' }
      ]
    };
  }

  const finder = detectFinderPattern({
    width: snapshot.width,
    height: snapshot.height,
    data: snapshot.pixels
  });

  if (!finder.found) {
    return {
      diagnostics: [
        { stage: 'finder', status: 'failed', message: finder.reason ?? 'Finder pattern was not detected.' },
        { stage: 'sampling', status: 'pending', message: `Snapshot stored at ${snapshot.uri}. No normalized ring grid available.` },
        { stage: 'decode', status: 'pending', message: 'Decode did not run.' }
      ]
    };
  }

  const image = {
    width: snapshot.width,
    height: snapshot.height,
    data: snapshot.pixels
  };
  let bestAttempt = sampleCameraRings(image, finder.centerX ?? 0, finder.centerY ?? 0, finder.radius ?? 0, snapshot.ringCount ?? 8);

  let decoded: DecodeResult | undefined;
  let decodeDiagnostic: ScanDiagnostic = {
    stage: 'decode',
    status: 'pending',
    message: 'Waiting for enough sampled symbols before payload decode.'
  };

  if (snapshot.metadata) {
    try {
      const decodedAttempt = decodeWithMetadataSearch(
        image,
        finder.centerX ?? 0,
        finder.centerY ?? 0,
        finder.radius ?? 0,
        snapshot.ringCount ?? 8,
        snapshot.metadata,
        snapshot.maxSamplingAttempts
      );
      decoded = decodedAttempt.decoded;
      bestAttempt = decodedAttempt.attempt;
      decodeDiagnostic = {
        stage: 'decode',
        status: 'ok',
        message: `Decoded ${decoded.payloadType} payload with ${decoded.eccLevel} ECC.`
      };
    } catch (error) {
      decodeDiagnostic = {
        stage: 'decode',
        status: 'failed',
        message: error instanceof Error ? error.message : 'Sampled symbols did not decode.'
      };
    }
  } else {
    try {
      const decodedAttempt = decodeWithoutMetadataSearch(
        image,
        finder.centerX ?? 0,
        finder.centerY ?? 0,
        finder.radius ?? 0,
        snapshot.ringCount ?? 8,
        snapshot.maxSamplingAttempts
      );
      decoded = decodedAttempt.decoded;
      bestAttempt = decodedAttempt.attempt;
      decodeDiagnostic = {
        stage: 'decode',
        status: 'ok',
        message: `Decoded ${decoded.payloadType} payload with ${decoded.eccLevel} ECC from sampled frame header.`
      };
    } catch (error) {
      decodeDiagnostic = {
        stage: 'decode',
        status: 'failed',
        message: error instanceof Error ? error.message : 'Sampled symbols did not decode.'
      };
    }
  }

  return {
    decoded,
    diagnostics: [
      { stage: 'finder', status: 'ok', message: `Finder detected with confidence ${finder.confidence}.` },
      {
        stage: 'sampling',
        status: bestAttempt.sampled.unknownCount > bestAttempt.sampled.sampleCount * 0.4 ? 'failed' : 'ok',
        message: `Sampled ${bestAttempt.sampled.sampleCount} cells near center=(${Math.round(bestAttempt.centerX)}, ${Math.round(bestAttempt.centerY)}), radius=${bestAttempt.finderRadius.toFixed(1)}. Colors white=${bestAttempt.sampled.colorCounts.white}, black=${bestAttempt.sampled.colorCounts.black}, red=${bestAttempt.sampled.colorCounts.red}, green=${bestAttempt.sampled.colorCounts.green}, blue=${bestAttempt.sampled.colorCounts.blue}, unknown=${bestAttempt.sampled.colorCounts.unknown}.`
      },
      decodeDiagnostic
    ]
  };
}

function decodeWithoutMetadataSearch(
  image: { width: number; height: number; data: Uint8ClampedArray },
  centerX: number,
  centerY: number,
  finderRadius: number,
  ringCount: number,
  maxSamplingAttempts?: number
): { decoded: DecodeResult; attempt: SamplingAttempt } {
  let lastError: unknown;

  for (const attempt of buildSamplingAttempts(image, centerX, centerY, finderRadius, ringCount, 0, maxSamplingAttempts)) {
    try {
      return {
        decoded: decodeColorCodeSymbolsFromHeader(attempt.sampled.symbols),
        attempt
      };
    } catch (error) {
      lastError = error;
    }
  }

  for (const attempt of buildSamplingAttempts(image, centerX, centerY, finderRadius, ringCount, 0, maxSamplingAttempts)) {
    try {
      return {
        decoded: decodeColorCodeSymbols(attempt.sampled.symbols),
        attempt
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No valid color wheel frame found in sampled symbols.');
}

function decodeWithMetadataSearch(
  image: { width: number; height: number; data: Uint8ClampedArray },
  centerX: number,
  centerY: number,
  finderRadius: number,
  ringCount: number,
  metadata: CodeMetadata,
  maxSamplingAttempts?: number
): { decoded: DecodeResult; attempt: SamplingAttempt } {
  let lastError: unknown;

  for (const attempt of buildSamplingAttempts(image, centerX, centerY, finderRadius, ringCount, metadata.symbolCount, maxSamplingAttempts)) {
    try {
      return {
        decoded: decodeColorCode(attempt.sampled.symbols, metadata),
        attempt
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Sampled symbols did not decode.');
}

function sampleCameraRings(
  image: { width: number; height: number; data: Uint8ClampedArray },
  centerX: number,
  centerY: number,
  finderRadius: number,
  ringCount: number
): SamplingAttempt {
  return buildSamplingAttempts(image, centerX, centerY, finderRadius, ringCount)[0];
}

function buildSamplingAttempts(
  image: { width: number; height: number; data: Uint8ClampedArray },
  centerX: number,
  centerY: number,
  finderRadius: number,
  ringCount: number,
  requiredSymbols = 0,
  maxAttempts = Number.POSITIVE_INFINITY
): SamplingAttempt[] {
  const attempts: SamplingAttempt[] = [];
  const baseCenterX = Math.round(centerX);
  const baseCenterY = Math.round(centerY);
  const radiusCandidates = uniqueNumbers([
    Math.round(finderRadius),
    Math.ceil(finderRadius),
    finderRadius,
    Math.floor(finderRadius),
    finderRadius * 0.96,
    finderRadius * 1.04,
    finderRadius * 1.08
  ]).filter((radius) => radius > 0);
  const centerOffsets = [0, 1, -1, 2, -2];
  const angleOffsets = [0, -0.012, 0.012];

  for (const radius of radiusCandidates) {
    const rings = planRingsFromFinder({ finderRadius: radius, ringCount });
    if (requiredSymbols > 0 && rings.reduce((sum, ring) => sum + ring.cellCount, 0) < requiredSymbols) continue;

    for (const dy of centerOffsets) {
      for (const dx of centerOffsets) {
        for (const angleOffset of angleOffsets) {
          attempts.push({
            sampled: sampleRingSymbols(image, {
              centerX: baseCenterX + dx,
              centerY: baseCenterY + dy,
              finderRadius: radius,
              rings,
              sampleRadius: 1,
              angleOffset
            }),
            rings,
            centerX: baseCenterX + dx,
            centerY: baseCenterY + dy,
            finderRadius: radius,
            angleOffset
          });
          if (attempts.length >= maxAttempts) return attempts;
        }
      }
    }
  }

  return attempts;
}

function uniqueNumbers(values: number[]): number[] {
  const seen = new Set<string>();
  const unique: number[] = [];
  for (const value of values) {
    const key = value.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
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
