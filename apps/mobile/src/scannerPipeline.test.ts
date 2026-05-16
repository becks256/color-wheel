import { describe, expect, test } from 'vitest';
import { encodeColorCode, renderColorCodeSvg } from '@color-wheel/codec';
import {
  createLiveScannerState,
  decodeCameraSnapshot,
  decodeImportedSvg,
  decodeImportedSvgDocument,
  describeCameraPipeline,
  nextLiveScannerState
} from './scannerPipeline';

describe('mobile scanner pipeline', () => {
  test('decodes imported generated SVGs through the shared codec', async () => {
    const encoded = encodeColorCode({ payload: 'mobile import smoke', payloadType: 'text', eccLevel: 'medium' });
    const svg = renderColorCodeSvg(encoded);

    const result = await decodeImportedSvg(svg);

    expect(result.decoded?.payloadText).toBe('mobile import smoke');
    expect(result.diagnostics.at(-1)?.status).toBe('ok');
  });

  test('describes the camera stages for the native scanner', () => {
    expect(describeCameraPipeline().map((diagnostic) => diagnostic.stage)).toEqual(['finder', 'sampling', 'decode']);
  });

  test('decodes SVG documents through an injected file reader', async () => {
    const encoded = encodeColorCode({ payload: 'document import smoke', payloadType: 'text', eccLevel: 'low' });
    const svg = renderColorCodeSvg(encoded);

    const result = await decodeImportedSvgDocument('file://code.svg', async () => svg);

    expect(result.decoded?.payloadText).toBe('document import smoke');
    expect(result.diagnostics.every((diagnostic) => diagnostic.status !== 'failed')).toBe(true);
  });

  test('tracks live scanner start, frame attempts, and stop state', () => {
    const initial = createLiveScannerState();
    const scanning = nextLiveScannerState(initial, { type: 'start' });
    const afterFrame = nextLiveScannerState(scanning, { type: 'frame-attempt' });
    const stopped = nextLiveScannerState(afterFrame, { type: 'stop' });

    expect(scanning.isScanning).toBe(true);
    expect(afterFrame.frameAttempts).toBe(1);
    expect(stopped.isScanning).toBe(false);
  });

  test('reports camera snapshots as captured before pixel decoding is available', async () => {
    const result = await decodeCameraSnapshot({ uri: 'file://snapshot.jpg', width: 1280, height: 720 });

    expect(result.diagnostics[0]).toEqual({
      stage: 'finder',
      status: 'ok',
      message: 'Captured camera snapshot 1280x720.'
    });
    expect(result.diagnostics.at(-1)?.status).toBe('pending');
  });
});
