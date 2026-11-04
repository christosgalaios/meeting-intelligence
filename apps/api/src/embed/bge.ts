import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_DIM, EMBEDDING_MODEL, type Embedder } from './embedder.js';

const BATCH = 16;

if (process.env.HF_HUB_CACHE) env.cacheDir = process.env.HF_HUB_CACHE;

export class BgeEmbedder implements Embedder {
  private extractor: Promise<FeatureExtractionPipeline> | null = null;
  private ready = false;

  private load(): Promise<FeatureExtractionPipeline> {
    // Singleton: the model is loaded once per process.
    this.extractor ??= pipeline('feature-extraction', EMBEDDING_MODEL) as Promise<FeatureExtractionPipeline>;
    return this.extractor;
  }

  /** Load the model and run one embed so the first real request is not slow. */
  async warm(): Promise<void> {
    await this.embedBatch(['warm up']);
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const extractor = await this.load();
    // bge models are CLS-pooled; normalising makes cosine distance exact.
    const out = await extractor(texts, { pooling: 'cls', normalize: true });
    const rows = out.tolist() as number[][];
    for (const r of rows) {
      if (r.length !== EMBEDDING_DIM) throw new Error(`unexpected embedding size ${r.length}`);
    }
    return rows;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      result.push(...(await this.embedBatch(texts.slice(i, i + BATCH))));
    }
    return result;
  }
}
