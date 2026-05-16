import { describe, expect, test } from 'vitest';
import { encodeColorCode, renderColorCodeSvg } from '@color-wheel/codec';
import { decodeImportedSvg, decodeImportedSvgDocument, describeCameraPipeline } from './scannerPipeline';

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
});
