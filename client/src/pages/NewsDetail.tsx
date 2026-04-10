import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Calendar,
  ExternalLink,
  Globe,
  Newspaper,
  User,
  GripVertical,
  PanelRightClose,
  PanelRightOpen,
  Upload,
} from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { PdfCitationViewer } from "@/components/PdfCitationViewer";

// 获取或生成持久化的 sessionId
function getSessionId(): string {
  let sid = localStorage.getItem("ipms_session_id");
  if (!sid) {
    sid = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("ipms_session_id", sid);
  }
  return sid;
}

function ImportSourceIcon({ source }: { source: string }) {
  const manual = source === "Manual";
  return (
    <span
      title={manual ? "手工上传" : "自动导入"}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600"
    >
      {manual ? (
        <Upload className="h-4 w-4 text-slate-600" />
      ) : (
        <Globe className="h-4 w-4 text-[#1677ff]" />
      )}
    </span>
  );
}

// 章节颜色池（循环使用）
const SECTION_COLORS = [
  { border: "border-l-blue-500", bg: "bg-blue-50/40", title: "text-blue-700", dot: "bg-blue-500" },
  { border: "border-l-emerald-500", bg: "bg-emerald-50/40", title: "text-emerald-700", dot: "bg-emerald-500" },
  { border: "border-l-violet-500", bg: "bg-violet-50/40", title: "text-violet-700", dot: "bg-violet-500" },
  { border: "border-l-sky-500", bg: "bg-sky-50/40", title: "text-sky-700", dot: "bg-sky-500" },
  { border: "border-l-amber-500", bg: "bg-amber-50/40", title: "text-amber-700", dot: "bg-amber-500" },
  { border: "border-l-rose-500", bg: "bg-rose-50/40", title: "text-rose-700", dot: "bg-rose-500" },
];

interface ArticleSection {
  heading: string;
  body: string;
}

type MainTab = "ai" | "body";

const SPLIT_PCT_KEY = "ipms_news_detail_split_pct";
const SPLIT_DEFAULT = 54;
const SPLIT_MIN = 26;
const SPLIT_MAX = 74;

/** 左侧文本预览分块行数；引用定位跳转需与此一致 */
const PREVIEW_LINES_PER_CHUNK = 14;

export default function NewsDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const id = parseInt(params.id ?? "0");
  const sessionId = useMemo(() => getSessionId(), []);
  /** 报告式详情：AI导读 / 资讯正文 */
  const [mainTab, setMainTab] = useState<MainTab>("ai");
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT);
  const [insightPanelOpen, setInsightPanelOpen] = useState(true);
  /** PDF 内嵌预览页码（浏览器内置查看器支持 #page= 时生效，仅为大致定位） */
  const [pdfPage, setPdfPage] = useState(1);
  /** 与 chat 引用 L 行号一致：基于「非空行」连续编号（同 server/routers/chat.ts） */
  const [citationHighlight, setCitationHighlight] = useState<{
    startLine: number;
    endLine: number;
    page: number;
    quote?: string;
  } | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ startX: number; startPct: number; lastPct: number } | null>(
    null
  );

  const { data: article, isLoading, error } = trpc.news.detail.useQuery(
    { id },
    { enabled: id > 0 }
  );

  const { data: bookmarked, refetch: refetchBookmark } =
    trpc.news.isBookmarked.useQuery(
      { articleId: id, sessionId },
      { enabled: id > 0 }
    );

  const addBookmark = trpc.news.addBookmark.useMutation({
    onSuccess: () => {
      refetchBookmark();
      toast.success("已添加到稍后再看");
    },
  });

  const removeBookmark = trpc.news.removeBookmark.useMutation({
    onSuccess: () => {
      refetchBookmark();
      toast.success("已从稍后再看中移除");
    },
  });

  const markRead = trpc.news.markRead.useMutation();
  const recordView = trpc.news.recordView.useMutation();
  const lastRecordedViewId = useRef<number | null>(null);

  useEffect(() => {
    if (article && !article.isRead) {
      markRead.mutate({ id: article.id });
    }
  }, [article?.id]);

  useEffect(() => {
    if (!article?.id) return;
    if (lastRecordedViewId.current === article.id) return;
    lastRecordedViewId.current = article.id;
    recordView.mutate({ id: article.id });
  }, [article?.id]);

  const handleBookmarkToggle = () => {
    if (bookmarked) {
      removeBookmark.mutate({ articleId: id, sessionId });
    } else {
      addBookmark.mutate({ articleId: id, sessionId });
    }
  };

  const tags = useMemo(() => {
    const raw = (article?.tags as string[] | null) ?? [];
    const strat = article?.strategy ?? null;
    const reg = article?.region ?? null;
    return raw.filter(
      (t) =>
        t !== strat &&
        t !== reg &&
        !["手工上传", "Preqin", "Pitchbook", "PitchBook"].includes(t)
    );
  }, [article?.tags, article?.strategy, article?.region]);
  const sections = (article?.sections as ArticleSection[] | null) ?? [];

  const attachmentPublicUrl = (article as { attachmentPublicUrl?: string | null } | undefined)
    ?.attachmentPublicUrl;
  const extractedText = (article as { extractedText?: string | null } | undefined)?.extractedText;
  const articleContent = (article as { content?: string | null } | undefined)?.content;
  const attachmentMime = (article as { attachmentMime?: string | null } | undefined)?.attachmentMime;
  const attachmentOriginalName = (article as { attachmentOriginalName?: string | null } | undefined)
    ?.attachmentOriginalName;
  const extractedLinePageMap = (
    article as { extractedLinePageMap?: number[] | null } | undefined
  )?.extractedLinePageMap;

  useEffect(() => {
    setPdfPage(1);
  }, [id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SPLIT_PCT_KEY);
      if (raw) {
        const n = parseFloat(raw);
        if (!Number.isNaN(n)) {
          setSplitPct(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n)));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const citationSource = ((extractedText ?? articleContent) ?? "").trim();
  const citationLines = useMemo(
    () => citationSource.split(/\r?\n/).filter((l) => l.trim().length > 0),
    [citationSource]
  );

  const textPreviewChunks = useMemo(() => {
    if (citationLines.length === 0) return [] as string[];
    const chunks: string[] = [];
    for (let i = 0; i < citationLines.length; i += PREVIEW_LINES_PER_CHUNK) {
      chunks.push(citationLines.slice(i, i + PREVIEW_LINES_PER_CHUNK).join("\n"));
    }
    return chunks;
  }, [citationLines]);

  const isPdfPreview = Boolean(attachmentMime?.toLowerCase().includes("pdf"));

  useEffect(() => {
    const onLocate = (event: Event) => {
      const detail = (event as CustomEvent<{
        articleId: number;
        page: number;
        startLine: number;
        endLine: number;
        quote?: string;
      }>).detail;
      if (!detail || detail.articleId !== id) return;
      const startLine = Math.max(1, detail.startLine || 1);
      const endLine = Math.max(startLine, detail.endLine || startLine);
      const map = extractedLinePageMap;
      const lineIdx = startLine - 1;
      const pageFromMap =
        Array.isArray(map) && map[lineIdx] != null
          ? Math.max(1, Math.floor(Number(map[lineIdx]) || 1))
          : null;
      const page = pageFromMap ?? Math.max(1, detail.page || 1);
      const quote = typeof detail.quote === "string" ? detail.quote.trim() : "";
      setCitationHighlight({
        startLine,
        endLine,
        page,
        quote: quote || undefined,
      });
      (
        document.getElementById("news-original-preview") ||
        document.getElementById("news-original-preview-mobile")
      )?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (isPdfPreview) {
        setPdfPage(page);
      } else {
        const targetChunk = Math.floor((startLine - 1) / PREVIEW_LINES_PER_CHUNK);
        const el = document.getElementById(`news-preview-chunk-${targetChunk}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener("ipms-locate-reference", onLocate as EventListener);
    return () =>
      window.removeEventListener("ipms-locate-reference", onLocate as EventListener);
  }, [id, isPdfPreview, extractedLinePageMap]);

  useEffect(() => {
    if (!citationHighlight) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-citation-line="${citationHighlight.startLine}"]`
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, isPdfPreview ? 220 : 120);
    return () => window.clearTimeout(t);
  }, [citationHighlight, isPdfPreview]);

  const startSplitDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    splitDragRef.current = {
      startX: e.clientX,
      startPct: splitPct,
      lastPct: splitPct,
    };
    const onMove = (ev: MouseEvent) => {
      const d = splitDragRef.current;
      if (!d) return;
      const rect = el.getBoundingClientRect();
      const dx = ev.clientX - d.startX;
      const deltaPct = (dx / rect.width) * 100;
      const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, d.startPct + deltaPct));
      d.lastPct = next;
      setSplitPct(next);
    };
    const onUp = () => {
      const d = splitDragRef.current;
      splitDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (d) {
        try {
          localStorage.setItem(SPLIT_PCT_KEY, String(d.lastPct));
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [splitPct]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f7fa] p-6">
        <div className="max-w-3xl mx-auto">
          <Skeleton className="h-8 w-32 mb-6" />
          <div className="bg-white rounded-xl border border-gray-100 p-8">
            <Skeleton className="h-7 w-3/4 mb-4" />
            <Skeleton className="h-4 w-48 mb-6" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="min-h-screen bg-[#f5f7fa] flex items-center justify-center">
        <div className="text-center">
          <Newspaper className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">资讯不存在或已被删除</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setLocation("/news")}
          >
            返回资讯列表
          </Button>
        </div>
      </div>
    );
  }

  const isManual = article.source === "Manual";
  const legacySourceLink =
    article.originalUrl && !article.originalUrl.startsWith("manual://");
  const hasFilePreview = Boolean(attachmentPublicUrl);
  const splitReportLayout = isManual && hasFilePreview;

  const getPreviewPanelEl = () =>
    document.getElementById("news-original-preview") ||
    document.getElementById("news-original-preview-mobile");

  const scrollToOriginalPreview = () => {
    getPreviewPanelEl()?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  };

  const tabBar = (
    <div className="flex gap-2 flex-wrap shrink-0">
      <button
        type="button"
        onClick={() => setMainTab("ai")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          mainTab === "ai"
            ? "bg-[#1677ff] text-white"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        )}
      >
        AI导读
      </button>
      <button
        type="button"
        onClick={() => setMainTab("body")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          mainTab === "body"
            ? "bg-[#1677ff] text-white"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        )}
      >
        资讯正文
      </button>
    </div>
  );

  const renderArticleBody = () => {
    const contentZh = (article as { contentZh?: string | null }).contentZh?.trim() ?? "";
    const detailBodyText = contentZh || (article.content ?? "");

    return (
    <>
      {mainTab === "ai" && (
        <>
          {article.summary && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-1 h-4 bg-[#1677ff] rounded-full shrink-0" />
                  <h2 className="text-sm font-semibold text-gray-800">AI导读</h2>
                </div>
                <p className="text-xs text-gray-400 pl-3">
                  由 AI 根据资讯内容生成的导读摘要，供快速了解要点。
                </p>
              </div>
              <div className="px-5 py-5">
                <p className="text-sm text-gray-700 leading-relaxed">{article.summary}</p>
              </div>
            </div>
          )}

          {sections.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">结构化要点</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              {sections.map((section, idx) => {
                const color = SECTION_COLORS[idx % SECTION_COLORS.length];
                return (
                  <div
                    key={idx}
                    className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
                  >
                    <div
                      className={`px-5 py-3.5 border-b border-gray-50 flex items-center gap-2.5 border-l-4 ${color.border} ${color.bg} flex-wrap`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${color.dot}`} />
                      <h2 className={`text-sm font-semibold ${color.title}`}>
                        {section.heading}
                      </h2>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-sm text-gray-700 leading-relaxed">{section.body}</p>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {!article.summary && sections.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                暂无导读内容
              </div>
            )}
        </>
      )}

      {mainTab === "body" && (
        <>
          {detailBodyText ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 bg-[#1677ff] rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-800">详细内容</h2>
                </div>
                {contentZh ? (
                  <p className="text-xs text-gray-400 pl-3">
                    以下为入库时生成的中文译本，便于阅读；原文仍保存在系统中。
                  </p>
                ) : null}
                {!contentZh && (article.source === "Preqin" || article.source === "Pitchbook") && (
                  <p className="text-xs text-gray-400 pl-3">
                    暂无中文译本时显示抓取原文；可通过再次执行链接导入以生成中文正文（需 LLM 配置可用）。
                  </p>
                )}
                {isManual && (
                  <p className="text-xs text-gray-400 pl-3">
                    正文由上传文件解析与整理生成；对照请以{splitReportLayout ? "左" : "右"}
                    侧原文件为准。
                  </p>
                )}
              </div>
              <div className="px-5 py-5">
                <div className="text-sm text-gray-700 leading-relaxed space-y-3">
                  {detailBodyText.split(/\n+/).filter(Boolean).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
              暂无正文内容
            </div>
          )}
        </>
      )}
    </>
    );
  };

  const previewUrl = attachmentPublicUrl ?? "";

  const previewPanelInner = (
    <>
      <div className="px-4 py-3 border-b border-gray-50 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-gray-800">原文件预览</span>
          {attachmentOriginalName && (
            <p className="text-xs text-gray-400 truncate mt-0.5" title={attachmentOriginalName}>
              {attachmentOriginalName}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 flex-wrap">
          <button
            type="button"
            className="text-xs text-[#1677ff] hover:underline"
            onClick={scrollToOriginalPreview}
          >
            回到预览
          </button>
          <a
            href={previewUrl}
            download
            className="text-xs text-[#1677ff] hover:underline"
          >
            下载
          </a>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#1677ff] hover:underline"
          >
            新窗口
          </a>
        </div>
      </div>
      <div className="p-2 flex-1 min-h-0 bg-gray-50/50 flex flex-col overflow-hidden gap-2">
        {attachmentMime?.includes("pdf") ? (
          <>
            <div className="flex w-full flex-1 min-h-[280px] shrink-0 flex-col">
              <PdfCitationViewer
                url={previewUrl}
                page={pdfPage}
                onPageChange={setPdfPage}
                citationHighlight={citationHighlight}
                citationLines={citationLines}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-3">
            {textPreviewChunks.length > 0 ? (
              textPreviewChunks.map((chunk, ci) => (
                <div key={ci} id={`news-preview-chunk-${ci}`} className="mb-4 scroll-mt-2">
                  <div className="rounded-md border border-gray-100 overflow-hidden">
                    {chunk.split("\n").map((line, li) => {
                      const lineNo = ci * PREVIEW_LINES_PER_CHUNK + li + 1;
                      const highlighted =
                        !!citationHighlight &&
                        lineNo >= citationHighlight.startLine &&
                        lineNo <= citationHighlight.endLine;
                      return (
                        <div
                          key={`${ci}-${li}`}
                          data-citation-line={lineNo}
                          className={cn(
                            "grid grid-cols-[56px_1fr] gap-2 px-2 py-0.5 text-xs leading-relaxed transition-colors",
                            highlighted
                              ? "bg-amber-100 border-l-2 border-amber-400 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]"
                              : "bg-white border-l-2 border-transparent"
                          )}
                        >
                          <span className="text-gray-400 text-right select-none tabular-nums">
                            {lineNo}
                          </span>
                          <span className="text-gray-800 whitespace-pre-wrap font-sans">
                            {line || " "}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                {citationSource
                  ? citationSource
                  : "（无抽取文本，请下载查看）"}
              </pre>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/news")}
          className="h-8 gap-1.5 text-gray-600 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          返回资讯列表
        </Button>
        <div className="h-4 w-px bg-gray-200" />
        <span className="text-sm text-gray-400 truncate max-w-md">{article.title}</span>
        <div className="ml-auto flex items-center gap-2">
          {splitReportLayout && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-gray-600"
              onClick={() => setInsightPanelOpen((o) => !o)}
              title={insightPanelOpen ? "收起导读面板" : "展开导读面板"}
            >
              {insightPanelOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
              {insightPanelOpen ? "收起导读" : "展开导读"}
            </Button>
          )}
          <Button
            variant={bookmarked ? "default" : "outline"}
            size="sm"
            onClick={handleBookmarkToggle}
            disabled={addBookmark.isPending || removeBookmark.isPending}
            className={`h-8 gap-1.5 text-xs ${
              bookmarked
                ? "bg-[#1677ff] hover:bg-[#0958d9] text-white"
                : "text-gray-600 hover:text-[#1677ff]"
            }`}
          >
            {bookmarked ? (
              <BookmarkCheck className="h-3.5 w-3.5" />
            ) : (
              <Bookmark className="h-3.5 w-3.5" />
            )}
            {bookmarked ? "已收藏" : "稍后再看"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          "mx-auto px-6 py-6 space-y-4",
          splitReportLayout ? "max-w-[min(100%,1680px)] w-full" : "max-w-3xl"
        )}
      >
        {/* Header Card */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <ImportSourceIcon source={article.source} />
            {article.strategy && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                {article.strategy}
              </span>
            )}
            {article.region && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                {article.region}
              </span>
            )}
          </div>

          <h1 className="text-xl font-semibold text-gray-900 leading-snug mb-4">
            {article.title}
          </h1>

          <div className="flex items-center gap-4 text-sm text-gray-400 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {format(new Date(article.publishedAt), "yyyy年MM月dd日 HH:mm", { locale: zhCN })}
            </span>
            {article.author && (
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {article.author}
              </span>
            )}
            {legacySourceLink && (
              <a
                href={article.originalUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[#1677ff] hover:text-[#0958d9] transition-colors font-medium"
              >
                <Globe className="h-3.5 w-3.5" />
                跳转至原始资讯
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-4 pt-4 border-t border-gray-50">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {!splitReportLayout && tabBar}

        {splitReportLayout && attachmentPublicUrl ? (
          <>
            <div className="flex flex-col gap-4 lg:hidden">
              <aside
                id="news-original-preview-mobile"
                className="min-w-0 rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden flex flex-col max-h-[70vh]"
              >
                {previewPanelInner}
              </aside>
              {tabBar}
              <div className="min-w-0 space-y-4">{renderArticleBody()}</div>
            </div>

            <div
              ref={splitRef}
              className="hidden lg:flex w-full rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[calc(100dvh-3.75rem-3rem)] max-h-[calc(100dvh-3.75rem-3rem)]"
            >
              <aside
                id="news-original-preview"
                className="min-w-0 min-h-0 flex flex-col bg-white overflow-hidden border-r border-gray-100"
                style={{
                  flex: insightPanelOpen ? `0 0 ${splitPct}%` : "1 1 100%",
                }}
              >
                {previewPanelInner}
              </aside>

              {insightPanelOpen && (
                <>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="拖动调整左右宽度"
                    onMouseDown={startSplitDrag}
                    className="w-3 shrink-0 cursor-col-resize flex items-center justify-center border-l border-r border-gray-100 bg-gray-50/90 hover:bg-[#e8f0fe] active:bg-[#d6e8ff] transition-colors group"
                  >
                    <GripVertical className="h-6 w-6 text-gray-400 group-hover:text-[#1677ff]" />
                  </div>
                  <div className="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden bg-[#f5f7fa]">
                    <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 bg-white flex flex-wrap items-center gap-3">
                      {tabBar}
                      <span className="text-[11px] text-gray-400 ml-auto hidden xl:inline">
                        拖拽中间竖条可调整预览与导读宽度
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                      {renderArticleBody()}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">{renderArticleBody()}</div>
        )}

      </div>
    </div>
  );
}
