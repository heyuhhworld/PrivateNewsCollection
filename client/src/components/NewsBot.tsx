import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getChromeExtensionUserGuideMarkdown,
  chromeExtensionZipUrl,
} from "@shared/chromeExtensionUserGuide";


import {
  copyChromeExtensionsUrl,
  tryOpenChromeExtensionsPage,
} from "@/lib/chromeExtensions";
import { Streamdown } from "streamdown";
import { getRehypePluginsWithOrigin } from "@/lib/streamdownPlugins";
import {
  Bot,
  Link2,
  Loader2,
  Send,
  X,
  Sparkles,
  User,
  PlusCircle,
  Puzzle,
  Maximize2,
  Minimize2,
  Shrink,
  History,
  ThumbsUp,
  ThumbsDown,
  Copy,
  RefreshCw,
  Trash2,
  Pencil,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";

const CHAT_SESSION_KEY = "ipms_research_chat_session_id";
const ARTICLE_CHAT_SESSION_KEY_PREFIX = "ipms_article_chat_session_id:";

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

function stripCitationFooter(content: string): string {
  return content.replace(/\n\n---\s*\n\*\*相关资讯链接：\*\*[\s\S]*$/m, "").trimEnd();
}

function stripSessionTitlePrefix(content: string): string {
  return content.replace(/^\[会话名:.+?\]\s*/, "");
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
    const aid = Number(m[2]);
    out.push({
      refKey: `文章${n}`,
      articleId: aid,
      title: m[1],
    });
    n++;
  }
  return out;
}

/** Build map: "文章1" → articleId, for rewriting body text */
function buildRefKeyToIdMap(cites: CitationItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of cites) map.set(c.refKey, c.articleId);
  return map;
}

/** Replace [文章N] in text with [#articleId] */
function rewriteCitationKeysInBody(body: string, cites: CitationItem[]): string {
  if (cites.length === 0) return body;
  const map = buildRefKeyToIdMap(cites);
  return body.replace(/\[文章(\d+)\]/g, (_match, n) => {
    const aid = map.get(`文章${n}`);
    return aid ? `[#${aid}]` : _match;
  });
}

function mergeCitationsForMessage(msg: Message): CitationItem[] {
  if (msg.citations && msg.citations.length > 0) return msg.citations;
  if (msg.role === "assistant") return parseCitationsFromFooter(msg.content);
  return [];
}

function AssistantBody({
  content,
  onNavigate,
  citations,
}: {
  content: string;
  onNavigate?: (path: string) => void;
  citations?: CitationItem[];
}) {
  const display = rewriteCitationKeysInBody(stripCitationFooter(content), citations ?? []);
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (href && /^\/news\/\d+$/.test(href)) {
        e.preventDefault();
        onNavigate?.(`${href}?entry=chat`);
      }
    },
    [onNavigate]
  );
  return (
    <div
      className="prose prose-sm max-w-none text-gray-700 [&_a]:inline-flex [&_a]:items-center [&_a]:align-middle [&_a]:mx-0.5 [&_a]:text-[#1677ff] [&_a]:cursor-pointer"
      onClick={handleClick}
    >
      <Streamdown rehypePlugins={getRehypePluginsWithOrigin()}>{display}</Streamdown>
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
  "Chrome 浏览器插件怎么下载和安装？有什么作用？",
];

interface NewsBotProps {
  articleId?: number;
  openedArticleId?: number;
  chatFullscreen?: boolean;
  onToggleChatFullscreen?: () => void;
  onMinimizeChat?: () => void;
  onRequestPickArticle?: (
    currentIds: number[],
    onConfirm: (ids: number[]) => void
  ) => void;
}

function HeaderIconTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-[16rem]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
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

function getArticleChatSessionKey(articleId: number): string {
  return `${ARTICLE_CHAT_SESSION_KEY_PREFIX}${articleId}`;
}

function getStoredSessionId(key: string): string | null {
  try {
    const v = localStorage.getItem(key)?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

function setStoredSessionId(key: string, sessionId: string): void {
  try {
    localStorage.setItem(key, sessionId);
  } catch {
    /* ignore */
  }
}

export default function NewsBot({
  articleId,
  openedArticleId,
  chatFullscreen,
  onToggleChatFullscreen,
  onMinimizeChat,
  onRequestPickArticle,
}: NewsBotProps) {
  const [, setLocation] = useLocation();
  const [sessionId, setSessionId] = useState(() => nanoid());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [linkedArticleIds, setLinkedArticleIds] = useState<number[]>([]);




  const [chromeExtGuideOpen, setChromeExtGuideOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 避免在会话中途被 history 查询刷新覆盖本地消息 */
  const lastHistorySyncSession = useRef<string | null>(null);
  /** 详情页优先尝试恢复旧会话；若该会话无历史，则仅重建一次空会话 */
  const articleSessionLoadedFromStorage = useRef(false);

  const utils = trpc.useUtils();
  const { data: me } = trpc.auth.me.useQuery();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "like" | "dislike">>({});



  const sendMutation = trpc.chat.send.useMutation();
  const { data: sessionList } = trpc.chat.sessions.useQuery(
    { userId: me?.id ?? 0 },
    { enabled: Boolean(me?.id), staleTime: 15_000 }
  );
  const renameSessionMutation = trpc.chat.renameSession.useMutation({
    onSuccess: async () => {
      if (!me?.id) return;
      await utils.chat.sessions.invalidate({ userId: me.id });
      toast.success("会话已重命名");
      setRenamingSessionId(null);
      setRenameInput("");
    },
  });
  const deleteSessionMutation = trpc.chat.deleteSession.useMutation({
    onSuccess: async (_v, vars) => {
      if (me?.id) await utils.chat.sessions.invalidate({ userId: me.id });
      toast.success("会话已删除");
      if (vars.sessionId === sessionId) {
        startNewChat();
      }
    },
  });
  const { data: linkedArticlesMeta } = trpc.briefing.citationMeta.useQuery(
    { ids: linkedArticleIds },
    { enabled: linkedArticleIds.length > 0 }
  );


  const setBriefingPrefsMutation = trpc.briefing.setMyPrefs.useMutation({
    onSuccess: () => {
      void utils.briefing.myPrefs.invalidate();
    },
  });

  const isInlineMode = !onMinimizeChat && !onToggleChatFullscreen;
  const shouldLoadHistory = Boolean(sessionId) && (isInlineMode || Boolean(chatFullscreen) || articleId != null);
  const { data: historyRows, isSuccess: historyReady } = trpc.chat.history.useQuery(
    { sessionId },
    { enabled: shouldLoadHistory, staleTime: 30_000 }
  );

  useEffect(() => {
    // 详情页：按文章/报告绑定独立会话，自动恢复最近一次对话
    if (articleId != null) {
      const key = getArticleChatSessionKey(articleId);
      const restored = getStoredSessionId(key);
      if (restored) {
        articleSessionLoadedFromStorage.current = true;
        setSessionId(restored);
      } else {
        articleSessionLoadedFromStorage.current = false;
        const sid = nanoid();
        setStoredSessionId(key, sid);
        setSessionId(sid);
      }
      lastHistorySyncSession.current = null;
      setMessages([]);
      return;
    }

    articleSessionLoadedFromStorage.current = false;
    if (isInlineMode || chatFullscreen) {
      const sid = getOrCreateChatSessionId();
      setSessionId(sid);
    } else {
      setSessionId(nanoid());
    }
    lastHistorySyncSession.current = null;
    setMessages([]);
  }, [articleId, chatFullscreen, isInlineMode]);

  useEffect(() => {
    if (openedArticleId == null || articleId != null) return;
    setLinkedArticleIds((prev) =>
      prev.includes(openedArticleId) ? prev : [openedArticleId, ...prev].slice(0, 5)
    );
  }, [openedArticleId, articleId]);

  useEffect(() => {
    if (!shouldLoadHistory || !historyReady || !historyRows) return;
    if (articleId != null && historyRows.length === 0 && articleSessionLoadedFromStorage.current) {
      // 旧会话已不存在/无记录：自动切到一个全新的空会话
      const sid = nanoid();
      setStoredSessionId(getArticleChatSessionKey(articleId), sid);
      setSessionId(sid);
      articleSessionLoadedFromStorage.current = false;
      lastHistorySyncSession.current = null;
      setMessages([]);
      return;
    }
    if (lastHistorySyncSession.current === sessionId) return;
    articleSessionLoadedFromStorage.current = false;
    lastHistorySyncSession.current = sessionId;
    setMessages(
      historyRows.map((row) => ({
        id: `db-${row.id}`,
        role: row.role as "user" | "assistant",
        content:
          row.role === "user" ? stripSessionTitlePrefix(row.content) : row.content,
        citations:
          row.role === "assistant" ? parseCitationsFromFooter(row.content) : undefined,
      }))
    );
  }, [articleId, historyReady, historyRows, sessionId, shouldLoadHistory]);

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
    if (articleId != null) {
      setStoredSessionId(getArticleChatSessionKey(articleId), next);
      articleSessionLoadedFromStorage.current = false;
    } else if (isInlineMode || chatFullscreen) {
      setStoredSessionId(CHAT_SESSION_KEY, next);
    }
    setSessionId(next);
    lastHistorySyncSession.current = null;
    setMessages([]);
  }, [articleId, chatFullscreen, isInlineMode]);




  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;

    const userMsg: Message = { role: "user", content, id: nanoid() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let streamAssistantId: string | null = null;

    try {
      if (articleId == null && /^\s*设置简报内容[:：]/.test(content)) {
        if (!me?.id) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "请先登录后再保存简报设置。", id: nanoid() },
          ]);
          return;
        }
        const full = content.replace(/^\s*设置简报内容[:：]\s*/, "").trim();
        if (!full) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "请在「设置简报内容：」后附上完整提示词内容。",
              id: nanoid(),
            },
          ]);
          return;
        }
        await setBriefingPrefsMutation.mutateAsync({
          briefingSystemPromptCustom: full,
          instruction: null,
          introCompleted: true,
        });
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "已按你提供的内容更新简报提示。", id: nanoid() },
        ]);
        return;
      }

      if (articleId == null && /^\s*【简报偏好】/.test(content)) {
        if (!me?.id) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "请先登录后再保存简报写作偏好。",
              id: nanoid(),
            },
          ]);
          return;
        }
        const instr = content.replace(/^\s*【简报偏好】\s*/, "").trim();
        await setBriefingPrefsMutation.mutateAsync({
          instruction: instr || null,
          briefingSystemPromptCustom: null,
          introCompleted: true,
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "已保存你的「追加说明」：管理员下次在「AI 每日简报」点击「重新生成」时，会把它合并进系统默认模板。若需整条替换系统提示，请发送以「【简报完整提示】」开头的消息。",
            id: nanoid(),
          },
        ]);
        setAwaitingBriefingCustomizeConfirm(false);
        setAwaitingBriefingPromptInput(false);
        return;
      }

      if (articleId == null && /^\s*【简报完整提示】/.test(content)) {
        if (!me?.id) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "请先登录后再保存简报系统提示。",
              id: nanoid(),
            },
          ]);
          return;
        }
        const full = content.replace(/^\s*【简报完整提示】\s*/, "").trim();
        if (!full) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "请在「【简报完整提示】」同一消息里附上完整的 system 提示内容（可多行）。",
              id: nanoid(),
            },
          ]);
          return;
        }
        await setBriefingPrefsMutation.mutateAsync({
          briefingSystemPromptCustom: full,
          instruction: null,
          introCompleted: true,
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "已保存你的「完整 System Prompt」：将覆盖默认模板，仅在管理员重新生成每日简报时生效。若要改回默认并只用简短追加说明，可再发「【简报偏好】…」或在简报页点「恢复系统预设」。",
            id: nanoid(),
          },
        ]);
        setAwaitingBriefingCustomizeConfirm(false);
        setAwaitingBriefingPromptInput(false);
        return;
      }

      if (articleId != null) {
        const result = await sendMutation.mutateAsync({
          sessionId,
          message: content,
          articleId,
          userId: me?.id,
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
        return;
      }

      if (linkedArticleIds.length > 0) {
        const result = await sendMutation.mutateAsync({
          sessionId,
          message: content,
          articleIds: linkedArticleIds,
          userId: me?.id,
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
        return;
      }

      const sid = nanoid();
      streamAssistantId = sid;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", id: sid },
      ]);

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId,
          message: content,
          origin: window.location.origin,
          userId: me?.id,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let carry = "";
      let full = "";

      const applyChunk = (text: string) => {
        full += text;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamAssistantId ? { ...m, content: full } : m
          )
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        const parts = carry.split("\n\n");
        carry = parts.pop() ?? "";
        for (const block of parts) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          try {
            const ev = JSON.parse(raw) as {
              type?: string;
              text?: string;
              content?: string;
              citations?: CitationItem[];
              message?: string;
            };
            if (ev.type === "chunk" && ev.text) applyChunk(ev.text);
            if (ev.type === "done") {
              const finalText = ev.content ?? full;
              full = finalText;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamAssistantId
                    ? {
                        ...m,
                        content: finalText,
                        citations: ev.citations,
                      }
                    : m
                )
              );
            }
            if (ev.type === "error") {
              throw new Error(ev.message ?? "流式输出失败");
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (!full.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamAssistantId
              ? { ...m, content: "未收到模型回复，请重试。" }
              : m
          )
        );
      }

      await utils.chat.history.invalidate({ sessionId }).catch(() => {});
    } catch (err) {
      const detail =
        err instanceof TRPCClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "未知错误";
      const errorMsg: Message = {
        role: "assistant",
        content:
          detail && detail !== "Failed to fetch"
            ? `抱歉，请求失败：${detail}`
            : "抱歉，网络异常（Failed to fetch）。请确认本页地址与终端 dev 端口一致，或稍后重试。",
        id: nanoid(),
      };
      setMessages((prev) => {
        const withoutEmpty = prev.filter(
          (m) =>
            !(
              streamAssistantId &&
              m.id === streamAssistantId &&
              m.role === "assistant" &&
              m.content.trim() === ""
            )
        );
        return [...withoutEmpty, errorMsg];
      });
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

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(stripCitationFooter(content));
      toast.success("已复制");
    } catch {
      toast.error("复制失败");
    }
  }, []);

  const handleRegenerate = useCallback(
    (assistantMsgId: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0) return;
      const prevUser = [...messages.slice(0, idx)]
        .reverse()
        .find((m) => m.role === "user");
      if (!prevUser) return;
      void handleSend(prevUser.content);
    },
    [messages]
  );

  const openRename = useCallback((sid: string, title: string) => {
    setRenamingSessionId(sid);
    setRenameInput(title);
  }, []);




  return (
    <div className="flex flex-col h-full min-h-0 flex-1">
      {/* Header：标题与所有窗口操作同一行，避免与外层绝对定位叠压 */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-lg bg-[#1677ff] flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate leading-tight">
              AI 资讯助手
            </p>
            <p className="text-[11px] text-gray-400 truncate leading-tight mt-0.5">
              {articleId
                ? "本文问答 · 严格基于当前文档"
                : linkedArticleIds.length > 0
                  ? `已关联 ${linkedArticleIds.length} 篇文章，优先基于关联内容回答`
                  : "基于资讯库问答"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <HeaderIconTooltip label="查看浏览器插件安装说明，并下载插件 ZIP 压缩包">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 border-violet-200 text-violet-700 hover:bg-violet-50"
              onClick={() => setChromeExtGuideOpen(true)}
            >
              <Puzzle className="h-4 w-4" />
            </Button>
          </HeaderIconTooltip>
          <HeaderIconTooltip label="开启新对话；之前的会话仍保存在服务器，可从历史恢复">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-gray-600"
              onClick={startNewChat}
            >
              <PlusCircle className="h-4 w-4" />
            </Button>
          </HeaderIconTooltip>
          <HeaderIconTooltip label="历史会话：查看、重命名、删除并继续问答">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-gray-600"
              onClick={() => setHistoryOpen(true)}
              disabled={!me?.id}
            >
              <History className="h-4 w-4" />
            </Button>
          </HeaderIconTooltip>
          {onToggleChatFullscreen && onMinimizeChat && (
            <>
              <HeaderIconTooltip
                label={
                  chatFullscreen
                    ? "退出全屏，恢复为可拖拽调整大小的浮窗"
                    : "全屏铺满当前页面（仍在本页内，非浏览器原生全屏）"
                }
              >
                <button
                  type="button"
                  onClick={onToggleChatFullscreen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50 shrink-0"
                >
                  {chatFullscreen ? (
                    <Shrink className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </button>
              </HeaderIconTooltip>
              <HeaderIconTooltip label="收起聊天窗（会话保留，可再次点击右下角按钮打开）">
                <button
                  type="button"
                  onClick={onMinimizeChat}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50 shrink-0"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </HeaderIconTooltip>
            </>
          )}
        </div>
      </div>
      {articleId == null && (
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/70 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-500 flex items-center gap-1">
              <Link2 className="h-3 w-3" />
              关联文章（问答优先使用）
              {linkedArticleIds.length > 0 && (
                <span className="ml-1 text-[#1677ff] font-medium">{linkedArticleIds.length}/5</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {linkedArticleIds.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-gray-400 hover:text-red-500 hover:underline"
                  onClick={() => setLinkedArticleIds([])}
                >
                  清空
                </button>
              )}
              <button
                type="button"
                className="text-[11px] text-[#1677ff] hover:underline"
                onClick={() => {
                  if (onRequestPickArticle) {
                    onRequestPickArticle(linkedArticleIds, (ids) => {
                      setLinkedArticleIds(ids);
                    });
                  }
                }}
              >
                {linkedArticleIds.length > 0 ? "修改" : "添加"}
              </button>
            </div>
          </div>
          {linkedArticleIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedArticleIds.map((id) => {
                const title =
                  linkedArticlesMeta?.find((m) => m.id === id)?.title ?? `文章 #${id}`;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 max-w-full"
                  >
                    <button
                      type="button"
                      className="truncate max-w-[180px] hover:underline"
                      title={title}
                      onClick={() => setLocation(`/news/${id}?entry=chat`)}
                    >
                      {title}
                    </button>
                    <button
                      type="button"
                      className="text-blue-500 hover:text-blue-700"
                      onClick={() =>
                        setLinkedArticleIds((prev) => prev.filter((x) => x !== id))
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollAreaRef} className="flex-1 min-h-0 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col h-full p-4">
            <div className="flex flex-col items-center justify-center gap-3 flex-1 text-center min-h-0">
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
                      基于入库资讯，随时提问、总结与分析
                    </>
                  )}
                </p>
              </div>



            </div>

            {articleId && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 text-center mb-2">快速提问</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {[
                    "请总结这篇内容的核心结论",
                    "这篇文章涉及哪些关键数据？",
                    "请给出这篇内容的结构化要点",
                    "文中有哪些风险与机会信号？",
                  ].map((prompt) => (
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
            )}

            {!articleId && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 text-center mb-2">直接提问</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {SUGGESTED_PROMPTS.slice(0, 4).map((prompt) => (
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
            )}
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
                          <AssistantBody content={msg.content} onNavigate={setLocation} citations={cites} />
                          {!articleId && cites.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {cites.map((c, i) => (
                                <button
                                  key={`${msg.id}-cite-${i}`}
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
                                  onClick={() => {
                                    if (c.articleId > 0) setLocation(`/news/${c.articleId}?entry=chat`);
                                  }}
                                  title={c.title}
                                  disabled={c.articleId <= 0}
                                >
                                  <span className="shrink-0 font-mono text-blue-500/80">#{c.articleId}</span>
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
                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              type="button"
                              className={`inline-flex h-6 w-6 items-center justify-center rounded border ${
                                feedbackMap[msg.id] === "like"
                                  ? "border-green-300 bg-green-50 text-green-600"
                                  : "border-gray-200 text-gray-400 hover:text-green-600 hover:border-green-200"
                              }`}
                              onClick={() =>
                                setFeedbackMap((p) => ({ ...p, [msg.id]: "like" }))
                              }
                              title="有帮助"
                            >
                              <ThumbsUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={`inline-flex h-6 w-6 items-center justify-center rounded border ${
                                feedbackMap[msg.id] === "dislike"
                                  ? "border-rose-300 bg-rose-50 text-rose-600"
                                  : "border-gray-200 text-gray-400 hover:text-rose-600 hover:border-rose-200"
                              }`}
                              onClick={() =>
                                setFeedbackMap((p) => ({ ...p, [msg.id]: "dislike" }))
                              }
                              title="无帮助"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300"
                              onClick={() => handleRegenerate(msg.id)}
                              title="重新生成"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300"
                              onClick={() => void handleCopy(msg.content)}
                              title="复制"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
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
            ? "当前回答默认仅基于本页文档；若问「浏览器插件 / 安装」等，会直接给出操作步骤（不依赖本文）"
            : "回答仅供参考；引用可点击图标跳转原文详情"}
        </p>
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-gray-100">
            <DialogTitle className="text-base text-gray-900">历史会话</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-3 space-y-2">
              {(sessionList ?? []).map((s) => (
                <div
                  key={s.sessionId}
                  className={`rounded-lg border px-3 py-2 ${
                    s.sessionId === sessionId ? "border-[#1677ff]/40 bg-blue-50/50" : "border-gray-200 bg-white"
                  }`}
                >
                  {renamingSessionId === s.sessionId ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        className="h-8 flex-1 rounded border border-gray-200 px-2 text-sm"
                        placeholder="输入会话名称"
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          if (!me?.id || !renameInput.trim()) return;
                          renameSessionMutation.mutate({
                            userId: me.id,
                            sessionId: s.sessionId,
                            title: renameInput.trim(),
                          });
                        }}
                        disabled={renameSessionMutation.isPending || !renameInput.trim()}
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => {
                          setRenamingSessionId(null);
                          setRenameInput("");
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setSessionId(s.sessionId);
                          setStoredSessionId(CHAT_SESSION_KEY, s.sessionId);
                          lastHistorySyncSession.current = null;
                          setHistoryOpen(false);
                        }}
                      >
                        <p className="text-sm text-gray-800 truncate">{s.title || "新对话"}</p>
                        <p className="text-[11px] text-gray-400 mt-1">
                          {new Date(s.lastAt).toLocaleString()} · {s.totalMessages} 条消息
                        </p>
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:text-[#1677ff]"
                          onClick={() => openRename(s.sessionId, s.title)}
                          title="重命名"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:text-rose-600"
                          onClick={() => {
                            if (!me?.id) return;
                            deleteSessionMutation.mutate({
                              userId: me.id,
                              sessionId: s.sessionId,
                            });
                          }}
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {(sessionList ?? []).length === 0 && (
                <div className="text-center text-sm text-gray-400 py-10">暂无历史会话</div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={chromeExtGuideOpen} onOpenChange={setChromeExtGuideOpen}>
        <DialogContent className="max-w-lg gap-0 p-0 overflow-hidden sm:max-w-lg">
          <DialogHeader className="px-5 pt-5 pb-2 border-b border-gray-100 space-y-2">
            <DialogTitle className="text-base text-gray-900">
              安装 IPMS 浏览器插件
            </DialogTitle>
            <p className="text-xs text-gray-500 font-normal leading-relaxed">
              按下面步骤即可完成。Chrome
              不允许网站对未上架扩展「静默一键安装」，先下载再解压加载是正常、安全的方式。
            </p>
          </DialogHeader>

          <ScrollArea className="max-h-[55vh] px-5 py-3">
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div
              className="prose prose-sm max-w-none text-gray-700 pr-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:first:mt-0 [&_a]:text-[#1677ff] [&_img]:rounded-lg [&_img]:border [&_img]:border-gray-200 [&_img]:shadow-sm [&_img]:my-2"
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest?.("a");
                if (a?.href?.startsWith("chrome://")) {
                  e.preventDefault();
                  tryOpenChromeExtensionsPage();
                }
              }}
            >
              <Streamdown rehypePlugins={getRehypePluginsWithOrigin()}>
                {getChromeExtensionUserGuideMarkdown(
                  typeof window !== "undefined" ? window.location.origin : ""
                )}
              </Streamdown>
            </div>
          </ScrollArea>
          <DialogFooter className="px-5 py-4 border-t border-gray-100 bg-gray-50/80 flex-col sm:flex-row gap-2 shrink-0">
            <Button variant="secondary" className="w-full sm:w-auto order-2 sm:order-1" type="button" onClick={() => setChromeExtGuideOpen(false)}>
              关闭
            </Button>
            <Button asChild className="w-full sm:w-auto order-1 sm:order-2 bg-violet-600 hover:bg-violet-700 text-white">
              <a
                href={chromeExtensionZipUrl(
                  typeof window !== "undefined" ? window.location.origin : ""
                )}
                download="ipms-news-importer.zip"
              >
                下载 ZIP 文件
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
