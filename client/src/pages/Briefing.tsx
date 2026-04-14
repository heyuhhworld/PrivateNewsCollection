import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  applyBriefingNumericCitationLinks,
  extractBriefingNumericCitationIds,
  normalizeBriefingHeadingLabel,
  stripBriefingOriginalLinks,
} from "@/lib/briefingBodyDisplay";
import { BRIEFING_DEFAULT_SYSTEM_PROMPT } from "@shared/briefingConstants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Streamdown } from "streamdown";
import { getRehypePluginsWithOrigin } from "@/lib/streamdownPlugins";
import {
  Loader2,
  RefreshCw,
  Sparkles,
  Mail,
  Webhook,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Clock,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";

function BriefingMarkdownBody({
  markdown,
  citationTitleMap,
}: {
  markdown: string;
  citationTitleMap?: Record<number, string>;
}) {
  const [, navigate] = useLocation();
  const A = useCallback(
    (props: ComponentProps<"a">) => {
      const href = props.href ?? "";
      if (href.startsWith("/")) {
        const m = href.match(/^\/news\/(\d+)$/);
        const aid = m ? Number(m[1]) : NaN;
        const hoverTitle =
          Number.isFinite(aid) && citationTitleMap?.[aid]
            ? `查看详情：${citationTitleMap[aid]}`
            : props.title;
        return (
          <a
            {...props}
            href={href}
            title={hoverTitle}
            onClick={(e) => {
              e.preventDefault();
              navigate(href);
            }}
          />
        );
      }
      return <a {...props} />;
    },
    [navigate, citationTitleMap]
  );
  return (
    <Streamdown className="streamdown-briefing" components={{ a: A } as any} rehypePlugins={getRehypePluginsWithOrigin()}>
      {markdown}
    </Streamdown>
  );
}

export default function Briefing() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: latest, isLoading, refetch } = trpc.briefing.latest.useQuery();
  const { data: pushConfig } = trpc.briefing.pushConfig.useQuery();
  const { data: subs, refetch: refetchSubs } =
    trpc.briefing.subscriptions.useQuery(undefined, { enabled: isAdmin });
  const { data: myPrefs, refetch: refetchPrefs } = trpc.briefing.myPrefs.useQuery(
    undefined,
    { enabled: Boolean(user?.id) }
  );

  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsTab, setPrefsTab] = useState<"append" | "full">("append");
  const [draftInstruction, setDraftInstruction] = useState("");
  const [draftFullPrompt, setDraftFullPrompt] = useState("");

  const setPrefsMutation = trpc.briefing.setMyPrefs.useMutation({
    onSuccess: async () => {
      toast.success("已保存");
      await refetchPrefs();
      setPrefsOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const generate = trpc.briefing.generate.useMutation({
    onSuccess: async () => {
      toast.success("简报已生成");
      await refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const addSub = trpc.briefing.addSubscription.useMutation({
    onSuccess: () => {
      toast.success("已添加订阅");
      refetchSubs();
      setNewEmail("");
      setNewWebhook("");
    },
    onError: (e) => toast.error(e.message),
  });
  const removeSub = trpc.briefing.removeSubscription.useMutation({
    onSuccess: () => refetchSubs(),
  });
  const toggleSub = trpc.briefing.toggleSubscription.useMutation({
    onSuccess: () => refetchSubs(),
  });

  const [newEmail, setNewEmail] = useState("");
  const [newWebhook, setNewWebhook] = useState("");
  const [showSubForm, setShowSubForm] = useState(false);

  const displayBody = useMemo(() => {
    if (!latest?.body) return "";
    const stripped = stripBriefingOriginalLinks(latest.body);
    const linked = applyBriefingNumericCitationLinks(stripped);
    return normalizeBriefingHeadingLabel(linked);
  }, [latest?.body]);
  const citationIds = useMemo(
    () => (latest?.body ? extractBriefingNumericCitationIds(latest.body) : []),
    [latest?.body]
  );
  const { data: citationMeta } = trpc.briefing.citationMeta.useQuery(
    { ids: citationIds },
    { enabled: citationIds.length > 0 }
  );
  const citationTitleMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const m of citationMeta ?? []) map[m.id] = m.title;
    return map;
  }, [citationMeta]);

  function openPrefsEditor() {
    const hasFull = Boolean(myPrefs?.systemPromptCustom?.trim());
    setPrefsTab(hasFull ? "full" : "append");
    setDraftInstruction(myPrefs?.instruction ?? "");
    setDraftFullPrompt(myPrefs?.systemPromptCustom ?? "");
    setPrefsOpen(true);
  }

  async function savePrefsFromDialog() {
    if (prefsTab === "full") {
      const t = draftFullPrompt.trim();
      if (!t) {
        toast.error("自定义 System Prompt 不能为空；可切换到「追加说明」或点「恢复系统预设」。");
        return;
      }
      await setPrefsMutation.mutateAsync({
        briefingSystemPromptCustom: t,
        instruction: null,
        introCompleted: true,
      });
      return;
    }
    await setPrefsMutation.mutateAsync({
      instruction: draftInstruction.trim() || null,
      briefingSystemPromptCustom: null,
      introCompleted: true,
    });
  }

  async function resetSystemPromptToDefault() {
    await setPrefsMutation.mutateAsync({
      instruction: null,
      briefingSystemPromptCustom: null,
      introCompleted: true,
    });
    setDraftInstruction("");
    setDraftFullPrompt("");
    setPrefsTab("append");
    setPrefsOpen(false);
    toast.success("已恢复为系统默认简报提示（管理员重新生成时生效）");
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">AI 每日简报</h1>
            <p className="text-sm text-gray-500">
              基于过去 24 小时新入库资讯自动汇总
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {user?.id && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={openPrefsEditor}
            >
              <Settings2 className="h-4 w-4" />
              简报写作偏好
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
              className="gap-2"
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              重新生成
            </Button>
          )}
        </div>
      </div>

      {user?.id && (
        <p className="text-xs text-gray-500">
          在资讯页打开右侧「AI 资讯助手」，用自然语言说明偏好；发送以{" "}
          <code className="text-[11px] bg-gray-100 px-1 rounded">【简报偏好】</code> 或{" "}
          <code className="text-[11px] bg-gray-100 px-1 rounded">【简报完整提示】</code>{" "}
          开头的消息可直接保存（无需离开对话）。
        </p>
      )}

      {pushConfig && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            定时生成：<code className="text-gray-700">{pushConfig.cronExpr}</code>
          </span>
          <span className="mx-1">|</span>
          <span>
            SMTP：
            <span className={pushConfig.smtpConfigured ? "text-green-600" : "text-amber-600"}>
              {pushConfig.smtpConfigured ? "已配置" : "未配置"}
            </span>
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm min-h-[200px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            加载中…
          </div>
        ) : displayBody ? (
          <div className="prose prose-sm max-w-none text-gray-800 [&_a]:text-[#1677ff]">
            <BriefingMarkdownBody markdown={displayBody} citationTitleMap={citationTitleMap} />
          </div>
        ) : (
          <div className="text-center py-16 text-gray-500 text-sm">
            暂无简报。
            {isAdmin ? " 请点击「重新生成」。" : " 请联系管理员生成首份简报。"}
          </div>
        )}
      </div>

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>简报写作偏好（仅影响你账号下管理员「重新生成」时合并的规则）</DialogTitle>
          </DialogHeader>
          <Tabs
            value={prefsTab}
            onValueChange={(v) => setPrefsTab(v as "append" | "full")}
            className="py-1"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="append">追加说明</TabsTrigger>
              <TabsTrigger value="full">完整 System Prompt</TabsTrigger>
            </TabsList>
            <TabsContent value="append" className="space-y-2 mt-3">
              <Label className="text-xs text-gray-600">
                追加到系统默认模板后的要求（可选，最多 2000 字）。保存后会清空「完整自定义」。
              </Label>
              <Textarea
                value={draftInstruction}
                onChange={(e) => setDraftInstruction(e.target.value)}
                placeholder="例：侧重亚太私募股权与信贷；语气偏保守；每条要点尽量短。"
                className="min-h-[140px] text-sm"
                maxLength={2000}
              />
              <Button
                type="button"
                variant="link"
                className="text-xs h-auto p-0 text-amber-800"
                disabled={setPrefsMutation.isPending}
                onClick={() => void resetSystemPromptToDefault()}
              >
                恢复系统预设（清空追加说明与完整自定义）
              </Button>
            </TabsContent>
            <TabsContent value="full" className="space-y-2 mt-3">
              <Label className="text-xs text-gray-600">
                整条作为生成简报的 system 提示（覆盖默认模板，最多 12000 字）。保存后会清空「追加说明」。
              </Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDraftFullPrompt(BRIEFING_DEFAULT_SYSTEM_PROMPT.trim())}
                >
                  填入系统预设
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-amber-800 border-amber-200"
                  onClick={() => void resetSystemPromptToDefault()}
                  disabled={setPrefsMutation.isPending}
                >
                  恢复系统预设并清空
                </Button>
              </div>
              <Textarea
                value={draftFullPrompt}
                onChange={(e) => setDraftFullPrompt(e.target.value)}
                placeholder="在此粘贴或编辑完整 system 提示…"
                className="min-h-[220px] text-xs font-mono"
                maxLength={12000}
              />
            </TabsContent>
          </Tabs>
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-xs text-gray-500"
              onClick={() => setPrefsOpen(false)}
            >
              取消
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPrefsOpen(false)}>
                关闭
              </Button>
              <Button
                disabled={setPrefsMutation.isPending}
                onClick={() => void savePrefsFromDialog()}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {setPrefsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "保存"
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isAdmin && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Mail className="h-4 w-4 text-violet-500" />
              推送订阅管理
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowSubForm((v) => !v)}
            >
              <Plus className="h-3.5 w-3.5" />
              新增订阅
            </Button>
          </div>

          {showSubForm && (
            <div className="flex flex-col sm:flex-row gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <Input
                type="email"
                placeholder="邮箱地址"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                type="url"
                placeholder="Webhook URL（如企业微信/飞书/钉钉群机器人）"
                value={newWebhook}
                onChange={(e) => setNewWebhook(e.target.value)}
                className="h-9 text-sm"
              />
              <Button
                size="sm"
                disabled={
                  addSub.isPending || (!newEmail.trim() && !newWebhook.trim())
                }
                onClick={() =>
                  addSub.mutate({
                    email: newEmail.trim() || undefined,
                    webhookUrl: newWebhook.trim() || undefined,
                  })
                }
                className="shrink-0 bg-violet-600 hover:bg-violet-700"
              >
                {addSub.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "添加"
                )}
              </Button>
            </div>
          )}

          {subs && subs.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {subs.map((sub) => (
                <li
                  key={sub.id}
                  className="flex items-center justify-between py-2.5 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    {sub.email && (
                      <div className="flex items-center gap-1.5 text-sm text-gray-700">
                        <Mail className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="truncate">{sub.email}</span>
                      </div>
                    )}
                    {sub.webhookUrl && (
                      <div className="flex items-center gap-1.5 text-sm text-gray-700">
                        <Webhook className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="truncate text-xs text-gray-500">
                          {sub.webhookUrl}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        toggleSub.mutate({
                          id: sub.id,
                          isEnabled: !sub.isEnabled,
                        })
                      }
                      className="p-1 rounded hover:bg-gray-100"
                      title={sub.isEnabled ? "暂停推送" : "启用推送"}
                    >
                      {sub.isEnabled ? (
                        <ToggleRight className="h-5 w-5 text-green-500" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSub.mutate({ id: sub.id })}
                      className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400 text-center py-3">
              暂无订阅。添加邮箱或 Webhook 后，定时生成的简报将自动推送。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
