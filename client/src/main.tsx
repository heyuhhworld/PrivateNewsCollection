import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  const login = getLoginUrl();
  if (login) window.location.href = login;
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

/** 开发环境：切回标签时发现 dev 已关，避免「脚本验证过了但页面仍 Failed to fetch」无提示 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  const BACKEND_WARN_ID = "ipms-backend-health";
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void fetch("/api/health", { credentials: "include", cache: "no-store" })
      .then((r) => {
        if (!r.ok) {
          void import("sonner").then(({ toast }) => {
            toast.error(
              "后端无响应（/api/health 异常），列表可能无法加载。请检查终端里 pnpm dev 是否在跑，或执行 pnpm run dev:restart",
              { id: BACKEND_WARN_ID, duration: 9000 }
            );
          });
        }
      })
      .catch(() => {
        void import("sonner").then(({ toast }) => {
          toast.error(
            "无法连接后端（与 Failed to fetch 同源）。请确认 pnpm dev 已启动且地址栏端口与终端一致；可执行 pnpm run dev:verify 做完整探活",
            { id: BACKEND_WARN_ID, duration: 11000 }
          );
        });
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
