import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";

const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSION = 3072;

export function createEmbedder(apiKey: string) {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });

  async function embedSingle(text: string): Promise<number[]> {
    const response = await model.embedContent({
      content: { role: "user", parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });
    return response.embedding.values;
  }

  /**
   * Embed multiple texts with controlled concurrency.
   * gemini-embedding-001 doesn't support batchEmbedContents via this SDK,
   * so we call embedContent in parallel with a concurrency limit.
   */
  async function embedBatch(
    texts: string[],
    concurrency: number = 5
  ): Promise<number[][]> {
    const results: (number[] | null)[] = new Array(texts.length).fill(null);

    for (let i = 0; i < texts.length; i += concurrency) {
      const chunk = texts.slice(i, i + concurrency);
      const promises = chunk.map((text, idx) =>
        embedSingle(text).then((embedding) => {
          results[i + idx] = embedding;
        })
      );
      await Promise.all(promises);
    }

    return results as number[][];
  }

  return { embedBatch, embedSingle };
}
