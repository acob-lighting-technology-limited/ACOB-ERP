"use client"

import { motion } from "framer-motion"
import { Bot, User } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { linkifyRoutes } from "./linkify"

interface AcobotMessageProps {
  role: "user" | "assistant"
  content: string
  /** Navigate within the app (internal routes starting with "/") and close the widget. */
  onNavigate?: (href: string) => void
}

export function AcobotMessage({ role, content, onNavigate }: AcobotMessageProps) {
  const isUser = role === "user"

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn("flex w-full items-end gap-2", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="bg-primary text-primary-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "border-border bg-card text-card-foreground rounded-bl-sm border"
        )}
      >
        {isUser ? (
          <p className="leading-relaxed whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="text-card-foreground text-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                code: ({ children }) => (
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">{children}</code>
                ),
                a: ({ href, children }) => {
                  const target = href || ""
                  const isInternal = target.startsWith("/")
                  if (isInternal && onNavigate) {
                    return (
                      <button
                        type="button"
                        onClick={() => onNavigate(target)}
                        className="text-primary font-medium underline underline-offset-2 hover:opacity-80"
                      >
                        {children}
                      </button>
                    )
                  }
                  return (
                    <a
                      href={target}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary font-medium underline underline-offset-2 hover:opacity-80"
                    >
                      {children}
                    </a>
                  )
                },
              }}
            >
              {linkifyRoutes(content || "")}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {isUser && (
        <div className="bg-muted text-muted-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
          <User className="h-4 w-4" />
        </div>
      )}
    </motion.div>
  )
}
