import { describe, expect, test } from 'vitest';
import { detectFinderPattern, type RgbaImage } from './finderDetector';

describe('finder detector', () => {
  test('detects a keyhole bullseye in a synthetic camera frame', () => {
    const image = makeSyntheticFinderImage(220, 180, 104, 88, 31);

    const result = detectFinderPattern(image);

    expect(result.found).toBe(true);
    expect(Math.abs((result.centerX ?? 0) - 104)).toBeLessThan(2);
    expect(Math.abs((result.centerY ?? 0) - 88)).toBeLessThan(2);
    expect(result.radius).toBeGreaterThan(24);
    expect(result.confidence).toBeGreaterThan(0.55);
  });

  test('rejects blank images without dark finder structure', () => {
    const image = makeWhiteImage(160, 120);

    const result = detectFinderPattern(image);

    expect(result.found).toBe(false);
    expect(result.reason).toContain('dark component');
  });

  test('keeps finder center and radius stable with nearby ring cells', () => {
    const image = makeSyntheticFinderImage(360, 360, 180, 180, 24);
    drawRingDots(image, 180, 180, 47, 48);

    const result = detectFinderPattern(image);

    expect(result.found).toBe(true);
    expect(Math.abs((result.centerX ?? 0) - 180)).toBeLessThan(2);
    expect(Math.abs((result.centerY ?? 0) - 180)).toBeLessThan(2);
    expect(result.radius).toBeGreaterThan(23);
    expect(result.radius).toBeLessThan(27);
  });
});

function makeSyntheticFinderImage(width: number, height: number, cx: number, cy: number, radius: number): RgbaImage {
  const image = makeWhiteImage(width, height);
  drawCircle(image, cx, cy, radius, [4, 10, 27, 255]);
  drawCircle(image, cx, cy, radius * 0.55, [255, 255, 255, 255]);
  drawCircle(image, cx, cy, radius * 0.29, [4, 10, 27, 255]);
  drawRect(image, cx - radius * 0.15, cy - radius * 1.55, radius * 0.3, radius * 0.54, [4, 10, 27, 255]);
  drawRect(image, cx - radius * 1.55, cy - radius * 0.15, radius * 0.72, radius * 0.3, [4, 10, 27, 255]);
  drawRect(image, cx + radius * 0.92, cy - radius * 0.1, radius * 0.36, radius * 0.2, [4, 10, 27, 255]);
  drawRect(image, cx - radius * 0.13, cy + radius * 0.94, radius * 0.26, radius * 0.66, [4, 10, 27, 255]);
  return image;
}

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

function drawCircle(image: RgbaImage, cx: number, cy: number, radius: number, color: [number, number, number, number]): void {
  const radiusSquared = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(image.height - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(image.width - 1, Math.ceil(cx + radius)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) setPixel(image, x, y, color);
    }
  }
}

function drawRect(image: RgbaImage, x: number, y: number, width: number, height: number, color: [number, number, number, number]): void {
  for (let py = Math.max(0, Math.floor(y)); py <= Math.min(image.height - 1, Math.ceil(y + height)); py += 1) {
    for (let px = Math.max(0, Math.floor(x)); px <= Math.min(image.width - 1, Math.ceil(x + width)); px += 1) {
      setPixel(image, px, py, color);
    }
  }
}

function setPixel(image: RgbaImage, x: number, y: number, color: [number, number, number, number]): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = color[3];
}

function drawRingDots(image: RgbaImage, cx: number, cy: number, radius: number, count: number): void {
  const colors: Array<[number, number, number, number]> = [
    [4, 10, 27, 255],
    [239, 68, 68, 255],
    [34, 197, 94, 255],
    [37, 99, 235, 255]
  ];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    drawCircle(image, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 4, colors[index % colors.length]);
  }
}
