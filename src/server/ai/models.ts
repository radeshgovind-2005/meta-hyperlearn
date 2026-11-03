// Model ids and prices, verified against https://dev.meta.ai/docs/models and /docs/pricing-rate-limits.

export const MODELS = {
  spark: "muse-spark-1.3",
  wonder: "muse-wonder-1.0",
  sam: "sam-3.1",
  transcribe: "muse-voice-transcribe-1.0",
  image: "muse-image-1.0",
  embed: "@cf/baai/bge-base-en-v1.5", // Workers AI: the Meta API has no embeddings endpoint
  tts: "@cf/myshell-ai/melotts", // Workers AI (open weights): the Meta API has no text-to-speech model
} as const;

export const MODEL_LABELS: Record<string, string> = {
  [MODELS.spark]: "Muse Spark",
  [MODELS.wonder]: "Muse Wonder",
  [MODELS.sam]: "SAM 3.1",
  [MODELS.transcribe]: "Muse Voice Transcribe",
  [MODELS.image]: "Muse Image",
};

/** USD per 1M tokens: [input, output] */
const TOKEN_PRICES: Record<string, [number, number]> = {
  "muse-spark-1.3": [1.25, 4.25],
  "muse-spark-1.2": [1.25, 4.25],
  "muse-wonder-1.0": [4, 20],
};

export function tokenCost(model: string, promptTokens: number, completionTokens: number): number {
  const [inp, out] = TOKEN_PRICES[model] ?? [1.25, 4.25];
  return (promptTokens * inp + completionTokens * out) / 1_000_000;
}

export const PRICES = {
  imageEach: 0.01,
  transcribePerHour: 0.18,
  samPerImage: 2.5 / 1000,
};
