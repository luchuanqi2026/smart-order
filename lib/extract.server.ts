import type { FileKind, ParsedDocument, ParsedSheet } from "./types";

const excelExtensions = new Set(["xlsx", "xls", "xlsm", "csv"]);
const wordExtensions = new Set(["docx"]);
const pdfExtensions = new Set(["pdf"]);

export async function extractDocument(file: File): Promise<ParsedDocument> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = getExtension(file.name);
  const warnings: string[] = [];

  if (excelExtensions.has(extension)) {
    const sheets = await extractExcel(buffer);
    return baseDocument(file, "excel", sheets, sheetsToText(sheets), warnings);
  }

  if (wordExtensions.has(extension)) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.length) {
      warnings.push(...result.messages.map((message) => message.message));
    }
    return baseDocument(file, "word", [], result.value, warnings);
  }

  if (pdfExtensions.has(extension)) {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return {
      ...baseDocument(file, "pdf", [], result.text, warnings),
      meta: {
        size: file.size,
        extractedAt: new Date().toISOString(),
        pageCount: result.numpages
      }
    };
  }

  if (file.type.startsWith("text/") || extension === "txt") {
    return baseDocument(file, "text", [], buffer.toString("utf8"), warnings);
  }

  throw new Error("暂不支持该文件格式，请上传 xlsx/xls/docx/pdf/txt 文件。");
}

async function extractExcel(buffer: Buffer): Promise<ParsedSheet[]> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(buffer, {
    type: "buffer",
    cellDates: false,
    dense: false,
    raw: false
  });

  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const rows = xlsx.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      defval: "",
      blankrows: true,
      raw: false
    });
    const normalized = rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
    const colCount = normalized.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      name,
      rows: normalized,
      rowCount: normalized.length,
      colCount
    };
  });
}

function baseDocument(
  file: File,
  kind: FileKind,
  sheets: ParsedSheet[],
  text: string,
  warnings: string[]
): ParsedDocument {
  return {
    fileName: file.name,
    kind,
    sheets,
    text,
    warnings,
    meta: {
      size: file.size,
      extractedAt: new Date().toISOString()
    }
  };
}

function sheetsToText(sheets: ParsedSheet[]) {
  return sheets
    .map((sheet) => [`# ${sheet.name}`, ...sheet.rows.map((row) => row.join("\t"))].join("\n"))
    .join("\n\n");
}

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}
