import { NextResponse } from "next/server";
import { extractDocument } from "@/lib/extract.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件。" }, { status: 400 });
    }
    if (!file.size) {
      return NextResponse.json({ error: "文件为空，无法解析。" }, { status: 400 });
    }
    const document = await extractDocument(file);
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件解析失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
