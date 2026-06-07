"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Trash2 } from "lucide-react";
import { FIELD_KEYS, FIELD_LABELS, type FieldKey, type OrderRow, type ValidationIssue } from "@/lib/types";

interface PreviewGridProps {
  rows: OrderRow[];
  issues: ValidationIssue[];
  onChange: (rowId: string, field: FieldKey, value: string) => void;
  onDelete: (rowId: string) => void;
  onAdd: () => void;
}

export function PreviewGrid({ rows, issues, onChange, onDelete, onAdd }: PreviewGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 12
  });

  const issueMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    issues.forEach((issue) => {
      const set = map.get(issue.rowId) ?? new Set<string>();
      set.add(issue.field);
      map.set(issue.rowId, set);
    });
    return map;
  }, [issues]);

  if (!rows.length) {
    return (
      <div className="empty-state">
        <div className="brand-mark">
          <Plus size={20} />
        </div>
        <div>
          <strong>暂无预览数据</strong>
          <p className="hint">上传文件并执行 AI规则解析 后，会在这里编辑和校验下单数据。</p>
        </div>
        <button className="button secondary" onClick={onAdd} type="button">
          <Plus size={16} />
          新增空行
        </button>
      </div>
    );
  }

  return (
    <div className="grid-wrap">
      <div className="grid-inner">
        <div className="grid-header">
          <div className="grid-cell">行号</div>
          {FIELD_KEYS.map((field) => (
            <div className="grid-cell" key={field}>
              {FIELD_LABELS[field]}
            </div>
          ))}
          <div className="grid-cell">操作</div>
        </div>
        <div ref={parentRef} style={{ height: 520, overflowY: "auto", position: "relative" }}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const rowIssues = issueMap.get(row.id);
              return (
                <div
                  className="grid-row"
                  key={row.id}
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <div className={cellClass(rowIssues, "row")}>{virtualRow.index + 1}</div>
                  {FIELD_KEYS.map((field) => (
                    <div className={cellClass(rowIssues, field)} key={field}>
                      <input
                        aria-label={`${FIELD_LABELS[field]} 第 ${virtualRow.index + 1} 行`}
                        className="cell-input"
                        value={row[field]}
                        onChange={(event) => onChange(row.id, field, event.target.value)}
                      />
                    </div>
                  ))}
                  <div className="grid-cell">
                    <button
                      aria-label="删除行"
                      className="button danger icon-button"
                      onClick={() => onDelete(row.id)}
                      title="删除行"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function cellClass(rowIssues: Set<string> | undefined, field: FieldKey | "row") {
  const hasError = rowIssues?.has(field) || (field !== "row" && rowIssues?.has("row"));
  return `grid-cell${hasError ? " error" : ""}`;
}
