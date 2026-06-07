import { NextResponse } from "next/server";
import { readAiConfig, writeAiConfig, type AiConfig } from "@/lib/ai-config.server";

export const runtime = "nodejs";

export async function GET() {
  const config = await readAiConfig();
  if (!config) {
    return NextResponse.json({
      config: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: "",
        temperature: 0.1,
        hasApiKey: false
      }
    });
  }
  return NextResponse.json({
    config: {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: "",
      temperature: config.temperature ?? 0.1,
      hasApiKey: Boolean(config.apiKey)
    }
  });
}

export async function POST(request: Request) {
  try {
    const current = await readAiConfig();
    const body = (await request.json()) as Partial<AiConfig>;
    const apiKeyForFile = body.apiKey?.trim() || (current?.apiKeySource === "file" ? current.apiKey : "");
    const next: AiConfig = {
      provider: body.provider === "openai" ? "openai" : "deepseek",
      baseUrl: body.baseUrl?.trim() || current?.baseUrl || "https://api.deepseek.com",
      model: body.model?.trim() || current?.model || "deepseek-v4-flash",
      apiKey: apiKeyForFile,
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : current?.temperature ?? 0.1
    };
    if (!next.apiKey && !current?.apiKey) {
      return NextResponse.json({ error: "API Key 不能为空。" }, { status: 400 });
    }
    await writeAiConfig(next);
    return NextResponse.json({
      config: {
        ...next,
        apiKey: "",
        hasApiKey: Boolean(next.apiKey || current?.apiKey)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
