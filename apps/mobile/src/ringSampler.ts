import type { ColorSymbol, RingDefinition } from '@color-wheel/codec';
import type { RgbaImage } from './finderDetector';

export type ColorClass = 'white' | 'black' | 'red' | 'green' | 'blue' | 'unknown';

export interface RingSampleOptions {
  centerX: number;
  centerY: number;
  finderRadius: number;
  rings?: RingDefinition[];
  ringCount?: number;
  cellsPerRing?: number;
  ringWidth?: number;
  ringGap?: number;
  quietZone?: number;
  sampleRadius?: number;
  angleOffset?: number;
}

export interface RingSampleResult {
  symbols: ColorSymbol[];
  sampleCount: number;
  colorCounts: Record<ColorClass, number>;
  unknownCount: number;
}

const SYMBOLS: Record<ColorClass, ColorSymbol | undefined> = {
  white: 0,
  black: 1,
  red: 2,
  green: 3,
  blue: 4,
  unknown: undefined
};

export function sampleRingSymbols(image: RgbaImage, options: RingSampleOptions): RingSampleResult {
  if (options.rings) {
    return sampleDefinedRings(image, options.centerX, options.centerY, options.rings, options.sampleRadius ?? 2, options.angleOffset ?? 0);
  }

  const ringCount = options.ringCount ?? 3;
  const cellsPerRing = options.cellsPerRing ?? 48;
  const ringWidth = options.ringWidth ?? Math.max(5, options.finderRadius * 0.22);
  const ringGap = options.ringGap ?? ringWidth * 0.35;
  const quietZone = options.quietZone ?? Math.max(8, options.finderRadius * 0.45);
  const symbols: ColorSymbol[] = [];
  const colorCounts: Record<ColorClass, number> = { white: 0, black: 0, red: 0, green: 0, blue: 0, unknown: 0 };

  for (let ring = 0; ring < ringCount; ring += 1) {
    const radius = options.finderRadius + quietZone + ring * (ringWidth + ringGap) + ringWidth / 2;
    for (let cell = 0; cell < cellsPerRing; cell += 1) {
      const angle = (cell / cellsPerRing) * Math.PI * 2 - Math.PI / 2 + (options.angleOffset ?? 0);
      const color = classifyNeighborhood(
        image,
        options.centerX + Math.cos(angle) * radius,
        options.centerY + Math.sin(angle) * radius,
        options.sampleRadius ?? 1
      );
      colorCounts[color] += 1;
      const symbol = SYMBOLS[color];
      if (symbol !== undefined) symbols.push(symbol);
    }
  }

  return {
    symbols,
    sampleCount: ringCount * cellsPerRing,
    colorCounts,
    unknownCount: colorCounts.unknown
  };
}

function sampleDefinedRings(
  image: RgbaImage,
  centerX: number,
  centerY: number,
  rings: RingDefinition[],
  sampleRadius: number,
  angleOffset: number
): RingSampleResult {
  const symbols: ColorSymbol[] = [];
  const colorCounts: Record<ColorClass, number> = { white: 0, black: 0, red: 0, green: 0, blue: 0, unknown: 0 };

  for (const ring of rings) {
    for (let cell = 0; cell < ring.cellCount; cell += 1) {
      const angle = (cell / ring.cellCount) * Math.PI * 2 - Math.PI / 2 + angleOffset;
      const color = classifyNeighborhood(image, centerX + Math.cos(angle) * ring.centerRadius, centerY + Math.sin(angle) * ring.centerRadius, sampleRadius);
      colorCounts[color] += 1;
      const symbol = SYMBOLS[color];
      if (symbol !== undefined) symbols.push(symbol);
    }
  }

  return {
    symbols,
    sampleCount: rings.reduce((sum, ring) => sum + ring.cellCount, 0),
    colorCounts,
    unknownCount: colorCounts.unknown
  };
}

export function classifyPixel(image: RgbaImage, x: number, y: number): ColorClass {
  const rgb = getPixel(image, x, y);
  if (!rgb) return 'unknown';
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  if (luminance > 210 && max - min < 60) return 'white';
  if (luminance < 85 && max - min < 70) return 'black';
  if (r > 150 && r > g * 1.45 && r > b * 1.35) return 'red';
  if (g > 120 && g > r * 1.25 && g > b * 1.1) return 'green';
  if (b > 130 && b > r * 1.25 && b > g * 1.05) return 'blue';
  return 'unknown';
}

function classifyNeighborhood(image: RgbaImage, x: number, y: number, radius: number): ColorClass {
  const counts: Record<ColorClass, number> = { white: 0, black: 0, red: 0, green: 0, blue: 0, unknown: 0 };
  const centerX = Math.round(x);
  const centerY = Math.round(y);
  const sampleRadius = Math.max(0, Math.round(radius));

  for (let py = centerY - sampleRadius; py <= centerY + sampleRadius; py += 1) {
    for (let px = centerX - sampleRadius; px <= centerX + sampleRadius; px += 1) {
      counts[classifyPixel(image, px, py)] += 1;
    }
  }

  return (Object.entries(counts) as Array<[ColorClass, number]>).sort((a, b) => b[1] - a[1])[0][0];
}

function getPixel(image: RgbaImage, x: number, y: number): [number, number, number] | undefined {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return undefined;
  const offset = (py * image.width + px) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}
