import { NextResponse } from "next/server";
import { existingExternalCodes, listOrders, saveOrders } from "@/lib/store.server";
import { validateRows } from "@/lib/rule-engine";
import type { OrderRow } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "20");
  const existing = searchParams.get("existing");
  if (existing === "1") {
    const codes = await existingExternalCodes();
    return NextResponse.json({ codes });
  }
  const result = await listOrders(q, page, pageSize);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows?: OrderRow[] };
    const rows = body.rows ?? [];
    const existingCodes = new Set(await existingExternalCodes());
    const issues = validateRows(rows, existingCodes).filter((issue) => issue.severity === "error");
    if (issues.length) {
      return NextResponse.json({ error: "存在未修正错误，禁止提交。", issues }, { status: 422 });
    }
    const saved = await saveOrders(rows);
    return NextResponse.json({ success: saved.length, failed: 0, rows: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
