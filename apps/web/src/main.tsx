import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Gauge, ImageUp, RotateCcw, ScanLine } from 'lucide-react';
import {
  decodeColorCode,
  encodeColorCode,
  extractColorCodeFromSvg,
  planColorCodeRender,
  renderColorCodeSvg,
  type EccLevel,
  type PayloadType,
  type RenderSizingMode
} from '@color-wheel/codec';
import './styles.css';

const EXAMPLE_PAYLOAD = 'https://example.com/check-in/CWC-DEMO-2026';

function App() {
  const [payload, setPayload] = useState(EXAMPLE_PAYLOAD);
  const [payloadType, setPayloadType] = useState<PayloadType>('url');
  const [eccLevel, setEccLevel] = useState<EccLevel>('medium');
  const [sizingMode, setSizingMode] = useState<RenderSizingMode>('auto-scan-safe');
  const [size, setSize] = useState(560);
  const [minCellSize, setMinCellSize] = useState(6);
  const [decodeStatus, setDecodeStatus] = useState('Upload an exported SVG to inspect decode diagnostics.');

  const encoded = useMemo(() => encodeColorCode({ payload, payloadType, eccLevel, compression: 'auto' }), [payload, payloadType, eccLevel]);
  const renderOptions = useMemo(() => ({
    sizingMode,
    minCellSize,
    size: sizingMode === 'manual' ? size : undefined
  }), [sizingMode, minCellSize, size]);
  const renderPlan = useMemo(() => planColorCodeRender(encoded, renderOptions), [encoded, renderOptions]);
  const svg = useMemo(() => renderColorCodeSvg(encoded, renderOptions), [encoded, renderOptions]);

  function downloadSvg() {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'color-wheel-code.svg';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function decodeUpload(file: File) {
    const text = await file.text();
    try {
      const extracted = extractColorCodeFromSvg(text);
      const result = decodeColorCode(extracted.symbols, extracted.metadata);
      setDecodeStatus([
        `Decoded ${result.payloadType} payload: ${result.payloadText}`,
        `ECC: ${result.eccLevel}`,
        `Compression: ${result.compression}`,
        `Checksum: ${result.checksumValid ? 'valid' : 'invalid'}`,
        `Symbols: ${extracted.metadata.symbolCount} total, ${extracted.metadata.paritySymbolCount} parity`
      ].join('\n'));
    } catch (error) {
      setDecodeStatus(error instanceof Error ? error.message : 'Could not decode this file.');
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="brand-row">
            <div className="brand-mark"><ScanLine size={22} /></div>
            <div>
              <h1>Color Wheel Code</h1>
              <p>Ring-track encoder lab</p>
            </div>
          </div>

          <label className="field">
            <span>Payload</span>
            <textarea value={payload} onChange={(event) => setPayload(event.target.value)} rows={5} />
          </label>

          <div className="field-grid">
            <label className="field">
              <span>Payload type</span>
              <select value={payloadType} onChange={(event) => setPayloadType(event.target.value as PayloadType)}>
                <option value="text">Text</option>
                <option value="url">URL</option>
                <option value="json">JSON</option>
                <option value="binary">Binary</option>
              </select>
            </label>
            <label className="field">
              <span>ECC level</span>
              <select value={eccLevel} onChange={(event) => setEccLevel(event.target.value as EccLevel)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Scale mode</span>
            <select value={sizingMode} onChange={(event) => setSizingMode(event.target.value as RenderSizingMode)}>
              <option value="auto-scan-safe">Auto scan-safe</option>
              <option value="auto-compact">Auto compact</option>
              <option value="manual">Manual</option>
            </select>
          </label>

          {sizingMode === 'manual' ? (
            <label className="field">
              <span>Render size: {size}px</span>
              <input type="range" min="220" max="1200" step="20" value={size} onChange={(event) => setSize(Number(event.target.value))} />
            </label>
          ) : (
            <label className="field">
              <span>Minimum cell: {minCellSize}px</span>
              <input type="range" min="3" max="10" step="0.5" value={minCellSize} onChange={(event) => setMinCellSize(Number(event.target.value))} />
            </label>
          )}

          <div className="button-row">
            <button onClick={downloadSvg}><Download size={17} /> SVG</button>
            <button onClick={() => setPayload(EXAMPLE_PAYLOAD)}><RotateCcw size={17} /> Reset</button>
          </div>
        </aside>

        <section className="code-stage" aria-label="Generated circular color code">
          <div className="stage-header">
            <div>
              <h2>Keyhole Bullseye Symbol</h2>
              <p>Concentric base-5 cells with proportional outer-ring capacity.</p>
            </div>
            <div className="density-chip"><Gauge size={16} /> {renderPlan.size}px / {renderPlan.ringCount} rings</div>
          </div>
          <div className="symbol-frame" dangerouslySetInnerHTML={{ __html: svg }} />
        </section>

        <aside className="panel diagnostics-panel">
          <h2>Diagnostics</h2>
          <div className="metric-list">
            <Metric label="Data symbols" value={encoded.metadata.dataSymbolCount} />
            <Metric label="Parity symbols" value={encoded.metadata.paritySymbolCount} />
            <Metric label="Capacity" value={renderPlan.capacity} />
            <Metric label="Cell size" value={`${renderPlan.ringWidth}px`} />
            <Metric label="Payload bytes" value={encoded.metadata.byteLength} />
            <Metric label="Compression" value={`${Math.round(encoded.metadata.compressionRatio * 100)}%`} />
          </div>

          <label className="upload-box">
            <ImageUp size={20} />
            <span>Decode exported SVG</span>
            <input
              type="file"
              accept=".svg,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void decodeUpload(file);
              }}
            />
          </label>

          <pre>{decodeStatus}</pre>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
