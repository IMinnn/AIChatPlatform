"use client";

import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

let mermaidReady = false;

function ensureMermaid() {
  if (mermaidReady) {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "neutral",
    themeVariables: {
      fontSize: "13px"
    }
  });
  mermaidReady = true;
}

function MermaidBlock({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderedSvgRef = useRef("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");

  useEffect(() => {
    let active = true;

    async function renderChart() {
      try {
        ensureMermaid();
        const rendered = await mermaid.render(`mermaid-${id}`, chart);
        if (!active) {
          return;
        }
        renderedSvgRef.current = rendered.svg;
        if (containerRef.current) {
          containerRef.current.innerHTML = renderedSvgRef.current;
        }
        setReady(true);
        setFailed(false);
      } catch {
        if (!active) {
          return;
        }
        renderedSvgRef.current = "";
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }
        setReady(false);
        setFailed(true);
      }
    }

    void renderChart();

    return () => {
      active = false;
    };
  }, [chart, id]);

  useEffect(() => {
    if (viewMode !== "diagram" || !containerRef.current || !renderedSvgRef.current) {
      return;
    }
    containerRef.current.innerHTML = renderedSvgRef.current;
  }, [viewMode]);

  if (failed) {
    return (
      <pre className="chat-code-block">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div className="mermaid-shell">
      <div className="mermaid-toggle-row">
        <button
          type="button"
          className={viewMode === "code" ? "mermaid-toggle-button active" : "mermaid-toggle-button"}
          onClick={() => setViewMode("code")}
        >
          代码
        </button>
        <button
          type="button"
          className={viewMode === "diagram" ? "mermaid-toggle-button active" : "mermaid-toggle-button"}
          onClick={() => setViewMode("diagram")}
        >
          流程图
        </button>
      </div>
      {viewMode === "diagram" ? (
        <>
          <div ref={containerRef} className="mermaid-block" />
          {!failed && !ready ? <span className="mermaid-loading">流程图生成中...</span> : null}
        </>
      ) : (
        <pre className="chat-code-block mermaid-code-block">
          <code>{chart}</code>
        </pre>
      )}
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const label = language || "text";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="chat-code-shell">
      <div className="chat-code-head">
        <span className="chat-code-language">{label}</span>
        <button className="chat-code-copy" type="button" onClick={() => void handleCopy()}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="chat-code-block">
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

function normalizeDisplayContent(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => {
      if (segment.startsWith("```") && segment.endsWith("```")) {
        return segment;
      }
      return segment.replace(/\n{2,}/g, "\n");
    })
    .join("");
}

export function MessageMarkdown({ content }: { content: string }) {
  const normalizedContent = normalizeDisplayContent(content);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children }) {
          return (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          );
        },
        img({ src, alt }) {
          return <img alt={alt ?? ""} loading="lazy" src={src ?? ""} />;
        },
        table({ children }) {
          return (
            <div className="chat-table-wrap">
              <table>{children}</table>
            </div>
          );
        },
        code({ className, children }) {
          const language = className?.replace("language-", "") ?? "";
          const value = String(children).replace(/\n$/, "");
          const isBlock = language || value.includes("\n");

          if (language === "mermaid") {
            return <MermaidBlock chart={value} />;
          }

          if (isBlock) {
            return <CodeBlock code={value} language={language} />;
          }

          return <code className="chat-inline-code">{children}</code>;
        }
      }}
    >
      {normalizedContent}
    </ReactMarkdown>
  );
}
