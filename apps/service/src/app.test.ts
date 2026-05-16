import { describe, expect, test } from 'vitest';
import { createServiceApp } from './app';

describe('generation service', () => {
  test('generates svg codes with metadata', async () => {
    const app = createServiceApp();

    const response = await app.inject({
      method: 'POST',
      url: '/codes',
      payload: {
        payload: 'https://example.com/mobile-test',
        payloadType: 'url',
        eccLevel: 'medium',
        outputFormat: 'svg',
        size: 360
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.format).toBe('svg');
    expect(body.asset).toContain('data-finder="keyhole-bullseye"');
    expect(body.metadata.eccLevel).toBe('medium');
    expect(body.metadata.symbolCount).toBeGreaterThan(body.metadata.dataSymbolCount);
    expect(body.render.sizingMode).toBe('manual');
    await app.close();
  });

  test('auto-scales generated codes when no manual size is provided', async () => {
    const app = createServiceApp();

    const response = await app.inject({
      method: 'POST',
      url: '/codes',
      payload: {
        payload: 'auto scale '.repeat(70),
        payloadType: 'text',
        eccLevel: 'high',
        sizingMode: 'auto-compact',
        minCellSize: 5
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.render.sizingMode).toBe('auto-compact');
    expect(body.render.capacity).toBeGreaterThanOrEqual(body.metadata.symbolCount);
    expect(body.asset).toContain('data-sizing-mode="auto-compact"');
    await app.close();
  });

  test('rejects invalid ecc levels', async () => {
    const app = createServiceApp();

    const response = await app.inject({
      method: 'POST',
      url: '/codes',
      payload: { payload: 'bad', eccLevel: 'extreme' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('eccLevel');
    await app.close();
  });
});
