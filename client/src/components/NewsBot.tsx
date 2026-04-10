import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Streamdown } from "streamdown";
import {
  Bot,
  Loader2,
  Send,
  Sparkles,
  User,
  X,
  Upload,
  Link2,
  ListTodo,
  PlusCircle,
  Flame,
} from "lucide-react";
import { nanoid } from "nanoid";

const CHAT_SESSION_KEY = "ipms_research_chat_session_id";

type CitationItem = { refKey: string; articleId: number; title: string };

type Message = {
  role: "user" | "assistant";
  content: string;
  id: string;
  references?: Array<{
    page: number;
    startLine: number;
    endLine: number;
    quote?: string;
  }>;
  citations?: CitationItem[];
};

type ImportTask = {
  id: string;
  kind: "file" | "url";
  label: string;
  status: "queued" | "running" | "done" | "failed";
  detail?: string;
};

function stripCitationFooter(content: string): string {
  return content.replace(/\n\n---\s*\n\*\*相关资讯链接：\*\*[\s\S]*$/m, "").trimEnd();
}

/** 从历史消息正文尾部解析引用（无 citations 元数据时） */
function parseCitationsFromFooter(content: string): CitationItem[] {
  const idx = content.indexOf("**相关资讯链接：**");
  if (idx === -1) return [];
  const tail = content.slice(idx);
  const re = /-\s*\[([^\]]+)\]\([^)]*\/news\/(\d+)\)/g;
  const out: CitationItem[] = [];
  let m: RegExpExecArray | null;
  let n = 1;
  while ((m = re.exec(tail)) !== null) {
    out.push({
      refKey: `文章${n}`,
      articleId: Number(m[2]),
      title: m[1],
    });
    n++;
  }
  return out;
}

function mergeCitationsForMessage(msg: Message): CitationItem[] {
  if (msg.citations && msg.citations.length > 0) return msg.citations;
  if (msg.role === "assistant") return parseCitationsFromFooter(msg.content);
  return [];
}

function AssistantBody({
  content,
}: {
  content: string;
}) {
  const display = stripCitationFooter(content);
  return (
    <div className="prose prose-sm max-w-none text-gray-700 [&_a]:inline-flex [&_a]:items-center [&_a]:align-middle [&_a]:mx-0.5 [&_a]:text-[#1677ff]">
      <Streamdown>{display}</Streamdown>
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  "最近有哪些重要的私募股权资讯？",
  "总结一下亚太地区的投资动态",
  "分析当前基础设施投资趋势",
  "Preqin 和 Pitchbook 最新报道了什么？",
  "有哪些大型基金正在募资？",
  "中国市场近期有什么投资动向？",
];

interface NewsBotProps {
  onClose: () => void;
  articleId?: number;
}

function getOrCreateChatSessionId(): string {
  try {
    let sid = localStorage.getItem(CHAT_SESSION_KEY);
    if (!sid) {
      sid = nanoid();
      localStorage.setItem(CHAT_SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return nanoid();
  }
}

function guessImportSource(url: string): "Preqin" | "Pitchbook" {
  const u = url.toLowerCase();
  if (u.includes("preqin.com")) return "Preqin";
  return "Pitchbook";
}

function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\//i.test(t) || /^www\./i.test(t);
}

export default function NewsBot({ onClose, articleId }: NewsBotProps) {
  const [, setLocation] = useLocation();
  const [sessionId, setSessionId] = useState(() => getOrCreateChatSessionId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrlText, setImportUrlText] = useState("");
  const [importTasks, setImportTasks] = useState<ImportTask[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 避免在会话中途被 history 查询刷新覆盖本地消息 */
  const lastHistorySyncSession = useRef<string | null>(null);

  const sendMutation = trpc.chat.send.useMutation();
  const importByUrlMutation = trpc.news.importByUrl.useMutation();

  const { data: historyRows, isSuccess: historyReady } = trpc.chat.history.useQuery(
    { sessionId },
    { enabled: !!sessionId, staleTime: 30_000 }
  );

  useEffect(() => {
    if (!historyReady || !historyRows) return;
    if (lastHistorySyncSession.current === sessionId) return;
    lastHistorySyncSession.current = sessionId;
    setMessages(
      historyRows.map((row) => ({
        id: `db-${row.id}`,
        role: row.role as "user" | "assistant",
        content: row.content,
        citations:
          row.role === "assistant" ? parseCitationsFromFooter(row.content) : undefined,
      }))
    );
  }, [historyReady, historyRows, sessionId]);

  const scrollToBottom = () => {
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null;
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const startNewChat = useCallback(() => {
    const next = nanoid();
    try {
      localStorage.setItem(CHAT_SESSION_KEY, next);
    } catch {
      /* ignore */
    }
    setSessionId(next);
    setMessages([]);
  }, []);

  const appendImportTask = useCallback((task: ImportTask) => {
    setImportTasks((prev) => [...prev, task]);
  }, []);

  const patchImportTask = useCallback((id: string, patch: Partial<ImportTask>) => {
    setImportTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  const runFileImport = useCallback(
    async (file: File) => {
      const tid = nanoid();
      appendImportTask({
        id: tid,
        kind: "file",
        label: file.name,
        status: "running",
      });
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/news/upload-document", {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          patchImportTask(tid, {
            status: "failed",
            detail: (json as { error?: string }).error ?? `HTTP ${res.status}`,
          });
          setMessages((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              content: `文件导入失败：${(json as { error?: string }).error ?? res.statusText}`,
            },
          ]);
          return;
        }
        const ok = json as { success?: boolean; articleId?: number; title?: string };
        patchImportTask(tid, {
          status: "done",
          detail: ok.title ? `已入库 #${ok.articleId}` : "已完成",
        });
        setMessages((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: "assistant",
            content: `文件导入成功。${ok.title ? `已添加报告「${ok.title}」。` : ""}`,
            citations:
              ok.articleId && ok.title
                ? [{ refKey: "文章1", articleId: ok.articleId, title: ok.title }]
                : undefined,
          },
        ]);
      } catch (e) {
        patchImportTask(tid, {
          status: "failed",
          detail: e instanceof Error ? e.message : "网络错误",
        });
        setMessages((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: "assistant",
            content: "文件导入失败，请检查网络或登录状态后重试。",
          },
        ]);
      }
    },
    [appendImportTask, patchImportTask]
  );

  const runUrlImport = useCallback(
    async (raw: string) => {
      let url = raw.trim();
      if (/^www\./i.test(url)) url = `https://${url}`;
      const tid = nanoid();
      appendImportTask({
        id: tid,
        kind: "url",
        label: url,
        status: "running",
      });
      try {
        const source = guessImportSource(url);
        const out = await importByUrlMutation.mutateAsync({
          urls: [url],
          source,
        });
        const first = out.results[0];
        if (first?.status === "success") {
          patchImportTask(tid, { status: "done", detail: first.title });
          setMessages((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              content: `链接导入成功：${first.title ?? url}。`,
            },
          ]);
        } else if (first?.status === "duplicate") {
          patchImportTask(tid, { status: "done", detail: "已存在" });
          setMessages((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              content: `该链接对应内容已在库中${first.title ? `（${first.title}）` : ""}，未重复导入。`,
            },
          ]);
        } else {
          patchImportTask(tid, {
            status: "failed",
            detail: first?.error ?? "导入失败",
          });
          setMessages((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              content: `链接导入失败：${first?.error ?? "未知错误"}`,
            },
          ]);
        }
      } catch (e) {
        patchImportTask(tid, {
          status: "failed",
          detail: e instanceof Error ? e.message : "请求失败",
        });
        setMessages((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: "assistant",
            content: "链接导入失败，请稍后重试。",
          },
        ]);
      }
    },
    [appendImportTask, importByUrlMutation, patchImportTask]
  );

  const handleSmartImportSubmit = useCallback(() => {
    const text = importUrlText.trim();
    if (looksLikeUrl(text)) {
      setImportOpen(false);
      void runUrlImport(text);
      setImportUrlText("");
      return;
    }
    if (fileInputRef.current?.files?.length) {
      const f = fileInputRef.current.files[0];
      void runFileImport(f);
      fileInputRef.current.value = "";
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: nanoid(),
        role: "assistant",
        content: "请粘贴以 http(s):// 开头的链接，或点击下方选择 PDF / Word 文件。",
      },
    ]);
  }, [importUrlText, runUrlImport, runFileImport]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;

    const userMsg: Message = { role: "user", content, id: nanoid() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const result = await sendMutation.mutateAsync({
        sessionId,
        message: content,
        articleId,
        origin: window.location.origin,
      });
      const assistantMsg: Message = {
        role: "assistant",
        content: result.content,
        id: nanoid(),
        references: result.references,
        citations: result.citations,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: Message = {
        role: "assistant",
        content: "抱歉，请求失败，请稍后重试。",
        id: nanoid(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickFilters = useMemo(
    () => [
      {
        label: "今日资讯",
        onClick: () => {
          window.dispatchEvent(
            new CustomEvent("ipms-research-preset", { detail: { preset: "today" } })
          );
          setLocation("/news?preset=today");
        },
      },
      {
        label: "本周热度 Top3",
        onClick: () => {
          window.dispatchEvent(
            new CustomEvent("ipms-research-preset", { detail: { preset: "weekTop3" } })
          );
          setLocation("/news?preset=weekTop3");
        },
      },
    ],
    [setLocation]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-white shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#1677ff] flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">AI 资讯助手</p>
            <p className="text-[11px] text-gray-400 truncate">
              {articleId
                ? "本文问答（默认严格基于当前文档）"
                : "基于资讯库 · 可导入链接或文件"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-gray-600"
            onClick={startNewChat}
            title="开启新会话（当前会话仍保留在服务端）"
          >
            <PlusCircle className="h-3.5 w-3.5 mr-1" />
            新对话
          </Button>
          <Popover open={importOpen} onOpenChange={setImportOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs border-[#1677ff]/30 text-[#1677ff]"
                title="导入链接或文件"
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                导入
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end">
              <p className="text-xs font-medium text-gray-700 mb-2">智能导入</p>
              <p className="text-[11px] text-gray-500 mb-2">
                粘贴 Preqin / Pitchbook 文章链接，或选择 PDF / Word；导入进行中仍可正常提问。
              </p>
              <div className="flex gap-1.5 mb-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setImportOpen(false);
                      void runFileImport(f);
                    }
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs flex-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  选择文件
                </Button>
              </div>
              <div className="flex gap-1.5 items-center">
                <Link2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <input
                  className="flex-1 h-8 text-xs border rounded-md px-2 border-gray-200"
                  placeholder="https://… 文章链接"
                  value={importUrlText}
                  onChange={(e) => setImportUrlText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSmartImportSubmit()}
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="w-full mt-2 h-8 text-xs bg-[#1677ff]"
                onClick={handleSmartImportSubmit}
              >
                提交链接
              </Button>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {importTasks.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/90 shrink-0 max-h-28 overflow-y-auto">
          <div className="flex items-center gap-1 text-[11px] font-medium text-gray-600 mb-1.5">
            <ListTodo className="h-3 w-3" />
            导入任务
          </div>
          <ul className="space-y-1">
            {importTasks.slice(-6).map((t) => (
              <li
                key={t.id}
                className="text-[11px] text-gray-600 flex items-start gap-1.5 justify-between"
              >
                <span className="truncate flex-1" title={t.label}>
                  {t.kind === "url" ? "链接" : "文件"} · {t.label}
                </span>
                <span
                  className={
                    t.status === "done"
                      ? "text-emerald-600 shrink-0"
                      : t.status === "failed"
                        ? "text-red-600 shrink-0"
                        : "text-[#1677ff] shrink-0"
                  }
                >
                  {t.status === "running"
                    ? "进行中"
                    : t.status === "done"
                      ? "完成"
                      : t.status === "failed"
                        ? "失败"
                        : "排队"}
                  {t.detail ? ` · ${t.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollAreaRef} className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex flex-col h-full p-4">
            <div className="flex flex-col items-center justify-center gap-3 flex-1 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#e8f0fe] flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-[#1677ff]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">资讯智能助手</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {articleId ? (
                    <>
                      围绕当前文档问答
                      <br />
                      回答默认严格基于当前内容
                    </>
                  ) : (
                    <>
                      查询、总结与分析 Preqin / Pitchbook 等来源
                      <br />
                      可使用右上角「导入」添加链接或上传文件
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 justify-center mb-3">
              {quickFilters.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={f.onClick}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-[#1677ff]/25 bg-white text-[#1677ff] hover:bg-[#e8f0fe]"
                >
                  <Flame className="h-3 w-3" />
                  {f.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs text-gray-400 text-center mb-2">快速提问</p>
              <div className="grid grid-cols-1 gap-1.5">
                {(articleId
                  ? [
                      "请总结这篇内容的核心结论",
                      "这篇文章涉及哪些关键数据？",
                      "请给出这篇内容的结构化要点",
                      "文中有哪些风险与机会信号？",
                    ]
                  : SUGGESTED_PROMPTS
                ).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    disabled={isLoading}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-[#e8f0fe] hover:border-[#1677ff]/30 hover:text-[#1677ff] transition-all text-gray-600 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-4">
              {messages.map((msg) => {
                const cites = mergeCitationsForMessage(msg);
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2 items-start ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <div className="w-6 h-6 rounded-full bg-[#1677ff] flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2.5 text-sm ${
                        msg.role === "user"
                          ? "bg-[#1677ff] text-white"
                          : "bg-gray-50 border border-gray-100 text-gray-700"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="space-y-2">
                          <AssistantBody content={msg.content} />
                          {!articleId && cites.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {cites.map((c, i) => (
                                <button
                                  key={`${msg.id}-cite-${i}`}
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
                                  onClick={() => {
                                    if (c.articleId > 0) setLocation(`/news/${c.articleId}`);
                                  }}
                                  title={c.title}
                                  disabled={c.articleId <= 0}
                                >
                                  📄
                                  <span className="max-w-[180px] truncate">{c.title}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {articleId &&
                            msg.references &&
                            msg.references.length > 0 && (
                              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-2 space-y-1.5">
                                <p className="text-[11px] text-blue-700 font-medium">
                                  引用定位（点击跳转）
                                </p>
                                <div className="flex flex-col gap-1.5 max-w-full">
                                  {msg.references.map((ref, idx) => (
                                    <div
                                      key={`${msg.id}-ref-${idx}`}
                                      className="rounded-md border border-blue-200/80 bg-white overflow-hidden w-full min-w-[200px] max-w-full"
                                    >
                                      <button
                                        type="button"
                                        className="w-full text-left text-[11px] px-2 py-1.5 text-blue-700 hover:bg-blue-50 font-medium"
                                        title={ref.quote ?? "定位到原文对应行"}
                                        onClick={() => {
                                          window.dispatchEvent(
                                            new CustomEvent("ipms-locate-reference", {
                                              detail: {
                                                articleId,
                                                page: ref.page,
                                                startLine: ref.startLine,
                                                endLine: ref.endLine,
                                                quote: ref.quote ?? "",
                                              },
                                            })
                                          );
                                        }}
                                      >
                                        定位：第{ref.page}页 · L{ref.startLine}–{ref.endLine}
                                      </button>
                                      {ref.quote ? (
                                        <p className="text-[10px] leading-relaxed text-gray-700 px-2 pb-2 pt-0 border-t border-amber-100 bg-amber-50/90">
                                          <span className="text-amber-800/80 font-medium">摘录 </span>
                                          {ref.quote}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="h-3.5 w-3.5 text-gray-500" />
                      </div>
                    )}
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex gap-2 items-start">
                  <div className="w-6 h-6 rounded-full bg-[#1677ff] flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-1.5 h-1.5 rounded-full bg-[#1677ff] animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full bg-[#1677ff] animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full bg-[#1677ff] animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-100 bg-white shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行..."
            className="flex-1 max-h-24 resize-none min-h-[36px] text-sm border-gray-200 focus:border-[#1677ff] focus:ring-[#1677ff]/20"
            rows={1}
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-9 w-9 bg-[#1677ff] hover:bg-[#0958d9] text-white shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          {articleId
            ? "当前回答默认仅基于本页文档，并附引用定位"
            : "回答仅供参考；引用可点击图标跳转原文详情"}
        </p>
      </div>
    </div>
  );
}
