import { Pinecone, type RecordMetadata } from "@pinecone-database/pinecone";

const UPSERT_BATCH_SIZE = 100;

export interface MessageVector {
  id: string;
  values: number[];
  metadata: RecordMetadata;
}

export function createPineconeClient(apiKey: string, indexName: string) {
  const pc = new Pinecone({ apiKey });
  const index = pc.index(indexName);

  async function upsertBatch(vectors: MessageVector[]): Promise<number> {
    let upserted = 0;
    for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
      const batch = vectors.slice(i, i + UPSERT_BATCH_SIZE);
      await index.upsert(batch);
      upserted += batch.length;
    }
    return upserted;
  }

  async function queryByVector(
    vector: number[],
    topK: number = 10,
    filter?: Record<string, unknown>
  ) {
    return index.query({
      vector,
      topK,
      includeMetadata: true,
      filter,
    });
  }

  async function getStats() {
    return index.describeIndexStats();
  }

  return { upsertBatch, queryByVector, getStats };
}
