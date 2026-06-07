import { NextResponse } from "next/server";
import { readAiConfig } from "@/lib/ai-config.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = await readAiConfig();
    if (!config) {
      return NextResponse.json({ error: "未找到模型配置。" }, { status: 400 });
    }
    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim() || "你好，你是什么模型";
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature ?? 0.1,
        messages: [{ role: "user", content: message }]
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: json.error?.message ?? `模型接口返回 ${response.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json({
      reply: json.choices?.[0]?.message?.content ?? "",
      model: json.model ?? config.model,
      usage: json.usage ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型测试失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
