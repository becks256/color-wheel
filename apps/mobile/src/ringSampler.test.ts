import { describe, expect, test } from 'vitest';
import { decodeColorCode, encodeColorCode, planRingsFromFinder } from '@color-wheel/codec';
import { sampleRingSymbols, type ColorClass } from './ringSampler';
import type { RgbaImage } from './finderDetector';

describe('ring sampler', () => {
  test('samples color symbols from polar ring cells', () => {
    const image = makeWhiteImage(180, 180);
    const cx = 90;
    const cy = 90;
    const finderRadius = 18;
    const expected: ColorClass[] = ['red', 'green', 'blue', 'black', 'white'];

    drawPolarCells(image, cx, cy, finderRadius + 14, 8, expected);

    const sampled = sampleRingSymbols(image, {
      centerX: cx,
      centerY: cy,
      finderRadius,
      ringCount: 1,
      cellsPerRing: 5,
      ringWidth: 8,
      ringGap: 3,
      quietZone: 10
    });

    expect(sampled.symbols).toEqual([2, 3, 4, 1, 0]);
    expect(sampled.colorCounts).toEqual({ white: 1, black: 1, red: 1, green: 1, blue: 1, unknown: 0 });
    expect(sampled.sampleCount).toBe(5);
  });

  test('samples enough defined rings to decode a synthetic payload', () => {
    const encoded = encodeColorCode({ payload: 'sample decode', payloadType: 'text', eccLevel: 'low', compression: 'none' });
    const image = makeWhiteImage(420, 420);
    const cx = 210;
    const cy = 210;
    const finderRadius = 28;
    const rings = planRingsFromFinder({ finderRadius, ringCount: 8 });

    drawDefinedRingSymbols(image, cx, cy, rings, encoded.symbols);

    const sampled = sampleRingSymbols(image, { centerX: cx, centerY: cy, finderRadius, rings });
    const decoded = decodeColorCode(sampled.symbols, encoded.metadata);

    expect(sampled.symbols.slice(0, encoded.metadata.symbolCount)).toEqual(encoded.symbols);
    expect(decoded.payloadText).toBe('sample decode');
  });
});

function makeWhiteImage(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

function drawPolarCells(image: RgbaImage, cx: number, cy: number, radius: number, width: number, colors: ColorClass[]): void {
  const palette: Record<ColorClass, [number, number, number]> = {
    white: [255, 255, 255],
    black: [4, 10, 27],
    red: [239, 68, 68],
    green: [34, 197, 94],
    blue: [37, 99, 235],
    unknown: [160, 160, 160]
  };

  for (let cell = 0; cell < colors.length; cell += 1) {
    const angle = (cell / colors.length) * Math.PI * 2 - Math.PI / 2;
    drawCircle(image, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, width / 2, palette[colors[cell]]);
  }
}

function drawCircle(image: RgbaImage, cx: number, cy: number, radius: number, color: [number, number, number]): void {
  const radiusSquared = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(image.height - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(image.width - 1, Math.ceil(cx + radius)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const offset = (y * image.width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
}

function drawDefinedRingSymbols(
  image: RgbaImage,
  cx: number,
  cy: number,
  rings: ReturnType<typeof planRingsFromFinder>,
  symbols: readonly number[]
): void {
  const palette: Array<[number, number, number]> = [
    [255, 255, 255],
    [4, 10, 27],
    [239, 68, 68],
    [34, 197, 94],
    [37, 99, 235]
  ];

  for (const ring of rings) {
    const dotRadius = Math.max(2.2, (ring.outerRadius - ring.innerRadius) * 0.38);
    for (let cell = 0; cell < ring.cellCount; cell += 1) {
      const symbol = symbols[ring.startIndex + cell] ?? 0;
      const angle = (cell / ring.cellCount) * Math.PI * 2 - Math.PI / 2;
      drawCircle(image, cx + Math.cos(angle) * ring.centerRadius, cy + Math.sin(angle) * ring.centerRadius, dotRadius, palette[symbol]);
    }
  }
}
