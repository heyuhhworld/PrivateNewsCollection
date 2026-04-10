import { useAuth } from "@/_core/hooks/useAuth";
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
  BookOpen,
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

const menuItems = [
  { icon: BookOpen, label: "资讯", path: "/news" },
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

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f5f7fa]">
        <div className="flex flex-col items-center gap-8 p-10 max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-100">
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
          <Button
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
            size="lg"
            className="w-full bg-[#1677ff] hover:bg-[#0958d9] text-white shadow-md"
          >
            登录
          </Button>
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
                      <span>{item.label}</span>
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
      </SidebarInset>
    </>
  );
}
