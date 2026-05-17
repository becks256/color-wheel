import { describe, expect, test } from 'vitest';
import {
  decodeColorCode,
  decodeColorCodeSymbols,
  encodeColorCode,
  renderColorCodeSvg,
  extractColorCodeFromSvg,
  getRingLayout,
  planColorCodeRender,
  planRingsFromFinder
} from './index';

describe('color wheel codec', () => {
  test('round-trips text payloads through base-5 symbols', () => {
    const encoded = encodeColorCode({
      payload: 'https://example.com/check-in/ABC-123',
      payloadType: 'url',
      eccLevel: 'medium',
      compression: 'auto'
    });

    const decoded = decodeColorCode(encoded.symbols, encoded.metadata);

    expect(decoded.payloadText).toBe('https://example.com/check-in/ABC-123');
    expect(decoded.payloadType).toBe('url');
    expect(decoded.eccLevel).toBe('medium');
    expect(encoded.metadata.symbolCount).toBeGreaterThan(0);
    expect(encoded.metadata.compressionRatio).toBeGreaterThan(0);
  });

  test('decodes sampled symbols without external metadata', () => {
    const encoded = encodeColorCode({
      payload: 'camera payload',
      payloadType: 'text',
      eccLevel: 'low',
      compression: 'none'
    });

    const decoded = decodeColorCodeSymbols([...encoded.symbols, 0, 0, 0]);

    expect(decoded.payloadText).toBe('camera payload');
    expect(decoded.payloadType).toBe('text');
    expect(decoded.checksumValid).toBe(true);
  });

  test('uses proportional ring capacity so outer rings hold more cells', () => {
    const rings = getRingLayout({ ringCount: 7, innerRadius: 64, ringWidth: 12, quietGap: 3 });

    expect(rings).toHaveLength(7);
    expect(rings[0].cellCount).toBeLessThan(rings[6].cellCount);
    expect(rings[0].startIndex).toBe(0);
    expect(rings[6].startIndex).toBe(rings.slice(0, 6).reduce((sum, ring) => sum + ring.cellCount, 0));
  });

  test('renders svg with keyhole bullseye metadata that can be decoded again', () => {
    const encoded = encodeColorCode({
      payload: 'desk test payload',
      payloadType: 'text',
      eccLevel: 'high',
      compression: 'auto'
    });

    const svg = renderColorCodeSvg(encoded, { size: 420 });
    const extracted = extractColorCodeFromSvg(svg);
    const decoded = decodeColorCode(extracted.symbols, extracted.metadata);

    expect(svg).toContain('data-finder="keyhole-bullseye"');
    expect(svg).toContain('<metadata');
    expect(decoded.payloadText).toBe('desk test payload');
  });

  test('renders the keyhole bullseye as clean explicit orientation tabs', () => {
    const encoded = encodeColorCode({
      payload: 'finder shape check',
      payloadType: 'text',
      eccLevel: 'medium',
      compression: 'auto'
    });

    const svg = renderColorCodeSvg(encoded, { size: 420 });

    expect(svg).toContain('data-finder-shape="four-tab-bullseye"');
    expect(svg.match(/data-key-tab="/g)).toHaveLength(4);
    expect(svg).toContain('data-key-tab="top-small-outset"');
    expect(svg).toContain('data-key-tab="right-small-inset"');
  });

  test('auto scales compact output from payload capacity and minimum cell size', () => {
    const shortCode = encodeColorCode({
      payload: 'short',
      payloadType: 'text',
      eccLevel: 'low',
      compression: 'auto'
    });
    const longCode = encodeColorCode({
      payload: 'long payload '.repeat(80),
      payloadType: 'text',
      eccLevel: 'high',
      compression: 'auto'
    });

    const shortPlan = planColorCodeRender(shortCode, { sizingMode: 'auto-compact', minCellSize: 5 });
    const longPlan = planColorCodeRender(longCode, { sizingMode: 'auto-compact', minCellSize: 5 });
    const svg = renderColorCodeSvg(longCode, { sizingMode: 'auto-compact', minCellSize: 5 });

    expect(shortPlan.capacity).toBeGreaterThanOrEqual(shortCode.metadata.symbolCount);
    expect(longPlan.capacity).toBeGreaterThanOrEqual(longCode.metadata.symbolCount);
    expect(longPlan.ringCount).toBeGreaterThan(shortPlan.ringCount);
    expect(longPlan.size).toBeGreaterThan(shortPlan.size);
    expect(svg).toContain(`data-sizing-mode="auto-compact"`);
    expect(svg).toContain(`data-ring-count="${longPlan.ringCount}"`);
  });

  test('derives scanner ring layout from observed finder radius', () => {
    const rings = planRingsFromFinder({ finderRadius: 32, ringCount: 4 });

    expect(rings).toHaveLength(4);
    expect(rings[0].innerRadius).toBeGreaterThan(32);
    expect(rings[1].cellCount).toBeGreaterThanOrEqual(rings[0].cellCount);
    expect(rings[3].startIndex).toBe(rings.slice(0, 3).reduce((sum, ring) => sum + ring.cellCount, 0));
  });
});
