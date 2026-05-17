import jpeg from 'jpeg-js';
import type { RgbaImage } from './finderDetector';

export function decodeJpegBase64(base64: string): RgbaImage {
  const bytes = base64ToBytes(base64);
  const decoded = jpeg.decode(bytes, { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data)
  };
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
