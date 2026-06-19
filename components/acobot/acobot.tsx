"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useChat } from "ai/react"
import { AnimatePresence, motion } from "framer-motion"
import { Bot, Send, Square, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { AcobotMessage } from "./acobot-message"
import { SuggestedPrompts } from "./suggested-prompts"

interface AcoBotProps {
  /** First name of the signed-in user, used only for the greeting. */
  userName?: string | null
}

export function AcoBot({ userName }: AcoBotProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleNavigate = (href: string) => {
    setIsOpen(false)
    router.push(href)
  }

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop, error, setInput } = useChat({
    api: "/api/acobot",
    // Send the page the user is on so ACOBot can answer with route context.
    body: { currentPath: pathname },
  })

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant")
  const greeting = userName ? userName.split(" ")[0] : "there"

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      inputRef.current?.focus()
    }
  }, [visibleMessages.length, isOpen, isLoading])

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen])

  const handleQuickPrompt = (text: string) => {
    setInput(text)
    requestAnimationFrame(() => {
      document.getElementById("acobot-form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }))
    })
  }

  return (
    <>
      {/* Launcher */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            aria-label="Open ACOBot assistant"
            className="bg-primary text-primary-foreground ring-border fixed right-5 bottom-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-1"
          >
            <Bot className="h-7 w-7" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="bg-background border-border fixed right-5 bottom-5 z-50 flex h-[70dvh] max-h-[620px] w-[calc(100vw-2.5rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          >
            {/* Header */}
            <div className="bg-primary text-primary-foreground relative flex items-center gap-3 px-4 py-3">
              <div className="bg-primary-foreground/15 ring-primary-foreground/25 flex h-9 w-9 items-center justify-center rounded-full ring-1">
                <Bot className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm leading-tight font-semibold">ACOBot</p>
                <p className="text-primary-foreground/80 flex items-center gap-1.5 text-xs">
                  <span className="bg-primary-foreground/70 inline-block h-1.5 w-1.5 rounded-full" />
                  ACOB workspace assistant
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
                className="hover:bg-primary-foreground/15 rounded-full p-1.5 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="bg-muted/30 flex-1 space-y-3 overflow-y-auto px-3.5 py-4">
              {visibleMessages.length === 0 && (
                <div className="border-border bg-card rounded-2xl border p-3.5 text-sm shadow-sm">
                  <p className="text-card-foreground">
                    👋 Hi <strong>{greeting}</strong>, I&apos;m <strong>ACOBot</strong>. I can help you find your way
                    around the ACOB workspace and answer questions about your own leave, tickets and tasks.
                  </p>
                </div>
              )}

              {visibleMessages.map((m) => (
                <AcobotMessage
                  key={m.id}
                  role={m.role as "user" | "assistant"}
                  content={m.content}
                  onNavigate={handleNavigate}
                />
              ))}

              {isLoading && visibleMessages[visibleMessages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-2">
                  <div className="bg-primary text-primary-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="border-border bg-card flex items-center gap-1 rounded-2xl rounded-bl-sm border px-3 py-2.5 shadow-sm">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="bg-muted-foreground/60 h-1.5 w-1.5 rounded-full"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border px-3 py-2 text-center text-xs">
                  Something went wrong. Please try again.
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggested prompts — sit just above the input, like the website */}
            {visibleMessages.length === 0 && (
              <div className="border-border bg-background space-y-2 border-t px-3 pt-3">
                <p className="text-muted-foreground px-1 text-xs font-medium">Try asking</p>
                <SuggestedPrompts onSelect={handleQuickPrompt} disabled={isLoading} />
              </div>
            )}

            {/* Input */}
            <form
              id="acobot-form"
              onSubmit={handleSubmit}
              className={cn(
                "border-border bg-background flex items-center gap-2 px-3 py-2.5",
                visibleMessages.length === 0 ? "" : "border-t"
              )}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                placeholder="Ask ACOBot…"
                className="bg-muted/50 focus:ring-primary/40 placeholder:text-muted-foreground flex-1 rounded-full px-4 py-2 text-sm outline-none focus:ring-2"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop"
                  className="bg-muted text-muted-foreground hover:bg-muted/80 flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Send"
                  className={cn(
                    "text-primary-foreground flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                    input.trim() ? "bg-primary hover:bg-primary/90" : "bg-muted-foreground/40 cursor-not-allowed"
                  )}
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
