"use client"

import { motion } from "framer-motion"
import { CalendarDays, Ticket, ListChecks, HelpCircle } from "lucide-react"

const PROMPTS: { icon: typeof HelpCircle; label: string; text: string }[] = [
  { icon: CalendarDays, label: "My leave balance", text: "What is my leave balance?" },
  { icon: Ticket, label: "My tickets", text: "Show me my help-desk tickets" },
  { icon: ListChecks, label: "My tasks", text: "What tasks are assigned to me?" },
  { icon: HelpCircle, label: "How do I request leave?", text: "How do I request leave?" },
]

interface SuggestedPromptsProps {
  onSelect: (text: string) => void
  disabled?: boolean
}

export function SuggestedPrompts({ onSelect, disabled }: SuggestedPromptsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PROMPTS.map((p, i) => (
        <motion.button
          key={p.label}
          type="button"
          disabled={disabled}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i }}
          onClick={() => onSelect(p.text)}
          className="border-border bg-card hover:border-primary/40 hover:bg-accent flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-colors disabled:opacity-50"
        >
          <p.icon className="text-primary h-4 w-4 shrink-0" />
          <span className="text-card-foreground leading-tight font-medium">{p.label}</span>
        </motion.button>
      ))}
    </div>
  )
}
