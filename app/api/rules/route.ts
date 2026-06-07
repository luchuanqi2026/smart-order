import { NextResponse } from "next/server";
import { listRules, upsertRule } from "@/lib/store.server";
import type { ParserRule } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const rules = await listRules();
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  try {
    const rule = (await request.json()) as ParserRule;
    if (!rule.id || !rule.name) {
      return NextResponse.json({ error: "规则名称和 ID 不能为空。" }, { status: 400 });
    }
    const saved = await upsertRule(rule);
    return NextResponse.json({ rule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存规则失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
