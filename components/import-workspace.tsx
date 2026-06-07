"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  Play,
  Plus,
  Save,
  Send,
  Trash2,
  UploadCloud,
  Wand2
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "./app-header";
import { PreviewGrid } from "./preview-grid";
import {
  applyRule,
  createEmptyRule,
  cryptoId,
  getColumnOptions,
  validateRows
} from "@/lib/rule-engine";
import {
  FIELD_KEYS,
  FIELD_LABELS,
  type FieldKey,
  type OrderRow,
  type ParsedDocument,
  type ParserRule,
  type RuleMapping,
  type SourceRef,
  type SourceType,
  type ValidationIssue
} from "@/lib/types";

type BusyState = {
  label: string;
  progress: number;
};

type AiStatus = {
  enabled: boolean;
  note: string;
  inferredFields: number;
};

type MappingPatch = Omit<Partial<RuleMapping>, "source"> & {
  source?: Partial<SourceRef>;
};

const sourceTypes: Array<{ value: SourceType; label: string }> = [
  { value: "column", label: "表格列" },
  { value: "previousNonEmpty", label: "向下填充列" },
  { value: "static", label: "固定值" },
  { value: "sheetName", label: "Sheet 名" },
  { value: "regex", label: "正则提取" },
  { value: "rowCell", label: "固定单元格" }
];

export function ImportWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [document, setDocument] = useState<ParsedDocument | null>(null);
  const [rules, setRules] = useState<ParserRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string>("");
  const [draftRule, setDraftRule] = useState<ParserRule>(() => createEmptyRule("通用表格规则"));
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [ruleTab, setRuleTab] = useState<"basic" | "mapping" | "raw">("basic");

  const columnOptions = useMemo(
    () => (document ? getColumnOptions(document, draftRule) : []),
    [document, draftRule]
  );
  const validationExistingCodes = useMemo(() => {
    const currentSubmittedCodes = new Set(
      rows.filter((row) => row.submittedAt).map((row) => row.externalCode).filter(Boolean)
    );
    return new Set(Array.from(existingCodes).filter((code) => !currentSubmittedCodes.has(code)));
  }, [existingCodes, rows]);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;

  useEffect(() => {
    void refreshRules();
    void refreshExistingCodes();
  }, []);

  useEffect(() => {
    setIssues(validateRows(rows, validationExistingCodes));
  }, [rows, validationExistingCodes]);

  async function refreshRules() {
    const data = await fetchJson<{ rules: ParserRule[] }>("/api/rules");
    setRules(data.rules);
    if (data.rules[0]) {
      setSelectedRuleId(data.rules[0].id);
      setDraftRule(data.rules[0]);
    }
  }

  async function refreshExistingCodes() {
    const data = await fetchJson<{ codes: string[] }>("/api/orders?existing=1");
    setExistingCodes(new Set(data.codes));
  }

  async function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    setBusy({ label: "上传并抽取文件 0/1", progress: 8 });
    setRows([]);
    setAiStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const extracted = await fetchJson<{ document: ParsedDocument }>("/api/extract", {
        method: "POST",
        body: form
      });
      setDocument(extracted.document);
      setBusy({ label: "生成推荐规则 1/1", progress: 62 });
      const ai = await fetchJson<{ rule: ParserRule; aiEnabled: boolean; note: string }>("/api/ai-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: extracted.document })
      });
      setDraftRule(ai.rule);
      setAiStatus({
        enabled: ai.aiEnabled,
        note: ai.note,
        inferredFields: ai.rule.inferredFields.length
      });
      setSelectedRuleId("__draft");
      setRuleTab("mapping");
      setBusy({ label: "完成 1/1", progress: 100 });
      toast.success(ai.note);
      window.setTimeout(() => setBusy(null), 500);
    } catch (error) {
      setBusy(null);
      toast.error(error instanceof Error ? error.message : "导入失败");
    }
  }

  async function saveRule() {
    try {
      setBusy({ label: "保存规则", progress: 40 });
      const saved = await fetchJson<{ rule: ParserRule }>("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draftRule, updatedAt: new Date().toISOString() })
      });
      setRules((current) => [saved.rule, ...current.filter((rule) => rule.id !== saved.rule.id)]);
      setSelectedRuleId(saved.rule.id);
      setDraftRule(saved.rule);
      setBusy({ label: "保存完成", progress: 100 });
      toast.success("规则已保存");
      window.setTimeout(() => setBusy(null), 350);
    } catch (error) {
      setBusy(null);
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function deleteSelectedRule() {
    if (!selectedRuleId || selectedRuleId === "__draft") {
      setDraftRule(createEmptyRule());
      return;
    }
    try {
      await fetchJson(`/api/rules/${selectedRuleId}`, { method: "DELETE" });
      const nextRules = rules.filter((rule) => rule.id !== selectedRuleId);
      setRules(nextRules);
      setSelectedRuleId(nextRules[0]?.id ?? "");
      setDraftRule(nextRules[0] ?? createEmptyRule());
      toast.success("规则已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  function duplicateRule() {
    const now = new Date().toISOString();
    const duplicate: ParserRule = {
      ...draftRule,
      id: cryptoId(),
      name: `${draftRule.name} 副本`,
      createdAt: now,
      updatedAt: now
    };
    setDraftRule(duplicate);
    setSelectedRuleId("__draft");
    toast.success("已复制为未保存规则");
  }

  async function generateAiRuleFromCurrentFile() {
    if (!document) {
      toast.error("请先上传文件");
      return;
    }
    try {
      setBusy({ label: "AI 生成解析规则", progress: 45 });
      const ai = await fetchJson<{ rule: ParserRule; aiEnabled: boolean; note: string }>("/api/ai-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document })
      });
      setDraftRule(ai.rule);
      setSelectedRuleId("__draft");
      setRuleTab("mapping");
      setAiStatus({
        enabled: ai.aiEnabled,
        note: ai.note,
        inferredFields: ai.rule.inferredFields.length
      });
      setBusy({ label: "AI 规则生成完成", progress: 100 });
      toast.success(ai.note);
      window.setTimeout(() => setBusy(null), 350);
    } catch (error) {
      setBusy(null);
      toast.error(error instanceof Error ? error.message : "AI 规则生成失败");
    }
  }

  function createRuleFromCurrentFile() {
    const next = createEmptyRule(document ? `${document.fileName.replace(/\.[^.]+$/, "")} 手动规则` : "手动规则");
    setDraftRule(next);
    setSelectedRuleId("__draft");
    setRuleTab("mapping");
  }

  function selectRule(id: string) {
    const rule = rules.find((item) => item.id === id);
    if (!rule) {
      return;
    }
    setSelectedRuleId(id);
    setDraftRule(rule);
  }

  function testParse() {
    if (!document) {
      toast.error("请先上传文件");
      return;
    }
    setBusy({ label: "AI规则解析 0/1", progress: 35 });
    window.setTimeout(() => {
      const parsed = applyRule(document, draftRule);
      setRows(parsed);
      setBusy({ label: `AI规则解析完成 ${parsed.length}/${parsed.length}`, progress: 100 });
      toast.success(`AI规则解析完成，共 ${parsed.length} 行`);
      window.setTimeout(() => setBusy(null), 350);
    }, 50);
  }

  function updateRow(rowId: string, field: FieldKey, value: string) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, [field]: value, submittedAt: undefined } : row))
    );
  }

  function deleteRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
  }

  function addRow() {
    setRows((current) => [...current, createEmptyOrderRow(document?.fileName)]);
  }

  function clearBatch() {
    setRows([]);
    setDocument(null);
    setIssues([]);
    setAiStatus(null);
    setBusy(null);
  }

  async function downloadTemplate() {
    const xlsx = await import("xlsx");
    const worksheet = xlsx.utils.json_to_sheet([
      FIELD_KEYS.reduce<Record<string, string>>((acc, field) => {
        acc[FIELD_LABELS[field]] = "";
        return acc;
      }, {})
    ]);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "批量录单模板");
    xlsx.writeFile(workbook, "批量录单模板.xlsx");
  }

  async function exportExcel() {
    if (!rows.length) {
      toast.error("没有可导出的数据");
      return;
    }
    const xlsx = await import("xlsx");
    const exportRows = rows.map((row) =>
      FIELD_KEYS.reduce<Record<string, string>>((acc, field) => {
        acc[FIELD_LABELS[field]] = row[field];
        return acc;
      }, {})
    );
    const worksheet = xlsx.utils.json_to_sheet(exportRows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "预览数据");
    xlsx.writeFile(workbook, `万能导入预览-${Date.now()}.xlsx`);
    toast.success("已导出 Excel");
  }

  async function submitOrders() {
    const errors = issues.filter((issue) => issue.severity === "error");
    if (!rows.length) {
      toast.error("没有可提交的数据");
      return;
    }
    if (errors.length) {
      toast.error(`还有 ${errors.length} 个错误需要修正`);
      return;
    }
    try {
      setBusy({ label: `提交下单 0/${rows.length}`, progress: 20 });
      const result = await fetchJson<{ success: number; failed: number; rows: OrderRow[] }>("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      });
      setBusy({ label: `提交完成 ${result.success}/${rows.length}`, progress: 100 });
      setRows(result.rows);
      await refreshExistingCodes();
      toast.success(`提交成功 ${result.success} 条，失败 ${result.failed} 条`);
      window.setTimeout(() => setBusy(null), 500);
    } catch (error) {
      setBusy(null);
      toast.error(error instanceof Error ? error.message : "提交失败");
    }
  }

  function updateRule(patch: Partial<ParserRule>) {
    setDraftRule((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  }

  function updateMapping(field: FieldKey, patch: MappingPatch) {
    setDraftRule((current) => {
      const existing = current.mappings.find((mapping) => mapping.field === field) ?? {
        field,
        required: false,
        source: { type: "column" as SourceType }
      };
      const existingSource = isValidSourceRef(existing.source) ? existing.source : { type: "column" as SourceType };
      const nextMapping = {
        ...existing,
        ...patch,
        source: {
          ...existingSource,
          ...patch.source
        }
      };
      const rest = current.mappings.filter((mapping) => mapping.field !== field);
      return {
        ...current,
        mappings: FIELD_KEYS.map((key) => (key === field ? nextMapping : rest.find((mapping) => mapping.field === key) ?? {
          field: key,
          source: { type: "column" },
          required: false
        })),
        updatedAt: new Date().toISOString()
      };
    });
  }

  return (
    <main className="shell">
      <AppHeader
        active="import"
        actions={
          <>
          <span className="badge">{document?.kind ?? "未上传"}</span>
          <span className={errorCount ? "badge danger" : "badge success"}>
            {errorCount ? `${errorCount} 个错误` : "校验通过"}
          </span>
          </>
        }
      />

      <div className="workspace">
        <div className="left-stack">
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <FileSpreadsheet size={17} />
                文件导入
              </h2>
              <span className="badge">{document?.kind ?? "未上传"}</span>
            </div>
            <div className="panel-body section-grid">
              <label className="upload-zone">
                <input
                  ref={fileInputRef}
                  accept=".xlsx,.xls,.xlsm,.csv,.docx,.pdf,.txt"
                  onChange={(event) => void handleFiles(event.currentTarget.files)}
                  type="file"
                />
                <span className="upload-icon">
                  <UploadCloud size={24} />
                </span>
                <strong>{document ? document.fileName : "上传 Excel / Word / PDF / TXT"}</strong>
                <p className="hint">文件上传后自动抽取内容，并生成可编辑解析规则。</p>
              </label>

              <div className="toolbar">
                <button className="button secondary" onClick={() => void downloadTemplate()} type="button">
                  <Download size={15} />
                  模板下载
                </button>
                <button className="button secondary" onClick={() => fileInputRef.current?.click()} type="button">
                  <UploadCloud size={15} />
                  重新导入
                </button>
              </div>

              {busy ? (
                <div className="section-grid">
                  <div className="toolbar">
                    <span className="hint">{busy.label}</span>
                    <span className="hint">{busy.progress}%</span>
                  </div>
                  <div className="progress">
                    <span style={{ width: `${busy.progress}%` }} />
                  </div>
                </div>
              ) : null}

              {aiStatus ? (
                <div className="ai-status">
                  <div className="ai-status-header">
                    <span className={aiStatus.enabled ? "badge success" : "badge warn"}>
                      {aiStatus.enabled ? "DeepSeek 已生成" : "本地规则"}
                    </span>
                    <span className="badge">{aiStatus.inferredFields} 个映射</span>
                  </div>
                  <p>{aiStatus.note}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <Database size={17} />
                解析规则
              </h2>
              <button className="button primary" onClick={() => void saveRule()} type="button">
                <Save size={15} />
                保存
              </button>
            </div>
            <div className="panel-body rule-list">
              {rules.map((rule) => (
                <button
                  className={`rule-item${selectedRuleId === rule.id ? " active" : ""}`}
                  key={rule.id}
                  onClick={() => selectRule(rule.id)}
                  type="button"
                >
                  <span>
                    <span className="rule-name">{rule.name}</span>
                    <span className="rule-meta">{rule.strategy} · {new Date(rule.updatedAt).toLocaleString()}</span>
                  </span>
                  <CheckCircle2 size={16} />
                </button>
              ))}
              {!rules.length ? <p className="hint">暂无已保存规则</p> : null}
            </div>
          </section>
        </div>

        <div className="right-stack">
          <section className="panel">
            <div className="panel-header">
              <div className="toolbar-group">
                <h2 className="panel-title">
                  <Wand2 size={17} />
                  规则编辑
                </h2>
                {selectedRuleId === "__draft" ? <span className="badge warn">未保存</span> : null}
              </div>
              <div className="toolbar-group">
                <button className="button secondary" onClick={duplicateRule} type="button">
                  <Copy size={15} />
                  复制
                </button>
                <button className="button danger" onClick={() => void deleteSelectedRule()} type="button">
                  <Trash2 size={15} />
                  删除
                </button>
                <button className="button secondary" onClick={createRuleFromCurrentFile} type="button">
                  <Plus size={15} />
                  手动规则
                </button>
              </div>
            </div>
            <div className="panel-body section-grid">
              <div className="tabs" role="tablist">
                {(["basic", "mapping", "raw"] as const).map((tab) => (
                  <button
                    className={`tab${ruleTab === tab ? " active" : ""}`}
                    key={tab}
                    onClick={() => setRuleTab(tab)}
                    type="button"
                  >
                    {tab === "basic" ? "结构" : tab === "mapping" ? "映射" : "原始"}
                  </button>
                ))}
              </div>
              {ruleTab === "basic" ? <RuleBasicPanel draftRule={draftRule} updateRule={updateRule} /> : null}
              {ruleTab === "mapping" ? (
                <RuleMappingPanel columnOptions={columnOptions} draftRule={draftRule} updateMapping={updateMapping} />
              ) : null}
              {ruleTab === "raw" ? <RawPreview document={document} /> : null}
            </div>
          </section>

          <section className="panel preview-shell">
            <div className="panel-header">
              <div className="toolbar-group">
                <h2 className="panel-title">预览与校验</h2>
                <span className={errorCount ? "badge danger" : "badge success"}>
                  {errorCount ? `${errorCount} 个错误` : "校验通过"}
                </span>
                <span className="badge">{rows.length} 行</span>
              </div>
              <div className="toolbar-group">
                <button className="button primary" onClick={testParse} type="button">
                  <Play size={15} />
                  AI规则解析
                </button>
                <button className="button secondary" onClick={() => void generateAiRuleFromCurrentFile()} type="button">
                  <Wand2 size={15} />
                  AI规则生成
                </button>
                <button className="button secondary" onClick={addRow} type="button">
                  <Plus size={15} />
                  新增行
                </button>
                <button className="button secondary" onClick={() => void exportExcel()} type="button">
                  <Download size={15} />
                  导出
                </button>
                <button className="button primary" onClick={() => void submitOrders()} type="button">
                  <Send size={15} />
                  提交下单
                </button>
                <button className="button danger" onClick={clearBatch} type="button">
                  <Trash2 size={15} />
                  清空
                </button>
              </div>
            </div>
            <div className="panel-body section-grid">
              {issues.length ? <IssuePanel issues={issues} /> : null}
              <PreviewGrid
                issues={issues}
                onAdd={addRow}
                onChange={updateRow}
                onDelete={deleteRow}
                rows={rows}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function isValidSourceRef(value: unknown): value is SourceRef {
  return value !== null && typeof value === "object" && "type" in value;
}

function normalizeMappingForEditor(field: FieldKey, draftRule: ParserRule): ParserRule["mappings"][number] {
  const fallback: ParserRule["mappings"][number] = {
    field,
    source: { type: "column" },
    required: false
  };
  const mapping = draftRule.mappings.find((item) => item.field === field) ?? fallback;
  const source: SourceRef = isValidSourceRef(mapping.source) ? mapping.source : fallback.source;
  const sourceType = sourceTypes.some((item) => item.value === source.type) ? source.type : "column";
  return {
    ...mapping,
    field,
    source: {
      ...source,
      type: sourceType
    }
  } satisfies ParserRule["mappings"][number];
}

function RuleBasicPanel({
  draftRule,
  updateRule
}: {
  draftRule: ParserRule;
  updateRule: (patch: Partial<ParserRule>) => void;
}) {
  return (
    <div className="section-grid">
      <div className="mapping-row">
        <div className="field">
          <label>规则名称</label>
          <input
            className="input"
            value={draftRule.name}
            onChange={(event) => updateRule({ name: event.target.value })}
          />
        </div>
        <div className="field">
          <label>解析模式</label>
          <select
            className="select"
            value={draftRule.strategy}
            onChange={(event) => updateRule({ strategy: event.target.value as ParserRule["strategy"] })}
          >
            <option value="table">标准表格</option>
            <option value="matrix">矩阵转置</option>
            <option value="cards">卡片式</option>
            <option value="text">纯文本</option>
          </select>
        </div>
        <div className="field">
          <label>说明</label>
          <input
            className="input"
            value={draftRule.description}
            onChange={(event) => updateRule({ description: event.target.value })}
          />
        </div>
      </div>

      {draftRule.strategy === "table" ? (
        <div className="mapping-row">
          <div className="field">
            <label>Sheet</label>
            <select
              className="select"
              value={draftRule.table.sheetMode}
              onChange={(event) =>
                updateRule({ table: { ...draftRule.table, sheetMode: event.target.value as "first" | "all" } })
              }
            >
              <option value="first">第一个</option>
              <option value="all">全部合并</option>
            </select>
          </div>
          <div className="field">
            <label>表头行</label>
            <input
              className="input"
              value={draftRule.table.headerRows.join(",")}
              onChange={(event) =>
                updateRule({
                  table: {
                    ...draftRule.table,
                    headerRows: event.target.value
                      .split(",")
                      .map((item) => Number(item.trim()))
                      .filter(Boolean)
                  }
                })
              }
            />
          </div>
          <div className="field">
            <label>数据起始行</label>
            <input
              className="input"
              min={1}
              type="number"
              value={draftRule.table.dataStartRow}
              onChange={(event) =>
                updateRule({ table: { ...draftRule.table, dataStartRow: Number(event.target.value) } })
              }
            />
          </div>
          <div className="field">
            <label>过滤关键词</label>
            <input
              className="input"
              value={draftRule.table.skipRowsContaining.join(",")}
              onChange={(event) =>
                updateRule({
                  table: {
                    ...draftRule.table,
                    skipRowsContaining: event.target.value.split(",").map((item) => item.trim()).filter(Boolean)
                  }
                })
              }
            />
          </div>
        </div>
      ) : null}

      {draftRule.strategy === "matrix" ? (
        <div className="mapping-row">
          {[
            ["门店表头行", "storeHeaderRow"],
            ["数据起始行", "dataStartRow"],
            ["SKU名称列", "skuNameColumn"],
            ["门店起始列", "storeColumnStart"]
          ].map(([label, key]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <input
                className="input"
                min={1}
                type="number"
                value={Number(draftRule.matrix[key as keyof typeof draftRule.matrix] ?? 1)}
                onChange={(event) =>
                  updateRule({ matrix: { ...draftRule.matrix, [key]: Number(event.target.value) } })
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      {draftRule.strategy === "text" ? (
        <div className="mapping-row">
          <div className="field">
            <label>记录分隔正则</label>
            <input
              className="input"
              value={draftRule.text.recordSeparatorPattern}
              onChange={(event) => updateRule({ text: { ...draftRule.text, recordSeparatorPattern: event.target.value } })}
            />
          </div>
          <div className="field">
            <label>物品行正则</label>
            <input
              className="input"
              value={draftRule.text.itemLinePattern}
              onChange={(event) => updateRule({ text: { ...draftRule.text, itemLinePattern: event.target.value } })}
            />
          </div>
        </div>
      ) : null}

      {draftRule.strategy === "cards" ? (
        <div className="mapping-row">
          <div className="field">
            <label>卡片起始正则</label>
            <input
              className="input"
              value={draftRule.cards.startPattern}
              onChange={(event) => updateRule({ cards: { ...draftRule.cards, startPattern: event.target.value } })}
            />
          </div>
          <div className="field">
            <label>字段行正则</label>
            <input
              className="input"
              value={draftRule.cards.fieldLinePattern}
              onChange={(event) => updateRule({ cards: { ...draftRule.cards, fieldLinePattern: event.target.value } })}
            />
          </div>
          <div className="field">
            <label>物品行正则</label>
            <input
              className="input"
              value={draftRule.cards.itemLinePattern}
              onChange={(event) => updateRule({ cards: { ...draftRule.cards, itemLinePattern: event.target.value } })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RuleMappingPanel({
  columnOptions,
  draftRule,
  updateMapping
}: {
  columnOptions: Array<{ index: number; label: string }>;
  draftRule: ParserRule;
  updateMapping: (field: FieldKey, patch: MappingPatch) => void;
}) {
  return (
    <div className="mapping-table">
      {FIELD_KEYS.map((field) => {
        const mapping = normalizeMappingForEditor(field, draftRule);
        return (
          <div className="mapping-row" key={field}>
            <span className="mapping-label">{FIELD_LABELS[field]}</span>
            <select
              className="select"
              value={mapping.source.type}
              onChange={(event) =>
                updateMapping(field, {
                  source: { type: event.target.value as SourceType, inferred: false, confidence: undefined }
                })
              }
            >
              {sourceTypes.map((sourceType) => (
                <option key={sourceType.value} value={sourceType.value}>
                  {sourceType.label}
                </option>
              ))}
            </select>
            <MappingSourceEditor columnOptions={columnOptions} field={field} mapping={mapping} updateMapping={updateMapping} />
            <span className={mapping.source.inferred ? "badge warn" : "badge"}>
              {mapping.source.inferred ? `推测 ${Math.round((mapping.source.confidence ?? 0) * 100)}%` : "人工确认"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MappingSourceEditor({
  columnOptions,
  field,
  mapping,
  updateMapping
}: {
  columnOptions: Array<{ index: number; label: string }>;
  field: FieldKey;
  mapping: ParserRule["mappings"][number];
  updateMapping: (field: FieldKey, patch: MappingPatch) => void;
}) {
  if (mapping.source.type === "column" || mapping.source.type === "previousNonEmpty") {
    return (
      <select
        className="select"
        value={mapping.source.columnIndex ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          const option = columnOptions.find((item) => item.index === Number(value));
          updateMapping(field, {
            source: {
              columnIndex: value === "" ? undefined : Number(value),
              headerText: option?.label,
              inferred: false
            }
          });
        }}
      >
        <option value="">未选择</option>
        {columnOptions.map((option) => (
          <option key={option.index} value={option.index}>
            {option.index + 1}. {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (mapping.source.type === "static") {
    return (
      <input
        className="input"
        value={mapping.source.value ?? ""}
        onChange={(event) => updateMapping(field, { source: { value: event.target.value, inferred: false } })}
      />
    );
  }

  if (mapping.source.type === "regex") {
    return (
      <input
        className="input"
        value={mapping.source.pattern ?? ""}
        onChange={(event) =>
          updateMapping(field, {
            source: { pattern: event.target.value, groupIndex: 1, inferred: false }
          })
        }
      />
    );
  }

  if (mapping.source.type === "rowCell") {
    return (
      <div className="toolbar-group">
        <input
          className="input"
          min={1}
          style={{ width: 70 }}
          type="number"
          value={mapping.source.rowIndex ?? 1}
          onChange={(event) => updateMapping(field, { source: { rowIndex: Number(event.target.value), inferred: false } })}
        />
        <input
          className="input"
          min={1}
          style={{ width: 70 }}
          type="number"
          value={mapping.source.cellIndex ?? 1}
          onChange={(event) => updateMapping(field, { source: { cellIndex: Number(event.target.value), inferred: false } })}
        />
      </div>
    );
  }

  return <span className="hint">自动取值</span>;
}

function RawPreview({ document }: { document: ParsedDocument | null }) {
  const sheet = document?.sheets[0];
  if (!document) {
    return <p className="hint">未上传文件</p>;
  }
  if (!sheet) {
    return (
      <div className="raw-preview">
        <pre style={{ margin: 0, padding: 12, whiteSpace: "pre-wrap" }}>{document.text.slice(0, 5000)}</pre>
      </div>
    );
  }
  return (
    <div className="raw-preview">
      <table>
        <tbody>
          {sheet.rows.slice(0, 24).map((row, index) => (
            <tr key={`${sheet.name}-${index}`}>
              <td>{index + 1}</td>
              {row.slice(0, 36).map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssuePanel({ issues }: { issues: ValidationIssue[] }) {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const previewIssues = issues.slice(0, 3);

  return (
    <div className="issue-panel">
      <div className="issue-summary">
        <span className="issue-summary-title">
          <AlertCircle size={15} />
          校验结果
        </span>
        <span className="badge danger">{errorCount} 个错误</span>
        {warningCount ? <span className="badge warn">{warningCount} 个提醒</span> : null}
        {issues.length > previewIssues.length ? <span className="hint">仅展示前 {previewIssues.length} 条，完整信息见表格错误列</span> : null}
      </div>
      <div className="issue-preview-list">
        {previewIssues.map((issue, index) => (
          <span className="issue-chip" key={`${issue.rowId}-${issue.field}-${index}`}>
            <span>
              第 {issue.rowNumber} 行 · {issue.field === "row" ? "整行" : FIELD_LABELS[issue.field]} · {issue.message}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function createEmptyOrderRow(sourceFile?: string): OrderRow {
  return {
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
    sourceFile
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "请求失败");
  }
  return data as T;
}
