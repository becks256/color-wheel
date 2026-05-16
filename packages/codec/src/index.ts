export type PayloadType = 'text' | 'url' | 'json' | 'binary';
export type EccLevel = 'low' | 'medium' | 'high';
export type CompressionMode = 'none' | 'auto' | 'rle';
export type ColorSymbol = 0 | 1 | 2 | 3 | 4;

export interface EncodeRequest {
  payload: string | Uint8Array;
  payloadType?: PayloadType;
  eccLevel?: EccLevel;
  compression?: CompressionMode;
}

export interface CodeMetadata {
  magic: 'CWC1';
  version: 1;
  finder: 'keyhole-bullseye';
  payloadType: PayloadType;
  eccLevel: EccLevel;
  compression: 'none' | 'rle';
  byteLength: number;
  frameLength: number;
  dataSymbolCount: number;
  paritySymbolCount: number;
  symbolCount: number;
  checksum: number;
  compressionRatio: number;
}

export interface EncodedColorCode {
  symbols: ColorSymbol[];
  metadata: CodeMetadata;
}

export interface DecodeResult {
  payloadBytes: Uint8Array;
  payloadText: string;
  payloadType: PayloadType;
  eccLevel: EccLevel;
  compression: 'none' | 'rle';
  checksumValid: boolean;
}

export interface RingLayoutOptions {
  ringCount: number;
  innerRadius: number;
  ringWidth: number;
  quietGap: number;
}

export interface RingDefinition {
  index: number;
  innerRadius: number;
  outerRadius: number;
  centerRadius: number;
  cellCount: number;
  startIndex: number;
}

export type RenderSizingMode = 'manual' | 'auto-compact' | 'auto-scan-safe';

export interface RenderOptions {
  size?: number;
  ringCount?: number;
  sizingMode?: RenderSizingMode;
  minCellSize?: number;
}

export interface RenderPlan {
  sizingMode: RenderSizingMode;
  size: number;
  ringCount: number;
  capacity: number;
  ringWidth: number;
  quietGap: number;
  innerRadius: number;
  finderScale: number;
  outerQuietZone: number;
  rings: RingDefinition[];
}

const SYMBOL_COLORS = ['#ffffff', '#020617', '#ef4444', '#22c55e', '#2563eb'] as const;
const TYPE_CODES: Record<PayloadType, number> = { text: 1, url: 2, json: 3, binary: 4 };
const CODE_TYPES: Record<number, PayloadType> = { 1: 'text', 2: 'url', 3: 'json', 4: 'binary' };
const ECC_CODES: Record<EccLevel, number> = { low: 1, medium: 2, high: 3 };
const CODE_ECC: Record<number, EccLevel> = { 1: 'low', 2: 'medium', 3: 'high' };
const ECC_RATIOS: Record<EccLevel, number> = { low: 0.08, medium: 0.16, high: 0.28 };
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeColorCode(request: EncodeRequest): EncodedColorCode {
  const payloadType = request.payloadType ?? (typeof request.payload === 'string' ? 'text' : 'binary');
  const eccLevel = request.eccLevel ?? 'medium';
  const originalBytes = typeof request.payload === 'string' ? textEncoder.encode(request.payload) : request.payload;
  const compressed = compressPayload(originalBytes, request.compression ?? 'auto');
  const checksum = crc32(originalBytes);
  const frame = buildFrame({
    payloadType,
    eccLevel,
    compression: compressed.mode,
    originalLength: originalBytes.length,
    checksum,
    data: compressed.bytes
  });
  const dataSymbols = bytesToBase5(frame);
  const paritySymbols = buildParitySymbols(dataSymbols, eccLevel);

  return {
    symbols: [...dataSymbols, ...paritySymbols],
    metadata: {
      magic: 'CWC1',
      version: 1,
      finder: 'keyhole-bullseye',
      payloadType,
      eccLevel,
      compression: compressed.mode,
      byteLength: originalBytes.length,
      frameLength: frame.length,
      dataSymbolCount: dataSymbols.length,
      paritySymbolCount: paritySymbols.length,
      symbolCount: dataSymbols.length + paritySymbols.length,
      checksum,
      compressionRatio: originalBytes.length === 0 ? 1 : compressed.bytes.length / originalBytes.length
    }
  };
}

export function decodeColorCode(symbols: ColorSymbol[], metadata: CodeMetadata): DecodeResult {
  const dataSymbols = symbols.slice(0, metadata.dataSymbolCount);
  const frame = base5ToBytes(dataSymbols, metadata.frameLength);
  const parsed = parseFrame(frame);
  const payloadBytes = parsed.compression === 'rle'
    ? decompressRle(parsed.data, parsed.originalLength)
    : parsed.data;
  const checksumValid = crc32(payloadBytes) === parsed.checksum;

  if (!checksumValid) {
    throw new Error('Checksum mismatch: sampled symbols do not decode to a valid payload');
  }

  return {
    payloadBytes,
    payloadText: parsed.payloadType === 'binary' ? bytesToBase64(payloadBytes) : textDecoder.decode(payloadBytes),
    payloadType: parsed.payloadType,
    eccLevel: parsed.eccLevel,
    compression: parsed.compression,
    checksumValid
  };
}

export function getRingLayout(options: RingLayoutOptions): RingDefinition[] {
  let startIndex = 0;
  const rings: RingDefinition[] = [];
  for (let index = 0; index < options.ringCount; index += 1) {
    const innerRadius = options.innerRadius + index * (options.ringWidth + options.quietGap);
    const outerRadius = innerRadius + options.ringWidth;
    const centerRadius = (innerRadius + outerRadius) / 2;
    const cellCount = Math.max(24, Math.floor((2 * Math.PI * centerRadius) / options.ringWidth));
    rings.push({ index, innerRadius, outerRadius, centerRadius, cellCount, startIndex });
    startIndex += cellCount;
  }
  return rings;
}

export function renderColorCodeSvg(
  encoded: EncodedColorCode,
  options: RenderOptions = {}
): string {
  const plan = planColorCodeRender(encoded, options);
  const size = plan.size;
  const center = size / 2;
  const cells: string[] = [];

  for (const ring of plan.rings) {
    for (let offset = 0; offset < ring.cellCount; offset += 1) {
      const symbol = encoded.symbols[ring.startIndex + offset] ?? 0;
      const startAngle = (offset / ring.cellCount) * Math.PI * 2 - Math.PI / 2;
      const endAngle = ((offset + 0.84) / ring.cellCount) * Math.PI * 2 - Math.PI / 2;
      cells.push(`<path d="${annularSectorPath(center, center, ring.innerRadius, ring.outerRadius, startAngle, endAngle)}" fill="${SYMBOL_COLORS[symbol]}"/>`);
    }
  }

  const metadataJson = escapeHtml(JSON.stringify({ symbols: encoded.symbols, metadata: encoded.metadata }));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" data-format="color-wheel-code" data-finder="keyhole-bullseye" data-sizing-mode="${plan.sizingMode}" data-ring-count="${plan.ringCount}" data-capacity="${plan.capacity}">`,
    `<metadata id="color-wheel-code">${metadataJson}</metadata>`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    `<circle cx="${center}" cy="${center}" r="${size * 0.485}" fill="none" stroke="#020617" stroke-width="${Math.max(2, size * 0.006)}"/>`,
    ...cells,
    renderKeyholeBullseye(center, center, plan.finderScale),
    `</svg>`
  ].join('');
}

export function planColorCodeRender(encoded: EncodedColorCode, options: RenderOptions = {}): RenderPlan {
  const sizingMode = options.sizingMode ?? 'manual';

  if (sizingMode === 'manual') {
    const size = options.size ?? 640;
    const ringCount = options.ringCount ?? Math.max(7, Math.ceil(encoded.symbols.length / 54));
    const finderScale = size * 0.064;
    const finderRadius = finderScale * 1.26;
    const innerRadius = finderRadius + Math.max(size * 0.022, 12);
    const available = size * 0.42;
    const ringWidth = Math.max(5, available / (ringCount * 1.35));
    const quietGap = ringWidth * 0.32;
    const rings = getRingLayout({ ringCount, innerRadius, ringWidth, quietGap });
    return {
      sizingMode,
      size,
      ringCount,
      capacity: totalCapacity(rings),
      ringWidth,
      quietGap,
      innerRadius,
      finderScale,
      outerQuietZone: size * 0.03,
      rings
    };
  }

  const ringWidth = options.minCellSize ?? (sizingMode === 'auto-scan-safe' ? 7 : 4.5);
  const quietGap = ringWidth * 0.26;
  const finderScale = Math.max(22, ringWidth * 5.4);
  const innerRadius = finderScale * 1.26 + Math.max(12, ringWidth * 2.4);
  const outerQuietZone = Math.max(16, ringWidth * 3.2);
  const requestedRingCount = options.ringCount;
  const ringCount = requestedRingCount ?? chooseRingCount(encoded.metadata.symbolCount, {
    innerRadius,
    ringWidth,
    quietGap
  });
  const rings = getRingLayout({ ringCount, innerRadius, ringWidth, quietGap });
  const outerRadius = rings.at(-1)?.outerRadius ?? innerRadius;
  const size = options.size ?? Math.ceil((outerRadius + outerQuietZone) * 2);

  return {
    sizingMode,
    size,
    ringCount,
    capacity: totalCapacity(rings),
    ringWidth,
    quietGap,
    innerRadius,
    finderScale,
    outerQuietZone,
    rings
  };
}

export function extractColorCodeFromSvg(svg: string): EncodedColorCode {
  const match = svg.match(/<metadata id="color-wheel-code">([\s\S]*?)<\/metadata>/);
  if (!match) {
    throw new Error('SVG does not contain color wheel metadata');
  }
  const parsed = JSON.parse(unescapeHtml(match[1])) as EncodedColorCode;
  return parsed;
}

function buildFrame(input: {
  payloadType: PayloadType;
  eccLevel: EccLevel;
  compression: 'none' | 'rle';
  originalLength: number;
  checksum: number;
  data: Uint8Array;
}): Uint8Array {
  const frame = new Uint8Array(19 + input.data.length);
  frame.set([67, 87, 67, 49], 0);
  frame[4] = 1;
  frame[5] = TYPE_CODES[input.payloadType];
  frame[6] = ECC_CODES[input.eccLevel];
  frame[7] = input.compression === 'rle' ? 1 : 0;
  writeUint32(frame, 8, input.originalLength);
  writeUint32(frame, 12, input.checksum);
  writeUint24(frame, 16, input.data.length);
  frame.set(input.data, 19);
  return frame;
}

function parseFrame(frame: Uint8Array) {
  const magic = textDecoder.decode(frame.slice(0, 4));
  if (magic !== 'CWC1' || frame[4] !== 1) {
    throw new Error('Unsupported color wheel frame');
  }
  const payloadType = CODE_TYPES[frame[5]];
  const eccLevel = CODE_ECC[frame[6]];
  if (!payloadType || !eccLevel) {
    throw new Error('Unknown color wheel frame mode');
  }
  const compression = frame[7] === 1 ? 'rle' : 'none';
  const originalLength = readUint32(frame, 8);
  const checksum = readUint32(frame, 12);
  const dataLength = readUint24(frame, 16);
  return {
    payloadType,
    eccLevel,
    compression: compression as 'none' | 'rle',
    originalLength,
    checksum,
    data: frame.slice(19, 19 + dataLength)
  };
}

function compressPayload(bytes: Uint8Array, mode: CompressionMode): { mode: 'none' | 'rle'; bytes: Uint8Array } {
  if (mode === 'none') return { mode: 'none', bytes };
  const rle = compressRle(bytes);
  if (mode === 'rle' || rle.length < bytes.length) {
    return { mode: 'rle', bytes: rle };
  }
  return { mode: 'none', bytes };
}

function compressRle(bytes: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < bytes.length;) {
    const value = bytes[index];
    let count = 1;
    while (index + count < bytes.length && bytes[index + count] === value && count < 255) count += 1;
    output.push(count, value);
    index += count;
  }
  return Uint8Array.from(output);
}

function decompressRle(bytes: Uint8Array, expectedLength: number): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    const count = bytes[index];
    const value = bytes[index + 1];
    for (let repeat = 0; repeat < count; repeat += 1) output.push(value);
  }
  if (output.length !== expectedLength) {
    throw new Error('RLE payload length mismatch');
  }
  return Uint8Array.from(output);
}

function bytesToBase5(bytes: Uint8Array): ColorSymbol[] {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  const digits: ColorSymbol[] = [];
  while (value > 0n) {
    digits.push(Number(value % 5n) as ColorSymbol);
    value /= 5n;
  }
  const minimumDigits = Math.ceil((bytes.length * 8) / Math.log2(5));
  while (digits.length < minimumDigits) digits.push(0);
  return digits.reverse();
}

function base5ToBytes(symbols: ColorSymbol[], byteLength: number): Uint8Array {
  let value = 0n;
  for (const symbol of symbols) value = value * 5n + BigInt(symbol);
  const bytes = new Uint8Array(byteLength);
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

function buildParitySymbols(symbols: ColorSymbol[], eccLevel: EccLevel): ColorSymbol[] {
  const parityCount = Math.max(4, Math.ceil(symbols.length * ECC_RATIOS[eccLevel]));
  const parity = Array.from({ length: parityCount }, (_, index) => (index % 5) as ColorSymbol);
  for (let index = 0; index < symbols.length; index += 1) {
    parity[index % parityCount] = ((parity[index % parityCount] + symbols[index]) % 5) as ColorSymbol;
  }
  return parity;
}

function chooseRingCount(
  symbolCount: number,
  layout: { innerRadius: number; ringWidth: number; quietGap: number }
): number {
  for (let ringCount = 4; ringCount <= 96; ringCount += 1) {
    const rings = getRingLayout({ ringCount, ...layout });
    if (totalCapacity(rings) >= symbolCount) return ringCount;
  }
  throw new Error(`Payload requires more than 96 rings (${symbolCount} symbols)`);
}

function totalCapacity(rings: RingDefinition[]): number {
  return rings.reduce((sum, ring) => sum + ring.cellCount, 0);
}

function annularSectorPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const p1 = polar(cx, cy, outer, start);
  const p2 = polar(cx, cy, outer, end);
  const p3 = polar(cx, cy, inner, end);
  const p4 = polar(cx, cy, inner, start);
  return [
    `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
    `A ${outer.toFixed(3)} ${outer.toFixed(3)} 0 ${largeArc} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
    `L ${p3.x.toFixed(3)} ${p3.y.toFixed(3)}`,
    `A ${inner.toFixed(3)} ${inner.toFixed(3)} 0 ${largeArc} 0 ${p4.x.toFixed(3)} ${p4.y.toFixed(3)}`,
    'Z'
  ].join(' ');
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function renderKeyholeBullseye(cx: number, cy: number, scale: number): string {
  const outerRadius = scale * 1.02;
  const topWidth = scale * 0.32;
  const topHeight = scale * 0.48;
  const bottomWidth = scale * 0.26;
  const bottomHeight = scale * 0.64;
  const leftWidth = scale * 0.54;
  const leftHeight = scale * 0.28;
  const rightWidth = scale * 0.28;
  const rightHeight = scale * 0.2;
  const corner = scale * 0.08;

  return [
    `<g data-finder-shape="four-tab-bullseye">`,
    `<rect data-key-tab="top-small-outset" x="${round(cx - topWidth / 2)}" y="${round(cy - outerRadius - topHeight * 0.82)}" width="${round(topWidth)}" height="${round(topHeight)}" rx="${round(corner)}" fill="#020617"/>`,
    `<rect data-key-tab="left-wide-outset" x="${round(cx - outerRadius - leftWidth * 0.82)}" y="${round(cy - leftHeight / 2)}" width="${round(leftWidth)}" height="${round(leftHeight)}" rx="${round(corner)}" fill="#020617"/>`,
    `<rect data-key-tab="right-small-inset" x="${round(cx + outerRadius - rightWidth * 0.24)}" y="${round(cy - rightHeight / 2)}" width="${round(rightWidth)}" height="${round(rightHeight)}" rx="${round(corner * 0.8)}" fill="#020617"/>`,
    `<rect data-key-tab="bottom-narrow-outset" x="${round(cx - bottomWidth / 2)}" y="${round(cy + outerRadius - bottomHeight * 0.18)}" width="${round(bottomWidth)}" height="${round(bottomHeight)}" rx="${round(corner)}" fill="#020617"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${round(outerRadius)}" fill="#020617"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${round(scale * 0.58)}" fill="#ffffff"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${round(scale * 0.31)}" fill="#020617"/>`,
    `</g>`
  ].join('');
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 16) & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = value & 0xff;
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeHtml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
