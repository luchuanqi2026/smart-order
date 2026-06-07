"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Save, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "./app-header";
import { createEmptyRule, cryptoId } from "@/lib/rule-engine";
import { FIELD_LABELS, type ParserRule } from "@/lib/types";

export function RulesPage() {
  const [rules, setRules] = useState<ParserRule[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ParserRule>(() => createEmptyRule("解析规则"));
  const [loading, setLoading] = useState(false);

  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedId), [rules, selectedId]);

  useEffect(() => {
    void loadRules();
  }, []);

  async function loadRules() {
    setLoading(true);
    try {
      const response = await fetch("/api/rules");
      const data = (await response.json()) as { rules?: ParserRule[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "读取失败");
      }
      const nextRules = data.rules ?? [];
      setRules(nextRules);
      const first = nextRules[0];
      if (first) {
        setSelectedId(first.id);
        setDraft(first);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  function selectRule(rule: ParserRule) {
    setSelectedId(rule.id);
    setDraft(rule);
  }

  function newRule() {
    const rule = createEmptyRule("解析规则");
    setSelectedId("__draft");
    setDraft(rule);
  }

  function duplicateRule() {
    const now = new Date().toISOString();
    setSelectedId("__draft");
    setDraft({
      ...draft,
      id: cryptoId(),
      name: `${draft.name} 副本`,
      createdAt: now,
      updatedAt: now
    });
  }

  async function saveRule() {
    try {
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })
      });
      const data = (await response.json()) as { rule?: ParserRule; error?: string };
      if (!response.ok || !data.rule) {
        throw new Error(data.error ?? "保存失败");
      }
      setRules((current) => [data.rule!, ...current.filter((rule) => rule.id !== data.rule!.id)]);
      setSelectedId(data.rule.id);
      setDraft(data.rule);
      toast.success("规则已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function deleteRule() {
    if (!selectedRule) {
      newRule();
      return;
    }
    try {
      const response = await fetch(`/api/rules/${selectedRule.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("删除失败");
      }
      const nextRules = rules.filter((rule) => rule.id !== selectedRule.id);
      setRules(nextRules);
      setSelectedId(nextRules[0]?.id ?? "__draft");
      setDraft(nextRules[0] ?? createEmptyRule("解析规则"));
      toast.success("规则已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  return (
    <main className="shell">
      <AppHeader active="rules" actions={<span className="badge">{loading ? "加载中" : `${rules.length} 条规则`}</span>} />

      <div className="rule-page">
        <section className="panel rule-sidebar">
          <div className="panel-header">
            <h2 className="panel-title">
              <Settings2 size={17} />
              规则列表
            </h2>
            <button className="button primary" onClick={newRule} type="button">
              <Plus size={15} />
              新建
            </button>
          </div>
          <div className="panel-body rule-list">
            {rules.map((rule) => (
              <button
                className={`rule-item${rule.id === selectedId ? " active" : ""}`}
                key={rule.id}
                onClick={() => selectRule(rule)}
                type="button"
              >
                <span>
                  <span className="rule-name">{rule.name}</span>
                  <span className="rule-meta">{rule.strategy} · {new Date(rule.updatedAt).toLocaleString()}</span>
                </span>
              </button>
            ))}
            {!rules.length ? <p className="hint">暂无规则</p> : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">规则详情</h2>
            <div className="toolbar-group">
              <button className="button secondary" onClick={duplicateRule} type="button">
                <Copy size={15} />
                复制
              </button>
              <button className="button danger" onClick={() => void deleteRule()} type="button">
                <Trash2 size={15} />
                删除
              </button>
              <button className="button primary" onClick={() => void saveRule()} type="button">
                <Save size={15} />
                保存
              </button>
            </div>
          </div>
          <div className="panel-body section-grid">
            <div className="mapping-row">
              <div className="field">
                <label>名称</label>
                <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div className="field">
                <label>模式</label>
                <select
                  className="select"
                  value={draft.strategy}
                  onChange={(event) => setDraft({ ...draft, strategy: event.target.value as ParserRule["strategy"] })}
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
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
            </div>

            <div className="history-table">
              <table>
                <thead>
                  <tr>
                    <th>目标字段</th>
                    <th>来源类型</th>
                    <th>来源</th>
                    <th>置信度</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.mappings.map((mapping) => (
                    <tr key={mapping.field}>
                      <td>{FIELD_LABELS[mapping.field]}</td>
                      <td>{mapping.source.type}</td>
                      <td>{mapping.source.headerText ?? mapping.source.value ?? mapping.source.pattern ?? "-"}</td>
                      <td>{mapping.source.confidence ? `${Math.round(mapping.source.confidence * 100)}%` : "-"}</td>
                      <td>{mapping.source.note ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
