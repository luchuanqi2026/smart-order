import { promises as fs } from "node:fs";
import path from "node:path";

export interface AiConfig {
  provider: "deepseek" | "openai";
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature?: number;
  apiKeySource?: "env" | "file";
}

export async function readAiConfig() {
  const filePath = aiConfigPath();
  const envConfig = readEnvConfig();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    const apiKey = envConfig.apiKey || parsed.apiKey || "";
    const model = envConfig.model || parsed.model || "deepseek-v4-flash";
    if (!apiKey || !model) {
      return undefined;
    }
    return {
      provider: envConfig.provider ?? parsed.provider ?? "deepseek",
      baseUrl: envConfig.baseUrl || parsed.baseUrl || "https://api.deepseek.com",
      model,
      apiKey,
      temperature: envConfig.temperature ?? parsed.temperature ?? 0.1,
      apiKeySource: envConfig.apiKey ? "env" : "file"
    } satisfies AiConfig;
  } catch {
    if (!envConfig.apiKey) {
      return undefined;
    }
    return {
      provider: envConfig.provider ?? "deepseek",
      baseUrl: envConfig.baseUrl || "https://api.deepseek.com",
      model: envConfig.model || "deepseek-v4-flash",
      apiKey: envConfig.apiKey,
      temperature: envConfig.temperature ?? 0.1,
      apiKeySource: "env"
    } satisfies AiConfig;
  }
}

export async function writeAiConfig(config: AiConfig) {
  const filePath = aiConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function aiConfigPath() {
  return path.join(process.cwd(), "config", "ai.config.json");
}

function readEnvConfig(): Partial<AiConfig> {
  const temperature = process.env.AI_TEMPERATURE ?? process.env.DEEPSEEK_TEMPERATURE;
  return {
    provider: parseProvider(process.env.AI_PROVIDER),
    baseUrl: process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || "",
    model: process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || "",
    apiKey: process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || "",
    temperature: temperature === undefined || temperature === "" ? undefined : Number(temperature)
  };
}

function parseProvider(value: string | undefined): AiConfig["provider"] | undefined {
  if (value === "openai" || value === "deepseek") {
    return value;
  }
  return undefined;
}
