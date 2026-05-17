export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface FinderDetection {
  found: boolean;
  centerX?: number;
  centerY?: number;
  radius?: number;
  confidence?: number;
  reason?: string;
}

interface Component {
  pixels: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
}

export function detectFinderPattern(image: RgbaImage): FinderDetection {
  const dark = buildDarkMask(image);
  const components = findDarkComponents(dark, image.width, image.height)
    .filter((component) => component.pixels > 80)
    .sort((a, b) => b.pixels - a.pixels);

  if (components.length === 0) {
    return { found: false, reason: 'No dark component large enough for finder detection.' };
  }

  for (const component of components.slice(0, 8)) {
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    const roughCenterX = (component.minX + component.maxX) / 2;
    const roughCenterY = (component.minY + component.maxY) / 2;
    const radius = Math.min(width, height) * 0.36;
    const aspect = width / height;
    if (aspect < 0.55 || aspect > 1.8 || radius < 12) continue;

    const refined = refineCenter(image, roughCenterX, roughCenterY, radius);
    const score = refined.score;
    if (score > 0.55) {
      const estimatedRadius = estimateOuterDiskRadius(image, refined.centerX, refined.centerY, radius);
      return {
        found: true,
        centerX: refined.centerX,
        centerY: refined.centerY,
        radius: estimatedRadius,
        confidence: Number(score.toFixed(3))
      };
    }
  }

  return { found: false, reason: 'Dark components were found, but none matched the bullseye finder profile.' };
}

function estimateOuterDiskRadius(image: RgbaImage, centerX: number, centerY: number, fallbackRadius: number): number {
  const estimates: number[] = [];
  const angles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const maxRadius = fallbackRadius * 1.5;

  for (const angle of angles) {
    let lastDarkRadius = 0;
    for (let radius = fallbackRadius * 0.45; radius <= maxRadius; radius += 1) {
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (isDarkPixel(image, x, y)) {
        lastDarkRadius = radius;
      } else if (lastDarkRadius > fallbackRadius * 0.65) {
        estimates.push(lastDarkRadius);
        break;
      }
    }
  }

  if (estimates.length === 0) return fallbackRadius;
  return estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
}

function refineCenter(image: RgbaImage, centerX: number, centerY: number, radius: number) {
  let best = { centerX, centerY, score: scoreBullseye(image, centerX, centerY, radius) };
  const step = Math.max(2, radius * 0.08);
  const searchRadius = radius * 0.28;
  for (let dy = -searchRadius; dy <= searchRadius; dy += step) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += step) {
      const candidateX = centerX + dx;
      const candidateY = centerY + dy;
      const score = scoreBullseye(image, candidateX, candidateY, radius);
      if (score > best.score) {
        best = { centerX: candidateX, centerY: candidateY, score };
      }
    }
  }
  return best;
}

function buildDarkMask(image: RgbaImage): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const r = image.data[offset];
    const g = image.data[offset + 1];
    const b = image.data[offset + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    mask[index] = luminance < 70 && Math.max(r, g, b) - Math.min(r, g, b) < 48 ? 1 : 0;
  }
  return mask;
}

function findDarkComponents(mask: Uint8Array, width: number, height: number): Component[] {
  const visited = new Uint8Array(mask.length);
  const components: Component[] = [];
  const queue: number[] = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;

    const component: Component = {
      pixels: 0,
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
      sumX: 0,
      sumY: 0
    };
    queue.length = 0;
    queue.push(index);
    visited[index] = 1;

    while (queue.length > 0) {
      const current = queue.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      component.pixels += 1;
      component.sumX += x;
      component.sumY += y;
      component.minX = Math.min(component.minX, x);
      component.minY = Math.min(component.minY, y);
      component.maxX = Math.max(component.maxX, x);
      component.maxY = Math.max(component.maxY, y);

      visitNeighbor(current - 1, x > 0);
      visitNeighbor(current + 1, x < width - 1);
      visitNeighbor(current - width, y > 0);
      visitNeighbor(current + width, y < height - 1);
    }

    components.push(component);
  }

  return components;

  function visitNeighbor(next: number, inBounds: boolean): void {
    if (!inBounds || visited[next] || !mask[next]) return;
    visited[next] = 1;
    queue.push(next);
  }
}

function scoreBullseye(image: RgbaImage, cx: number, cy: number, radius: number): number {
  const darkCenter = sampleRing(image, cx, cy, radius * 0.2, 20, isDarkPixel);
  const whiteMiddle = sampleRing(image, cx, cy, radius * 0.5, 28, isLightPixel);
  const darkOuter = sampleRing(image, cx, cy, radius * 0.82, 36, isDarkPixel);
  const darkTabs = [
    isDarkAt(image, cx, cy - radius * 1.18),
    isDarkAt(image, cx - radius * 1.18, cy),
    isDarkAt(image, cx + radius * 1.08, cy),
    isDarkAt(image, cx, cy + radius * 1.18)
  ].filter(Boolean).length / 4;

  return darkCenter * 0.28 + whiteMiddle * 0.28 + darkOuter * 0.28 + darkTabs * 0.16;
}

function sampleRing(
  image: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  samples: number,
  predicate: (image: RgbaImage, x: number, y: number) => boolean
): number {
  let hits = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const angle = (sample / samples) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (predicate(image, x, y)) hits += 1;
  }
  return hits / samples;
}

function isDarkAt(image: RgbaImage, x: number, y: number): boolean {
  return isDarkPixel(image, x, y);
}

function isDarkPixel(image: RgbaImage, x: number, y: number): boolean {
  const rgb = getPixel(image, x, y);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 80;
}

function isLightPixel(image: RgbaImage, x: number, y: number): boolean {
  const rgb = getPixel(image, x, y);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return r > 180 && g > 180 && b > 180;
}

function getPixel(image: RgbaImage, x: number, y: number): [number, number, number] | undefined {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return undefined;
  const offset = (py * image.width + px) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}
