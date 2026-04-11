import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Streamdown } from "streamdown";
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
} from "lucide-react";
import { toast } from "sonner";

export default function Briefing() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: latest, isLoading, refetch } = trpc.briefing.latest.useQuery();
  const { data: pushConfig } = trpc.briefing.pushConfig.useQuery();
  const { data: subs, refetch: refetchSubs } =
    trpc.briefing.subscriptions.useQuery(undefined, { enabled: isAdmin });
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

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Header */}
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

      {/* Cron info */}
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

      {/* Briefing content */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm min-h-[200px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            加载中…
          </div>
        ) : latest?.body ? (
          <div className="prose prose-sm max-w-none text-gray-800 [&_a]:text-[#1677ff]">
            <Streamdown>{latest.body}</Streamdown>
          </div>
        ) : (
          <div className="text-center py-16 text-gray-500 text-sm">
            暂无简报。
            {isAdmin ? " 请点击「重新生成」。" : " 请联系管理员生成首份简报。"}
          </div>
        )}
      </div>

      {/* Subscription management (admin only) */}
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
