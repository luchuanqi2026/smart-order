# 智能批量下单系统

基于 Next.js App Router 和 TypeScript 实现的多格式文件解析、规则配置、AI 规则生成、批量下单管理系统。

## 技术栈

- Next.js 15
- React 19
- TypeScript
- xlsx：Excel / CSV 抽取与导出
- mammoth：Word 文本抽取
- pdf-parse：PDF 文本抽取
- @tanstack/react-virtual：大批量预览数据虚拟滚动
- pg：PostgreSQL 持久化
- DeepSeek API：AI 解析规则生成与模型测试

## 功能

- 支持 Excel、CSV、Word、PDF、TXT 文件上传
- 文件内容统一抽取为 `ParsedDocument`
- 支持解析规则配置、保存、复制、删除
- 支持表格、矩阵转置、卡片式、纯文本解析策略
- 支持 AI 自动生成解析规则
- 支持 AI规则解析、预览编辑、错误校验
- 支持批次内重复校验、历史外部编码重复校验
- 支持预览数据导出 Excel
- 支持提交下单并持久化订单
- 支持订单管理分页查询
- 支持模型配置和聊天测试

## 启动

安装依赖：

```bash
npm install
```

开发环境启动：

```bash
npm run dev
```

指定端口启动：

```bash
npm run dev -- -p 3000
```

访问：

```text
http://localhost:3000/import
```

生产构建：

```bash
npm run build
```

生产启动：

```bash
npm run start
```

类型检查：

```bash
npm run typecheck
```

## 大模型配置

大模型配置支持两种方式：

- 环境变量：适合线上部署
- 配置文件：适合本地开发

配置文件：

```text
config/ai.config.json
```

示例：

```json
{
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "apiKey": "",
  "temperature": 0.1
}
```

最少环境变量：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
```

只配置 `DEEPSEEK_API_KEY` 时，`provider`、`baseUrl`、`model`、`temperature` 使用配置文件或系统默认值。

完整环境变量：

```bash
AI_PROVIDER=deepseek
AI_API_KEY=你的 DeepSeek API Key
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
AI_TEMPERATURE=0.1
```

DeepSeek 专用变量也支持：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TEMPERATURE=0.1
```

环境变量优先级高于配置文件。

相关接口：

- `GET /api/model-config`：读取模型配置，API Key 不回传明文
- `POST /api/model-config`：保存模型配置
- `POST /api/model-test`：发送测试消息并返回模型回复
- `POST /api/ai-rule`：根据文件抽取结果生成解析规则

## 数据存储

订单和规则支持两种存储方式：

- 配置 `DATABASE_URL` 时使用 PostgreSQL
- 未配置 `DATABASE_URL` 时使用本地 `data/store.json`

PostgreSQL 表会在服务启动后按需创建。

## 文件抽取流程

入口：

```text
POST /api/extract
```

流程：

1. 接收上传文件
2. 按扩展名选择抽取器
3. 输出统一结构 `ParsedDocument`
4. 前端使用文档样本生成规则或执行解析

格式处理：

- `.xlsx` / `.xls` / `.xlsm` / `.csv`：使用 `xlsx` 抽取 Sheet 行列
- `.docx`：使用 `mammoth` 抽取文本
- `.pdf`：使用 `pdf-parse` 抽取文本和页数
- `.txt`：按 UTF-8 文本读取

## 规则引擎

核心文件：

```text
lib/rule-engine.ts
```

规则结构：

- `ParserRule`：规则主结构
- `RuleMapping`：目标字段映射
- `SourceRef`：字段取值来源
- `TableOptions`：表格解析配置
- `MatrixOptions`：矩阵转置配置
- `TextOptions`：纯文本正则配置
- `CardOptions`：卡片式文本配置

目标字段：

- 外部编码
- 收货门店
- 收件人姓名
- 收件人电话
- 收件人地址
- SKU物品编码
- SKU物品名称
- SKU发货数量
- SKU规格型号
- 备注

校验规则：

- 必填字段校验
- 发货数量格式校验
- 电话格式校验
- 批次内重复校验
- 历史外部编码重复校验

## AI 规则生成

入口：

```text
POST /api/ai-rule
```

实现方式：

1. 服务端先根据文件结构生成本地 fallback 规则
2. 将 `ParsedDocument` 样本和 fallback 规则发送给大模型
3. 大模型只返回解析规则 JSON，不直接返回订单数据
4. 服务端归一化 AI 返回结果，保证每个字段都有合法映射
5. 用户在前端确认、修改并保存规则

AI 返回规则会保留：

- `source.inferred`
- `source.confidence`
- `source.note`

## 前端页面

主要页面：

- `/import`：批量录单、文件导入、规则编辑、AI规则解析、预览校验
- `/rules`：解析规则管理
- `/orders`：订单管理
- `/model`：模型设置和聊天测试
- `/docs`：技术说明

主要组件：

- `components/import-workspace.tsx`
- `components/preview-grid.tsx`
- `components/rules-page.tsx`
- `components/history-page.tsx`
- `components/model-page.tsx`
- `components/app-header.tsx`

## API

- `POST /api/extract`
- `GET /api/rules`
- `POST /api/rules`
- `DELETE /api/rules/[id]`
- `GET /api/orders`
- `POST /api/orders`
- `GET /api/model-config`
- `POST /api/model-config`
- `POST /api/model-test`
- `POST /api/ai-rule`

## 项目结构

```text
app/
  api/
  import/
  rules/
  orders/
  model/
  docs/
components/
config/
data/
lib/
示范导入文件/
```

## 常用命令

```bash
npm install
npm run dev
npm run dev -- -p 3000
npm run typecheck
npm run build
npm run start
```
