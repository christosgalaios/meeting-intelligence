// sherpa-onnx-node ships no type declarations. Only what worker.ts uses is declared.
declare module 'sherpa-onnx-node' {
  interface DiarizationSegment { start: number; end: number; speaker: number }
  interface RecognizerStream { acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void }
  interface Diarizer {
    process(samples: Float32Array): DiarizationSegment[];
    setConfig(config: { clustering: { numClusters: number; threshold: number } }): void;
  }
  interface Recognizer {
    createStream(): RecognizerStream;
    decode(stream: RecognizerStream): void;
    getResult(stream: RecognizerStream): { text: string };
  }
  const sherpa: {
    OfflineSpeakerDiarization: new (config: object) => Diarizer;
    OfflineRecognizer: new (config: object) => Recognizer;
  };
  export default sherpa;
}
