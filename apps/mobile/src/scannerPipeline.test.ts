import { describe, expect, test } from 'vitest';
import { encodeColorCode, planRingsFromFinder, renderColorCodeSvg } from '@color-wheel/codec';
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
      status: 'pending',
      message: 'Captured camera snapshot 1280x720 without pixel data.'
    });
    expect(result.diagnostics.at(-1)?.status).toBe('pending');
  });

  test('runs finder detection when camera snapshots include pixels', async () => {
    const result = await decodeCameraSnapshot({
      uri: 'file://snapshot.jpg',
      width: 80,
      height: 80,
      pixels: makeSyntheticFinderPixels(80, 80, 40, 40, 16)
    });

    expect(result.diagnostics[0].status).toBe('ok');
    expect(result.diagnostics[0].message).toContain('Finder detected');
    expect(result.diagnostics[1].message).toContain('Sampled');
  });

  test('decodes sampled ring symbols when metadata is provided', async () => {
    const encoded = encodeColorCode({ payload: 'camera decode', payloadType: 'text', eccLevel: 'low', compression: 'none' });
    const width = 360;
    const height = 360;
    const cx = 180;
    const cy = 180;
    const finderRadius = 24;
    const pixels = makeSyntheticFinderPixels(width, height, cx, cy, finderRadius);
    drawDefinedRingSymbols(pixels, width, height, cx, cy, planRingsFromFinder({ finderRadius, ringCount: 8 }), encoded.symbols);

    const result = await decodeCameraSnapshot({
      uri: 'file://snapshot.jpg',
      width,
      height,
      pixels,
      metadata: encoded.metadata,
      ringCount: 8
    });

    expect(result.decoded?.payloadText).toBe('camera decode');
    expect(result.diagnostics.at(-1)?.stage).toBe('decode');
    expect(result.diagnostics.at(-1)?.status).toBe('ok');
  });

  test('decodes sampled camera symbols from the frame header when metadata is not provided', async () => {
    const encoded = encodeColorCode({ payload: 'header decode', payloadType: 'text', eccLevel: 'low', compression: 'none' });
    const width = 360;
    const height = 360;
    const cx = 180;
    const cy = 180;
    const finderRadius = 24;
    const pixels = makeSyntheticFinderPixels(width, height, cx, cy, finderRadius);
    drawDefinedRingSymbols(pixels, width, height, cx, cy, planRingsFromFinder({ finderRadius, ringCount: 8 }), encoded.symbols);

    const result = await decodeCameraSnapshot({
      uri: 'file://snapshot.jpg',
      width,
      height,
      pixels,
      ringCount: 8
    });

    expect(result.decoded?.payloadText).toBe('header decode');
    expect(result.diagnostics.at(-1)?.stage).toBe('decode');
    expect(result.diagnostics.at(-1)?.status).toBe('ok');
  });
});

function makeSyntheticFinderPixels(width: number, height: number, cx: number, cy: number, radius: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
  drawCircle(data, width, height, cx, cy, radius, [4, 10, 27, 255]);
  drawCircle(data, width, height, cx, cy, radius * 0.55, [255, 255, 255, 255]);
  drawCircle(data, width, height, cx, cy, radius * 0.29, [4, 10, 27, 255]);
  drawRect(data, width, height, cx - radius * 0.15, cy - radius * 1.55, radius * 0.3, radius * 0.54, [4, 10, 27, 255]);
  drawRect(data, width, height, cx - radius * 1.55, cy - radius * 0.15, radius * 0.72, radius * 0.3, [4, 10, 27, 255]);
  drawRect(data, width, height, cx + radius * 0.92, cy - radius * 0.1, radius * 0.36, radius * 0.2, [4, 10, 27, 255]);
  drawRect(data, width, height, cx - radius * 0.13, cy + radius * 0.94, radius * 0.26, radius * 0.66, [4, 10, 27, 255]);
  return data;
}

function drawCircle(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number, number]
): void {
  const radiusSquared = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = color[3];
      }
    }
  }
}

function drawRect(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number]
): void {
  for (let py = Math.max(0, Math.floor(y)); py <= Math.min(imageHeight - 1, Math.ceil(y + height)); py += 1) {
    for (let px = Math.max(0, Math.floor(x)); px <= Math.min(imageWidth - 1, Math.ceil(x + width)); px += 1) {
      const offset = (py * imageWidth + px) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
}

function drawDefinedRingSymbols(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  cx: number,
  cy: number,
  rings: ReturnType<typeof planRingsFromFinder>,
  symbols: readonly number[]
): void {
  const palette: Array<[number, number, number, number]> = [
    [255, 255, 255, 255],
    [4, 10, 27, 255],
    [239, 68, 68, 255],
    [34, 197, 94, 255],
    [37, 99, 235, 255]
  ];

  for (const ring of rings) {
    const dotRadius = Math.max(2.2, (ring.outerRadius - ring.innerRadius) * 0.38);
    for (let cell = 0; cell < ring.cellCount; cell += 1) {
      const symbol = symbols[ring.startIndex + cell] ?? 0;
      const angle = (cell / ring.cellCount) * Math.PI * 2 - Math.PI / 2;
      drawCircleIntoData(data, imageWidth, imageHeight, cx + Math.cos(angle) * ring.centerRadius, cy + Math.sin(angle) * ring.centerRadius, dotRadius, palette[symbol]);
    }
  }
}

function drawCircleIntoData(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number, number]
): void {
  const radiusSquared = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(imageHeight - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(imageWidth - 1, Math.ceil(cx + radius)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const offset = (y * imageWidth + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
}
