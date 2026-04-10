import { trpc } from "@/lib/trpc";
import { BarChart3, BookOpen, FileText, Star, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: newsData } = trpc.news.list.useQuery({ pageSize: 5 });

  return (
    <div className="p-6 space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-semibold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">投资项目管理系统概览</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="最新资讯" value={newsData?.total ?? "--"} color="bg-[#1677ff]" />
        <StatCard icon={FileText} label="在管项目" value="578" color="bg-[#52c41a]" />
        <StatCard icon={Star} label="基金评价" value="42" color="bg-[#faad14]" />
        <StatCard icon={TrendingUp} label="本月新增" value="12" color="bg-[#722ed1]" />
      </div>

      {/* Recent News */}
      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#1677ff]" />
            最新资讯
          </h2>
          <button
            onClick={() => setLocation("/news")}
            className="text-xs text-[#1677ff] hover:text-[#0958d9] transition-colors"
          >
            查看全部 →
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {newsData?.items.slice(0, 5).map((article) => (
            <div
              key={article.id}
              onClick={() => setLocation(`/news/${article.id}`)}
              className="px-5 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 group-hover:text-[#1677ff] transition-colors line-clamp-1 font-medium">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        article.source === "Preqin"
                          ? "bg-purple-50 text-purple-600"
                          : "bg-orange-50 text-orange-600"
                      }`}
                    >
                      {article.source}
                    </span>
                    {article.strategy && (
                      <span className="text-xs text-gray-400">{article.strategy}</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {format(new Date(article.publishedAt), "MM/dd", { locale: zhCN })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Access */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "图表分析", path: "/charts", icon: BarChart3, desc: "基金业绩与市场分析" },
          { label: "基金评价", path: "/fund-evaluation", icon: Star, desc: "基金筛选与评级" },
          { label: "项目管理", path: "/projects", icon: FileText, desc: "在管项目全览" },
        ].map((item) => (
          <div
            key={item.path}
            onClick={() => setLocation(item.path)}
            className="bg-white rounded-xl border border-gray-100 p-5 cursor-pointer hover:border-[#1677ff]/30 hover:shadow-sm transition-all group"
          >
            <item.icon className="h-6 w-6 text-[#1677ff] mb-3" />
            <p className="text-sm font-semibold text-gray-700 group-hover:text-[#1677ff] transition-colors">
              {item.label}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
