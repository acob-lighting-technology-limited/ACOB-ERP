"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Mail, KeyRound, Copy, Check, Eye, EyeOff, Sparkles, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

interface DispatchEmployee {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  employee_number?: string | null
  company_email?: string | null
  personal_email?: string | null
  department?: string | null
}

interface DispatchCredentialsDialogProps {
  employee: DispatchEmployee | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

function generateRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*"
  let pass = ""
  for (let i = 0; i < 14; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return pass
}

export function DispatchCredentialsDialog({ employee, open, onOpenChange, onSuccess }: DispatchCredentialsDialogProps) {
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!employee) return null

  const employeeName =
    employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "Employee"

  const handleCopy = async () => {
    if (!password) return
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success("Password copied to clipboard")
    } catch {
      toast.error("Failed to copy password")
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setPassword(text.trim())
        toast.success("Password pasted from clipboard")
      }
    } catch {
      toast.error("Please allow clipboard access or paste manually")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim() || password.trim().length < 6) {
      toast.error("Password must be at least 6 characters")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await apiFetch(`/api/admin/hr/employees/${employee.id}/dispatch-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to dispatch credentials")
      }

      toast.success(`Webmail credentials dispatched to ${employee.personal_email}`)
      onOpenChange(false)
      setPassword("")
      onSuccess?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to dispatch credentials")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !isSubmitting && onOpenChange(val)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="text-primary h-5 w-5" />
            Dispatch Webmail Credentials
          </DialogTitle>
          <DialogDescription>
            Send official company webmail login details and Matrix setup instructions to the employee&apos;s personal
            inbox.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Recipient Details Card */}
          <div className="bg-muted/40 space-y-1.5 rounded-lg border p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Employee:</span>
              <span className="text-foreground font-semibold">{employeeName}</span>
            </div>
            {employee.employee_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Staff ID:</span>
                <span className="text-foreground font-mono font-medium">{employee.employee_number}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">cPanel Email:</span>
              <span className="text-foreground font-mono font-medium">{employee.company_email || "Not set"}</span>
            </div>
            <div className="flex justify-between border-t pt-1.5">
              <span className="text-muted-foreground">Personal Recipient:</span>
              <span className="text-primary font-medium">{employee.personal_email || "No personal email"}</span>
            </div>
          </div>

          {!employee.personal_email && (
            <div className="flex items-center gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Cannot dispatch: This employee does not have a personal email on file.</span>
            </div>
          )}

          {/* cPanel Password Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="cpanel-pass" className="flex items-center gap-1.5 text-xs font-semibold">
                <KeyRound className="h-3.5 w-3.5" />
                cPanel Webmail Password
              </Label>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground h-6 px-2 text-[11px]"
                  onClick={handlePaste}
                >
                  Paste from cPanel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={() => setPassword(generateRandomPassword())}
                >
                  <Sparkles className="h-3 w-3" />
                  Generate
                </Button>
              </div>
            </div>

            <div className="relative">
              <Input
                id="cpanel-pass"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Paste password created in cPanel..."
                className="pr-20 font-mono text-xs"
                required
                minLength={6}
                disabled={!employee.personal_email || isSubmitting}
              />
              <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
                {password && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground h-7 w-7"
                    onClick={handleCopy}
                    title="Copy password"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Paste the password you entered in cPanel when creating the account. This will be securely emailed to the
              employee.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={isSubmitting}
              disabled={!employee.personal_email || !password.trim() || password.trim().length < 6}
            >
              Send Webmail Credentials
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
