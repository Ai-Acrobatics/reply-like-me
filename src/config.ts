import "dotenv/config";

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_KEY!,
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? "llama3.1:70b",
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 120_000),
  },
  pipeline: {
    batchSize: Number(process.env.PIPELINE_BATCH_SIZE ?? 50),
    profileWindowDays: Number(process.env.PROFILE_WINDOW_DAYS ?? 90),
  },
} as const;
