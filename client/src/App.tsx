import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import News from "./pages/News";
import NewsDetail from "./pages/NewsDetail";
import Projects from "./pages/Projects";
import PlaceholderPage from "./pages/PlaceholderPage";
import SystemManagement from "./pages/SystemManagement";
import {
  BarChart3,
  Building2,
  Settings,
  Star,
} from "lucide-react";

function Router() {
  return (
    <Switch>
      {/* 直接打开 /index.html 时与首页路由不一致，统一回到 / */}
      <Route path="/index.html">
        <Redirect to="/" />
      </Route>

      {/* News routes - no layout wrapper needed (full screen) */}
      <Route path="/news/:id">
        {(params) => (
          <DashboardLayout>
            <NewsDetail />
          </DashboardLayout>
        )}
      </Route>
      <Route path="/news">
        <DashboardLayout>
          <News />
        </DashboardLayout>
      </Route>

      {/* Root redirect */}
      <Route path="/">
        <Redirect to="/news" />
      </Route>

      {/* Projects */}
      <Route path="/projects">
        <DashboardLayout>
          <Projects />
        </DashboardLayout>
      </Route>

      {/* Charts */}
      <Route path="/charts">
        <DashboardLayout>
          <PlaceholderPage
            title="图表分析"
            description="基金业绩图表、市场趋势分析、投资组合可视化等功能"
            icon={BarChart3}
          />
        </DashboardLayout>
      </Route>

      {/* Fund Evaluation */}
      <Route path="/fund-evaluation">
        <DashboardLayout>
          <PlaceholderPage
            title="基金评价"
            description="基金筛选、评级、尽职调查报告管理等功能"
            icon={Star}
          />
        </DashboardLayout>
      </Route>

      {/* Structured HK */}
      <Route path="/structured-hk">
        <DashboardLayout>
          <PlaceholderPage
            title="结构化票据 (HK)"
            description="香港结构化票据产品管理、定价、风险分析等功能"
            icon={Building2}
          />
        </DashboardLayout>
      </Route>

      {/* Structured SG */}
      <Route path="/structured-sg">
        <DashboardLayout>
          <PlaceholderPage
            title="结构化票据 (SG)"
            description="新加坡结构化票据产品管理、定价、风险分析等功能"
            icon={Building2}
          />
        </DashboardLayout>
      </Route>

      {/* System */}
      <Route path="/system">
        <DashboardLayout>
          <SystemManagement />
        </DashboardLayout>
      </Route>

      {/* 404 */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
