import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Globe,
  Newspaper,
  RefreshCw,
  Search,
  Tag,
  Upload,
  X,
  Flame,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useMemo } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type NewsListItem = inferRouterOutputs<AppRouter>["news"]["list"]["items"][number];

const STRATEGIES = [
  "私募股权", "风险投资", "房地产", "信贷", "基础设施",
  "对冲基金", "母基金", "并购", "成长股权", "其他",
];
const REGIONS = ["全球", "亚太", "北美", "欧洲", "中国", "东南亚", "中东", "其他"];

/** 列表标题前：手工上传 / 自动导入（站点抓取），不占用标签位 */
function ImportSourceIcon({ source }: { source: string }) {
  const manual = source === "Manual";
  return (
    <span
      title={manual ? "手工上传" : "自动导入"}
      className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600"
    >
      {manual ? (
        <Upload className="h-3.5 w-3.5 text-slate-600" />
      ) : (
        <Globe className="h-3.5 w-3.5 text-[#1677ff]" />
      )}
    </span>
  );
}

function shouldShowAsTag(tag: string, strategy: string | null, region: string | null) {
  if (tag === strategy || tag === region) return false;
  if (["手工上传", "Preqin", "Pitchbook", "PitchBook"].includes(tag)) return false;
  return true;
}

function StrategyBadge({ strategy }: { strategy: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
      {strategy}
    </span>
  );
}

function RegionBadge({ region }: { region: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
      {region}
    </span>
  );
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
      {tag}
    </span>
  );
}

function getSessionId(): string {
  let sid = localStorage.getItem("ipms_session_id");
  if (!sid) {
    sid = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("ipms_session_id", sid);
  }
  return sid;
}

export default function News() {
  const [, setLocation] = useLocation();
  const [source, setSource] = useState<"Preqin" | "Pitchbook" | "Manual" | "">("")
  const [strategy, setStrategy] = useState("");
  const [region, setRegion] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateRange, setDateRange] = useState("");
  const [page, setPage] = useState(1);
  const [listCategory, setListCategory] = useState<"report" | "news">("news");
  const [showBookmarks, setShowBookmarks] = useState(false);
  /** 与 AI 助手快捷筛选联动：今日 / 本周热度 Top3 */
  const [smartPreset, setSmartPreset] = useState<null | "today" | "weekTop3">(null);
  /** AI 自然语言解析后的列表覆盖（与常规分页列表二选一展示） */
  const [smartList, setSmartList] = useState<{
    items: NewsListItem[];
    semanticOnly: boolean;
  } | null>(null);
  /** 点「AI」但搜索框为空时，在搜索行下方提示（避免 Sonner 飘在右下角像 AI 助手提示） */
  const [aiSearchHint, setAiSearchHint] = useState<string | null>(null);
  const sessionId = useMemo(() => getSessionId(), []);
  const PAGE_SIZE = 15;

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("preset");
    if (p === "today") setSmartPreset("today");
    else if (p === "weekTop3") setSmartPreset("weekTop3");
  }, []);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ preset: "today" | "weekTop3" }>).detail;
      if (d?.preset === "today" || d?.preset === "weekTop3") {
        setSmartPreset(d.preset);
        setPage(1);
      }
    };
    window.addEventListener("ipms-research-preset", h);
    return () => window.removeEventListener("ipms-research-preset", h);
  }, []);

  const listQueryInput = useMemo(() => {
    const base = {
      source: source || undefined,
      strategy: strategy || undefined,
      region: region || undefined,
      keyword: keyword || undefined,
      recordCategory: listCategory,
      page,
      pageSize: PAGE_SIZE as number,
      sortBy: undefined as "published_desc" | "hot_desc" | undefined,
      dateFrom: undefined as string | undefined,
      dateTo: undefined as string | undefined,
    };

    if (smartPreset === "today") {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return {
        ...base,
        dateFrom: start.toISOString(),
        dateTo: end.toISOString(),
        sortBy: "published_desc" as const,
        page: 1,
        pageSize: PAGE_SIZE,
      };
    }

    if (smartPreset === "weekTop3") {
      return {
        ...base,
        dateFrom: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        sortBy: "hot_desc" as const,
        page: 1,
        pageSize: 3,
      };
    }

    return {
      ...base,
      dateFrom:
        dateRange === "week"
          ? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
          : dateRange === "month"
            ? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
            : dateRange === "quarter"
              ? new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
              : undefined,
    };
  }, [
    source,
    strategy,
    region,
    keyword,
    listCategory,
    page,
    dateRange,
    smartPreset,
  ]);

  const { data, isLoading, isError, error, refetch } = trpc.news.list.useQuery(listQueryInput);

  const smartSearchMutation = trpc.news.smartSearch.useMutation({
    onSuccess: (out) => {
      const i = out.intent as Record<string, unknown>;
      if (!out.semanticOnly && i) {
        if (i.source === "Preqin" || i.source === "Pitchbook" || i.source === "Manual") {
          setSource(i.source);
        }
        if (typeof i.strategy === "string" && i.strategy) setStrategy(i.strategy);
        if (typeof i.region === "string" && i.region) setRegion(i.region);
        if (i.recordCategory === "report" || i.recordCategory === "news") {
          setListCategory(i.recordCategory);
        }
      }
      setSmartList({
        items: out.items as NewsListItem[],
        semanticOnly: out.semanticOnly,
      });
      setSmartPreset(null);
      setAiSearchHint(null);
      toast.success(out.semanticOnly ? "已用语义检索" : "已应用 AI 解析筛选");
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: recData } = trpc.news.recommend.useQuery({ sessionId });

  const handleAiSearch = useCallback(() => {
    const q = searchInput.trim();
    if (!q) {
      setAiSearchHint(
        "请先在左侧输入框里用一句话描述想找的内容，再点「AI」。示例：最近一周亚太私募股权资讯、只看 Pitchbook 房地产报告"
      );
      return;
    }
    setAiSearchHint(null);
    smartSearchMutation.mutate({ query: q });
  }, [searchInput, smartSearchMutation]);

  const displayItems = smartList?.items ?? data?.items ?? [];
  const showMainLoading = !smartList && isLoading;
  const showMainError = !smartList && isError;

  const handleSearch = useCallback(() => {
    setSmartList(null);
    setKeyword(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleClearKeyword = useCallback(() => {
    setKeyword("");
    setSearchInput("");
  }, []);

  const handleReset = useCallback(() => {
    setSource("");
    setStrategy("");
    setRegion("");
    setKeyword("");
    setSearchInput("");
    setPage(1);
    setSmartPreset(null);
    setSmartList(null);
    setAiSearchHint(null);
    setLocation("/news");
  }, [setLocation]);

  const switchListCategory = useCallback((cat: "report" | "news") => {
    setListCategory(cat);
    setPage(1);
    setSmartList(null);
  }, []);

  const hasFilters =
    source || strategy || region || keyword || dateRange || smartPreset || smartList;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  // Bookmarks
  const { data: bookmarksData, refetch: refetchBookmarks } = trpc.news.bookmarks.useQuery(
    { sessionId },
    { enabled: showBookmarks }
  );
  const addBookmarkMutation = trpc.news.addBookmark.useMutation({
    onSuccess: () => { toast.success("已添加到稍后再看"); refetchBookmarks(); },
  });
  const removeBookmarkMutation = trpc.news.removeBookmark.useMutation({
    onSuccess: () => { toast.success("已从稍后再看中移除"); refetchBookmarks(); },
  });

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f7fa]">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Page Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Newspaper className="h-5 w-5 text-[#1677ff]" />
            <h1 className="text-lg font-semibold text-gray-800">资讯</h1>
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 ml-1">
              <button
                type="button"
                onClick={() => switchListCategory("report")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  listCategory === "report"
                    ? "bg-white text-[#1677ff] shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                报告
              </button>
              <button
                type="button"
                onClick={() => switchListCategory("news")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  listCategory === "news"
                    ? "bg-white text-[#1677ff] shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                资讯
              </button>
            </div>
            <button
              onClick={() => setShowBookmarks(!showBookmarks)}
              className={`ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showBookmarks
                  ? "bg-[#1677ff] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {showBookmarks ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
              稍后再看
              {bookmarksData && bookmarksData.length > 0 && (
                <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${
                  showBookmarks ? "bg-white/20 text-white" : "bg-[#1677ff] text-white"
                }`}>{bookmarksData.length}</span>
              )}
            </button>
            {(data || smartList) && (
              <span className="text-sm text-gray-400">
                {smartList
                  ? `AI 结果 · ${smartList.items.length} 条${smartList.semanticOnly ? "（语义）" : ""}`
                  : smartPreset === "weekTop3"
                    ? `近 7 日热度 · 展示前 3 条（候选共 ${data?.total ?? 0} 条）`
                    : `共 ${data?.total ?? 0} 条`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="h-8 gap-1.5 text-gray-600"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Filter className="h-3.5 w-3.5" />
            筛选：
          </div>

          {/* Search：与右侧「AI 资讯助手」无关；AI 按钮只解析本行输入并刷新下方列表 */}
          <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-lg">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="关键词搜索；或输入一句话后点「AI」智能筛选/语义检索"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    setAiSearchHint(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-8 h-8 text-sm border-gray-200"
                />
              </div>
              <Button
                size="sm"
                onClick={handleSearch}
                className="h-8 px-3 bg-[#1677ff] hover:bg-[#0958d9] text-white text-xs shrink-0"
              >
                搜索
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleAiSearch()}
                disabled={smartSearchMutation.isPending}
                className="h-8 px-2 gap-1 text-xs shrink-0"
                title="根据本框文字解析筛选条件，或做语义检索（仅影响当前资讯列表）"
              >
                <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                AI
              </Button>
            </div>
            {aiSearchHint && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 leading-relaxed">
                {aiSearchHint}
              </p>
            )}
          </div>

          {/* Source Filter */}
          <Select
            value={source || "all"}
            onValueChange={(v) => {
              setSmartList(null);
              setSource(v === "all" ? "" : (v as "Preqin" | "Pitchbook" | "Manual"));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-40 text-sm border-gray-200">
              <SelectValue placeholder="来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              <SelectItem value="Preqin">Preqin</SelectItem>
              <SelectItem value="Pitchbook">Pitchbook</SelectItem>
              <SelectItem value="Manual">手工上传</SelectItem>
            </SelectContent>
          </Select>

          {/* Strategy Filter */}
          <Select
            value={strategy || "all"}
            onValueChange={(v) => {
              setSmartList(null);
              setStrategy(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-36 text-sm border-gray-200">
              <SelectValue placeholder="策略" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部策略</SelectItem>
              {STRATEGIES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Region Filter */}
          <Select
            value={region || "all"}
            onValueChange={(v) => {
              setSmartList(null);
              setRegion(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-32 text-sm border-gray-200">
              <SelectValue placeholder="地区" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部地区</SelectItem>
              {REGIONS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Range Filter */}
          <Select
            value={dateRange || "all"}
            onValueChange={(v) => {
              setSmartList(null);
              setDateRange(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-32 text-sm border-gray-200">
              <SelectValue placeholder="时间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部时间</SelectItem>
              <SelectItem value="week">近一周</SelectItem>
              <SelectItem value="month">近一月</SelectItem>
              <SelectItem value="quarter">近三月</SelectItem>
            </SelectContent>
          </Select>

          {/* Reset */}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
          onClick={handleReset}
          className="h-8 gap-1 text-gray-500 hover:text-gray-700 text-xs"
            >
              <X className="h-3.5 w-3.5" />
              清除筛选
            </Button>
          )}
        </div>

        {/* Active Filter Tags */}
        {hasFilters && (
          <div className="bg-[#f5f7fa] px-6 py-2 flex items-center gap-2 flex-wrap border-b border-gray-100 shrink-0">
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Tag className="h-3 w-3" /> 当前筛选：
            </span>
            {source && (
              <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setSource("")}>
                来源: {source} <X className="h-2.5 w-2.5" />
              </Badge>
            )}
            {strategy && (
              <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setStrategy("")}>
                策略: {strategy} <X className="h-2.5 w-2.5" />
              </Badge>
            )}
            {region && (
              <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setRegion("")}>
                地区: {region} <X className="h-2.5 w-2.5" />
              </Badge>
            )}
             {dateRange && (
              <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setDateRange("")}>  
                时间: {dateRange === "week" ? "近一周" : dateRange === "month" ? "近一月" : "近三月"} <X className="h-2.5 w-2.5" />
              </Badge>
            )}
            {keyword && (
              <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={handleClearKeyword}>
                关键词: {keyword} <X className="h-2.5 w-2.5" />
              </Badge>
            )}
            {smartList && (
              <Badge
                variant="secondary"
                className="text-xs gap-1 cursor-pointer bg-violet-50 text-violet-800 border-violet-200"
                onClick={() => setSmartList(null)}
              >
                AI 结果 · 点击恢复标准列表 <X className="h-2.5 w-2.5" />
              </Badge>
            )}
          </div>
        )}

        {/* Bookmarks View */}
        {showBookmarks && (
          <div className="flex-1 overflow-y-auto">
            {!bookmarksData ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-lg p-4 border border-gray-100">
                    <Skeleton className="h-5 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-full mb-1" />
                  </div>
                ))}
              </div>
            ) : bookmarksData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <Bookmark className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">暂无稍后再看的条目</p>
                <p className="text-xs mt-1 text-gray-300">在列表中点击书签图标即可添加</p>
              </div>
            ) : (
              <div className="p-4 space-y-2">
                {bookmarksData.map((item) => item.article && (
                  <div
                    key={item.id}
                    onClick={() => setLocation(`/news/${item.article!.id}`)}
                    className="bg-white rounded-lg border border-gray-100 p-4 cursor-pointer hover:border-[#1677ff]/30 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 mb-2">
                          <ImportSourceIcon source={item.article.source} />
                          <h3 className="text-sm font-medium text-gray-800 group-hover:text-[#1677ff] transition-colors leading-snug line-clamp-2">
                            {item.article.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.article.strategy && <StrategyBadge strategy={item.article.strategy} />}
                          {item.article.region && <RegionBadge region={item.article.region} />}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(item.article.publishedAt), "MM月dd日", { locale: zhCN })}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBookmarkMutation.mutate({ articleId: item.article!.id, sessionId });
                          }}
                          className="p-1 rounded hover:bg-red-50 text-[#1677ff] hover:text-red-500 transition-colors"
                          title="移除稍后再看"
                        >
                          <BookmarkCheck className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* News List */}
        {!showBookmarks && (<div className="flex-1 overflow-y-auto">
          {recData && recData.items.length > 0 && !smartList && (
            <div className="px-4 pt-3 pb-1 border-b border-gray-100 bg-gradient-to-r from-violet-50/50 to-transparent">
              <p className="text-xs font-medium text-violet-800 mb-2 flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                {recData.mode === "personalized" ? "为你推荐" : "热门阅读"}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {recData.items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setLocation(`/news/${a.id}`)}
                    className="shrink-0 max-w-[220px] text-left text-xs px-3 py-2 rounded-lg bg-white border border-violet-100 hover:border-violet-300 hover:shadow-sm transition-all line-clamp-2"
                  >
                    {a.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {showMainLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg p-4 border border-gray-100">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : showMainError ? (
            <div className="flex flex-col items-center justify-center min-h-64 px-6 py-12 text-center">
              <Newspaper className="h-12 w-12 mb-3 text-red-200" />
              <p className="text-sm font-medium text-red-700">列表加载失败</p>
              <p className="text-xs text-red-600/90 mt-2 max-w-lg break-words">
                {error?.message ?? "未知错误"}
              </p>
              {/failed to fetch|load failed|networkerror/i.test(
                String(error?.message ?? "")
              ) ? (
                <p className="text-xs text-amber-800 mt-3 max-w-md leading-relaxed rounded border border-amber-100 bg-amber-50/80 px-2 py-1.5">
                  这通常表示<strong>浏览器没连上本机后端</strong>（不是数据库缺列）。请确认终端里已运行{" "}
                  <code className="rounded bg-white px-1">pnpm dev</code>，并用{" "}
                  <code className="rounded bg-white px-1">http://localhost:3000</code>{" "}
                  打开本站后再试；若端口不是 3000，请与终端里「Server running on …」一致。
                </p>
              ) : null}
              <p className="text-xs text-gray-500 mt-4 max-w-md leading-relaxed">
                若错误中含 Unknown column，说明数据库结构与代码不一致。请在项目根目录执行{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5">pnpm run db:ensure-schema</code>{" "}
                补齐列后重启 dev，再刷新本页。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => refetch()}
              >
                重试
              </Button>
            </div>
          ) : displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400 px-6 text-center">
              <Newspaper className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">暂无符合条件的资讯条目</p>
              {listCategory === "report" ? (
                <p className="text-xs text-gray-400 mt-2 max-w-sm leading-relaxed">
                  「报告」仅展示手工上传的文档；Preqin / Pitchbook 等站点抓取的内容在「资讯」标签下。
                </p>
              ) : null}
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {displayItems.map((article) => (
                <div
                  key={article.id}
                  onClick={() => setLocation(`/news/${article.id}`)}
                  className={`bg-white rounded-lg border border-gray-100 p-4 cursor-pointer hover:border-[#1677ff]/30 hover:shadow-sm transition-all group ${
                    !article.isRead ? "border-l-2 border-l-[#1677ff]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-start gap-2 mb-2">
                        {!article.isRead && (
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#1677ff] shrink-0" />
                        )}
                        <ImportSourceIcon source={article.source} />
                        <h3 className="text-sm font-medium text-gray-800 group-hover:text-[#1677ff] transition-colors leading-snug line-clamp-2">
                          {article.title}
                        </h3>
                      </div>

                      {/* Summary */}
                      {article.summary && (
                        <p className="text-xs text-gray-500 line-clamp-2 mb-2.5 leading-relaxed">
                          {article.summary}
                        </p>
                      )}

                      {/* Tags row */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {article.strategy && <StrategyBadge strategy={article.strategy} />}
                        {article.region && <RegionBadge region={article.region} />}
                        {(article.tags as string[] | null)
                          ?.filter((tag) =>
                            shouldShowAsTag(tag, article.strategy ?? null, article.region ?? null)
                          )
                          .slice(0, 5)
                          .map((tag) => (
                            <TagBadge key={tag} tag={tag} />
                          ))}
                      </div>
                    </div>

                    {/* Right side: date + bookmark + arrow */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div
                        className="inline-flex items-center gap-0.5 text-xs text-amber-700/90 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded"
                        title="热度（详情页浏览累计）"
                      >
                        <Flame className="h-3 w-3 text-amber-500" />
                        {(article as { viewCount?: number }).viewCount ?? 0}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(article.publishedAt), "MM月dd日", { locale: zhCN })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            addBookmarkMutation.mutate({ articleId: article.id, sessionId });
                          }}
                          className="p-1 rounded hover:bg-blue-50 text-gray-300 hover:text-[#1677ff] transition-colors"
                          title="稍后再看"
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                        </button>
                        <ExternalLink className="h-3.5 w-3.5 text-gray-300 group-hover:text-[#1677ff] transition-colors" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {smartPreset !== "weekTop3" && !smartList && totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 py-4 border-t border-gray-100 bg-white">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一页
              </Button>
              <span className="text-sm text-gray-500">
                第 {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-8 gap-1"
              >
                下一页
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        )}
      </div>

    </div>
  );
}
