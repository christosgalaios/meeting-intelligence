// Manual check for B5: embeds a few strings and prints sizes, norms and similarities.
import { BgeEmbedder } from '../src/embed/bge.js';
import { QUERY_PREFIX } from '../src/embed/embedder.js';

const e = new BgeEmbedder();
const t0 = Date.now();
await e.warm();
console.log(`warm ${Date.now() - t0} ms`);
const texts = [
  'We agreed the Starter plan costs 12 pounds per seat per month.',
  'The Starter plan will be priced at twelve pounds a seat monthly.',
  'Declan ran a half marathon on Sunday and his knees hurt.',
];
const v = await e.embed(texts);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
console.log('shape', v.length, 'x', v[0]!.length);
console.log('norms', v.map((x) => Math.sqrt(dot(x, x)).toFixed(4)));
console.log('similar pair', dot(v[0]!, v[1]!).toFixed(3));
console.log('unrelated pair', dot(v[0]!, v[2]!).toFixed(3));
const [q] = await e.embed([`${QUERY_PREFIX}What did we agree about Starter pricing?`]);
console.log('query vs 0', dot(q!, v[0]!).toFixed(3), 'query vs 2', dot(q!, v[2]!).toFixed(3));
