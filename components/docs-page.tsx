import { AppHeader } from "./app-header";

export function DocsPage() {
  return (
    <main className="shell">
      <AppHeader active="docs" />
      <div className="docs-page">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">系统架构</h2>
          </div>
          <div className="panel-body docs-grid">
            <article className="doc-block">
              <h3>文件抽取</h3>
              <p>服务端统一抽取 Excel、Word、PDF、TXT，输出 `ParsedDocument`、文本内容、文件元信息和告警。</p>
            </article>
            <article className="doc-block">
              <h3>规则引擎</h3>
              <p>解析逻辑由 `ParserRule` 描述，支持标准表格、矩阵转置、卡片式区域和纯文本正则。新增格式通过新增规则适配。</p>
            </article>
            <article className="doc-block">
              <h3>AI 生成规则</h3>
              <p>`/api/ai-rule` 读取文档样本和 fallback 规则，调用 DeepSeek 生成可编辑规则，字段推测会保留置信度和说明。</p>
            </article>
            <article className="doc-block">
              <h3>数据提交</h3>
              <p>提交前执行必填、电话、数量和重复校验。提交成功后写入数据库；未配置数据库时写入本地 JSON 存储。</p>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">配置</h2>
          </div>
          <div className="panel-body section-grid">
            <pre className="code-block">{`config/ai.config.json
{
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "apiKey": "...",
  "temperature": 0.1
}`}</pre>
            <p className="hint">数据库连接使用 `DATABASE_URL`。部署环境设置该变量后，服务端自动建表并持久化规则与运单。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
