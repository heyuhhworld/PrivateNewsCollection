import { LucideIcon } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

export default function PlaceholderPage({
  title,
  description,
  icon: Icon,
}: PlaceholderPageProps) {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-[#e8f0fe] flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-[#1677ff]" />
      </div>
      <h2 className="text-lg font-semibold text-gray-700 mb-2">{title}</h2>
      <p className="text-sm text-gray-400 max-w-sm">{description}</p>
      <div className="mt-6 px-4 py-2 bg-[#f5f7fa] rounded-lg border border-dashed border-gray-300">
        <p className="text-xs text-gray-400">功能开发中，敬请期待</p>
      </div>
    </div>
  );
}
