import { NextResponse } from "next/server";
import { readAiConfig } from "@/lib/ai-config.server";
import { suggestRuleFromDocument } from "@/lib/rule-engine";
import { FIELD_KEYS, type FieldKey, type ParsedDocument, type ParserRule, type RuleMapping, type SourceRef, type SourceType } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { document?: ParsedDocument };
    if (!body.document) {
      return NextResponse.json({ error: "缺少文件解析结果。" }, { status: 400 });
    }

    const heuristicRule = suggestRuleFromDocument(body.document);
    const llmRule = await generateRuleWithLlm(body.document, heuristicRule);
    return NextResponse.json({
      rule: llmRule ?? heuristicRule,
      aiEnabled: Boolean(llmRule),
      note: llmRule ? "已由大模型生成规则草案。" : "未配置大模型 Key，已使用本地启发式规则草案。"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成规则失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function generateRuleWithLlm(document: ParsedDocument, fallbackRule: ParserRule) {
  const provider = await getProvider();
  if (!provider) {
    return undefined;
  }

  const sample = compactDocumentSample(document);
  const prompt = [
    "你是物流出库单解析规则设计助手。",
    "任务：只生成一份可编辑解析规则 JSON，不要直接解析业务数据。",
    "规则必须符合给定 TypeScript 结构，保留 fallbackRule 中已有字段，必要时调整 strategy、mappings、table/matrix/text/cards。",
    "所有推测映射 source.inferred=true，并写 confidence 与 note。",
    "禁止根据文件名分支，只能根据文档结构、表头、位置、正则来描述规则。",
    "",
    "目标字段：外部编码、收货门店、收件人姓名、收件人电话、收件人地址、SKU物品编码、SKU物品名称、SKU发货数量、SKU规格型号、备注。",
    "",
    `fallbackRule=${JSON.stringify(fallbackRule)}`,
    `documentSample=${JSON.stringify(sample)}`
  ].join("\n");

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.key}`
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: provider.temperature,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你输出严格 JSON，顶层对象必须包含 rule 字段。"
        },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    return undefined;
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(content) as { rule?: Partial<ParserRule> } & Partial<ParserRule>;
    const candidate = parsed.rule ?? parsed;
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }
    return normalizeGeneratedRule(fallbackRule, candidate);
  } catch {
    return undefined;
  }
}

const validSourceTypes = new Set<SourceType>(["column", "static", "sheetName", "regex", "rowCell", "previousNonEmpty"]);

function normalizeGeneratedRule(fallbackRule: ParserRule, candidate: Partial<ParserRule>) {
  const next: ParserRule = {
    ...fallbackRule,
    ...candidate,
    id: fallbackRule.id,
    createdAt: fallbackRule.createdAt,
    updatedAt: new Date().toISOString(),
    mappings: FIELD_KEYS.map((field) => normalizeMapping(field, candidate.mappings, fallbackRule.mappings))
  };
  return next;
}

function normalizeMapping(field: FieldKey, candidateMappings: unknown, fallbackMappings: RuleMapping[]) {
  const fallback = fallbackMappings.find((mapping) => mapping.field === field) ?? {
    field,
    required: false,
    source: { type: "column" as SourceType }
  };
  if (!Array.isArray(candidateMappings)) {
    return fallback;
  }
  const raw = candidateMappings.find((item) => isRecord(item) && item.field === field);
  if (!isRecord(raw)) {
    return fallback;
  }

  const rawSource = isRecord(raw.source) ? raw.source : undefined;
  const sourceType = typeof rawSource?.type === "string" && validSourceTypes.has(rawSource.type as SourceType)
    ? rawSource.type as SourceType
    : fallback.source.type;
  const source = rawSource
    ? ({
        ...fallback.source,
        ...rawSource,
        type: sourceType
      } as SourceRef)
    : fallback.source;

  return {
    ...fallback,
    ...raw,
    field,
    required: typeof raw.required === "boolean" ? raw.required : fallback.required,
    source
  } as RuleMapping;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function getProvider() {
  const config = await readAiConfig();
  if (!config) {
    return undefined;
  }
  const baseUrl = config.provider === "openai" && !config.baseUrl ? "https://api.openai.com/v1" : config.baseUrl;
  return {
    url: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    key: config.apiKey,
    model: config.model,
    temperature: config.temperature ?? 0.1
  };
}

function compactDocumentSample(document: ParsedDocument) {
  return {
    fileName: document.fileName,
    kind: document.kind,
    sheets: document.sheets.slice(0, 3).map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      rows: sheet.rows.slice(0, 18).map((row) => row.slice(0, 36))
    })),
    text: document.text.slice(0, 8000)
  };
}
