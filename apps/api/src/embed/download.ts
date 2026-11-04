// Run at Docker image build so the model is baked into the image (HF_HUB_CACHE=/models).
import { BgeEmbedder } from './bge.js';

const embedder = new BgeEmbedder();
await embedder.warm();
console.log('embedding model downloaded and warmed');
