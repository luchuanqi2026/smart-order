export const FIELD_KEYS = [
  "externalCode",
  "storeName",
  "recipientName",
  "recipientPhone",
  "recipientAddress",
  "skuCode",
  "skuName",
  "quantity",
  "spec",
  "remark"
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  externalCode: "外部编码",
  storeName: "收货门店",
  recipientName: "收件人姓名",
  recipientPhone: "收件人电话",
  recipientAddress: "收件人地址",
  skuCode: "SKU物品编码",
  skuName: "SKU物品名称",
  quantity: "SKU发货数量",
  spec: "SKU规格型号",
  remark: "备注"
};

export const REQUIRED_FIELDS: FieldKey[] = [
  "externalCode",
  "skuCode",
  "skuName",
  "quantity"
];

export type FileKind = "excel" | "word" | "pdf" | "text";

export type RuleStrategy = "table" | "matrix" | "cards" | "text";

export interface ParsedSheet {
  name: string;
  rows: string[][];
  rowCount: number;
  colCount: number;
}

export interface ParsedDocument {
  fileName: string;
  kind: FileKind;
  sheets: ParsedSheet[];
  text: string;
  warnings: string[];
  meta: {
    size: number;
    extractedAt: string;
    pageCount?: number;
  };
}

export type SourceType =
  | "column"
  | "static"
  | "sheetName"
  | "regex"
  | "rowCell"
  | "previousNonEmpty";

export interface SourceRef {
  type: SourceType;
  columnIndex?: number;
  headerText?: string;
  value?: string;
  pattern?: string;
  flags?: string;
  rowIndex?: number;
  cellIndex?: number;
  groupIndex?: number;
  confidence?: number;
  inferred?: boolean;
  note?: string;
}

export interface RuleMapping {
  field: FieldKey;
  source: SourceRef;
  required?: boolean;
}

export interface TableOptions {
  sheetMode: "first" | "all";
  headerRows: number[];
  dataStartRow: number;
  dataEndRow?: number;
  skipRowsContaining: string[];
  stopRowsContaining: string[];
  carryDownFields: FieldKey[];
}

export interface MatrixOptions {
  sheetMode: "first" | "all";
  storeHeaderRow: number;
  dataStartRow: number;
  skuCodeColumn?: number;
  skuNameColumn: number;
  specColumn?: number;
  remarkColumn?: number;
  storeColumnStart: number;
  storeColumnEnd?: number;
  externalCodeTemplate: string;
}

export interface TextOptions {
  recordSeparatorPattern: string;
  itemLinePattern: string;
}

export interface CardOptions {
  startPattern: string;
  fieldLinePattern: string;
  itemLinePattern: string;
}

export interface ParserRule {
  id: string;
  name: string;
  description: string;
  strategy: RuleStrategy;
  mappings: RuleMapping[];
  table: TableOptions;
  matrix: MatrixOptions;
  text: TextOptions;
  cards: CardOptions;
  inferredFields: FieldKey[];
  createdAt: string;
  updatedAt: string;
}

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  rowId: string;
  rowNumber: number;
  field: FieldKey | "row";
  message: string;
  severity: ValidationSeverity;
}

export interface OrderRow {
  id: string;
  externalCode: string;
  storeName: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  skuCode: string;
  skuName: string;
  quantity: string;
  spec: string;
  remark: string;
  sourceFile?: string;
  sourceSheet?: string;
  sourceRow?: number;
  submittedAt?: string;
}

export interface StoredRuleRecord {
  id: string;
  rule: ParserRule;
  updatedAt: string;
}

export interface StoredOrderRecord {
  id: string;
  row: OrderRow;
  submittedAt: string;
}
