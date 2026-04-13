import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/useMobile";
import { MessageCircle } from "lucide-react";
import NewsBot from "@/components/NewsBot";
import News from "./News";
import NewsDetail from "./NewsDetail";

const SPLIT_KEY = "ipms_news_hub_split";
const DEFAULT_SPLIT = 38;
const MIN_SPLIT = 25;
const MAX_SPLIT = 55;

export default function NewsHub() {
  const [location, setLocation] = useLocation();
  const detailMatch = location.match(/^\/news\/(\d+)$/);
  const articleId = detailMatch ? Number(detailMatch[1]) : undefined;
  const isMobile = useIsMobile();

  const [splitPct, setSplitPct] = useState(() => {
    const saved = localStorage.getItem(SPLIT_KEY);
    return saved ? Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, Number(saved))) : DEFAULT_SPLIT;
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [mobileBotOpen, setMobileBotOpen] = useState(false);
  const [mobileBotFullscreen, setMobileBotFullscreen] = useState(false);
  const [mobileBotSize, setMobileBotSize] = useState({ width: 380, height: 560 });

  const [pickMode, setPickMode] = useState(false);
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const onPickConfirmRef = useRef<((ids: number[]) => void) | null>(null);

  const handleRequestPick = useCallback(
    (currentIds: number[], onConfirm: (ids: number[]) => void) => {
      if (articleId != null) {
        setLocation("/news");
      }
      setPickedIds(currentIds);
      onPickConfirmRef.current = onConfirm;
      setPickMode(true);
    },
    [articleId, setLocation]
  );

  const handlePickDone = useCallback(() => {
    if (onPickConfirmRef.current) {
      onPickConfirmRef.current(pickedIds);
      onPickConfirmRef.current = null;
    }
    setPickMode(false);
  }, [pickedIds]);

  const handlePickCancel = useCallback(() => {
    onPickConfirmRef.current = null;
    setPickMode(false);
    setPickedIds([]);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, pct));
      setSplitPct(clamped);
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(SPLIT_KEY, String(splitPct));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, splitPct]);

  const beginDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const toggleMobileFullscreen = useCallback(() => {
    setMobileBotFullscreen((p) => !p);
  }, []);

  if (isMobile) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {articleId != null ? <NewsDetail /> : <News />}
        </div>
        {mobileBotOpen && (
          <div
            className={
              mobileBotFullscreen
                ? "fixed inset-3 z-[100] rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col"
                : "fixed bottom-24 right-6 z-50 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col"
            }
            style={
              mobileBotFullscreen
                ? undefined
                : {
                    width: `${mobileBotSize.width}px`,
                    height: `${mobileBotSize.height}px`,
                    maxWidth: "calc(100vw - 1.5rem)",
                    maxHeight: "calc(100vh - 8rem)",
                  }
            }
          >
            <NewsBot
              openedArticleId={articleId}
              chatFullscreen={mobileBotFullscreen}
              onToggleChatFullscreen={toggleMobileFullscreen}
              onMinimizeChat={() => setMobileBotOpen(false)}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => setMobileBotOpen((v) => !v)}
          className="fixed bottom-6 right-6 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#1677ff] text-white shadow-xl hover:bg-[#0958d9] transition-colors"
          title="唤起 AI 助手"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/* Center: AI Assistant */}
      <div
        className="flex flex-col overflow-hidden bg-white border-r border-gray-200"
        style={{ width: `${splitPct}%`, minWidth: 320 }}
      >
        <NewsBot openedArticleId={articleId} onRequestPickArticle={handleRequestPick} />
      </div>

      {/* Drag handle */}
      <div
        className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 hover:bg-[#1677ff]/20 active:bg-[#1677ff]/30 transition-colors"
        onMouseDown={beginDrag}
        title="拖拽调整面板宽度"
      />

      {/* Right: News Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {articleId != null && !pickMode ? (
          <NewsDetail />
        ) : (
          <News
            pickMode={pickMode}
            pickedIds={pickedIds}
            onTogglePick={(id) =>
              setPickedIds((prev) =>
                prev.includes(id)
                  ? prev.filter((x) => x !== id)
                  : prev.length < 5
                    ? [...prev, id]
                    : prev
              )
            }
            onPickDone={handlePickDone}
            onPickCancel={handlePickCancel}
          />
        )}
      </div>
    </div>
  );
}
