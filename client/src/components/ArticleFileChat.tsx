import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Streamdown } from "streamdown";
import { getRehypePluginsWithOrigin } from "@/lib/streamdownPlugins";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";

type Message = { role: "user" | "assistant"; content: string; id: string };

export default function ArticleFileChat({
  articleId,
  userId,
}: {
  articleId: number;
  userId?: number;
}) {
  const [sessionId] = useState(() => `art_${articleId}_${nanoid()}`);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const sendMutation = trpc.chat.send.useMutation();

  const scrollToBottom = () => {
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null;
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isLoading) return;
    setMessages((prev) => [...prev, { role: "user", content, id: nanoid() }]);
    setInput("");
    setIsLoading(true);
    try {
      const result = await sendMutation.mutateAsync({
        sessionId,
        message: content,
        articleId,
        userId,
        origin: typeof window !== "undefined" ? window.location.origin : "",
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.content,
          id: nanoid(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "请求失败，请稍后重试。",
          id: nanoid(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#1677ff]/20 bg-gradient-to-b from-[#f8fbff] to-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-white/80">
        <Sparkles className="h-4 w-4 text-[#1677ff]" />
        <span className="text-sm font-semibold text-gray-800">针对本文档 / 原文问答</span>
        <span className="text-xs text-gray-400 ml-auto">基于上传全文与摘要</span>
      </div>
      <ScrollArea className="h-[280px] px-3" ref={scrollAreaRef}>
        <div className="py-3 space-y-3">
          {messages.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">
              输入问题，AI 将结合当前文件内容回答
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-[#1677ff]/10 flex items-center justify-center shrink-0">
                  <Bot className="h-3.5 w-3.5 text-[#1677ff]" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-[#1677ff] text-white"
                    : "bg-gray-50 text-gray-800 border border-gray-100"
                }`}
              >
                {m.role === "assistant" ? (
                  <Streamdown className="prose prose-sm max-w-none dark:prose-invert" rehypePlugins={getRehypePluginsWithOrigin()}>
                    {m.content}
                  </Streamdown>
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-2 justify-start">
              <div className="w-7 h-7 rounded-full bg-[#1677ff]/10 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-[#1677ff]" />
              </div>
              <div className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="p-3 border-t border-gray-100 bg-white flex gap-2">
        <Textarea
          placeholder="例如：这份材料的核心结论是什么？涉及哪些基金策略？"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="min-h-[72px] max-h-[120px] text-sm resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button
          type="button"
          className="shrink-0 self-end bg-[#1677ff] hover:bg-[#0958d9]"
          size="sm"
          disabled={isLoading || !input.trim()}
          onClick={handleSend}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
