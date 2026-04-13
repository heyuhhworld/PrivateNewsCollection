import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};
import { ChevronLeft, ChevronRight, Crop, Highlighter, ImageIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/** 由 vite 插件从 node_modules 拷到 client/public，避免 dev 下动态 URL 指向 @fs 失败 */
GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export type PdfCitationHighlight = {
  startLine: number;
  endLine: number;
  page: number;
  quote?: string;
};

export type PersistedPdfHighlight = {
  id: number;
  page: number;
  rectsNorm: { x: number; y: number; w: number; h: number }[];
  color: string | null;
};

type Props = {
  url: string;
  page: number;
  onPageChange: (p: number) => void;
  citationHighlight: PdfCitationHighlight | null;
  citationLines: string[];
  articleId?: number;
  sessionId?: string;
  persistedHighlights?: PersistedPdfHighlight[];
};

function normalizeForMatch(s: string): string {
  return s
    .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201A\u2039\u203A`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchPatterns(needleRaw: string): RegExp[] {
  const norm = normalizeForMatch(needleRaw);
  if (!norm) return [];

  const alphaParts = norm
    .split(/[^a-zA-Z0-9\u00C0-\u024F]+/)
    .filter((w) => w.length >= 2);
  if (alphaParts.length === 0) return [];

  const results: RegExp[] = [];

  const escaped = alphaParts.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  const full = escaped.slice(0, 50).join("[^a-zA-Z0-9]*\\s*[^a-zA-Z0-9]*");
  try { results.push(new RegExp(full, "i")); } catch { /* skip */ }

  if (escaped.length > 8) {
    const front = escaped.slice(0, 8).join("[^a-zA-Z0-9]*\\s*[^a-zA-Z0-9]*");
    try { results.push(new RegExp(front, "i")); } catch { /* skip */ }
  }

  if (escaped.length > 5) {
    const short = escaped.slice(0, 5).join("[^a-zA-Z0-9]*\\s*[^a-zA-Z0-9]*");
    try { results.push(new RegExp(short, "i")); } catch { /* skip */ }
  }

  return results;
}

function viewportRectForItem(item: PdfTextItem, viewport: PageViewport) {
  const m = item.transform;
  const pdfX = m[4];
  const pdfY = m[5];
  const fh = Math.hypot(m[2], m[3]);
  const rect = viewport.convertToViewportRectangle([
    pdfX,
    pdfY - fh,
    pdfX + item.width,
    pdfY,
  ]);
  const [x1, y1, x2, y2] = rect as number[];
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

async function findHighlightRects(
  page: PDFPageProxy,
  viewport: PageViewport,
  needleRaw: string
): Promise<{ left: number; top: number; width: number; height: number }[]> {
  const textContent = await page.getTextContent();
  const textItems: PdfTextItem[] = [];
  for (const item of textContent.items) {
    if ("str" in item && item.str && item.str.length > 0) {
      textItems.push(item as PdfTextItem);
    }
  }
  if (textItems.length === 0) return [];

  const acc = textItems.map((t) => t.str).join(" ");
  const patterns = buildSearchPatterns(needleRaw);

  for (const re of patterns) {
    const m = acc.match(re);
    if (m && m.index !== undefined) {
      return rectsForRange(textItems, viewport, m.index, m.index + m[0].length);
    }
  }

  const normAcc = normalizeForMatch(acc);
  for (const re of patterns) {
    const m = normAcc.match(re);
    if (m && m.index !== undefined) {
      return rectsForRange(textItems, viewport, m.index, m.index + m[0].length);
    }
  }

  return [];
}

type Rect = { left: number; top: number; width: number; height: number };

function mergeIntoLineRects(rects: Rect[], pageWidth: number): Rect[] {
  if (rects.length === 0) return [];

  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);

  const lines: Rect[][] = [];
  let curLine: Rect[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const prev = curLine[0];
    const yTol = Math.max(prev.height * 0.45, 4);
    if (Math.abs(r.top - prev.top) < yTol) {
      curLine.push(r);
    } else {
      lines.push(curLine);
      curLine = [r];
    }
  }
  lines.push(curLine);

  const hPad = 4;
  return lines.map((lineRects) => {
    const minLeft = Math.max(0, Math.min(...lineRects.map((r) => r.left)) - hPad);
    const maxRight = Math.min(
      pageWidth,
      Math.max(...lineRects.map((r) => r.left + r.width)) + hPad
    );
    const minTop = Math.min(...lineRects.map((r) => r.top));
    const maxBot = Math.max(...lineRects.map((r) => r.top + r.height));
    const vPad = 2;
    return {
      left: minLeft,
      top: minTop - vPad,
      width: maxRight - minLeft,
      height: maxBot - minTop + vPad * 2,
    };
  });
}

function rectsForRange(
  textItems: PdfTextItem[],
  viewport: PageViewport,
  start: number,
  end: number
): Rect[] {
  let offset = 0;
  const itemTouch: boolean[] = new Array(textItems.length).fill(false);
  for (let i = 0; i < textItems.length; i++) {
    const s = textItems[i].str;
    const from = offset;
    const to = offset + s.length;
    if (to > start && from < end) {
      itemTouch[i] = true;
    }
    offset = to;
    if (i < textItems.length - 1) offset += 1;
  }
  const raw: Rect[] = [];
  for (let i = 0; i < textItems.length; i++) {
    if (itemTouch[i]) {
      raw.push(viewportRectForItem(textItems[i], viewport));
    }
  }
  return mergeIntoLineRects(raw, viewport.width);
}

function normRectsToPixels(
  rects: { x: number; y: number; w: number; h: number }[],
  vw: number,
  vh: number
): Rect[] {
  return rects.map((r) => ({
    left: r.x * vw,
    top: r.y * vh,
    width: r.w * vw,
    height: r.h * vh,
  }));
}

function selectionToNormRects(
  pageBox: HTMLElement,
  vw: number,
  vh: number
): { x: number; y: number; w: number; h: number }[] | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!pageBox.contains(range.commonAncestorContainer)) return null;
  const br = pageBox.getBoundingClientRect();
  const rects = Array.from(range.getClientRects());
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const r of rects) {
    if (r.width < 2 && r.height < 2) continue;
    const left = r.left - br.left;
    const top = r.top - br.top;
    if (left < -2 || top < -2 || left > vw + 2 || top > vh + 2) continue;
    out.push({
      x: Math.max(0, Math.min(1, left / vw)),
      y: Math.max(0, Math.min(1, top / vh)),
      w: Math.max(0, Math.min(1, r.width / vw)),
      h: Math.max(0, Math.min(1, r.height / vh)),
    });
  }
  return out.length ? out : null;
}

export function PdfCitationViewer({
  url,
  page,
  onPageChange,
  citationHighlight,
  citationLines,
  articleId,
  sessionId,
  persistedHighlights = [],
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const textLayerHostRef = useRef<HTMLDivElement>(null);
  const textLayerBuilderRef = useRef<TextLayerBuilder | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [highlightRects, setHighlightRects] = useState<Rect[]>([]);
  const [renderTick, setRenderTick] = useState(0);
  const [canvasCssSize, setCanvasCssSize] = useState({ w: 0, h: 0 });
  const [pageHasSelectableText, setPageHasSelectableText] = useState<boolean | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropStartRef = useRef<{ sx: number; sy: number } | null>(null);

  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const renderGenRef = useRef(0);

  const utils = trpc.useUtils();
  const saveHighlightMut = trpc.reading.pdfHighlightCreate.useMutation({
    onSuccess: () => {
      toast.success("已保存团队高亮");
      if (articleId) void utils.reading.pdfHighlightsList.invalidate({ articleId });
      window.getSelection()?.removeAllRanges();
    },
    onError: (e) => toast.error(e.message),
  });

  const safePage = Math.min(Math.max(1, page), Math.max(1, numPages || 1));

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setPdfDoc(null);
    setNumPages(0);
    setLoadErr(null);
    (async () => {
      try {
        const loading = getDocument({ url, withCredentials: true });
        const d = await loading.promise;
        if (cancelled) {
          await d.destroy().catch(() => {});
          return;
        }
        doc = d;
        setPdfDoc(d);
        setNumPages(d.numPages);
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (doc) void doc.destroy().catch(() => {});
    };
  }, [url]);

  const renderPage = useCallback(
    async (doc: PDFDocumentProxy, pageNum: number) => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const gen = ++renderGenRef.current;

      const p = await doc.getPage(pageNum);
      if (gen !== renderGenRef.current) return;

      const base = p.getViewport({ scale: 1, rotation: 0 });
      const cw = wrap.clientWidth || 800;
      const scale = Math.min(Math.max(cw / base.width, 0.5), 3);
      const viewport = p.getViewport({ scale, rotation: 0 });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setCanvasCssSize({ w: viewport.width, h: viewport.height });

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const task = p.render({ canvasContext: ctx, viewport, canvas });
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch {
        return;
      }
      renderTaskRef.current = null;

      if (gen !== renderGenRef.current) return;

      const host = textLayerHostRef.current;
      if (host) {
        textLayerBuilderRef.current?.cancel();
        textLayerBuilderRef.current = null;
        host.replaceChildren();
        const tlb = new TextLayerBuilder({ pdfPage: p });
        textLayerBuilderRef.current = tlb;
        await tlb.render({ viewport });
        if (gen !== renderGenRef.current) {
          tlb.cancel();
          return;
        }
        host.appendChild(tlb.div);
        const div = tlb.div;
        div.style.position = "absolute";
        div.style.left = "0";
        div.style.top = "0";
        div.style.width = `${viewport.width}px`;
        div.style.height = `${viewport.height}px`;
      }

      if (gen !== renderGenRef.current) return;
      return { p, viewport };
    },
    []
  );

  useEffect(() => {
    if (!pdfDoc || numPages < 1) return;
    let alive = true;
    setPageHasSelectableText(null);
    (async () => {
      const meta = await renderPage(pdfDoc, safePage);
      if (!alive || !meta) return;
      const { p, viewport } = meta;

      try {
        const textContent = await p.getTextContent();
        const hasText = textContent.items.some((it) => {
          if (!it || typeof it !== "object" || !("str" in it)) return false;
          const s = String((it as { str?: string }).str ?? "").trim();
          return s.length > 0;
        });
        if (alive) setPageHasSelectableText(hasText);
      } catch {
        if (alive) setPageHasSelectableText(false);
      }

      if (!citationHighlight) {
        setHighlightRects([]);
        return;
      }

      const citePage = Math.min(
        Math.max(1, citationHighlight.page),
        numPages
      );
      if (citePage !== safePage) {
        setHighlightRects([]);
        return;
      }

      const quoteFromLlm = citationHighlight.quote?.trim() || "";
      const quoteFromLines = citationLines
        .slice(
          citationHighlight.startLine - 1,
          citationHighlight.endLine
        )
        .join(" ");

      let citeRects: Rect[] = [];
      if (quoteFromLlm) {
        citeRects = await findHighlightRects(p, viewport, quoteFromLlm);
      }
      if (citeRects.length === 0 && quoteFromLines) {
        citeRects = await findHighlightRects(p, viewport, quoteFromLines);
      }
      if (alive) setHighlightRects(citeRects);
    })();
    return () => {
      alive = false;
      textLayerBuilderRef.current?.cancel();
      textLayerBuilderRef.current = null;
    };
  }, [
    pdfDoc,
    numPages,
    safePage,
    citationHighlight,
    citationLines,
    renderPage,
    renderTick,
  ]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setRenderTick((t) => t + 1), 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  const handleSaveHighlight = () => {
    if (!articleId) {
      toast.message("仅在对已入库文章预览时可保存高亮");
      return;
    }
    const box = pageBoxRef.current;
    if (!box || canvasCssSize.w < 10 || canvasCssSize.h < 10) return;
    const norms = selectionToNormRects(box, canvasCssSize.w, canvasCssSize.h);
    if (!norms) {
      toast.message("请先在 PDF 文本上划选一段内容");
      return;
    }
    saveHighlightMut.mutate({
      articleId,
      page: safePage,
      rectsNorm: norms,
      sessionId: sessionId ?? undefined,
    });
  };

  const handleToggleCropMode = () => {
    if (cropMode) {
      setCropMode(false);
      setCropRect(null);
      cropStartRef.current = null;
    } else {
      setCropMode(true);
      setCropRect(null);
    }
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cropMode) return;
    const box = pageBoxRef.current;
    if (!box) return;
    const br = box.getBoundingClientRect();
    const sx = e.clientX - br.left;
    const sy = e.clientY - br.top;
    cropStartRef.current = { sx, sy };
    setCropRect({ x: sx, y: sy, w: 0, h: 0 });
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cropMode || !cropStartRef.current) return;
    const box = pageBoxRef.current;
    if (!box) return;
    const br = box.getBoundingClientRect();
    const cx = Math.max(0, Math.min(e.clientX - br.left, canvasCssSize.w));
    const cy = Math.max(0, Math.min(e.clientY - br.top, canvasCssSize.h));
    const { sx, sy } = cropStartRef.current;
    setCropRect({
      x: Math.min(sx, cx),
      y: Math.min(sy, cy),
      w: Math.abs(cx - sx),
      h: Math.abs(cy - sy),
    });
  };

  const handleCropMouseUp = () => {
    cropStartRef.current = null;
  };

  const handleSaveCropImage = () => {
    if (!articleId) {
      toast.message("仅在对已入库文章预览时可存图");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || canvas.width < 2) return;

    const scale = canvas.width / canvasCssSize.w;
    let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
    if (cropRect && cropRect.w > 10 && cropRect.h > 10) {
      sx = Math.round(cropRect.x * scale);
      sy = Math.round(cropRect.y * scale);
      sw = Math.round(cropRect.w * scale);
      sh = Math.round(cropRect.h * scale);
    }

    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = sw;
    tmpCanvas.height = sh;
    const ctx = tmpCanvas.getContext("2d");
    if (!ctx) { toast.error("导出图片失败"); return; }
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    tmpCanvas.toBlob(
      (blob) => {
        if (!blob) { toast.error("导出图片失败"); return; }
        const fd = new FormData();
        fd.append("file", blob, "crop.png");
        fd.append("articleId", String(articleId));
        fd.append("sourcePage", String(safePage));
        if (sessionId) fd.append("sessionId", sessionId);
        fetch("/api/news/reading-image", {
          method: "POST",
          body: fd,
          credentials: "include",
        })
          .then(async (r) => {
            const j = (await r.json().catch(() => ({}))) as { error?: string; success?: boolean };
            if (!r.ok) throw new Error(j.error || r.statusText);
            toast.success("已加入图片流");
            setCropMode(false);
            setCropRect(null);
            void utils.reading.readingImagesList.invalidate({ articleId });
          })
          .catch((e: Error) => toast.error(e.message));
      },
      "image/png",
      0.92,
    );
  };

  if (loadErr) {
    return (
      <div className="flex flex-1 min-h-[200px] items-center justify-center rounded-lg border border-red-200 bg-red-50/80 px-4 text-center text-xs text-red-800">
        PDF 加载失败：{loadErr}
        <br />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[#1677ff] underline"
        >
          新窗口打开文件
        </a>
      </div>
    );
  }

  const vw = canvasCssSize.w;
  const vh = canvasCssSize.h;
  const persistedForPage = persistedHighlights.filter((h) => h.page === safePage);
  const persistedPixelRects: Rect[] = [];
  for (const ph of persistedForPage) {
    persistedPixelRects.push(...normRectsToPixels(ph.rectsNorm, vw, vh));
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2">
      <div className="sticky top-0 z-20 -mx-1 border-b border-gray-100 bg-white/95 px-2 py-1 backdrop-blur flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            className="rounded border border-gray-200 p-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            aria-label="上一页"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums text-xs text-gray-600">
            {numPages > 0 ? `${safePage} / ${numPages}` : "…"}
          </span>
          <button
            type="button"
            disabled={numPages > 0 && safePage >= numPages}
            onClick={() => onPageChange(safePage + 1)}
            className="rounded border border-gray-200 p-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            aria-label="下一页"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {articleId ? (
            <>
              <button
                type="button"
                disabled={saveHighlightMut.isPending || pageHasSelectableText === false}
                onClick={handleSaveHighlight}
                className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50/90 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                title={pageHasSelectableText === false ? "当前页面无文本层，无法划词高亮" : undefined}
              >
                <Highlighter className="h-3 w-3" />
                保存选区为团队高亮
              </button>
              <button
                type="button"
                onClick={handleToggleCropMode}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
                  cropMode
                    ? "border-blue-400 bg-blue-100 text-blue-900"
                    : "border-sky-200 bg-sky-50/90 text-sky-900 hover:bg-sky-100"
                }`}
              >
                <Crop className="h-3 w-3" />
                {cropMode ? "取消截图" : "区域截图"}
              </button>
              {cropMode && cropRect && cropRect.w > 10 && cropRect.h > 10 && (
                <button
                  type="button"
                  onClick={handleSaveCropImage}
                  className="inline-flex items-center gap-1 rounded border border-green-300 bg-green-50 px-2 py-1 text-[11px] font-medium text-green-900 hover:bg-green-100"
                >
                  <ImageIcon className="h-3 w-3" />
                  加入图片流
                </button>
              )}
            </>
          ) : null}
          {citationHighlight && highlightRects.length > 0 ? (
            <span className="text-[11px] text-amber-800">已高亮引用</span>
          ) : citationHighlight ? (
            <span className="text-[11px] text-gray-400">未匹配到引用字形高亮</span>
          ) : null}
        </div>
      </div>
      {pageHasSelectableText === false && numPages > 0 ? (
        <div className="shrink-0 rounded border border-amber-100 bg-amber-50/90 px-2 py-1.5 text-[11px] leading-snug text-amber-950">
          该 PDF 可能为扫描件，无可选中文本层，划词保存高亮可能不可用。仍可浏览页面或使用
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-1 text-[#1677ff] underline"
          >
            新窗口打开
          </a>
          下载后本地查看。
        </div>
      ) : null}
      {cropMode && cropRect && cropRect.w > 10 && cropRect.h > 10 ? (
        <div className="shrink-0 rounded border border-green-200 bg-green-50 px-2 py-1.5 text-[11px] text-green-900">
          选区已就绪：点击右上角「加入图片流」即可保存到图片流页签。
        </div>
      ) : null}
      <div
        ref={wrapRef}
        className="relative flex min-h-[200px] flex-1 justify-center overflow-auto rounded-lg border border-gray-200 bg-neutral-700/5"
      >
        <div
          ref={pageBoxRef}
          className={`relative inline-block shadow-sm ${cropMode ? "cursor-crosshair" : ""}`}
          style={
            vw > 0 && vh > 0
              ? { width: vw, minHeight: vh }
              : { minWidth: 200, minHeight: 200 }
          }
          onMouseDown={handleCropMouseDown}
          onMouseMove={handleCropMouseMove}
          onMouseUp={handleCropMouseUp}
        >
          <canvas ref={canvasRef} className="block max-w-full" />
          <div
            className="pointer-events-none absolute left-0 top-0 z-[5]"
            style={{ width: vw || undefined, height: vh || undefined }}
          >
            {persistedPixelRects.map((r, i) => (
              <div
                key={`p-${i}`}
                className="absolute rounded-[2px]"
                style={{
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: Math.max(r.height, 8),
                  background: "rgba(52, 211, 153, 0.35)",
                  boxShadow: "0 0 0 1px rgba(16, 185, 129, 0.45)",
                  mixBlendMode: "multiply",
                }}
              />
            ))}
            {highlightRects.map((r, i) => (
              <div
                key={`c-${i}`}
                className="absolute rounded-[3px]"
                style={{
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: Math.max(r.height, 10),
                  background: "rgba(253, 224, 71, 0.38)",
                  boxShadow: "0 0 0 1px rgba(250, 204, 21, 0.5)",
                  mixBlendMode: "multiply",
                }}
              />
            ))}
          </div>
          <div
            ref={textLayerHostRef}
            className="absolute left-0 top-0 z-[10]"
            style={{
              width: vw || "100%",
              height: vh || "100%",
              pointerEvents: cropMode ? "none" : undefined,
            }}
          />
          {cropMode && (
            <div className="absolute inset-0 z-[15]" style={{ pointerEvents: "none" }}>
              {cropRect && cropRect.w > 2 && cropRect.h > 2 && (
                <div
                  className="absolute border-2 border-blue-500 bg-blue-500/10"
                  style={{
                    left: cropRect.x,
                    top: cropRect.y,
                    width: cropRect.w,
                    height: cropRect.h,
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
