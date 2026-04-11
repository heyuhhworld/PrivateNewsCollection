import { ENV } from "./env";

const resolveEmbeddingsUrl = () => {
  if (ENV.embeddingApiUrl) {
    return ENV.embeddingApiUrl.replace(/\/$/, "");
  }
  const base =
    ENV.embeddingOpenAiBaseUrl ||
    ENV.forgeApiUrl ||
    "https://api.openai.com";
  return `${base.replace(/\/$/, "")}/v1/embeddings`;
};

type EmbeddingsResponse = {
  data?: Array<{ embedding: number[]; index: number }>;
  error?: { message?: string };
};

export async function createEmbedding(input: string): Promise<number[]> {
  const key = ENV.forgeApiKey?.trim();
  if (!key) {
    throw new Error(
      "Embedding API Key 未配置：请设置 BUILT_IN_FORGE_API_KEY 或 OPENAI_API_KEY"
    );
  }
  const text = input.slice(0, 32_000);
  const res = await fetch(resolveEmbeddingsUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: ENV.embeddingModel,
      input: text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding failed: ${res.status} ${errText}`);
  }
  const json = (await res.json()) as EmbeddingsResponse;
  const vec = json.data?.[0]?.embedding;
  if (!vec?.length) {
    throw new Error(json.error?.message ?? "Embedding 返回为空");
  }
  return vec;
}
