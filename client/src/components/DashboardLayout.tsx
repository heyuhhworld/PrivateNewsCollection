import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl, isOAuthLoginConfigured } from "@/const";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/useMobile";
import {
  MessageCircle,
  Minimize2,
  Newspaper,
  ChevronDown,
  LogOut,
  PanelLeft,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import NewsBot from "./NewsBot";

const menuItems = [
  { icon: Newspaper, label: "资讯", path: "/news", beta: true },
  { icon: Settings, label: "系统管理", path: "/system" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 180;
const MAX_WIDTH = 320;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const utils = trpc.useUtils();
  const [authMode, setAuthMode] = useState<"login" | "register" | "changePassword">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const emailLoginMutation = trpc.auth.emailLogin.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      window.location.href = "/news";
    },
  });
  const emailRegisterMutation = trpc.auth.emailRegister.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      window.location.href = "/news";
    },
  });
  const emailChangePasswordMutation = trpc.auth.emailChangePassword.useMutation();

  const isAuthPending =
    emailLoginMutation.isPending ||
    emailRegisterMutation.isPending ||
    emailChangePasswordMutation.isPending;

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    const submitEmailAuth = async () => {
      try {
        if (authMode === "register") {
          await emailRegisterMutation.mutateAsync({
            name: name.trim(),
            email,
            password,
          });
          toast.success("注册成功，已自动登录");
        } else if (authMode === "changePassword") {
          if (newPassword !== confirmNewPassword) {
            toast.error("两次输入的新密码不一致");
            return;
          }
          await emailChangePasswordMutation.mutateAsync({
            email,
            currentPassword: password,
            newPassword,
          });
          toast.success("密码已更新，请使用新密码登录");
          setAuthMode("login");
          setPassword("");
          setNewPassword("");
          setConfirmNewPassword("");
        } else {
          await emailLoginMutation.mutateAsync({
            email,
            password,
          });
          toast.success("登录成功");
        }
      } catch (e: any) {
        toast.error(e?.message ?? "操作失败");
      }
    };

    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f5f7fa]">
        <div className="flex flex-col items-center gap-6 p-10 max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#1677ff] flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-[#1677ff] tracking-wide">IPMS</span>
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-xl font-semibold text-gray-800">投资项目管理系统</h1>
            <p className="text-sm text-gray-500">请登录以访问系统</p>
            {!isOAuthLoginConfigured() && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-left leading-relaxed">
                当前未配置 OAuth 登录地址（<code className="text-[11px]">VITE_OAUTH_PORTAL_URL</code>
                ）。请在 .env 中填写门户基地址与 <code className="text-[11px]">VITE_APP_ID</code>
                ，并重启开发服务。本地调试也可在服务端 .env 设置{" "}
                <code className="text-[11px]">DEV_ALLOW_AUTH_BYPASS=1</code> 后重启以跳过登录。
              </p>
            )}
          </div>
          <div className="w-full space-y-3">
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-200 p-1 bg-gray-50">
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`h-8 text-xs sm:text-sm rounded-md ${authMode === "login" ? "bg-white text-[#1677ff] shadow-sm" : "text-gray-500"}`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("register")}
                className={`h-8 text-xs sm:text-sm rounded-md ${authMode === "register" ? "bg-white text-[#1677ff] shadow-sm" : "text-gray-500"}`}
              >
                注册
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("changePassword")}
                className={`h-8 text-xs sm:text-sm rounded-md ${authMode === "changePassword" ? "bg-white text-[#1677ff] shadow-sm" : "text-gray-500"}`}
              >
                改密码
              </button>
            </div>
            {authMode === "register" && (
              <Input
                placeholder="姓名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10"
              />
            )}
            <Input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
            />
            <Input
              type="password"
              placeholder={
                authMode === "changePassword" ? "当前密码" : "密码（至少 8 位）"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
              autoComplete={authMode === "changePassword" ? "current-password" : undefined}
            />
            {authMode === "changePassword" && (
              <>
                <Input
                  type="password"
                  placeholder="新密码（至少 8 位）"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10"
                  autoComplete="new-password"
                />
                <Input
                  type="password"
                  placeholder="确认新密码"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="h-10"
                  autoComplete="new-password"
                />
              </>
            )}
            <Button
              onClick={() => void submitEmailAuth()}
              disabled={
                isAuthPending ||
                !email.trim() ||
                !password.trim() ||
                (authMode === "register" && !name.trim()) ||
                (authMode === "changePassword" &&
                  (!newPassword.trim() ||
                    !confirmNewPassword.trim() ||
                    newPassword.length < 8))
              }
              size="lg"
              className="w-full bg-[#1677ff] hover:bg-[#0958d9] text-white shadow-md"
            >
              {isAuthPending
                ? "提交中..."
                : authMode === "register"
                  ? "注册并登录"
                  : authMode === "changePassword"
                    ? "更新密码"
                    : "登录"}
            </Button>
            <div className="pt-1 border-t border-gray-100">
              <Button
                variant="outline"
                onClick={() => {
                  const url = getLoginUrl();
                  if (!url) {
                    toast.error(
                      "未配置登录门户：请设置 VITE_OAUTH_PORTAL_URL（及 VITE_APP_ID），保存后重启；或使用 DEV_ALLOW_AUTH_BYPASS=1 做本地免登录。"
                    );
                    return;
                  }
                  window.location.href = url;
                }}
                size="sm"
                className="w-full"
              >
                使用 OAuth 登录
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [botOpen, setBotOpen] = useState(false);
  const [botSize, setBotSize] = useState({ width: 380, height: 560 });
  const [isBotResizing, setIsBotResizing] = useState(false);
  const botResizeStartRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const isNewsRoute = location === "/news" || /^\/news\/\d+$/.test(location);
  const detailMatch = location.match(/^\/news\/(\d+)$/);
  const currentArticleId = detailMatch ? Number(detailMatch[1]) : undefined;

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  useEffect(() => {
    if (!isBotResizing) return;
    const onMove = (e: MouseEvent) => {
      const s = botResizeStartRef.current;
      if (!s) return;
      const nextWidth = Math.max(320, Math.min(760, s.width + (s.x - e.clientX)));
      const nextHeight = Math.max(420, Math.min(window.innerHeight - 80, s.height + (s.y - e.clientY)));
      setBotSize({ width: nextWidth, height: nextHeight });
    };
    const onUp = () => {
      setIsBotResizing(false);
      botResizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isBotResizing]);

  // Determine active path (support /news/:id etc.)
  const activePath = menuItems.find((item) => {
    if (item.path === "/") return location === "/";
    return location.startsWith(item.path);
  })?.path;

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r border-gray-200 bg-white"
          disableTransition={isResizing}
        >
          {/* Logo Header */}
          <SidebarHeader className="h-14 justify-center border-b border-gray-100">
            <div className="flex items-center gap-2 px-3">
              <div className="w-8 h-8 rounded-lg bg-[#1677ff] flex items-center justify-center shrink-0">
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              {!isCollapsed && (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="font-bold text-[#1677ff] text-base tracking-wide">IPMS</span>
                  <button
                    onClick={toggleSidebar}
                    className="h-7 w-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors"
                    aria-label="收起侧边栏"
                  >
                    <PanelLeft className="h-4 w-4 text-gray-400" />
                  </button>
                </div>
              )}
              {isCollapsed && (
                <button
                  onClick={toggleSidebar}
                  className="h-7 w-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors absolute right-2"
                  aria-label="展开侧边栏"
                >
                  <PanelLeft className="h-4 w-4 text-gray-400" />
                </button>
              )}
            </div>
          </SidebarHeader>

          {/* Navigation Menu */}
          <SidebarContent className="gap-0 pt-2">
            <SidebarMenu className="px-2 gap-0.5">
              {menuItems.map((item) => {
                const isActive = activePath === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 rounded-lg transition-all font-normal text-[13px] ${
                        isActive
                          ? "bg-[#e8f0fe] text-[#1677ff] font-medium"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                      }`}
                    >
                      <item.icon
                        className={`h-4 w-4 shrink-0 ${isActive ? "text-[#1677ff]" : "text-gray-400"}`}
                      />
                      <span className="flex items-center gap-1.5 min-w-0">
                        {item.label}
                        {"beta" in item && item.beta ? (
                          <span className="text-[10px] font-medium px-1.5 py-0 rounded bg-blue-100 text-blue-600 shrink-0">
                            Beta
                          </span>
                        ) : null}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          {/* User Footer */}
          <SidebarFooter className="p-3 border-t border-gray-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-gray-50 transition-colors w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1677ff]">
                  <Avatar className="h-8 w-8 border border-gray-200 shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-[#e8f0fe] text-[#1677ff]">
                      {user?.name?.charAt(0).toUpperCase() ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-gray-800 leading-none">
                        {user?.name || "用户"}
                      </p>
                      <p className="text-xs text-gray-400 truncate mt-1">
                        {user?.email || ""}
                      </p>
                    </div>
                  )}
                  {!isCollapsed && (
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-red-500 focus:text-red-500"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* Resize Handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[#1677ff]/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (!isCollapsed) setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-[#f5f7fa]">
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-white px-4 sticky top-0 z-40 shadow-sm">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-8 w-8 rounded-lg" />
              <span className="font-medium text-gray-700">
                {menuItems.find((m) => location.startsWith(m.path))?.label ?? "IPMS"}
              </span>
            </div>
          </div>
        )}
        <main className="flex-1 min-h-screen">{children}</main>

        {isNewsRoute && (
          <>
            {botOpen && (
              <div
                className="fixed bottom-24 right-6 z-50 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
                style={{
                  width: `${botSize.width}px`,
                  height: `${botSize.height}px`,
                  maxWidth: "calc(100vw - 1.5rem)",
                  maxHeight: "calc(100vh - 8rem)",
                }}
              >
                <div className="absolute right-3 top-3 z-10">
                  <button
                    type="button"
                    onClick={() => setBotOpen(false)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    title="最小化"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <NewsBot
                  onClose={() => setBotOpen(false)}
                  articleId={currentArticleId}
                />
                <div
                  className="absolute bottom-0 left-0 h-4 w-4 cursor-nwse-resize"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    botResizeStartRef.current = {
                      x: e.clientX,
                      y: e.clientY,
                      width: botSize.width,
                      height: botSize.height,
                    };
                    setIsBotResizing(true);
                  }}
                  title="拖拽调整聊天窗大小"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setBotOpen((v) => !v)}
              className="fixed bottom-6 right-6 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#1677ff] text-white shadow-xl hover:bg-[#0958d9] transition-colors"
              title={
                currentArticleId
                  ? "唤起 AI 助手（当前文章问答）"
                  : "唤起 AI 助手"
              }
            >
              <MessageCircle className="h-6 w-6" />
            </button>
          </>
        )}
      </SidebarInset>
    </>
  );
}
