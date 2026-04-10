import type { InputHTMLAttributes } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Settings,
  Plus,
  Play,
  Pause,
  Square,
  Trash2,
  Edit,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Globe,
  Calendar,
  Activity,
  ChevronDown,
  ChevronUp,
  FileUp,
  FolderOpen,
  Link2,
  Newspaper,
  Eye,
  EyeOff,
} from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

// Cron expression presets
const CRON_PRESETS = [
  { label: "每天上午 8 点", value: "0 8 * * *" },
  { label: "每天下午 6 点", value: "0 18 * * *" },
  { label: "每周一上午 9 点", value: "0 9 * * 1" },
  { label: "每周五下午 5 点", value: "0 17 * * 5" },
  { label: "每 6 小时", value: "0 */6 * * *" },
  { label: "每 12 小时", value: "0 */12 * * *" },
  { label: "自定义", value: "custom" },
];

const RANGE_OPTIONS = [
  { label: "近 1 天", value: 1 },
  { label: "近 3 天", value: 3 },
  { label: "近 7 天", value: 7 },
  { label: "近 14 天", value: 14 },
  { label: "近 30 天", value: 30 },
];

const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FOLDER_FILES = 80;

type ImportQueueRow = {
  id: string;
  kind: "file" | "url";
  label: string;
  relativePath?: string;
  status: "queued" | "running" | "success" | "duplicate" | "failed" | "cancelled";
  title?: string;
  error?: string;
  articleId?: number;
  file?: File;
  url?: string;
  source?: "Preqin" | "Pitchbook";
};

function isAllowedImportFile(f: File): boolean {
  const n = f.name.toLowerCase();
  return (
    n.endsWith(".pdf") ||
    n.endsWith(".docx") ||
    f.type === "application/pdf" ||
    f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function newQueueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type JobFormData = {
  name: string;
  url: string;
  source: "Preqin" | "Pitchbook";
  cronPreset: string;
  cronExpr: string;
  rangeInDays: number;
  isEnabled: boolean;
  /** Preqin 登录邮箱/用户名 */
  authUsername: string;
  /** 明文密码，仅创建或修改时填写 */
  authPassword: string;
};

const DEFAULT_FORM: JobFormData = {
  name: "",
  url: "",
  source: "Preqin",
  cronPreset: "0 8 * * *",
  cronExpr: "0 8 * * *",
  rangeInDays: 7,
  isEnabled: true,
  authUsername: "",
  authPassword: "",
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary" className="text-xs">未执行</Badge>;
  if (status === "success")
    return (
      <Badge className="text-xs bg-green-50 text-green-700 border border-green-200 gap-1">
        <CheckCircle className="h-3 w-3" /> 成功
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge className="text-xs bg-red-50 text-red-700 border border-red-200 gap-1">
        <XCircle className="h-3 w-3" /> 失败
      </Badge>
    );
  if (status === "running")
    return (
      <Badge className="text-xs bg-blue-50 text-blue-700 border border-blue-200 gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> 执行中
      </Badge>
    );
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function LogStatusBadge({ status }: { status: string }) {
  if (status === "success")
    return <span className="text-green-600 text-xs font-medium flex items-center gap-1"><CheckCircle className="h-3 w-3" />成功</span>;
  if (status === "failed")
    return <span className="text-red-600 text-xs font-medium flex items-center gap-1"><XCircle className="h-3 w-3" />失败</span>;
  return <span className="text-blue-600 text-xs font-medium flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />执行中</span>;
}

export default function SystemManagement() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const docFolderInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"jobs" | "import" | "records">("jobs");
  const [recordAdminPage, setRecordAdminPage] = useState(1);
  const [recordVisibility, setRecordVisibility] = useState<"all" | "visible" | "hidden">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<number | null>(null);
  const [form, setForm] = useState<JobFormData>(DEFAULT_FORM);
  const [runningJobId, setRunningJobId] = useState<number | null>(null);
  const [refreshingJobs, setRefreshingJobs] = useState(false);
  /** 编辑任务时勾选则清除已保存的 Preqin 密码 */
  const [clearPreqinPassword, setClearPreqinPassword] = useState(false);
  // Manual import state
  const [importUrls, setImportUrls] = useState("");
  const [importSource, setImportSource] = useState<"Preqin" | "Pitchbook">("Pitchbook");
  const [importQueue, setImportQueue] = useState<ImportQueueRow[]>([]);
  const importQueueRef = useRef<ImportQueueRow[]>([]);
  const importWorkerLockRef = useRef(false);
  const importPausedRef = useRef(false);
  const [importPaused, setImportPaused] = useState(false);
  const [importConcurrency, setImportConcurrency] = useState(1);
  const importConcurrencyRef = useRef(1);

  const { data: jobs, isLoading, refetch } = trpc.crawl.list.useQuery();
  const { data: logs, refetch: refetchLogs } = trpc.crawl.logs.useQuery(
    { jobId: expandedLogs ?? undefined },
    { enabled: expandedLogs !== null }
  );

  useEffect(() => {
    if (!jobs || jobs.length === 0) {
      setRunningJobId(null);
      return;
    }
    const running = jobs.find((j: any) => j.lastRunStatus === "running");
    if (running) {
      setRunningJobId(running.id);
      return;
    }
    setRunningJobId(null);
  }, [jobs]);

  const createMutation = trpc.crawl.create.useMutation({
    onSuccess: () => {
      toast.success("抓取任务已创建");
      setShowCreateDialog(false);
      setForm(DEFAULT_FORM);
      setClearPreqinPassword(false);
      refetch();
    },
    onError: (e) => toast.error(`创建失败: ${e.message}`),
  });

  const updateMutation = trpc.crawl.update.useMutation({
    onSuccess: () => {
      toast.success("任务已更新");
      setEditingJob(null);
      setClearPreqinPassword(false);
      refetch();
    },
    onError: (e) => toast.error(`更新失败: ${e.message}`),
  });

  const deleteMutation = trpc.crawl.delete.useMutation({
    onSuccess: () => {
      toast.success("任务已删除");
      setDeletingJobId(null);
      refetch();
    },
    onError: (e) => toast.error(`删除失败: ${e.message}`),
  });

  const runNowMutation = trpc.crawl.runNow.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setRunningJobId(null);
      refetch();
      if (expandedLogs !== null) refetchLogs();
    },
    onError: (e) => {
      toast.error(`执行失败: ${e.message}`);
      setRunningJobId(null);
    },
  });
  const stopRunMutation = trpc.crawl.stopRun.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.message(data.message);
      }
      refetch();
      if (expandedLogs !== null) refetchLogs();
    },
    onError: (e) => toast.error(`停止失败: ${e.message}`),
  });
  const reconcileRunningLogsMutation = trpc.crawl.reconcileRunningLogs.useMutation();

  const toggleEnabledMutation = trpc.crawl.update.useMutation({
    onSuccess: () => refetch(),
  });

  const { data: importSessionStatus } = trpc.news.importSessionStatus.useQuery(
    undefined,
    { enabled: activeTab === "import", refetchInterval: 30_000 }
  );

  const importByUrlMutation = trpc.news.importByUrl.useMutation();

  const { data: adminArticleData, refetch: refetchAdminArticles } =
    trpc.news.adminArticleList.useQuery(
      { page: recordAdminPage, pageSize: 25, visibility: recordVisibility },
      { enabled: activeTab === "records" && user?.role === "admin" }
    );

  const setArticleHiddenMutation = trpc.news.adminSetArticleHidden.useMutation({
    onSuccess: () => {
      toast.success("已更新展示状态");
      void refetchAdminArticles();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteArticleAdminMutation = trpc.news.adminDeleteArticle.useMutation({
    onSuccess: () => {
      toast.success("已删除该记录");
      void refetchAdminArticles();
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (activeTab === "records" && user?.role !== "admin") {
      setActiveTab("jobs");
    }
  }, [activeTab, user?.role]);

  const patchImportRow = useCallback((id: string, patch: Partial<ImportQueueRow>) => {
    setImportQueue((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      importQueueRef.current = next;
      return next;
    });
  }, []);

  const appendImportQueue = useCallback((rows: ImportQueueRow[]) => {
    if (rows.length === 0) return;
    setImportQueue((prev) => {
      const next = [...prev, ...rows];
      importQueueRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    importConcurrencyRef.current = importConcurrency;
  }, [importConcurrency]);

  const runImportWorker = useCallback(async () => {
    if (importWorkerLockRef.current) return;
    importWorkerLockRef.current = true;

    const processOneRow = async (row: ImportQueueRow) => {
      const live = importQueueRef.current.find((r) => r.id === row.id);
      if (!live || live.status !== "queued") return;
      patchImportRow(row.id, { status: "running" });
      try {
        if (row.kind === "file") {
          const file = row.file;
          if (!file) throw new Error("缺少文件对象");
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/news/upload-document", {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const data = (await res.json()) as {
            error?: string;
            success?: boolean;
            articleId?: number;
            title?: string;
          };
          if (!res.ok) {
            throw new Error(data.error || `上传失败（${res.status}）`);
          }
          patchImportRow(row.id, {
            status: "success",
            title: data.title,
            articleId: data.articleId,
          });
        } else {
          const out = await importByUrlMutation.mutateAsync({
            urls: [row.url!],
            source: row.source ?? "Pitchbook",
          });
          const r = out.results[0];
          patchImportRow(row.id, {
            status: r.status,
            title: r.title,
            error: r.error,
          });
        }
      } catch (e: unknown) {
        patchImportRow(row.id, {
          status: "failed",
          error: e instanceof Error ? e.message : "执行失败",
        });
      }
    };

    try {
      while (true) {
        if (importPausedRef.current) break;
        const q = importQueueRef.current;
        const queued = q.filter((r) => r.status === "queued");
        if (queued.length === 0) break;
        const n = Math.min(importConcurrencyRef.current, queued.length);
        const batch = queued.slice(0, n);
        await Promise.all(batch.map((row) => processOneRow(row)));
      }
    } finally {
      importWorkerLockRef.current = false;
    }
  }, [importByUrlMutation, patchImportRow]);

  function scheduleImportWorker() {
    if (importPausedRef.current) return;
    void runImportWorker();
  }

  function setImportQueuePaused(paused: boolean) {
    importPausedRef.current = paused;
    setImportPaused(paused);
    if (!paused) {
      void runImportWorker();
    }
  }

  function cancelAllQueuedImportRows() {
    setImportQueue((prev) => {
      const next = prev.map((r) =>
        r.status === "queued"
          ? { ...r, status: "cancelled" as const, error: "已取消排队" }
          : r
      );
      importQueueRef.current = next;
      return next;
    });
    toast.message("已取消所有排队中的任务（进行中的仍会跑完）");
  }

  function removeImportQueueRow(id: string) {
    const row = importQueueRef.current.find((r) => r.id === id);
    if (!row || row.status !== "queued") return;
    patchImportRow(id, { status: "cancelled", error: "已从队列移除" });
  }

  function handleImportUrls() {
    const urls = importUrls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http"));
    if (urls.length === 0) {
      toast.error("请输入至少一条有效 URL");
      return;
    }
    if (urls.length > 10) {
      toast.error("单次最多添加 10 条链接（可多次点击「加入队列」分批）");
      return;
    }
    const rows: ImportQueueRow[] = urls.map((url) => ({
      id: newQueueId(),
      kind: "url",
      label: url,
      url,
      source: importSource,
      status: "queued",
    }));
    appendImportQueue(rows);
    scheduleImportWorker();
    toast.message(`已加入队列 ${rows.length} 条链接，将按顺序执行`);
  }

  function enqueueFilesFromList(files: FileList | null, fromFolder: boolean) {
    if (!files?.length) return;
    const list = Array.from(files);
    const allowed = list.filter(
      (f) =>
        isAllowedImportFile(f) &&
        !f.name.startsWith(".") &&
        f.name !== ".DS_Store"
    );
    const skippedType = list.length - allowed.length;
    const oversized = allowed.filter((f) => f.size > MAX_IMPORT_FILE_BYTES);
    const ok = allowed.filter((f) => f.size <= MAX_IMPORT_FILE_BYTES);
    if (fromFolder && ok.length > MAX_FOLDER_FILES) {
      toast.error(`文件夹内符合格式的文件超过 ${MAX_FOLDER_FILES} 个，请分批选择`);
      return;
    }
    if (ok.length === 0) {
      toast.error("没有可导入的 PDF / .docx（单文件≤25MB）");
      return;
    }
    const rows: ImportQueueRow[] = ok.map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return {
        id: newQueueId(),
        kind: "file" as const,
        label: file.name,
        relativePath: rel && rel !== file.name ? rel : undefined,
        file,
        status: "queued" as const,
      };
    });
    appendImportQueue(rows);
    scheduleImportWorker();
    const parts = [`已加入队列 ${rows.length} 个文件`];
    if (skippedType) parts.push(`已跳过 ${skippedType} 个非支持类型`);
    if (oversized.length) parts.push(`${oversized.length} 个超过 25MB 已跳过`);
    toast.message(parts.join("；"));
  }

  function handleDocumentFilesSelected(files: FileList | null) {
    enqueueFilesFromList(files, false);
    if (docFileInputRef.current) docFileInputRef.current.value = "";
  }

  function handleFolderSelected(files: FileList | null) {
    enqueueFilesFromList(files, true);
    if (docFolderInputRef.current) docFolderInputRef.current.value = "";
  }

  function clearFinishedImportRows() {
    setImportQueue((prev) => {
      const next = prev.filter(
        (r) =>
          r.status === "queued" ||
          r.status === "running"
      );
      importQueueRef.current = next;
      return next;
    });
  }

  const importQueueBusy = importQueue.some(
    (r) => r.status === "running" || r.status === "queued"
  );
  const hasQueued = importQueue.some((r) => r.status === "queued");
  const hasRunning = importQueue.some((r) => r.status === "running");

  function handleFormChange(key: keyof JobFormData, value: any) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "cronPreset" && value !== "custom") {
        next.cronExpr = value;
      }
      return next;
    });
  }

  function handleSubmit(isEdit = false) {
    const base = {
      name: form.name,
      url: form.url,
      source: form.source,
      cronExpr: form.cronPreset === "custom" ? form.cronExpr : form.cronPreset,
      rangeInDays: form.rangeInDays,
      isEnabled: form.isEnabled,
    };

    if (form.source === "Preqin") {
      if (isEdit && editingJob) {
        const updatePayload: Parameters<typeof updateMutation.mutate>[0] = {
          id: editingJob.id,
          ...base,
          authUsername: form.authUsername.trim() || null,
        };
        if (clearPreqinPassword) {
          updatePayload.authPassword = "";
        } else if (form.authPassword.trim()) {
          updatePayload.authPassword = form.authPassword.trim();
        }
        updateMutation.mutate(updatePayload);
        return;
      }
      createMutation.mutate({
        ...base,
        authUsername: form.authUsername.trim() || undefined,
        authPassword: form.authPassword.trim() || undefined,
      });
      return;
    }

    if (isEdit && editingJob) {
      updateMutation.mutate({
        id: editingJob.id,
        ...base,
        authUsername: null,
        authPassword: "",
      });
    } else {
      createMutation.mutate(base);
    }
  }

  function openEdit(job: any) {
    const preset = CRON_PRESETS.find((p) => p.value === job.cronExpr && p.value !== "custom");
    setClearPreqinPassword(false);
    setForm({
      name: job.name,
      url: job.url,
      source: job.source,
      cronPreset: preset ? job.cronExpr : "custom",
      cronExpr: job.cronExpr,
      rangeInDays: job.rangeInDays,
      isEnabled: job.isEnabled,
      authUsername: job.authUsername ?? "",
      authPassword: "",
    });
    setEditingJob(job);
  }

  function handleRunNow(jobId: number) {
    setRunningJobId(jobId);
    runNowMutation.mutate({ id: jobId });
  }

  function handleStopRun(jobId: number) {
    stopRunMutation.mutate({ id: jobId });
  }

  async function handleRefreshJobs() {
    setRefreshingJobs(true);
    try {
      const out = await reconcileRunningLogsMutation.mutateAsync({});
      await refetch();
      if (expandedLogs !== null) await refetchLogs();
      if (out.updated > 0) {
        toast.success(out.message);
      } else {
        toast.message("已刷新任务与日志");
      }
    } catch (e: any) {
      toast.error(`刷新失败: ${e?.message ?? e}`);
    } finally {
      setRefreshingJobs(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#f5f7fa]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-[#1677ff]" />
          <h1 className="text-lg font-semibold text-gray-800">系统管理</h1>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "jobs" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRefreshJobs()}
                disabled={refreshingJobs}
                className="h-8 gap-1.5 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingJobs ? "animate-spin" : ""}`} />
                刷新
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setForm(DEFAULT_FORM);
                  setClearPreqinPassword(false);
                  setShowCreateDialog(true);
                }}
                className="h-8 gap-1.5 text-xs bg-[#1677ff] hover:bg-[#0958d9]"
              >
                <Plus className="h-3.5 w-3.5" />新建抓取任务
              </Button>
            </>
          ) : activeTab === "records" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetchAdminArticles()}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />刷新
            </Button>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-0 shrink-0">
        <button
          onClick={() => setActiveTab("jobs")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "jobs"
              ? "border-[#1677ff] text-[#1677ff]"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          定时抓取配置
        </button>
        <button
          onClick={() => setActiveTab("import")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "import"
              ? "border-[#1677ff] text-[#1677ff]"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          手动导入文章
        </button>
        {user?.role === "admin" && (
          <button
            type="button"
            onClick={() => setActiveTab("records")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "records"
                ? "border-[#1677ff] text-[#1677ff]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            资讯记录
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Manual Import Tab */}
        {activeTab === "import" && (
          <div className="max-w-3xl space-y-4">
            <div className="bg-white rounded-lg border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-1">
                <FileUp className="h-4 w-4 text-[#1677ff]" />
                <h2 className="text-sm font-semibold text-gray-800">文件导入</h2>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                支持多选文件或整夹上传：PDF / Word（.docx）进入与链接共用的导入队列；可在下方队列面板<strong>暂停 / 继续、取消排队、调整并发数（1～3）</strong>。入库后可在资讯详情查看上传人、时间说明、原文预览与文件问答。
              </p>
              <input
                ref={docFileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => handleDocumentFilesSelected(e.target.files)}
              />
              <input
                ref={docFolderInputRef}
                type="file"
                multiple
                className="hidden"
                {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => handleFolderSelected(e.target.files)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => docFileInputRef.current?.click()}
                  className="h-9 gap-2 text-xs border-[#1677ff]/40 text-[#1677ff] hover:bg-[#e8f0fe]"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  选择文件（可多选）
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => docFolderInputRef.current?.click()}
                  className="h-9 gap-2 text-xs border-[#1677ff]/40 text-[#1677ff] hover:bg-[#e8f0fe]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  选择文件夹
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                单文件最大 25MB；文件夹一次最多 {MAX_FOLDER_FILES} 个符合格式的文件；不支持旧版 .doc。
              </p>
            </div>

            <div className="bg-white rounded-lg border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-1">
                <Globe className="h-4 w-4 text-[#1677ff]" />
                <h2 className="text-sm font-semibold text-gray-800">链接导入文章</h2>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                粘贴 Preqin 或 Pitchbook 文章链接，点击「加入队列」后与文件导入共用<strong>同一顺序队列</strong>（先加入先执行）。每批最多 10 条 URL，可多批追加。
              </p>

              <div className="rounded-lg border border-amber-100 bg-amber-50/70 p-3 mb-4 text-xs text-amber-950 space-y-2">
                <p className="font-medium text-amber-950">首次登录（本机一次，后续自动复用）</p>
                <p className="text-amber-900/90 leading-relaxed">
                  在<strong>运行本服务的电脑</strong>上打开终端，执行下方命令后会弹出真实浏览器。请在窗口内完成登录与验证，回到终端按 Enter
                  保存会话；之后链接导入与无头抓取会沿用该账号，无需每次再登录。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-amber-900/80 shrink-0">Pitchbook</span>
                  <Badge
                    variant={importSessionStatus?.pitchbook ? "default" : "secondary"}
                    className="text-[10px] h-5"
                  >
                    {importSessionStatus?.pitchbook ? "已保存登录态" : "未保存"}
                  </Badge>
                  <code className="text-[10px] sm:text-xs bg-white/90 px-2 py-0.5 rounded border border-amber-200/80 font-mono break-all">
                    pnpm run import:session -- pitchbook
                  </code>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-amber-900/80 shrink-0">Preqin</span>
                  <Badge
                    variant={importSessionStatus?.preqin ? "default" : "secondary"}
                    className="text-[10px] h-5"
                  >
                    {importSessionStatus?.preqin ? "已保存登录态" : "未保存"}
                  </Badge>
                  <code className="text-[10px] sm:text-xs bg-white/90 px-2 py-0.5 rounded border border-amber-200/80 font-mono break-all">
                    pnpm run import:session -- preqin
                  </code>
                </div>
                <p className="text-[11px] text-amber-800/85 leading-relaxed">
                  外网需代理时先在 .env 配置 IMPORT_FETCH_PROXY；会话保存在 data/import-sessions/*.json（含 Cookie，已加入 .gitignore）。
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">资讯来源</label>
                <Select value={importSource} onValueChange={(v) => setImportSource(v as any)}>
                  <SelectTrigger className="h-8 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pitchbook">Pitchbook</SelectItem>
                    <SelectItem value="Preqin">Preqin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">文章 URL（每行一条）</label>
                <textarea
                  value={importUrls}
                  onChange={(e) => setImportUrls(e.target.value)}
                  placeholder={`例如：\nhttps://pitchbook.com/news/articles/example-article\nhttps://www.preqin.com/insights/research/example`}
                  className="w-full h-32 px-3 py-2 text-xs border border-gray-200 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-[#1677ff] font-mono"
                />
              </div>

              <Button
                type="button"
                onClick={handleImportUrls}
                disabled={!importUrls.trim()}
                className="h-8 gap-1.5 text-xs bg-[#1677ff] hover:bg-[#0958d9]"
              >
                <Play className="h-3.5 w-3.5" />
                加入链接到队列
              </Button>
            </div>

            {/* 统一导入队列（文件 + 链接按顺序） */}
            {importQueue.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-100 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-medium text-gray-800">导入队列</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {importPaused ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setImportQueuePaused(false)}
                        disabled={!hasQueued && !hasRunning}
                      >
                        <Play className="h-3 w-3" />
                        继续
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setImportQueuePaused(true)}
                        disabled={!hasQueued && !hasRunning}
                      >
                        <Pause className="h-3 w-3" />
                        暂停
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 text-amber-800 border-amber-200"
                      onClick={cancelAllQueuedImportRows}
                      disabled={!hasQueued}
                    >
                      <Square className="h-3 w-3" />
                      取消排队
                    </Button>
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className="shrink-0">并发</span>
                      <Select
                        value={String(importConcurrency)}
                        onValueChange={(v) => setImportConcurrency(Number(v) as 1 | 2 | 3)}
                      >
                        <SelectTrigger className="h-7 w-[4.5rem] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1（顺序）</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {importQueueBusy && !importPaused && (
                      <span className="text-xs text-[#1677ff] flex items-center gap-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        执行中…
                      </span>
                    )}
                    {importPaused && hasQueued && (
                      <span className="text-xs text-amber-700">已暂停</span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-gray-500"
                      onClick={clearFinishedImportRows}
                      disabled={
                        !importQueue.some((r) =>
                          ["success", "duplicate", "failed", "cancelled"].includes(r.status)
                        )
                      }
                    >
                      清除已完成
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">
                  自队列头部按批次取出任务；并发为 1 时等同于严格串行。暂停后当前批次仍会跑完，不再开新批次。「取消排队」仅标记尚未开始的任务。
                </p>
                <div className="space-y-2 max-h-[min(60vh,480px)] overflow-y-auto">
                  {importQueue.map((r, i) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-3 p-3 rounded-md bg-gray-50 border border-gray-100"
                    >
                      <div className="text-[10px] text-gray-400 w-5 shrink-0 pt-0.5">{i + 1}</div>
                      <div className="mt-0.5 shrink-0">
                        {r.kind === "file" ? (
                          <FileUp className="h-4 w-4 text-slate-500" />
                        ) : (
                          <Link2 className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-gray-400 mb-0.5">
                          {r.kind === "file" ? "文件" : "链接"} ·{" "}
                          {r.status === "queued" && "排队中"}
                          {r.status === "running" && "执行中"}
                          {r.status === "success" && "成功"}
                          {r.status === "duplicate" && "已存在"}
                          {r.status === "failed" && "失败"}
                          {r.status === "cancelled" && "已取消"}
                        </div>
                        {r.title && (
                          <div className="text-xs font-medium text-gray-800 mb-0.5 truncate">{r.title}</div>
                        )}
                        <div className="text-xs text-gray-600 break-all font-mono">
                          {r.relativePath || r.label}
                        </div>
                        {r.kind === "url" && r.url && r.url !== r.label && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">{r.url}</div>
                        )}
                        {r.error && <div className="text-xs text-red-500 mt-0.5">{r.error}</div>}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {r.status === "running" && (
                          <Loader2 className="h-4 w-4 animate-spin text-[#1677ff]" />
                        )}
                        {r.status === "queued" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
                            title="从队列移除"
                            onClick={() => removeImportQueueRow(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {r.status === "success" && typeof r.articleId === "number" && (
                          <button
                            type="button"
                            className="text-xs text-[#1677ff] hover:underline"
                            onClick={() => setLocation(`/news/${r.articleId}`)}
                          >
                            查看资讯
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Jobs Tab */}
        {activeTab === "jobs" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-[#1677ff]" />
              <span className="text-xs text-gray-500">总任务数</span>
            </div>
            <div className="text-2xl font-bold text-gray-800">{jobs?.length ?? 0}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-xs text-gray-500">已启用</span>
            </div>
            <div className="text-2xl font-bold text-gray-800">
              {jobs?.filter((j) => j.isEnabled).length ?? 0}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="h-4 w-4 text-gray-400" />
                <span className="text-xs text-gray-500">已暂停</span>
            </div>
            <div className="text-2xl font-bold text-gray-800">
              {jobs?.filter((j) => !j.isEnabled).length ?? 0}
              </div>
            </div>
          </div>

          {/* Jobs List */}
          <div className="bg-white rounded-lg border border-gray-100">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">抓取任务列表</span>
          </div>

          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : !jobs || jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Clock className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">暂无抓取任务</p>
              <p className="text-xs mt-1 text-gray-300">点击右上角"新建抓取任务"开始配置</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {jobs.map((job) => (
                <div key={job.id}>
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Job Info */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          job.source === "Preqin"
                            ? "bg-purple-50 text-purple-600"
                            : "bg-orange-50 text-orange-600"
                        }`}>
                          <Globe className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium text-gray-800">{job.name}</span>
                            <Badge
                              className={`text-xs px-1.5 py-0 ${
                                job.source === "Preqin"
                                  ? "bg-purple-50 text-purple-700 border-purple-200"
                                  : "bg-orange-50 text-orange-700 border-orange-200"
                              }`}
                            >
                              {job.source}
                            </Badge>
                            {job.source === "Preqin" && job.hasAuthPassword && (
                              <Badge
                                variant="outline"
                                className="text-xs px-1.5 py-0 text-emerald-700 border-emerald-200 bg-emerald-50"
                              >
                                已配置登录
                              </Badge>
                            )}
                            {!job.isEnabled && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 text-gray-400">
                                已暂停
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate mb-1.5">{job.url}</p>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {job.cronExpr}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              抓取近 {job.rangeInDays} 天
                            </span>
                            {job.lastRunAt && (
                              <span className="text-gray-400">
                                上次执行: {format(new Date(job.lastRunAt), "MM/dd HH:mm", { locale: zhCN })}
                              </span>
                            )}
                            <StatusBadge status={job.lastRunStatus} />
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 text-gray-500 hover:text-[#1677ff]"
                          onClick={() => setExpandedLogs(expandedLogs === job.id ? null : job.id)}
                        >
                          {expandedLogs === job.id ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                          日志
                        </Button>
                        {runningJobId === job.id ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1 text-red-600 hover:text-red-700"
                            onClick={() => handleStopRun(job.id)}
                            disabled={stopRunMutation.isPending}
                          >
                            {stopRunMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                            停止
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1 text-gray-500 hover:text-green-600"
                            onClick={() => handleRunNow(job.id)}
                            disabled={runNowMutation.isPending}
                          >
                            {runNowMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                            立即执行
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 text-gray-500 hover:text-amber-600"
                          onClick={() =>
                            toggleEnabledMutation.mutate({
                              id: job.id,
                              isEnabled: !job.isEnabled,
                            })
                          }
                        >
                          {job.isEnabled ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {job.isEnabled ? "暂停" : "启用"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 text-gray-500 hover:text-[#1677ff]"
                          onClick={() => openEdit(job)}
                        >
                          <Edit className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 text-gray-500 hover:text-red-500"
                          onClick={() => setDeletingJobId(job.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Logs Expansion */}
                  {expandedLogs === job.id && (
                    <div className="bg-gray-50 border-t border-gray-100 px-5 py-3">
                      <div className="flex items-center gap-2 mb-3">
                        <Activity className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-xs font-medium text-gray-600">执行日志</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5 text-xs text-gray-400 hover:text-gray-600 ml-auto"
                          onClick={() => refetchLogs()}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </div>
                      {!logs || logs.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">暂无执行记录</p>
                      ) : (
                        <div className="space-y-1.5">
                          {logs.slice(0, 10).map((log) => (
                            <div
                              key={log.id}
                              className="bg-white rounded border border-gray-100 px-3 py-2 flex items-center gap-3 text-xs"
                            >
                              <LogStatusBadge status={log.status} />
                              <span className="text-gray-500 shrink-0">
                                {format(new Date(log.startedAt), "MM/dd HH:mm:ss", { locale: zhCN })}
                              </span>
                              {log.articlesFound !== null && (
                                <span className="text-gray-500">
                                  发现 {log.articlesFound} 条 / 入库 {log.articlesAdded ?? 0} 条
                                </span>
                              )}
                              {log.message && (
                                <span className="text-gray-400 truncate flex-1">{log.message}</span>
                              )}
                              {log.finishedAt && (
                                <span className="text-gray-300 shrink-0">
                                  耗时 {Math.round((new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)}s
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>



          {/* Info Card */}
          <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg px-5 py-4">
            <div className="flex items-start gap-3">
              <Clock className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-700 mb-1">关于定时任务</p>
                <p className="text-xs text-blue-600 leading-relaxed">
                  每个任务对应一个资讯列表页（如 pitchbook.com/news）。点击"立即执行"时，系统会先提取链接并按任务的时间区间过滤，再按队列单线程逐篇导入；
                  每导入 1 篇会等待 30 秒后处理下一篇。执行日志可查看“发现 N 篇 / 符合 N 篇 / 导入 N 篇”的进度结果。
                </p>
              </div>
            </div>
          </div>
          </>
        )}

        {activeTab === "records" && user?.role === "admin" && (
          <div className="max-w-5xl space-y-4">
            <div className="bg-white rounded-lg border border-gray-100 p-5">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  <Newspaper className="h-4 w-4 text-[#1677ff]" />
                  资讯库记录
                </div>
                <Select
                  value={recordVisibility}
                  onValueChange={(v) => {
                    setRecordVisibility(v as "all" | "visible" | "hidden");
                    setRecordAdminPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue placeholder="可见性" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="visible">前台展示中</SelectItem>
                    <SelectItem value="hidden">已隐藏</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-400 ml-auto">
                  删除 / 隐藏 / 恢复对全员生效；隐藏后列表与详情均不可访问（管理员仍可在此查看）。
                </span>
              </div>

              {!adminArticleData ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : adminArticleData.items.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">暂无记录</p>
              ) : (
                <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
                  {adminArticleData.items.map((row) => (
                    <div
                      key={row.id}
                      className="px-4 py-3 flex flex-wrap items-start gap-3 bg-white hover:bg-gray-50/80"
                    >
                      <div className="flex-1 min-w-0">
                        <button
                          type="button"
                          className="text-left text-sm font-medium text-gray-800 hover:text-[#1677ff]"
                          onClick={() => setLocation(`/news/${row.id}`)}
                        >
                          {row.title}
                        </button>
                        <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-gray-500">
                          <span>ID {row.id}</span>
                          <span>
                            {row.recordCategory === "report" ? "报告" : "资讯"}
                          </span>
                          <span>{row.source}</span>
                          <span>
                            {row.isHidden ? (
                              <span className="text-amber-600 inline-flex items-center gap-0.5">
                                <EyeOff className="h-3 w-3" /> 已隐藏
                              </span>
                            ) : (
                              <span className="text-emerald-600 inline-flex items-center gap-0.5">
                                <Eye className="h-3 w-3" /> 展示中
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 shrink-0">
                        {row.isHidden ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={setArticleHiddenMutation.isPending}
                            onClick={() =>
                              setArticleHiddenMutation.mutate({ id: row.id, hidden: false })
                            }
                          >
                            恢复展示
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={setArticleHiddenMutation.isPending}
                            onClick={() =>
                              setArticleHiddenMutation.mutate({ id: row.id, hidden: true })
                            }
                          >
                            隐藏
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          disabled={deleteArticleAdminMutation.isPending}
                          onClick={() => {
                            if (
                              !confirm(
                                `确定删除「${row.title.slice(0, 40)}${row.title.length > 40 ? "…" : ""}」？不可恢复。`
                              )
                            ) {
                              return;
                            }
                            deleteArticleAdminMutation.mutate({ id: row.id });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {adminArticleData && adminArticleData.total > 25 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={recordAdminPage <= 1}
                    onClick={() => setRecordAdminPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <span className="text-xs text-gray-500">
                    第 {recordAdminPage} 页 / 共 {Math.ceil(adminArticleData.total / 25)} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={recordAdminPage >= Math.ceil(adminArticleData.total / 25)}
                    onClick={() => setRecordAdminPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Create / Edit Dialog */}
      <Dialog
        open={showCreateDialog || !!editingJob}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setEditingJob(null);
            setClearPreqinPassword(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingJob ? "编辑抓取任务" : "新建抓取任务"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Name */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">任务名称</label>
              <Input
                placeholder="例如：Preqin 每日资讯抓取"
                value={form.name}
                onChange={(e) => handleFormChange("name", e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* Source */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">数据来源</label>
              <Select
                value={form.source}
                onValueChange={(v) => handleFormChange("source", v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Preqin">Preqin</SelectItem>
                  <SelectItem value="Pitchbook">Pitchbook</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* URL */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">资讯列表页 URL</label>
              <Input
                placeholder={
                  form.source === "Preqin"
                    ? "https://www.preqin.com/insights"
                    : "https://pitchbook.com/news"
                }
                value={form.url}
                onChange={(e) => handleFormChange("url", e.target.value)}
                className="h-9 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">填写资讯列表页的 URL，系统将自动提取页面内所有文章链接并逐篇导入（每次最多导入 20 篇）</p>
            </div>

            {form.source === "Preqin" && (
              <div className="rounded-lg border border-purple-100 bg-purple-50/50 px-3 py-3 space-y-3">
                <p className="text-xs font-medium text-purple-900">
                  Preqin 需登录时填写（密码使用 JWT_SECRET 加密存储，不会回显）
                </p>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1.5 block">
                    登录邮箱 / 用户名
                  </label>
                  <Input
                    placeholder="与 Preqin 网站登录一致"
                    value={form.authUsername}
                    onChange={(e) => handleFormChange("authUsername", e.target.value)}
                    className="h-9 text-sm"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1.5 block">
                    密码
                  </label>
                  <Input
                    type="password"
                    placeholder={
                      editingJob?.hasAuthPassword
                        ? "留空保留已保存密码；填写则更新"
                        : "选填，列表页与文章页需登录时建议填写"
                    }
                    value={form.authPassword}
                    onChange={(e) => handleFormChange("authPassword", e.target.value)}
                    className="h-9 text-sm"
                    autoComplete="new-password"
                  />
                </div>
                {editingJob?.hasAuthPassword && (
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clearPreqinPassword}
                      onChange={(e) => setClearPreqinPassword(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    清除已保存的密码
                  </label>
                )}
              </div>
            )}

            {/* Cron */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">执行频率</label>
              <Select
                value={form.cronPreset}
                onValueChange={(v) => handleFormChange("cronPreset", v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.cronPreset === "custom" && (
                <Input
                  placeholder="Cron 表达式，例如：0 9 * * 1-5"
                  value={form.cronExpr}
                  onChange={(e) => handleFormChange("cronExpr", e.target.value)}
                  className="h-9 text-sm mt-2 font-mono"
                />
              )}
              <p className="text-xs text-gray-400 mt-1">
                当前表达式：<code className="bg-gray-100 px-1 rounded">{form.cronPreset === "custom" ? form.cronExpr : form.cronPreset}</code>
              </p>
            </div>

            {/* Range */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">抓取时间区间</label>
              <Select
                value={String(form.rangeInDays)}
                onValueChange={(v) => handleFormChange("rangeInDays", Number(v))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-1">每次执行时抓取距当前时间该区间内的资讯</p>
            </div>

            {/* Enabled */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-600">立即启用</label>
              <button
                type="button"
                onClick={() => handleFormChange("isEnabled", !form.isEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  form.isEnabled ? "bg-[#1677ff]" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    form.isEnabled ? "translate-x-4" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCreateDialog(false);
                setEditingJob(null);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-[#1677ff] hover:bg-[#0958d9]"
              onClick={() => handleSubmit(!!editingJob)}
              disabled={!form.name || !form.url || createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              {editingJob ? "保存修改" : "创建任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deletingJobId !== null} onOpenChange={(open) => !open && setDeletingJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该抓取任务将停止执行，相关执行日志也将一并删除。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => deletingJobId && deleteMutation.mutate({ id: deletingJobId })}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
