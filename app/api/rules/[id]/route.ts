import { NextResponse } from "next/server";
import { deleteRule } from "@/lib/store.server";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await deleteRule(id);
  return NextResponse.json({ ok: true });
}
