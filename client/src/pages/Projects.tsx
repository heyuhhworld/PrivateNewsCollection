import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Filter,
  MoreHorizontal,
  RefreshCw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

const PROJECTS = [
  { code: "140115", name: "海富通（香港）中国人民...", manager: "邹斌", status: "募集阶段", flow: "营销中", supervisor: "隋艳", region: "香港", fastTrack: "否", team: "其他" },
  { code: "140120", name: "歌斐海外全资产类别配置...", manager: "庄益燊", status: "潜在项目", flow: "潜在项目", supervisor: "隋艳", region: "香港", fastTrack: "否", team: "国际二级基金部" },
  { code: "140126", name: "歌斐全球信贷母基金", manager: "苏锦聪", status: "项目成立", flow: "存续中", supervisor: "苏锦聪", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140168", name: "歌斐海外弘晖医疗基金", manager: "苏锦聪", status: "项目成立", flow: "存续中", supervisor: "苏锦聪", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140216", name: "歌斐海外地产精选基金一期", manager: "茅琦峰", status: "项目成立", flow: "存续中", supervisor: "茅琦峰", region: "香港", fastTrack: "否", team: "国际私募一级基金部", highlight: true },
  { code: "140250", name: "澳大利亚投资移民计划", manager: "庄益燊", status: "项目成立", flow: "营销中", supervisor: "姚博文", region: "香港", fastTrack: "否", team: "其他" },
  { code: "140314", name: "铁狮门欧美商业地产基金", manager: "茅琦峰", status: "项目成立", flow: "存续中", supervisor: "茅琦峰", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140345", name: "歌斐海外盘实信贷基金", manager: "苏锦聪", status: "项目成立", flow: "存续中", supervisor: "苏锦聪", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140411", name: "歌斐海外万和股权质押基金II", manager: "苏锦聪", status: "项目成立", flow: "存续中", supervisor: "苏锦聪", region: "香港", fastTrack: "否", team: "国际二级基金部" },
  { code: "140412", name: "歌斐海外全球并购母基金", manager: "李青", status: "项目成立", flow: "存续中", supervisor: "李青", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140413", name: "歌斐海外凯雷欧洲并购基金", manager: "李青", status: "项目成立", flow: "存续中", supervisor: "李青", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140431", name: "歌斐海外德太并购基金", manager: "李青", status: "项目成立", flow: "存续中", supervisor: "李青", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140447", name: "歌斐海外五岳移动互联网...", manager: "苏锦聪", status: "项目成立", flow: "存续中", supervisor: "苏锦聪", region: "香港", fastTrack: "否", team: "国际私募一级基金部" },
  { code: "140469", name: "荷宝水资源基金", manager: "庄益燊", status: "项目成立", flow: "存续中", supervisor: "隋艳", region: "香港", fastTrack: "否", team: "其他" },
  { code: "140471", name: "景林环球基金", manager: "苏锦聪", status: "项目成立", flow: "存续中", supervisor: "苏锦聪", region: "香港", fastTrack: "否", team: "国际二级基金部" },
];

const TABS = ["工作台", "项目开发", "Kimi Moonshot AI 项目基金", "Keppel数据中心基金"];

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    "募集阶段": "bg-blue-50 text-blue-600 border-blue-200",
    "潜在项目": "bg-gray-50 text-gray-500 border-gray-200",
    "项目成立": "bg-green-50 text-green-600 border-green-200",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colorMap[status] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
      {status}
    </span>
  );
}

function FlowBadge({ flow }: { flow: string }) {
  const colorMap: Record<string, string> = {
    "营销中": "text-orange-500",
    "潜在项目": "text-gray-400",
    "存续中": "text-green-500",
  };
  return <span className={`text-xs ${colorMap[flow] ?? "text-gray-400"}`}>{flow}</span>;
}

export default function Projects() {
  const [activeTab, setActiveTab] = useState("项目开发");
  const [search, setSearch] = useState("");

  const filtered = PROJECTS.filter(
    (p) =>
      p.name.includes(search) ||
      p.code.includes(search) ||
      p.manager.includes(search)
  );

  return (
    <div className="flex flex-col h-screen bg-[#f5f7fa]">
      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 px-4 flex items-center gap-1 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3.5 text-sm transition-colors border-b-2 ${
              activeTab === tab
                ? "border-[#1677ff] text-[#1677ff] font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            默认视图
            <span className="text-gray-400">▾</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            保存
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => toast.info("功能开发中")}
          >
            显示结束项目
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => toast.info("功能开发中")}
          >
            显示失效项目
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-40 text-xs border-gray-200"
            />
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <RefreshCw className="h-3.5 w-3.5 text-gray-400" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ZoomIn className="h-3.5 w-3.5 text-gray-400" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Download className="h-3.5 w-3.5 text-gray-400" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-[#fafafa] border-b border-gray-200 z-10">
            <tr>
              {[
                "项目代码",
                "项目名称",
                "产品经理/项目经理",
                "项目状态",
                "流转节点",
                "产品总监/项目总监",
                "业务所属板块",
                "是否FastTrack",
                "项目团队",
                "操作",
              ].map((col) => (
                <th
                  key={col}
                  className="text-left text-xs font-medium text-gray-500 px-4 py-3 whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {filtered.map((project) => (
              <tr
                key={project.code}
                className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${
                  project.highlight ? "bg-blue-50/50" : ""
                }`}
              >
                <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                  {project.code}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#1677ff] hover:underline cursor-pointer">
                    {project.name}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#1677ff] hover:underline cursor-pointer">
                    {project.manager}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={project.status} />
                </td>
                <td className="px-4 py-3">
                  <FlowBadge flow={project.flow} />
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#1677ff] hover:underline cursor-pointer">
                    {project.supervisor}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{project.region}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{project.fastTrack}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{project.team}</td>
                <td className="px-4 py-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => toast.info("功能开发中")}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-white border-t border-gray-100 text-xs text-gray-400">
          总计：578
        </div>
      </div>
    </div>
  );
}
