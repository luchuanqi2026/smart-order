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
  if (doc.sheets.length && rule.strategy === "text") {
    const fallback = suggestRuleFromDocument(doc);
    if (looksLikeCardDocument(doc)) {
      fallback.strategy = "cards";
      return applyCardRule(doc, fallback);
    }
    return applyTableRule(doc, fallback);
  }
  if (!doc.sheets.length && doc.text.trim()) {
    return applyTextRule(doc, rule);
  }
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
    const headers = buildHeaders(sheet, effectiveHeaderRows(sheet, rule));
    const sheetBase = extractSheetBaseFields(sheet);
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
        const source = alignColumnSource(mapping.source, headers, mapping.field);
        order[mapping.field] = resolveSource(source, row, sheet, doc, carry, mapping.field);
      }

      repairTableOrderFromHeaders(order, row, headers, sheet.name, rowNumber);

      if (isLikelyHeaderOrder(order, rule.mappings)) {
        continue;
      }

      applySheetBase(order, sheetBase, sheet.name, rowNumber);

      for (const field of rule.table.carryDownFields) {
        const current = cleanCell(order[field]);
        if (current) {
          carry.set(field, current);
        } else if (carry.has(field)) {
          order[field] = carry.get(field) ?? "";
        }
      }

      if (hasTableLineItem(order)) {
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
  const structuredRows = applyStructuredTextFallback(doc, rule);
  if (structuredRows.length) {
    return structuredRows;
  }

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
    const text = chunk.rows.map((row) => row.join("\t")).join("\n");
    const globalText = doc.text || doc.sheets.map((sheet) => sheet.rows.map((row) => row.join("\t")).join("\n")).join("\n");
    const keyValues = collectAdjacentKeyValues(chunk.rows);
    const base = emptyRow({
      sourceFile: doc.fileName,
      sourceSheet: chunk.sheetName,
      sourceRow: chunk.startRow
    });
    const fieldRegex = safeRegex(rule.cards.fieldLinePattern, "g");
    const fieldMap = new Map(keyValues);
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
      } else if (mapping.source.type === "regex") {
        base[mapping.field] = resolveRegex(mapping.source, `${globalText}\n${text}`);
      } else if (mapping.source.headerText) {
        base[mapping.field] = fieldMap.get(mapping.source.headerText) ?? "";
      }
    }

    base.externalCode ||= findByPatterns(`${globalText}\n${text}`, [
      /(?:调拨单号|配送单号|单据编号)[:：]\s*([A-Z0-9-]+)/i
    ]);
    base.storeName ||= fieldMap.get("调入门店") ?? fieldMap.get("收货门店") ?? "";
    base.recipientName ||= fieldMap.get("收货人") ?? "";
    base.recipientPhone ||= fieldMap.get("电话") ?? fieldMap.get("联系电话") ?? "";
    base.recipientAddress ||= fieldMap.get("收货地址") ?? "";

    const itemRows = buildCardItemRows(chunk, rule, base);
    if (itemRows.length) {
      rows.push(...itemRows);
      return;
    }

    const itemRegex = safeRegex(rule.cards.itemLinePattern, "g");
    const itemMatches = itemRegex ? Array.from(text.matchAll(itemRegex)) : [];
    if (itemMatches.length === 0 && hasMeaningfulSku(base)) {
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

function applyStructuredTextFallback(doc: ParsedDocument, rule: ParserRule) {
  const detectedBase = extractTextBaseFields(doc.text);
  const base = emptyRow({
    ...detectedBase,
    sourceFile: doc.fileName,
    sourceSheet: "文本",
    sourceRow: 1
  });

  for (const mapping of rule.mappings) {
    if (mapping.source.type === "regex") {
      const value = resolveRegex(mapping.source, doc.text);
      if (value) {
        base[mapping.field] = value;
      }
    }
  }

  Object.assign(base, detectedBase);

  const itemBlocks: Array<{ text: string; lineNumber: number }> = [];
  const lines = doc.text.split(/\r?\n/).map(cleanCell).filter(Boolean);
  let current = "";
  let startLine = 0;

  lines.forEach((line, index) => {
    if (isTextItemStart(line)) {
      if (current) {
        itemBlocks.push({ text: current, lineNumber: startLine });
      }
      current = line;
      startLine = index + 1;
      return;
    }
    if (!current) {
      return;
    }
    if (isTextBoundaryLine(line)) {
      itemBlocks.push({ text: current, lineNumber: startLine });
      current = "";
      startLine = 0;
      return;
    }
    current += line;
  });

  if (current) {
    itemBlocks.push({ text: current, lineNumber: startLine });
  }

  return itemBlocks
    .map((block) => parseTextItemLine(block.text, base, block.lineNumber))
    .filter((row): row is OrderRow => Boolean(row));
}

function buildCardItemRows(
  chunk: { sheetName: string; startRow: number; rows: string[][] },
  rule: ParserRule,
  base: OrderRow
) {
  const headerIndex = chunk.rows.findIndex((row) => {
    const text = row.map(cleanCell).join(" ");
    return /物品编码|商品编码|SKU/i.test(text) && /物品名称|商品名称|品名|名称/.test(text) && /数量|发货数量|出库数量/.test(text);
  });
  if (headerIndex < 0) {
    return [];
  }

  const header = chunk.rows[headerIndex].map(cleanCell);
  const rows: OrderRow[] = [];
  for (let index = headerIndex + 1; index < chunk.rows.length; index += 1) {
    const sourceRow = chunk.rows[index] ?? [];
    const rowText = sourceRow.map(cleanCell).join(" ");
    if (isEmptyRow(sourceRow) || containsAny(rowText, ["合计", "小计", "总计"])) {
      break;
    }

    const order = {
      ...base,
      id: cryptoId(),
      sourceRow: chunk.startRow + index
    };

    for (const mapping of rule.mappings) {
      if (mapping.source.type !== "column") {
        continue;
      }
      if (!isItemField(mapping.field)) {
        continue;
      }
      const columnIndex = mapping.source.columnIndex ?? findHeaderColumn(header, mapping.source.headerText, mapping.field);
      if (columnIndex !== undefined) {
        order[mapping.field] = cleanCell(sourceRow[columnIndex]);
      }
    }

    order.skuCode ||= cleanCell(sourceRow[0]);
    order.skuName ||= cleanCell(sourceRow[1]);
    order.spec ||= cleanCell(sourceRow[2]);
    order.quantity ||= cleanCell(sourceRow[3]);

    if (!isLikelyHeaderOrder(order, rule.mappings) && hasMeaningfulSku(order)) {
      rows.push(order);
    }
  }

  return rows;
}

function collectAdjacentKeyValues(rows: string[][]) {
  const values = new Map<string, string>();
  for (const row of rows) {
    if (isHeaderLikeRow(row)) {
      continue;
    }
    for (let index = 0; index < row.length; index += 1) {
      const key = cleanCell(row[index]).replace(/[:：]$/, "");
      const value = cleanCell(row[index + 1]);
      const inline = cleanCell(row[index]).match(/^([^:：]{2,12})[:：]\s*(.+)$/);
      if (inline?.[1] && inline[2]) {
        values.set(inline[1], inline[2]);
      }
      if (key && value && !isLikelyHeaderText(value) && /门店|收货人|联系人|电话|地址|单号|编号/.test(key)) {
        values.set(key, value);
      }
    }
  }
  return values;
}

function looksLikeCardDocument(doc: ParsedDocument) {
  return doc.sheets.some((sheet) =>
    sheet.rows.some((row) => /(?:^|\s)(?:▶\s*)?(?:调拨|配送|订单|出库)?记录\s*#?\s*\d+/i.test(row.map(cleanCell).join(" ")))
  );
}

function extractSheetBaseFields(sheet: ParsedSheet): Partial<OrderRow> {
  const values = collectAdjacentKeyValues(sheet.rows);
  const sheetNameAsStore = looksLikeStoreSheetName(sheet.name) ? sheet.name : "";
  return {
    externalCode: findByPatterns(sheet.rows.map((row) => row.join("\t")).join("\n"), [
      /(?:单据编号|配送单号|调拨单号|订单号)[:：]\s*([A-Z0-9-]+)/i
    ]) || sheetNameAsStore,
    storeName: values.get("收货门店") ?? values.get("收货门店：") ?? values.get("调入门店") ?? sheetNameAsStore,
    recipientName: values.get("联系人") ?? values.get("收货人") ?? "",
    recipientPhone: values.get("联系电话") ?? values.get("电话") ?? "",
    recipientAddress: values.get("收货地址") ?? ""
  };
}

function applySheetBase(order: OrderRow, sheetBase: Partial<OrderRow>, sheetName: string, rowNumber: number) {
  const baseExternalCode = cleanCell(sheetBase.externalCode);
  if (
    !cleanCell(order.externalCode) ||
    isLikelySequenceNumber(order.externalCode) ||
    order.externalCode === order.skuCode ||
    (baseExternalCode && looksLikeStoreSheetName(baseExternalCode) && looksLikeStoreSheetName(order.externalCode) && order.externalCode !== baseExternalCode)
  ) {
    order.externalCode = sheetBase.externalCode || `${sheetName}-${rowNumber}`;
  }
  if (cleanCell(sheetBase.storeName) && looksLikeStoreSheetName(sheetBase.storeName ?? "")) {
    order.storeName = sheetBase.storeName ?? "";
  }
  if (cleanCell(sheetBase.recipientName)) {
    order.recipientName = sheetBase.recipientName ?? "";
  }
  if (cleanCell(sheetBase.recipientPhone)) {
    order.recipientPhone = sheetBase.recipientPhone ?? "";
  }
  if (cleanCell(sheetBase.recipientAddress)) {
    order.recipientAddress = sheetBase.recipientAddress ?? "";
  }
  if (shouldUseSheetBase(order.storeName, order, sheetBase.storeName)) {
    order.storeName = sheetBase.storeName ?? "";
  }
  if (shouldUseSheetBase(order.recipientName, order, sheetBase.recipientName)) {
    order.recipientName = sheetBase.recipientName ?? "";
  }
  if (shouldUseSheetBase(order.recipientPhone, order, sheetBase.recipientPhone)) {
    order.recipientPhone = sheetBase.recipientPhone ?? "";
  }
  if (shouldUseSheetBase(order.recipientAddress, order, sheetBase.recipientAddress)) {
    order.recipientAddress = sheetBase.recipientAddress ?? "";
  }
}

function alignColumnSource(source: SourceRef, headers: string[], field: FieldKey) {
  if (source.type !== "column" || !headers.length) {
    return source;
  }

  const matched = findHeaderColumn(headers, source.headerText, field);
  return matched === undefined ? source : { ...source, columnIndex: matched };
}

function extractTextBaseFields(text: string): Partial<OrderRow> {
  return {
    externalCode: findByPatterns(text, [/(?:单据编号|配送单号|调拨单号)[:：]\s*([A-Z0-9-]+)/i]),
    storeName: findByPatterns(text, [
      /收货机构[:：]\s*([^订供送业务\n]+)/,
      /收货门店[:：]\s*([^\n]+)/
    ]),
    recipientName: findByPatterns(text, [/收货人[:：]\s*([^\s收\n]+)/]),
    recipientPhone: findByPatterns(text, [/收货电话[:：]\s*(1[3-9]\d{9})/, /联系电话[:：]\s*(1[3-9]\d{9})/]),
    recipientAddress: findByPatterns(text, [/收货地址[:：]\s*([^\n]+)/])
  };
}

function parseTextItemLine(text: string, base: OrderRow, lineNumber: number) {
  const normalized = text.replace(/\s+/g, "");
  const match = normalized.match(/^\d+(.+?)([A-Z]{2,}[A-Z0-9]{3,})(.+)$/);
  if (!match) {
    return undefined;
  }

  const skuCode = match[2];
  const tail = match[3];
  const quantityMatch = tail.match(/^(.+?)([\u4e00-\u9fa5A-Za-z]{1,6})(\d+(?:\.\d+)?)$/);
  if (!quantityMatch) {
    return undefined;
  }

  const beforeQuantity = quantityMatch[1];
  const quantity = quantityMatch[3];
  const specIndex = beforeQuantity.search(/(?:[234]?XL码|XL码|L码|均码|\d+(?:\.\d+)?(?:kg|KG|g|ml|mL|L|个|瓶|包|桶|盒|件|码))/);
  const skuName = specIndex > 0 ? beforeQuantity.slice(0, specIndex) : beforeQuantity;
  const spec = specIndex > 0 ? beforeQuantity.slice(specIndex) : "";

  if (!skuName || !skuCode || !quantity) {
    return undefined;
  }

  return emptyRow({
    ...base,
    id: cryptoId(),
    skuCode,
    skuName,
    quantity,
    spec,
    sourceRow: lineNumber
  });
}

function findHeaderColumn(header: string[], headerText: string | undefined, field: FieldKey) {
  if (headerText) {
    const normalizedTarget = normalizeHeaderValue(headerText);
    const exact = header.findIndex((cell) => normalizeHeaderValue(cell) === normalizedTarget);
    if (exact >= 0) {
      return exact;
    }
    const fuzzy = header.findIndex((cell) => normalizeHeaderValue(cell).includes(normalizedTarget));
    if (fuzzy >= 0) {
      return fuzzy;
    }
  }

  const hints = fieldHints[field] ?? [];
  const match = header.findIndex((cell) => hints.some((hint) => cleanCell(cell).toLowerCase().includes(hint.toLowerCase())));
  return match >= 0 ? match : undefined;
}

function repairTableOrderFromHeaders(
  order: OrderRow,
  row: string[],
  headers: string[],
  sheetName: string,
  rowNumber: number
) {
  for (const field of FIELD_KEYS) {
    const columnIndex = findPreferredHeaderColumn(headers, field);
    if (columnIndex === undefined) {
      continue;
    }
    const candidate = cleanCell(row[columnIndex]);
    if (candidate && shouldRepairField(field, order[field], candidate, order, sheetName, rowNumber)) {
      order[field] = candidate;
    }
  }
}

function effectiveHeaderRows(sheet: ParsedSheet, rule: ParserRule) {
  const configured = rule.table.headerRows?.length ? rule.table.headerRows : [];
  const previousRow = rule.table.dataStartRow > 1 ? [rule.table.dataStartRow - 1] : [];
  const guessed = guessHeaderRows(sheet).headerRows;
  const scanned = sheet.rows
    .slice(0, Math.min(sheet.rows.length, 20))
    .map((_, index) => [index + 1]);
  const candidates = [configured, previousRow, guessed, ...scanned].filter((rows) => rows.length);
  const scored = candidates.map((rows) => ({
    rows,
    score: scoreHeaderRow(buildHeaders(sheet, rows))
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.rows ?? [1];
}

function scoreHeaderRow(headers: string[]) {
  const filledCount = headers.filter((header) => cleanCell(header)).length;
  const labels = new Set(
    FIELD_KEYS.flatMap((field) => [FIELD_LABELS[field], ...fieldHints[field]]).map(normalizeHeaderValue).filter(Boolean)
  );
  const semanticScore = headers.reduce((score, header) => {
    const normalized = normalizeHeaderValue(header);
    if (!normalized) {
      return score;
    }
    if (labels.has(normalized)) {
      return score + 2;
    }
    return score + (Array.from(labels).some((label) => normalized.includes(label) || label.includes(normalized)) ? 1 : 0);
  }, 0);
  return filledCount < 3 ? semanticScore * 0.2 : semanticScore + filledCount;
}

function findPreferredHeaderColumn(headers: string[], field: FieldKey) {
  const preferred: Record<FieldKey, string[]> = {
    externalCode: ["外部编码", "配送单号", "订单号", "单据编号", "编号"],
    storeName: ["收货门店", "收货机构", "收货单位", "收货方", "门店"],
    recipientName: ["收货人", "收件人", "联系人", "姓名"],
    recipientPhone: ["收货电话", "收件人电话", "联系电话", "电话", "手机"],
    recipientAddress: ["收货地址", "收件人地址", "详细地址", "地址"],
    skuCode: ["SKU物品编码", "物品编码", "商品编码", "SKU编码", "货号"],
    skuName: ["SKU物品名称", "物品名称", "商品名称", "品名"],
    quantity: ["SKU发货数量", "发货数量", "出库数量", "实发数量", "数量"],
    spec: ["SKU规格型号", "规格型号", "规格", "型号"],
    remark: ["单据备注", "备注", "说明"]
  };

  for (const label of preferred[field]) {
    const normalizedLabel = normalizeHeaderValue(label);
    const exact = headers.findIndex((header) => normalizeHeaderValue(header) === normalizedLabel);
    if (exact >= 0) {
      return exact;
    }
  }

  for (const label of preferred[field]) {
    const normalizedLabel = normalizeHeaderValue(label);
    const fuzzy = headers.findIndex((header) => {
      const normalized = normalizeHeaderValue(header);
      if (field === "externalCode" && /汇总/.test(header)) {
        return false;
      }
      return normalized.includes(normalizedLabel);
    });
    if (fuzzy >= 0) {
      return fuzzy;
    }
  }

  return undefined;
}

function shouldRepairField(
  field: FieldKey,
  current: string,
  candidate: string,
  order: OrderRow,
  sheetName: string,
  rowNumber: number
) {
  const value = cleanCell(current);
  if (!value) {
    return true;
  }
  if (isLikelyHeaderText(value)) {
    return true;
  }
  if (field === "externalCode") {
    return (
      value === order.skuCode ||
      isLikelySequenceNumber(value) ||
      value === `${sheetName}-${rowNumber}`
    );
  }
  if (field === "recipientName") {
    return isLikelyPhone(value) || /电话|地址|门店|机构/.test(value);
  }
  if (field === "recipientPhone") {
    return !isLikelyPhone(value) && isLikelyPhone(candidate);
  }
  if (field === "skuCode") {
    return isLikelySequenceNumber(value) || value === order.skuName;
  }
  if (field === "skuName") {
    return value === order.skuCode || isLikelySkuCode(value) || isLikelySequenceNumber(value);
  }
  if (field === "quantity") {
    return !(Number(value) > 0) && Number(candidate) > 0;
  }
  return false;
}

function isItemField(field: FieldKey) {
  return field === "skuCode" || field === "skuName" || field === "quantity" || field === "spec" || field === "remark";
}

function findByPatterns(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanCell(match[1]);
    }
  }
  return "";
}

function isTextItemStart(line: string) {
  return /^\d+\S*?[A-Z]{2,}[A-Z0-9]{3,}/.test(line.replace(/\s+/g, ""));
}

function isTextBoundaryLine(line: string) {
  return /物品类别.*物品编码|第\s*\d+\s*页|^合$|^计$|^合\s*计|制单日期|创建人|发货人|收货人签字|打印次数|^备注[:：]?$/.test(line);
}

function isLikelyHeaderOrder(order: OrderRow, mappings: RuleMapping[]) {
  const mappingHeaders = new Set(
    mappings
      .map((mapping) => normalizeHeaderValue(mapping.source.headerText))
      .filter(Boolean)
  );
  let hits = 0;
  for (const field of FIELD_KEYS) {
    const value = cleanCell(order[field]);
    if (!value) {
      continue;
    }
    const normalized = normalizeHeaderValue(value);
    if (mappingHeaders.has(normalized) || normalized === normalizeHeaderValue(FIELD_LABELS[field])) {
      hits += 1;
      continue;
    }
    if (/^(序号|物品编码\*?|商品编码|SKU物品编码|物品名称|商品名称|SKU物品名称|规格型号|发货数量\*?|出库数量|数量|收货机构|收货门店|配送单号|收货人|收货电话|收货地址|备注)$/.test(value)) {
      hits += 1;
    }
  }
  return hits >= 2;
}

function isLikelyHeaderText(value: string) {
  return /^(序号|物品编码\*?|商品编码|SKU物品编码|物品名称|商品名称|SKU物品名称|规格型号|发货数量\*?|出库数量|数量|收货机构|收货门店|配送单号|订单号|单据编号|收货人|收件人|联系人|收货电话|联系电话|收货地址|备注)$/.test(cleanCell(value));
}

function isHeaderLikeRow(row: string[]) {
  return row.filter((cell) => isLikelyHeaderText(cell)).length >= 3;
}

function isLikelySkuCode(value: string) {
  return /^[A-Z]{2,}[A-Z0-9]{3,}$/.test(cleanCell(value));
}

function isLikelySequenceNumber(value: string) {
  return /^\d{1,4}$/.test(cleanCell(value));
}

function shouldUseSheetBase(current: string, order: OrderRow, fallback: unknown) {
  const value = cleanCell(current);
  return Boolean(
    cleanCell(fallback) &&
      (!value ||
        value === order.skuCode ||
        value === order.skuName ||
        value === order.quantity ||
        /联系人|联系电话|收货地址|收货门店|调入门店/.test(value) ||
        isLikelySkuCode(value) ||
        isLikelySequenceNumber(value))
  );
}

function looksLikeStoreSheetName(value: string) {
  const name = cleanCell(value);
  return Boolean(name) && /店|门店/.test(name) && !/汇总|明细|模板|说明|调拨单|配送单|订单|Sheet/i.test(name);
}

function normalizeHeaderValue(value: unknown) {
  return cleanCell(value)
    .replace(/\*/g, "")
    .replace(/[：:\s/]/g, "")
    .toLowerCase();
}

function duplicateLineKey(row: OrderRow) {
  const externalCode = cleanCell(row.externalCode);
  const destination = cleanCell(row.storeName || row.recipientPhone || row.recipientName || row.recipientAddress);
  const skuCode = cleanCell(row.skuCode || row.skuName);
  if (!externalCode || !skuCode) {
    return "";
  }
  return `${externalCode}::${destination}::${skuCode}`;
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

function hasTableLineItem(row: OrderRow) {
  return Boolean(cleanCell(row.skuName) && Number(cleanCell(row.quantity)) > 0 && (cleanCell(row.skuCode) || cleanCell(row.skuName)));
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
  const specificStartRegex = /(?:^|\s)(?:▶\s*)?(?:调拨|配送|订单|出库)?记录\s*#?\s*\d+/i;
  const hasSpecificStarts = sheet.rows.some((row) => specificStartRegex.test(row.map(cleanCell).join(" ")));
  const chunks: Array<{ sheetName: string; startRow: number; rows: string[][] }> = [];
  let current: { sheetName: string; startRow: number; rows: string[][] } | undefined;

  sheet.rows.forEach((row, index) => {
    const text = row.join(" ");
    const starts = hasSpecificStarts ? specificStartRegex.test(text) : startRegex ? startRegex.test(text) : isEmptyRow(row);
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
