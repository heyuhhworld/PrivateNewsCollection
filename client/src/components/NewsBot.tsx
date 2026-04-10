import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Streamdown } from "streamdown";
import {
  Bot,
  Loader2,
  Send,
  Sparkles,
  User,
  X,
  ChevronDown,
} from "lucide-react";
import { nanoid } from "nanoid";

type Message = {
  role: "user" | "assistant";
  content: string;
  id: string;
  references?: Array<{
    page: number;
    startLine: number;
    endLine: number;
    quote?: string;
  }>;
};

const SUGGESTED_PROMPTS = [
  "最近有哪些重要的私募股权资讯？",
  "总结一下亚太地区的投资动态",
  "分析当前基础设施投资趋势",
  "Preqin 和 Pitchbook 最新报道了什么？",
  "有哪些大型基金正在募资？",
  "中国市场近期有什么投资动向？",
];

interface NewsBotProps {
  onClose: () => void;
  articleId?: number;
}

export default function NewsBot({ onClose, articleId }: NewsBotProps) {
  const [sessionId] = useState(() => nanoid());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;

    const userMsg: Message = { role: "user", content, id: nanoid() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const result = await sendMutation.mutateAsync({
        sessionId,
        message: content,
        articleId,
        origin: window.location.origin,
      });
      const assistantMsg: Message = {
        role: "assistant",
        content: result.content,
        id: nanoid(),
        references: result.references,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: Message = {
        role: "assistant",
        content: "抱歉，请求失败，请稍后重试。",
        id: nanoid(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#1677ff] flex items-center justify-center">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">AI 资讯助手</p>
            <p className="text-xs text-gray-400">
              {articleId
                ? "当前为本文问答模式（默认严格基于当前资讯/报告）"
                : "基于资讯/报告库数据分析"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollAreaRef} className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex flex-col h-full p-4">
            <div className="flex flex-col items-center justify-center gap-4 flex-1 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#e8f0fe] flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-[#1677ff]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  资讯智能分析助手
                </p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {articleId ? (
                    <>
                      我将围绕当前详情页文档进行问答<br />
                      回答默认严格基于当前文档内容
                    </>
                  ) : (
                    <>
                      我可以帮您查询、整理、总结和分析<br />
                      Preqin 和 Pitchbook 的最新资讯
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Suggested Prompts */}
            <div className="space-y-2">
              <p className="text-xs text-gray-400 text-center mb-3">快速提问</p>
              <div className="grid grid-cols-1 gap-1.5">
                {(articleId
                  ? [
                      "请总结这篇内容的核心结论",
                      "这篇文章涉及哪些关键数据？",
                      "请给出这篇内容的结构化要点",
                      "文中有哪些风险与机会信号？",
                    ]
                  : SUGGESTED_PROMPTS
                ).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    disabled={isLoading}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-[#e8f0fe] hover:border-[#1677ff]/30 hover:text-[#1677ff] transition-all text-gray-600 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 items-start ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-[#1677ff] flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-[#1677ff] text-white"
                        : "bg-gray-50 border border-gray-100 text-gray-700"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="space-y-2">
                        <div className="prose prose-sm max-w-none text-gray-700">
                          <Streamdown>{msg.content}</Streamdown>
                        </div>
                        {articleId &&
                          msg.references &&
                          msg.references.length > 0 && (
                            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-2 space-y-1.5">
                              <p className="text-[11px] text-blue-700 font-medium">
                                引用定位（点击跳转）
                              </p>
                              <div className="flex flex-col gap-1.5 max-w-full">
                                {msg.references.map((ref, idx) => (
                                  <div
                                    key={`${msg.id}-ref-${idx}`}
                                    className="rounded-md border border-blue-200/80 bg-white overflow-hidden w-full min-w-[200px] max-w-full"
                                  >
                                    <button
                                      type="button"
                                      className="w-full text-left text-[11px] px-2 py-1.5 text-blue-700 hover:bg-blue-50 font-medium"
                                      title={ref.quote ?? "定位到原文对应行"}
                                      onClick={() => {
                                        window.dispatchEvent(
                                          new CustomEvent("ipms-locate-reference", {
                                            detail: {
                                              articleId,
                                              page: ref.page,
                                              startLine: ref.startLine,
                                              endLine: ref.endLine,
                                              quote: ref.quote ?? "",
                                            },
                                          })
                                        );
                                      }}
                                    >
                                      定位：第{ref.page}页 · L{ref.startLine}–{ref.endLine}
                                    </button>
                                    {ref.quote ? (
                                      <p className="text-[10px] leading-relaxed text-gray-700 px-2 pb-2 pt-0 border-t border-amber-100 bg-amber-50/90">
                                        <span className="text-amber-800/80 font-medium">摘录 </span>
                                        {ref.quote}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-gray-500" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-2 items-start">
                  <div className="w-6 h-6 rounded-full bg-[#1677ff] flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1677ff] animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1677ff] animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1677ff] animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-100 bg-white shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行..."
            className="flex-1 max-h-24 resize-none min-h-[36px] text-sm border-gray-200 focus:border-[#1677ff] focus:ring-[#1677ff]/20"
            rows={1}
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-9 w-9 bg-[#1677ff] hover:bg-[#0958d9] text-white shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          {articleId
            ? "当前回答默认仅基于本页资讯/报告内容，并附引用源"
            : "AI 回答基于资讯/报告数据，仅供参考"}
        </p>
      </div>
    </div>
  );
}
