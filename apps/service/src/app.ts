import Fastify from 'fastify';
import type { EccLevel, PayloadType, RenderSizingMode } from '@color-wheel/codec';
import { encodeColorCode, planColorCodeRender, renderColorCodeSvg } from '@color-wheel/codec';

const ECC_LEVELS = new Set(['low', 'medium', 'high']);
const PAYLOAD_TYPES = new Set(['text', 'url', 'json', 'binary']);
const SIZING_MODES = new Set(['manual', 'auto-compact', 'auto-scan-safe']);

export function createServiceApp() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  app.post('/codes', async (request, reply) => {
    const body = request.body as {
      payload?: unknown;
      payloadType?: unknown;
      eccLevel?: unknown;
      outputFormat?: unknown;
      size?: unknown;
      sizingMode?: unknown;
      minCellSize?: unknown;
    };

    if (typeof body?.payload !== 'string') {
      return reply.code(400).send({ error: 'payload must be a string' });
    }
    if (body.payloadType !== undefined && !PAYLOAD_TYPES.has(String(body.payloadType))) {
      return reply.code(400).send({ error: 'payloadType must be text, url, json, or binary' });
    }
    if (body.eccLevel !== undefined && !ECC_LEVELS.has(String(body.eccLevel))) {
      return reply.code(400).send({ error: 'eccLevel must be low, medium, or high' });
    }
    if (body.outputFormat !== undefined && body.outputFormat !== 'svg') {
      return reply.code(400).send({ error: 'outputFormat currently supports svg' });
    }
    if (body.sizingMode !== undefined && !SIZING_MODES.has(String(body.sizingMode))) {
      return reply.code(400).send({ error: 'sizingMode must be manual, auto-compact, or auto-scan-safe' });
    }
    if (body.minCellSize !== undefined && (typeof body.minCellSize !== 'number' || body.minCellSize < 2 || body.minCellSize > 24)) {
      return reply.code(400).send({ error: 'minCellSize must be a number from 2 to 24' });
    }

    const encoded = encodeColorCode({
      payload: body.payload,
      payloadType: (body.payloadType ?? 'text') as PayloadType,
      eccLevel: (body.eccLevel ?? 'medium') as EccLevel,
      compression: 'auto'
    });
    const renderOptions = {
      sizingMode: (body.sizingMode ?? (body.size === undefined ? 'auto-scan-safe' : 'manual')) as RenderSizingMode,
      size: typeof body.size === 'number' ? Math.max(220, Math.min(1600, body.size)) : undefined,
      minCellSize: typeof body.minCellSize === 'number' ? body.minCellSize : undefined
    };
    const renderPlan = planColorCodeRender(encoded, renderOptions);
    const asset = renderColorCodeSvg(encoded, renderOptions);

    return {
      format: 'svg',
      asset,
      metadata: encoded.metadata,
      render: {
        sizingMode: renderPlan.sizingMode,
        size: renderPlan.size,
        ringCount: renderPlan.ringCount,
        capacity: renderPlan.capacity,
        minCellSize: renderPlan.ringWidth
      }
    };
  });

  return app;
}
