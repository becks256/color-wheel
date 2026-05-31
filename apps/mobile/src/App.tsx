import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import {
  createLiveScannerState,
  decodeCameraSnapshot,
  decodeImportedSvgDocument,
  describeCameraPipeline,
  nextLiveScannerState,
  type ScanDiagnostic
} from './scannerPipeline';
import { decodeJpegBase64 } from './jpegDecode';

type ReaderMode = 'camera' | 'import';
const SCAN_IMAGE_WIDTH = 420;

export default function App() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<ReaderMode>('camera');
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostic[]>(describeCameraPipeline());
  const [payload, setPayload] = useState('Point the camera at a Color Wheel code or import an exported SVG.');
  const [isImporting, setIsImporting] = useState(false);
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);
  const [pictureSize, setPictureSize] = useState<string>();
  const [scannerState, dispatchScanner] = useReducer(nextLiveScannerState, undefined, createLiveScannerState);

  const canUseCamera = permission?.granted === true;
  const statusLabel = useMemo(() => {
    const failed = diagnostics.find((diagnostic) => diagnostic.status === 'failed');
    if (failed) return 'Needs attention';
    const decoded = diagnostics.find((diagnostic) => diagnostic.stage === 'decode' && diagnostic.status === 'ok');
    if (decoded) return 'Decoded';
    return 'Ready';
  }, [diagnostics]);

  useEffect(() => {
    if (!scannerState.isScanning || !canUseCamera || isCapturingFrame) return undefined;

    const timer = setInterval(() => {
      void scanCameraFrame();
    }, 1800);

    return () => clearInterval(timer);
  }, [scannerState.isScanning, canUseCamera, isCapturingFrame]);

  async function handleImportSvg() {
    setMode('import');
    setIsImporting(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['image/svg+xml', 'text/xml', 'application/xml', '*/*'],
        copyToCacheDirectory: true,
        multiple: false
      });
      if (picked.canceled) return;

      const uri = picked.assets[0]?.uri;
      if (!uri) throw new Error('No document URI returned.');

      const result = await decodeImportedSvgDocument(uri, (fileUri) => FileSystem.readAsStringAsync(fileUri));
      setDiagnostics(result.diagnostics);
      setPayload(result.decoded?.payloadText ?? 'Import failed. Review diagnostics below.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not import this document.';
      Alert.alert('Import failed', message);
      setDiagnostics([
        { stage: 'finder', status: 'failed', message },
        { stage: 'sampling', status: 'pending', message: 'No ring samples available.' },
        { stage: 'decode', status: 'pending', message: 'Decode did not run.' }
      ]);
      setPayload('Import failed. Review diagnostics below.');
    } finally {
      setIsImporting(false);
    }
  }

  async function handleCameraPermission() {
    const nextPermission = await requestPermission();
    if (!nextPermission.granted) {
      Alert.alert('Camera access needed', 'Enable camera access to scan codes directly.');
    }
  }

  async function scanCameraFrame() {
    if (!cameraRef.current || isCapturingFrame) return;

    setMode('camera');
    setIsCapturingFrame(true);
    dispatchScanner({ type: 'frame-attempt' });
    try {
      const picture = await cameraRef.current.takePictureAsync({
        quality: 0.22,
        skipProcessing: true,
        shutterSound: false
      });
      const scanImage = await manipulateAsync(
        picture.uri,
        [{ resize: { width: SCAN_IMAGE_WIDTH } }],
        { base64: true, compress: 0.45, format: SaveFormat.JPEG }
      );
      const pixels = scanImage.base64 ? decodeJpegBase64(scanImage.base64).data : undefined;
      const result = await decodeCameraSnapshot({
        uri: scanImage.uri,
        width: scanImage.width,
        height: scanImage.height,
        pixels
      });
      setDiagnostics(result.diagnostics);
      setPayload(result.decoded?.payloadText ?? `Live scanner captured frame ${scannerState.frameAttempts + 1}. Pixel decoding is next.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not capture camera frame.';
      setDiagnostics([
        { stage: 'finder', status: 'failed', message },
        { stage: 'sampling', status: 'pending', message: 'No camera snapshot was sampled.' },
        { stage: 'decode', status: 'pending', message: 'Decode did not run.' }
      ]);
      setPayload('Camera frame capture failed. Review diagnostics below.');
      dispatchScanner({ type: 'stop' });
    } finally {
      setIsCapturingFrame(false);
    }
  }

  function toggleLiveScanner() {
    setMode('camera');
    dispatchScanner({ type: scannerState.isScanning ? 'stop' : 'start' });
  }

  async function handleCameraReady() {
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      const smallestSize = chooseSmallestPictureSize(sizes ?? []);
      if (smallestSize) setPictureSize(smallestSize);
    } catch {
      setPictureSize(undefined);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.app}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Color Wheel Reader</Text>
            <Text style={styles.subtitle}>Camera scanner and SVG import lab</Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.modeTabs}>
          <Pressable
            accessibilityRole="button"
            style={[styles.modeTab, mode === 'camera' && styles.modeTabActive]}
            onPress={() => setMode('camera')}
          >
            <Text style={[styles.modeTabText, mode === 'camera' && styles.modeTabTextActive]}>Camera</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.modeTab, mode === 'import' && styles.modeTabActive]}
            onPress={handleImportSvg}
          >
            <Text style={[styles.modeTabText, mode === 'import' && styles.modeTabTextActive]}>
              {isImporting ? 'Importing' : 'Import SVG'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.cameraCard}>
          {canUseCamera ? (
            <>
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="back"
                pictureSize={pictureSize}
                onCameraReady={() => void handleCameraReady()}
              />
              <View pointerEvents="none" style={styles.reticleOverlay}>
                <View style={styles.reticle}>
                  <View style={styles.reticleRing} />
                  <View style={styles.reticleDot} />
                </View>
              </View>
              <View style={styles.cameraControls}>
                <Pressable style={styles.cameraButton} onPress={toggleLiveScanner}>
                  <Text style={styles.cameraButtonText}>{scannerState.isScanning ? 'Stop Live Scan' : 'Start Live Scan'}</Text>
                </Pressable>
                <Pressable style={[styles.cameraButton, styles.secondaryCameraButton]} onPress={() => void scanCameraFrame()}>
                  <Text style={[styles.cameraButtonText, styles.secondaryCameraButtonText]}>
                    {isCapturingFrame ? 'Scanning' : 'Scan Frame'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.permissionPanel}>
              <Text style={styles.permissionTitle}>Camera permission is off</Text>
              <Text style={styles.permissionCopy}>Grant access to preview the scanner view on-device.</Text>
              <Pressable style={styles.primaryButton} onPress={handleCameraPermission}>
                <Text style={styles.primaryButtonText}>Enable Camera</Text>
              </Pressable>
            </View>
          )}
        </View>

        <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent}>
          <View style={styles.payloadCard}>
            <Text style={styles.sectionLabel}>Decoded payload</Text>
            <Text style={styles.payloadText}>{payload}</Text>
            <Text style={styles.frameCounter}>Frame attempts: {scannerState.frameAttempts}</Text>
          </View>

          <View style={styles.diagnosticCard}>
            <Text style={styles.sectionLabel}>Pipeline diagnostics</Text>
            {diagnostics.map((diagnostic) => (
              <View key={diagnostic.stage} style={styles.diagnosticRow}>
                <View style={[styles.dot, styles[diagnostic.status]]} />
                <View style={styles.diagnosticTextBlock}>
                  <Text style={styles.diagnosticStage}>{diagnostic.stage}</Text>
                  <Text style={styles.diagnosticMessage}>{diagnostic.message}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function chooseSmallestPictureSize(sizes: string[]): string | undefined {
  return sizes
    .map((size) => {
      const [width, height] = size.split('x').map((part) => Number(part));
      return { size, area: Number.isFinite(width) && Number.isFinite(height) ? width * height : Number.POSITIVE_INFINITY };
    })
    .filter((entry) => entry.area > 0 && Number.isFinite(entry.area))
    .sort((a, b) => a.area - b.area)[0]?.size;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7fb'
  },
  app: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 14
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14
  },
  title: {
    color: '#172033',
    fontSize: 24,
    fontWeight: '800'
  },
  subtitle: {
    color: '#65738a',
    fontSize: 13,
    marginTop: 3
  },
  statusPill: {
    borderRadius: 8,
    backgroundColor: '#eaf1ff',
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  statusText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800'
  },
  modeTabs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14
  },
  modeTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd7e6',
    backgroundColor: '#ffffff'
  },
  modeTabActive: {
    backgroundColor: '#172033',
    borderColor: '#172033'
  },
  modeTabText: {
    color: '#172033',
    fontWeight: '800'
  },
  modeTabTextActive: {
    color: '#ffffff'
  },
  cameraCard: {
    height: 360,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e2ef',
    backgroundColor: '#111827'
  },
  camera: {
    flex: 1
  },
  reticleOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent'
  },
  reticle: {
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 95,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: 'transparent'
  },
  reticleRing: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 10,
    borderColor: 'rgba(255,255,255,0.9)'
  },
  reticleDot: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.9)'
  },
  cameraControls: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    left: 14,
    flexDirection: 'row',
    gap: 10
  },
  cameraButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#ffffff'
  },
  secondaryCameraButton: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)'
  },
  cameraButtonText: {
    color: '#172033',
    fontWeight: '900'
  },
  secondaryCameraButtonText: {
    color: '#ffffff'
  },
  permissionPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22
  },
  permissionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8
  },
  permissionCopy: {
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryButtonText: {
    color: '#172033',
    fontWeight: '900'
  },
  results: {
    flex: 1,
    marginTop: 14
  },
  resultsContent: {
    paddingBottom: 26,
    gap: 12
  },
  payloadCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e2ef',
    backgroundColor: '#ffffff',
    padding: 14
  },
  diagnosticCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e2ef',
    backgroundColor: '#ffffff',
    padding: 14
  },
  sectionLabel: {
    color: '#65738a',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
    marginBottom: 8
  },
  payloadText: {
    color: '#172033',
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700'
  },
  frameCounter: {
    color: '#65738a',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 10
  },
  diagnosticRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#edf2f7'
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4
  },
  pending: {
    backgroundColor: '#94a3b8'
  },
  ok: {
    backgroundColor: '#22c55e'
  },
  failed: {
    backgroundColor: '#ef4444'
  },
  diagnosticTextBlock: {
    flex: 1
  },
  diagnosticStage: {
    color: '#172033',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'capitalize'
  },
  diagnosticMessage: {
    color: '#65738a',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2
  }
});
