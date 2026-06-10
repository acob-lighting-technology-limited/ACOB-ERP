"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export interface BirthdayValue {
  /** Month/day as zero-padded "MM-DD", or "" when not fully set. */
  birthday: string
  /** Year as "YYYY", or "" when unknown. */
  birthYear: string
}

interface BirthdayInputProps extends BirthdayValue {
  onChange: (next: BirthdayValue) => void
  idPrefix?: string
  className?: string
}

function parseBirthday(birthday: string): { month: string; day: string } {
  const match = birthday.trim().match(/^(\d{1,2})-(\d{1,2})$/)
  if (!match) return { month: "", day: "" }
  return { month: String(Number(match[1])), day: String(Number(match[2])) }
}

/** Days in a given month, accounting for leap years when the year is known. */
function daysInMonth(month: number, year: number | null): number {
  if (!month) return 31
  // Day 0 of next month = last day of this month. Use a non-leap fallback year.
  return new Date(year ?? 2001, month, 0).getDate()
}

/**
 * Captures a birthday as month + day with an optional year. The month/day are
 * required to form a birthday; the year stays blank until the person supplies
 * it. Emits `birthday` ("MM-DD") and `birthYear` ("YYYY" or "") separately so a
 * partial date is always valid — see the `profiles.birth_year` model.
 */
export function BirthdayInput({ birthday, birthYear, onChange, idPrefix = "dob", className }: BirthdayInputProps) {
  const { month, day } = parseBirthday(birthday)
  const yearNum = /^\d{4}$/.test(birthYear) ? Number(birthYear) : null
  const maxDay = daysInMonth(Number(month) || 0, yearNum)

  const emit = (nextMonth: string, nextDay: string, nextYear: string) => {
    // Clamp the day if the new month/year makes the current day invalid.
    const m = Number(nextMonth) || 0
    const y = /^\d{4}$/.test(nextYear) ? Number(nextYear) : null
    let d = Number(nextDay) || 0
    if (m && d) d = Math.min(d, daysInMonth(m, y))

    const nextBirthday = m && d ? `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : ""
    onChange({ birthday: nextBirthday, birthYear: nextYear })
  }

  return (
    <div className={className ?? "grid grid-cols-[1.4fr_1fr_1fr] gap-2"}>
      <Select value={month} onValueChange={(v) => emit(v, day, birthYear)}>
        <SelectTrigger id={`${idPrefix}-month`} aria-label="Birth month">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          {MONTHS.map((name, i) => (
            <SelectItem key={name} value={String(i + 1)}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={day} onValueChange={(v) => emit(month, v, birthYear)} disabled={!month}>
        <SelectTrigger id={`${idPrefix}-day`} aria-label="Birth day">
          <SelectValue placeholder="Day" />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: maxDay }, (_, i) => String(i + 1)).map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        id={`${idPrefix}-year`}
        type="number"
        inputMode="numeric"
        min={1900}
        max={new Date().getFullYear()}
        placeholder="Year (optional)"
        value={birthYear}
        onChange={(e) => emit(month, day, e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
      />
    </div>
  )
}
