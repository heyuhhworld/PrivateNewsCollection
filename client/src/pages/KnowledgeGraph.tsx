import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  Combine,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";

const TYPE_COLORS: Record<string, string> = {
  fund: "#6366f1",
  institution: "#0ea5e9",
  person: "#f59e0b",
  other: "#94a3b8",
};
const TYPE_LABELS: Record<string, string> = {
  fund: "基金",
  institution: "机构",
  person: "人物",
  other: "其他",
};

interface GraphNode {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  linkCount: number;
}
interface GraphEdge {
  id: number;
  source: number;
  target: number;
  relation: string;
  articleId: number;
}

function useForceLayout(
  rawNodes: { id: number; name: string; type: string }[],
  rawEdges: GraphEdge[],
  width: number,
  height: number
) {
  const nodesRef = useRef<GraphNode[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (rawNodes.length === 0) return;
    const linkCountMap = new Map<number, number>();
    for (const e of rawEdges) {
      linkCountMap.set(e.source, (linkCountMap.get(e.source) ?? 0) + 1);
      linkCountMap.set(e.target, (linkCountMap.get(e.target) ?? 0) + 1);
    }

    const nodes: GraphNode[] = rawNodes.map((n, i) => {
      const lc = linkCountMap.get(n.id) ?? 0;
      const angle = (2 * Math.PI * i) / rawNodes.length;
      const r = Math.min(width, height) * 0.35;
      return {
        ...n,
        x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
        y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        radius: Math.max(6, Math.min(20, 6 + lc * 2)),
        linkCount: lc,
      };
    });
    nodesRef.current = nodes;

    const idxMap = new Map(nodes.map((n, i) => [n.id, i]));
    let frame = 0;
    const maxFrames = 200;
    let raf: number;

    const step = () => {
      if (frame >= maxFrames) return;
      frame++;
      const alpha = 1 - frame / maxFrames;
      const k = 0.01 * alpha;
      const repulse = 3000 * alpha;

      for (let i = 0; i < nodes.length; i++) {
        const ni = nodes[i];
        ni.vx += (width / 2 - ni.x) * k;
        ni.vy += (height / 2 - ni.y) * k;

        for (let j = i + 1; j < nodes.length; j++) {
          const nj = nodes[j];
          let dx = ni.x - nj.x;
          let dy = ni.y - nj.y;
          const dist2 = dx * dx + dy * dy || 1;
          const f = repulse / dist2;
          const dist = Math.sqrt(dist2);
          dx /= dist;
          dy /= dist;
          ni.vx += dx * f;
          ni.vy += dy * f;
          nj.vx -= dx * f;
          nj.vy -= dy * f;
        }
      }

      const idealLen = 120;
      for (const e of rawEdges) {
        const si = idxMap.get(e.source);
        const ti = idxMap.get(e.target);
        if (si == null || ti == null) continue;
        const ni = nodes[si];
        const nj = nodes[ti];
        let dx = nj.x - ni.x;
        let dy = nj.y - ni.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (dist - idealLen) * 0.04 * alpha;
        dx /= dist;
        dy /= dist;
        ni.vx += dx * f;
        ni.vy += dy * f;
        nj.vx -= dx * f;
        nj.vy -= dy * f;
      }

      for (const n of nodes) {
        n.vx *= 0.8;
        n.vy *= 0.8;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(n.radius + 10, Math.min(width - n.radius - 10, n.x));
        n.y = Math.max(n.radius + 10, Math.min(height - n.radius - 10, n.y));
      }

      setTick((t) => t + 1);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rawNodes, rawEdges, width, height]);

  return { nodes: nodesRef.current, tick };
}

export default function KnowledgeGraph() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.kg.graph.useQuery();
  const mergeDuplicatesMutation = trpc.kg.mergeDuplicateEntities.useMutation({
    onSuccess: (r) => {
      toast.success(
        `已合并 ${r.entitiesRemoved} 条重复实体（${r.groupsMerged} 组），关系已去重`
      );
      void utils.kg.graph.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 900, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const dragRef = useRef<{ startX: number; startY: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDim({ w: Math.max(400, width), h: Math.max(300, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rawNodes = useMemo(() => data?.nodes ?? [], [data]);
  const rawEdges = useMemo(() => data?.edges ?? [], [data]);

  const { nodes } = useForceLayout(rawNodes, rawEdges, dim.w, dim.h);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const filteredNodeIds = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return new Set(
      nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id)
    );
  }, [nodes, search]);

  const { data: entityArticles } = trpc.kg.entityArticles.useQuery(
    { entityId: selected! },
    { enabled: selected != null }
  );

  const selectedNode = selected != null ? nodeMap.get(selected) : null;

  const handleBgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        px: pan.x,
        py: pan.y,
      };
    },
    [pan]
  );
  const handleBgPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({
      x: d.px + (e.clientX - d.startX),
      y: d.py + (e.clientY - d.startY),
    });
  }, []);
  const handleBgPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (rawNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-gray-500">
        <Network className="h-12 w-12 text-gray-300" />
        <p className="text-sm">暂无知识图谱数据。系统会在导入资讯时自动抽取实体与关系。</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-indigo-500" />
          <h1 className="text-base font-semibold text-gray-800">知识图谱</h1>
          <span className="text-xs text-gray-400">
            {rawNodes.length} 实体 · {rawEdges.length} 关系
          </span>
          {user?.role === "admin" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 ml-1"
              disabled={mergeDuplicatesMutation.isPending}
              title="将 PitchBook / Pitchbook 等同名实体合并并整理关系边"
              onClick={() => mergeDuplicatesMutation.mutate()}
            >
              {mergeDuplicatesMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Combine className="h-3.5 w-3.5" />
              )}
              合并重复实体
            </Button>
          )}
        </div>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="搜索实体…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setZoom((z) => Math.max(0.3, z / 1.2))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
        {/* Legend */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500 ml-2">
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: TYPE_COLORS[k] }}
              />
              {v}
            </span>
          ))}
        </div>
      </div>

      {/* Graph area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-[#f8f9fb] cursor-grab active:cursor-grabbing"
        onPointerDown={handleBgPointerDown}
        onPointerMove={handleBgPointerMove}
        onPointerUp={handleBgPointerUp}
        onPointerLeave={handleBgPointerUp}
      >
        <svg
          width={dim.w}
          height={dim.h}
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          {/* Edges */}
          {rawEdges.map((e) => {
            const s = nodeMap.get(e.source);
            const t = nodeMap.get(e.target);
            if (!s || !t) return null;
            const dimmed =
              filteredNodeIds != null &&
              !filteredNodeIds.has(e.source) &&
              !filteredNodeIds.has(e.target);
            return (
              <g key={e.id} opacity={dimmed ? 0.12 : 0.45}>
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="#94a3b8"
                  strokeWidth={1}
                />
                <text
                  x={(s.x + t.x) / 2}
                  y={(s.y + t.y) / 2 - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#64748b"
                >
                  {e.relation}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((n) => {
            const dimmed =
              filteredNodeIds != null && !filteredNodeIds.has(n.id);
            const isSel = selected === n.id;
            return (
              <g
                key={n.id}
                opacity={dimmed ? 0.2 : 1}
                style={{ cursor: "pointer" }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelected(isSel ? null : n.id);
                }}
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.radius}
                  fill={TYPE_COLORS[n.type] ?? TYPE_COLORS.other}
                  stroke={isSel ? "#1e293b" : "white"}
                  strokeWidth={isSel ? 2.5 : 1.5}
                />
                <text
                  x={n.x}
                  y={n.y + n.radius + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={isSel ? 600 : 400}
                  fill="#1e293b"
                >
                  {n.name.length > 10 ? n.name.slice(0, 10) + "…" : n.name}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Detail panel */}
        {selectedNode && (
          <div className="absolute top-3 right-3 w-72 max-h-[60vh] bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden flex flex-col z-10">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{
                  background:
                    TYPE_COLORS[selectedNode.type] ?? TYPE_COLORS.other,
                }}
              />
              <h3 className="text-sm font-semibold text-gray-800 truncate flex-1">
                {selectedNode.name}
              </h3>
              <span className="text-[11px] text-gray-400">
                {TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* Related edges */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">关系</p>
                {rawEdges
                  .filter(
                    (e) =>
                      e.source === selected || e.target === selected
                  )
                  .slice(0, 20)
                  .map((e) => {
                    const other =
                      e.source === selected
                        ? nodeMap.get(e.target)
                        : nodeMap.get(e.source);
                    return (
                      <div
                        key={e.id}
                        className="text-xs text-gray-600 py-0.5"
                      >
                        {e.source === selected ? (
                          <>
                            → <b>{e.relation}</b> → {other?.name ?? "?"}
                          </>
                        ) : (
                          <>
                            {other?.name ?? "?"} → <b>{e.relation}</b> →
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* Related articles */}
              {entityArticles && entityArticles.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    相关资讯
                  </p>
                  <ul className="space-y-1">
                    {entityArticles.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          className="text-left text-xs text-[#1677ff] hover:underline"
                          onClick={() => setLocation(`/news/${a.id}`)}
                        >
                          {a.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
