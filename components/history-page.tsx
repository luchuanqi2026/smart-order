"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Printer, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "./app-header";
import type { OrderRow } from "@/lib/types";

export function HistoryPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRows();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, page]);

  async function loadRows() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        pageSize: String(pageSize)
      });
      const response = await fetch(`/api/orders?${params.toString()}`);
      const data = (await response.json()) as { rows?: OrderRow[]; total?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "读取失败");
      }
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="shell">
      <AppHeader active="orders" actions={<span className="badge">{loading ? "加载中" : `${total} 条`}</span>} />

      <div className="history-page order-page">
        <section className="panel">
          <div className="order-status-tabs">
            <button className="active" type="button">全部({total})</button>
            <button type="button">失败列表(0)</button>
            <button type="button">待下单(0)</button>
            <button type="button">下单成功({total})</button>
            <button type="button">使用说明</button>
          </div>

          <div className="panel-body order-panel-body">
            <div className="order-action-bar">
              <div className="toolbar-group">
                <span className="hint">已选0条</span>
                <button className="button primary" type="button">重试</button>
                <button className="button primary" type="button">批量下单</button>
                <button className="button danger" type="button">
                  <Trash2 size={14} />
                  删除
                </button>
                <button className="button primary" type="button">
                  <Printer size={14} />
                  面单打印
                </button>
                <button className="button primary" type="button">
                  <Download size={14} />
                  导出
                </button>
              </div>
              <div className="toolbar-group" style={{ flex: 1 }}>
                <div className="field search-field">
                  <div style={{ position: "relative" }}>
                    <Search
                      size={15}
                      style={{ color: "var(--muted)", left: 10, position: "absolute", top: 10 }}
                    />
                    <input
                      className="input"
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(1);
                      }}
                      placeholder="外部编码 / 收件人 / 门店"
                      style={{ paddingLeft: 34 }}
                      value={query}
                    />
                  </div>
                </div>
              </div>
              <div className="toolbar-group">
                <button
                  className="button secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  上一页
                </button>
                <span className="badge">
                  {page} / {totalPages}
                </span>
                <button
                  className="button secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  type="button"
                >
                  下一页
                </button>
              </div>
            </div>

            <div className="history-table">
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="全选" /></th>
                    <th>序号</th>
                    <th>状态</th>
                    <th>错误信息</th>
                    <th>运单号</th>
                    <th>产品类型</th>
                    <th>增值服务</th>
                    <th>服务送货方式</th>
                    <th>交货中心</th>
                    <th>回单类型</th>
                    <th>客户单号</th>
                    <th>收件人</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id}>
                      <td><input type="checkbox" aria-label={`选择第 ${index + 1} 行`} /></td>
                      <td>{(page - 1) * pageSize + index + 1}</td>
                      <td><span className="table-status success">下单成功</span></td>
                      <td>-</td>
                      <td>{row.externalCode}</td>
                      <td>标准件</td>
                      <td>-</td>
                      <td>送货上门</td>
                      <td>{row.storeName || "-"}</td>
                      <td>无需回单</td>
                      <td>{row.externalCode}</td>
                      <td>{row.recipientName || row.storeName || "-"}</td>
                      <td>
                        <button className="table-link" type="button">
                          <FileText size={13} />
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td colSpan={13} style={{ color: "var(--muted)", textAlign: "center" }}>
                        暂无记录
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
