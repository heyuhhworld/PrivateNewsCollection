import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

GlobalWorkerOptions.workerSrc = workerSrc;

export type PdfCitationHighlight = {
  startLine: number;
  endLine: number;
  page: number;
  quote?: string;
};

type Props = {
  url: string;
  page: number;
  onPageChange: (p: number) => void;
  citationHighlight: PdfCitationHighlight | null;
  /** 与 chat / 抽取正文一致的非空行，用于在 PDF 文本层中匹配高亮 */
  citationLines: string[];
};

/**
 * Normalize text for fuzzy PDF matching:
 * - collapse whitespace, strip soft hyphens / zero-width chars
 * - replace fancy quotes / dashes with ASCII equivalents
 */
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

/**
 * Build regex patterns from a quote string, progressively relaxed.
 * Returns array of patterns to try (most specific first).
 */
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

/**
 * Group raw per-item rects into clean line-spanning highlight bands.
 * Items on the same baseline (within yTol px) are merged into one wide rect.
 */
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

export function PdfCitationViewer({
  url,
  page,
  onPageChange,
  citationHighlight,
  citationLines,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [highlightRects, setHighlightRects] = useState<
    { left: number; top: number; width: number; height: number }[]
  >([]);
  const [renderTick, setRenderTick] = useState(0);
  const [canvasCssSize, setCanvasCssSize] = useState({ w: 0, h: 0 });

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

      const p = await doc.getPage(pageNum);
      const base = p.getViewport({ scale: 1 });
      const cw = wrap.clientWidth || 800;
      const scale = Math.min(Math.max(cw / base.width, 0.5), 3);
      const viewport = p.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setCanvasCssSize({ w: viewport.width, h: viewport.height });

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await p
        .render({ canvasContext: ctx, viewport, canvas })
        .promise.catch(() => {});

      return { p, viewport };
    },
    []
  );

  useEffect(() => {
    if (!pdfDoc || numPages < 1) return;
    let alive = true;
    (async () => {
      const meta = await renderPage(pdfDoc, safePage);
      if (!alive || !meta) return;
      const { p, viewport } = meta;

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

      let rects = quoteFromLlm
        ? await findHighlightRects(p, viewport, quoteFromLlm)
        : [];
      if (rects.length === 0 && quoteFromLines) {
        rects = await findHighlightRects(p, viewport, quoteFromLines);
      }
      if (alive) setHighlightRects(rects);
    })();
    return () => {
      alive = false;
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
    const ro = new ResizeObserver(() => setRenderTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
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
        {citationHighlight && highlightRects.length > 0 ? (
          <span className="text-[11px] text-amber-800">已在正文上高亮引用片段</span>
        ) : citationHighlight ? (
          <span className="text-[11px] text-gray-400">未匹配到精确字形位置（见下方摘录）</span>
        ) : null}
      </div>
      <div
        ref={wrapRef}
        className="relative flex min-h-[200px] flex-1 justify-center overflow-auto rounded-lg border border-gray-200 bg-neutral-700/5"
      >
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="block max-w-full shadow-sm" />
          <div
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: canvasCssSize.w,
              height: canvasCssSize.h,
            }}
          >
            {highlightRects.map((r, i) => (
              <div
                key={i}
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
        </div>
      </div>
    </div>
  );
}
