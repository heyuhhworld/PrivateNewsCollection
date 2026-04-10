import { useState, useCallback } from "react";
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
  Bot,
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
} from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import NewsBot from "@/components/NewsBot";
import { useMemo } from "react";

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
  const [showBot, setShowBot] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const sessionId = useMemo(() => getSessionId(), []);
  const PAGE_SIZE = 15;

  const { data, isLoading, refetch } = trpc.news.list.useQuery({
    source: source || undefined,
    strategy: strategy || undefined,
    region: region || undefined,
    keyword: keyword || undefined,
    recordCategory: listCategory,
    dateFrom: dateRange === "week" ? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString() :
              dateRange === "month" ? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() :
              dateRange === "quarter" ? new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString() : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const handleSearch = useCallback(() => {
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
  }, []);

  const switchListCategory = useCallback((cat: "report" | "news") => {
    setListCategory(cat);
    setPage(1);
  }, []);

  const hasFilters = source || strategy || region || keyword || dateRange;
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
            {data && (
              <span className="text-sm text-gray-400">
                共 {data.total} 条
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
            <Button
              size="sm"
              onClick={() => setShowBot(!showBot)}
              className={`h-8 gap-1.5 ${showBot ? "bg-[#1677ff] text-white" : "bg-[#e8f0fe] text-[#1677ff] hover:bg-[#d0e4ff]"}`}
              variant="ghost"
            >
              <Bot className="h-3.5 w-3.5" />
              AI 助手
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Filter className="h-3.5 w-3.5" />
            筛选：
          </div>

          {/* Search */}
          <div className="flex items-center gap-1.5 flex-1 min-w-[200px] max-w-xs">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                placeholder="搜索标题或摘要..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-8 h-8 text-sm border-gray-200"
              />
            </div>
            <Button
              size="sm"
              onClick={handleSearch}
              className="h-8 px-3 bg-[#1677ff] hover:bg-[#0958d9] text-white text-xs"
            >
              搜索
            </Button>
          </div>

          {/* Source Filter */}
          <Select
            value={source || "all"}
            onValueChange={(v) => {
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
                <p className="text-sm">暂无稍后再看的资讯</p>
                <p className="text-xs mt-1 text-gray-300">在资讯列表中点击书签图标即可添加</p>
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
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg p-4 border border-gray-100">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : data?.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Newspaper className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">暂无符合条件的资讯</p>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {data?.items.map((article) => (
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
          {totalPages > 1 && (
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

      {/* AI Bot Panel */}
      {showBot && (
        <div className="w-[380px] border-l border-gray-200 bg-white flex flex-col shrink-0">
          <NewsBot onClose={() => setShowBot(false)} />
        </div>
      )}
    </div>
  );
}
