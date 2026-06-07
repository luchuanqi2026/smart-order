"use client";

import { useEffect, useState } from "react";
import { Bot, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "./app-header";

interface ModelConfigForm {
  provider: "deepseek" | "openai";
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  hasApiKey?: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const defaultConfig: ModelConfigForm = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKey: "",
  temperature: 0.1
};

export function ModelPage() {
  const [config, setConfig] = useState<ModelConfigForm>(defaultConfig);
  const [message, setMessage] = useState("你好，你是什么模型");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadConfig();
  }, []);

  async function loadConfig() {
    const response = await fetch("/api/model-config");
    const data = (await response.json()) as { config?: ModelConfigForm };
    if (data.config) {
      setConfig(data.config);
    }
  }

  async function saveConfig() {
    setLoading(true);
    try {
      const response = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      const data = (await response.json()) as { config?: ModelConfigForm; error?: string };
      if (!response.ok || !data.config) {
        throw new Error(data.error ?? "保存失败");
      }
      setConfig(data.config);
      toast.success("模型配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const content = message.trim();
    if (!content) {
      return;
    }
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content }]);
    try {
      const response = await fetch("/api/model-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content })
      });
      const data = (await response.json()) as { reply?: string; model?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "模型测试失败");
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply ? `${data.reply}\n\n模型：${data.model ?? config.model}` : `模型：${data.model ?? config.model}`
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: error instanceof Error ? error.message : "模型测试失败" }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <AppHeader
        active="model"
        actions={<span className={config.hasApiKey ? "badge success" : "badge warn"}>{config.hasApiKey ? "Key 已配置" : "Key 未配置"}</span>}
      />

      <div className="model-page">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <Bot size={17} />
              模型设置
            </h2>
            <button className="button primary" disabled={loading} onClick={() => void saveConfig()} type="button">
              <Save size={15} />
              保存
            </button>
          </div>
          <div className="panel-body section-grid">
            <div className="mapping-row">
              <div className="field">
                <label>Provider</label>
                <select
                  className="select"
                  value={config.provider}
                  onChange={(event) => setConfig({ ...config, provider: event.target.value as ModelConfigForm["provider"] })}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI Compatible</option>
                </select>
              </div>
              <div className="field">
                <label>Base URL</label>
                <input className="input" value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />
              </div>
              <div className="field">
                <label>Model</label>
                <input className="input" value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} />
              </div>
            </div>
            <div className="mapping-row">
              <div className="field">
                <label>API Key</label>
                <input
                  className="input"
                  placeholder={config.hasApiKey ? "已配置，留空不修改" : "输入 API Key"}
                  type="password"
                  value={config.apiKey}
                  onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
                />
              </div>
              <div className="field">
                <label>Temperature</label>
                <input
                  className="input"
                  max={2}
                  min={0}
                  step={0.1}
                  type="number"
                  value={config.temperature}
                  onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">聊天测试</h2>
            <button className="button primary" disabled={loading} onClick={() => void sendMessage()} type="button">
              <Send size={15} />
              发送
            </button>
          </div>
          <div className="panel-body section-grid">
            <div className="chat-box">
              {messages.map((item, index) => (
                <div className={`chat-message ${item.role}`} key={`${item.role}-${index}`}>
                  <span>{item.role === "user" ? "User" : "Model"}</span>
                  <p>{item.content}</p>
                </div>
              ))}
              {!messages.length ? <p className="hint">发送测试消息后显示模型回复。</p> : null}
            </div>
            <div className="chat-input-row">
              <input className="input" value={message} onChange={(event) => setMessage(event.target.value)} />
              <button className="button primary" disabled={loading} onClick={() => void sendMessage()} type="button">
                <Send size={15} />
                发送
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
