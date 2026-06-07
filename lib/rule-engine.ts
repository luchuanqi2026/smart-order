import {
  FIELD_KEYS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  type FieldKey,
  type OrderRow,
  type ParsedDocument,
  type ParsedSheet,
  type ParserRule,
  type RuleMapping,
  type SourceRef,
  type ValidationIssue
} from "./types";

const fieldHints: Record<FieldKey, string[]> = {
  externalCode: ["外部", "编码", "单号", "订单", "配送", "编号", "code", "no"],
  storeName: ["门店", "店铺", "机构", "客户", "收货单位", "收货方"],
  recipientName: ["收件人", "联系人", "姓名", "收货人"],
  recipientPhone: ["电话", "手机", "联系方式", "tel", "phone"],
  recipientAddress: ["地址", "收货地址", "详细地址"],
  skuCode: ["sku", "物品编码", "商品编码", "货号", "条码", "编码"],
  skuName: ["物品名称", "商品名称", "品名", "名称", "菜品", "产品"],
  quantity: ["数量", "发货数量", "实发", "应发", "qty", "num"],
  spec: ["规格", "型号", "单位", "包装"],
  remark: ["备注", "说明", "附言"]
};

const emptyRow = (partial: Partial<OrderRow> = {}): OrderRow => ({
  id: cryptoId(),
  externalCode: "",
  storeName: "",
  recipientName: "",
  recipientPhone: "",
  recipientAddress: "",
  skuCode: "",
  skuName: "",
  quantity: "",
  spec: "",
  remark: "",
  ...partial
});

export function cryptoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyRule(name = "新解析规则"): ParserRule {
  const now = new Date().toISOString();
  return {
    id: cryptoId(),
    name,
    description: "从样例文件生成，可继续微调字段映射和结构选项。",
    strategy: "table",
    mappings: FIELD_KEYS.map((field) => ({
      field,
      required: REQUIRED_FIELDS.includes(field),
      source: { type: "column", columnIndex: undefined, inferred: false }
    })),
    table: {
      sheetMode: "first",
      headerRows: [1],
      dataStartRow: 2,
      skipRowsContaining: ["合计", "小计", "总计"],
      stopRowsContaining: [],
      carryDownFields: ["externalCode", "storeName", "recipientName", "recipientPhone", "recipientAddress"]
    },
    matrix: {
      sheetMode: "first",
      storeHeaderRow: 1,
      dataStartRow: 2,
      skuNameColumn: 1,
      storeColumnStart: 2,
      externalCodeTemplate: "{sheet}-{store}"
    },
    text: {
      recordSeparatorPattern: "\\n\\s*\\n",
      itemLinePattern: "(?<skuName>[^x×\\n]+)[x×](?<quantity>\\d+(?:\\.\\d+)?)"
    },
    cards: {
      startPattern: "(出库|调拨|配送|订单)",
      fieldLinePattern: "(?<key>[^:：\\n]{2,12})[:：](?<value>[^\\n]+)",
      itemLinePattern: "(?<skuName>[^x×\\n]+)[x×](?<quantity>\\d+(?:\\.\\d+)?)"
    },
    inferredFields: [],
    createdAt: now,
    updatedAt: now
  };
}

export function suggestRuleFromDocument(doc: ParsedDocument): ParserRule {
  const rule = createEmptyRule(`${doc.fileName.replace(/\.[^.]+$/, "")} 推荐规则`);
  const sheet = doc.sheets[0];

  if (!sheet && doc.text.trim()) {
    rule.strategy = "text";
    rule.description = "根据纯文本内容生成的规则草案，字段正则需要人工确认。";
    rule.mappings = FIELD_KEYS.map((field) => ({
      field,
      required: REQUIRED_FIELDS.includes(field),
      source: {
        type: "regex",
        pattern: `${FIELD_LABELS[field]}[:：\\s]+([^\\n]+)`,
        groupIndex: 1,
        inferred: true,
        confidence: 0.48,
        note: "基于字段名的推测正则"
      }
    }));
    rule.inferredFields = [...FIELD_KEYS];
    return rule;
  }

  if (!sheet) {
    return rule;
  }

  const matrixGuess = guessMatrix(sheet);
  if (matrixGuess) {
    rule.strategy = "matrix";
    rule.description = "检测到横向展开的门店/日期列，已生成矩阵转置规则草案。";
    rule.matrix = {
      ...rule.matrix,
      ...matrixGuess
    };
    rule.mappings = [
      {
        field: "externalCode",
        required: true,
        source: {
          type: "static",
          value: "{sheet}-{store}",
          inferred: true,
          confidence: 0.62,
          note: "矩阵模式默认按工作表和门店聚合"
        }
      },
      {
        field: "storeName",
        source: { type: "sheetName", inferred: true, confidence: 0.55 }
      }
    ];
    rule.inferredFields = ["externalCode", "storeName"];
    return rule;
  }

  const headerGuess = guessHeaderRows(sheet);
  const headers = buildHeaders(sheet, headerGuess.headerRows);
  rule.table.headerRows = headerGuess.headerRows;
  rule.table.dataStartRow = headerGuess.dataStartRow;
  rule.table.sheetMode = doc.sheets.length > 1 ? "all" : "first";

  const inferred: FieldKey[] = [];
  rule.mappings = FIELD_KEYS.map((field) => {
    const match = bestHeaderMatch(field, headers);
    if (match && match.score >= 0.12) {
      inferred.push(field);
      return {
        field,
        required: REQUIRED_FIELDS.includes(field),
        source: {
          type: "column",
          columnIndex: match.index,
          headerText: headers[match.index],
          inferred: true,
          confidence: Math.min(0.95, match.score),
          note: "根据表头文本相似度推测"
        }
      };
    }
    return {
      field,
      required: REQUIRED_FIELDS.includes(field),
      source: {
        type: "column",
        inferred: false,
        confidence: 0.1,
        note: "未找到高置信度映射，需要人工选择"
      }
    };
  });
  rule.inferredFields = inferred;
  return rule;
}

export function buildHeaders(sheet: ParsedSheet, headerRows: number[]) {
  const maxCols = sheet.colCount || Math.max(0, ...sheet.rows.map((row) => row.length));
  return Array.from({ length: maxCols }, (_, colIndex) => {
    const parts = headerRows
      .map((rowNumber) => sheet.rows[rowNumber - 1]?.[colIndex] ?? "")
      .map(cleanCell)
      .filter(Boolean);
    return parts.join(" / ");
  });
}

export function getColumnOptions(doc: ParsedDocument, rule: ParserRule) {
  const sheet = doc.sheets[0];
  if (!sheet) {
    return [];
  }
  const headers =
    rule.strategy === "matrix"
      ? buildHeaders(sheet, [rule.matrix.storeHeaderRow])
      : buildHeaders(sheet, rule.table.headerRows);
  return headers.map((label, index) => ({
    index,
    label: label || `第 ${index + 1} 列`
  }));
}

export function applyRule(doc: ParsedDocument, rule: ParserRule): OrderRow[] {
  if (rule.strategy === "matrix") {
    return applyMatrixRule(doc, rule);
  }
  if (rule.strategy === "text") {
    return applyTextRule(doc, rule);
  }
  if (rule.strategy === "cards") {
    return applyCardRule(doc, rule);
  }
  return applyTableRule(doc, rule);
}

function applyTableRule(doc: ParsedDocument, rule: ParserRule) {
  const rows: OrderRow[] = [];
  const sheets = selectSheets(doc, rule.table.sheetMode);

  for (const sheet of sheets) {
    const carry = new Map<FieldKey, string>();
    const max = rule.table.dataEndRow ? Math.min(rule.table.dataEndRow, sheet.rows.length) : sheet.rows.length;
    for (let rowNumber = Math.max(1, rule.table.dataStartRow); rowNumber <= max; rowNumber += 1) {
      const row = sheet.rows[rowNumber - 1] ?? [];
      if (isEmptyRow(row)) {
        continue;
      }
      const rowText = row.join(" ");
      if (containsAny(rowText, rule.table.stopRowsContaining)) {
        break;
      }
      if (containsAny(rowText, rule.table.skipRowsContaining)) {
        continue;
      }

      const order = emptyRow({
        sourceFile: doc.fileName,
        sourceSheet: sheet.name,
        sourceRow: rowNumber
      });

      for (const mapping of rule.mappings) {
        order[mapping.field] = resolveSource(mapping.source, row, sheet, doc, carry, mapping.field);
      }

      for (const field of rule.table.carryDownFields) {
        const current = cleanCell(order[field]);
        if (current) {
          carry.set(field, current);
        } else if (carry.has(field)) {
          order[field] = carry.get(field) ?? "";
        }
      }

      if (hasMeaningfulSku(order) || order.externalCode || order.storeName || order.recipientName) {
        rows.push(order);
      }
    }
  }

  return rows;
}

function applyMatrixRule(doc: ParsedDocument, rule: ParserRule) {
  const rows: OrderRow[] = [];
  const sheets = selectSheets(doc, rule.matrix.sheetMode);

  for (const sheet of sheets) {
    const header = sheet.rows[rule.matrix.storeHeaderRow - 1] ?? [];
    const end = rule.matrix.storeColumnEnd ?? header.length;
    for (let rowNumber = Math.max(1, rule.matrix.dataStartRow); rowNumber <= sheet.rows.length; rowNumber += 1) {
      const sourceRow = sheet.rows[rowNumber - 1] ?? [];
      if (isEmptyRow(sourceRow) || containsAny(sourceRow.join(" "), ["合计", "小计", "总计"])) {
        continue;
      }
      const skuName = cleanCell(sourceRow[rule.matrix.skuNameColumn - 1]);
      const skuCode = rule.matrix.skuCodeColumn ? cleanCell(sourceRow[rule.matrix.skuCodeColumn - 1]) : skuName;
      const spec = rule.matrix.specColumn ? cleanCell(sourceRow[rule.matrix.specColumn - 1]) : "";
      const remark = rule.matrix.remarkColumn ? cleanCell(sourceRow[rule.matrix.remarkColumn - 1]) : "";
      if (!skuName && !skuCode) {
        continue;
      }
      for (let col = rule.matrix.storeColumnStart - 1; col < end; col += 1) {
        const quantity = cleanCell(sourceRow[col]);
        const storeName = cleanCell(header[col]);
        if (!storeName || !quantity || Number(quantity) <= 0) {
          continue;
        }
        const externalCode = rule.matrix.externalCodeTemplate
          .replaceAll("{sheet}", sheet.name)
          .replaceAll("{store}", storeName)
          .replaceAll("{row}", String(rowNumber));
        rows.push(
          emptyRow({
            externalCode,
            storeName,
            skuCode,
            skuName,
            quantity,
            spec,
            remark,
            sourceFile: doc.fileName,
            sourceSheet: sheet.name,
            sourceRow: rowNumber
          })
        );
      }
    }
  }

  return rows;
}

function applyTextRule(doc: ParsedDocument, rule: ParserRule) {
  const blocks = splitByPattern(doc.text, rule.text.recordSeparatorPattern).filter((block) => block.trim());
  const rows: OrderRow[] = [];

  blocks.forEach((block, index) => {
    const base = emptyRow({
      sourceFile: doc.fileName,
      sourceSheet: "文本",
      sourceRow: index + 1
    });
    for (const mapping of rule.mappings) {
      if (mapping.source.type === "regex") {
        base[mapping.field] = resolveRegex(mapping.source, block);
      }
    }
    const itemRegex = safeRegex(rule.text.itemLinePattern, "g");
    const itemMatches = itemRegex ? Array.from(block.matchAll(itemRegex)) : [];
    if (itemMatches.length === 0) {
      rows.push(base);
      return;
    }
    for (const match of itemMatches) {
      rows.push({
        ...base,
        id: cryptoId(),
        skuCode: match.groups?.skuCode ?? base.skuCode,
        skuName: match.groups?.skuName ?? base.skuName,
        quantity: match.groups?.quantity ?? base.quantity,
        spec: match.groups?.spec ?? base.spec,
        remark: match.groups?.remark ?? base.remark
      });
    }
  });

  return rows;
}

function applyCardRule(doc: ParsedDocument, rule: ParserRule) {
  const chunks = doc.sheets.flatMap((sheet) => chunkSheet(sheet, rule.cards.startPattern));
  const rows: OrderRow[] = [];

  chunks.forEach((chunk, index) => {
    const text = chunk.rows.map((row) => row.join(" ")).join("\n");
    const base = emptyRow({
      sourceFile: doc.fileName,
      sourceSheet: chunk.sheetName,
      sourceRow: chunk.startRow
    });
    const fieldRegex = safeRegex(rule.cards.fieldLinePattern, "g");
    const fieldMap = new Map<string, string>();
    if (fieldRegex) {
      for (const match of text.matchAll(fieldRegex)) {
        const key = match.groups?.key?.trim() ?? "";
        const value = match.groups?.value?.trim() ?? "";
        if (key && value) {
          fieldMap.set(key, value);
        }
      }
    }
    for (const mapping of rule.mappings) {
      if (mapping.source.type === "static" || mapping.source.type === "sheetName") {
        base[mapping.field] = resolveSource(mapping.source, [], { name: chunk.sheetName, rows: chunk.rows, rowCount: chunk.rows.length, colCount: 0 }, doc, new Map(), mapping.field);
      } else if (mapping.source.headerText) {
        base[mapping.field] = fieldMap.get(mapping.source.headerText) ?? "";
      }
    }
    const itemRegex = safeRegex(rule.cards.itemLinePattern, "g");
    const itemMatches = itemRegex ? Array.from(text.matchAll(itemRegex)) : [];
    if (itemMatches.length === 0) {
      rows.push({ ...base, id: `${base.id}-${index}` });
      return;
    }
    for (const match of itemMatches) {
      rows.push({
        ...base,
        id: cryptoId(),
        skuCode: match.groups?.skuCode ?? base.skuCode,
        skuName: match.groups?.skuName ?? base.skuName,
        quantity: match.groups?.quantity ?? base.quantity,
        spec: match.groups?.spec ?? base.spec,
        remark: match.groups?.remark ?? base.remark
      });
    }
  });

  return rows;
}

function resolveSource(
  source: SourceRef,
  row: string[],
  sheet: ParsedSheet,
  doc: ParsedDocument,
  carry: Map<FieldKey, string>,
  field: FieldKey
) {
  if (source.type === "column") {
    return source.columnIndex === undefined ? "" : cleanCell(row[source.columnIndex]);
  }
  if (source.type === "previousNonEmpty") {
    const current = source.columnIndex === undefined ? "" : cleanCell(row[source.columnIndex]);
    if (current) {
      carry.set(field, current);
      return current;
    }
    return carry.get(field) ?? "";
  }
  if (source.type === "static") {
    return cleanCell(source.value ?? "");
  }
  if (source.type === "sheetName") {
    return cleanCell(sheet.name);
  }
  if (source.type === "rowCell") {
    if (source.rowIndex === undefined || source.cellIndex === undefined) {
      return "";
    }
    return cleanCell(sheet.rows[source.rowIndex - 1]?.[source.cellIndex - 1]);
  }
  if (source.type === "regex") {
    return resolveRegex(source, doc.text || sheet.rows.map((cells) => cells.join(" ")).join("\n"));
  }
  return "";
}

function resolveRegex(source: SourceRef, text: string) {
  const regex = safeRegex(source.pattern ?? "", source.flags ?? "");
  if (!regex) {
    return "";
  }
  const match = text.match(regex);
  if (!match) {
    return "";
  }
  return cleanCell(match[source.groupIndex ?? 1] ?? match[0]);
}

export function validateRows(rows: OrderRow[], existingCodes = new Set<string>()) {
  const issues: ValidationIssue[] = [];
  const lineCount = new Map<string, number>();
  rows.forEach((row) => {
    const key = duplicateLineKey(row);
    if (key) {
      lineCount.set(key, (lineCount.get(key) ?? 0) + 1);
    }
  });

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    for (const field of REQUIRED_FIELDS) {
      if (!cleanCell(row[field])) {
        issues.push({
          rowId: row.id,
          rowNumber,
          field,
          message: `${FIELD_LABELS[field]}不能为空`,
          severity: "error"
        });
      }
    }

    const hasStoreMode = Boolean(cleanCell(row.storeName));
    const hasRecipientMode = Boolean(row.recipientName && row.recipientPhone && row.recipientAddress);
    if (!hasStoreMode && !hasRecipientMode) {
      issues.push({
        rowId: row.id,
        rowNumber,
        field: "row",
        message: "收货门店或收件人姓名/电话/地址至少填写一组",
        severity: "error"
      });
    }

    if (row.recipientPhone && !isLikelyPhone(row.recipientPhone)) {
      issues.push({
        rowId: row.id,
        rowNumber,
        field: "recipientPhone",
        message: "电话格式不正确",
        severity: "error"
      });
    }

    if (row.quantity && !(Number(row.quantity) > 0)) {
      issues.push({
        rowId: row.id,
        rowNumber,
        field: "quantity",
        message: "发货数量必须为正数",
        severity: "error"
      });
    }

    const duplicateKey = duplicateLineKey(row);
    if (duplicateKey && (lineCount.get(duplicateKey) ?? 0) > 1) {
      issues.push({
        rowId: row.id,
        rowNumber,
        field: "externalCode",
        message: "本批次外部编码与 SKU 重复",
        severity: "error"
      });
    }

    if (row.externalCode && existingCodes.has(row.externalCode)) {
      issues.push({
        rowId: row.id,
        rowNumber,
        field: "externalCode",
        message: "外部编码已存在于历史运单",
        severity: "error"
      });
    }
  });

  return issues;
}

function duplicateLineKey(row: OrderRow) {
  const externalCode = cleanCell(row.externalCode);
  const skuCode = cleanCell(row.skuCode || row.skuName);
  if (!externalCode || !skuCode) {
    return "";
  }
  return `${externalCode}::${skuCode}`;
}

export function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function selectSheets(doc: ParsedDocument, mode: "first" | "all") {
  if (mode === "all") {
    return doc.sheets;
  }
  return doc.sheets.slice(0, 1);
}

function guessHeaderRows(sheet: ParsedSheet) {
  const sample = sheet.rows.slice(0, Math.min(sheet.rows.length, 20));
  const scored = sample.map((row, index) => {
    const textScore = row.reduce((score, cell) => {
      const value = cleanCell(cell);
      if (!value) return score;
      const matchedHints = Object.values(fieldHints).flat().filter((hint) => value.toLowerCase().includes(hint.toLowerCase())).length;
      return score + 1 + matchedHints * 1.8;
    }, 0);
    return { index, score: textScore, width: row.filter(Boolean).length };
  });
  scored.sort((a, b) => b.score - a.score || b.width - a.width);
  const best = scored[0]?.index ?? 0;
  const previous = best > 0 && scored.find((row) => row.index === best - 1 && row.width > 2) ? best : undefined;
  return {
    headerRows: previous ? [previous, best + 1] : [best + 1],
    dataStartRow: best + 2
  };
}

function bestHeaderMatch(field: FieldKey, headers: string[]) {
  const hints = fieldHints[field];
  let best: { index: number; score: number } | undefined;
  headers.forEach((header, index) => {
    const lowered = header.toLowerCase();
    if (!lowered) return;
    let score = 0;
    for (const hint of hints) {
      const normalizedHint = hint.toLowerCase();
      if (lowered === normalizedHint) {
        score += 0.8;
      } else if (lowered.includes(normalizedHint)) {
        score += 0.45;
      }
    }
    if (FIELD_LABELS[field] && lowered.includes(FIELD_LABELS[field].toLowerCase())) {
      score += 0.7;
    }
    if (field === "quantity" && /发货数量|实发/.test(header)) {
      score += 0.28;
    }
    score = score / Math.max(1, Math.log2(lowered.length + 2));
    if (!best || score > best.score) {
      best = { index, score };
    }
  });
  return best;
}

function guessMatrix(sheet: ParsedSheet) {
  const rows = sheet.rows.slice(0, Math.min(12, sheet.rows.length));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const filled = row.map(cleanCell).filter(Boolean);
    if (filled.length < 6) {
      continue;
    }
    const leftText = row.slice(0, 4).join(" ");
    const hasSkuSide = /sku|物品|商品|品名|名称|编码/i.test(leftText);
    const rightDense = row.slice(3).filter((cell) => cleanCell(cell)).length >= 3;
    const rightHeaders = row.slice(3).map(cleanCell).filter(Boolean);
    const semanticHeaderCount = rightHeaders.filter((cell) => hasKnownFieldHint(cell)).length;
    const looksLikeWideBusinessTable = semanticHeaderCount / Math.max(1, rightHeaders.length) > 0.28;
    if (hasSkuSide && rightDense && !looksLikeWideBusinessTable) {
      return {
        sheetMode: "first" as const,
        storeHeaderRow: rowIndex + 1,
        dataStartRow: rowIndex + 2,
        skuNameColumn: 1,
        skuCodeColumn: undefined,
        storeColumnStart: 3,
        externalCodeTemplate: "{sheet}-{store}"
      };
    }
  }
  return undefined;
}

function hasKnownFieldHint(value: string) {
  const lowered = value.toLowerCase();
  return Object.values(fieldHints)
    .flat()
    .some((hint) => lowered.includes(hint.toLowerCase()));
}

function containsAny(text: string, needles: string[]) {
  return needles.filter(Boolean).some((needle) => text.includes(needle));
}

function isEmptyRow(row: string[]) {
  return row.every((cell) => !cleanCell(cell));
}

function hasMeaningfulSku(row: OrderRow) {
  return Boolean(cleanCell(row.skuCode) || cleanCell(row.skuName) || cleanCell(row.quantity));
}

function isLikelyPhone(value: string) {
  const normalized = value.replace(/[^\d+]/g, "");
  return /^1[3-9]\d{9}$/.test(normalized) || /^\+?\d{6,20}$/.test(normalized);
}

function safeRegex(pattern: string, flags: string) {
  if (!pattern) {
    return undefined;
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    return undefined;
  }
}

function splitByPattern(text: string, pattern: string) {
  const regex = safeRegex(pattern, "g");
  if (!regex) {
    return [text];
  }
  return text.split(regex);
}

function chunkSheet(sheet: ParsedSheet, startPattern: string) {
  const startRegex = safeRegex(startPattern, "i");
  const chunks: Array<{ sheetName: string; startRow: number; rows: string[][] }> = [];
  let current: { sheetName: string; startRow: number; rows: string[][] } | undefined;

  sheet.rows.forEach((row, index) => {
    const text = row.join(" ");
    const starts = startRegex ? startRegex.test(text) : isEmptyRow(row);
    if (starts || (!current && !isEmptyRow(row))) {
      if (current && current.rows.length) {
        chunks.push(current);
      }
      current = { sheetName: sheet.name, startRow: index + 1, rows: [row] };
      return;
    }
    if (current && !isEmptyRow(row)) {
      current.rows.push(row);
    }
  });

  if (current && current.rows.length) {
    chunks.push(current);
  }

  return chunks;
}
