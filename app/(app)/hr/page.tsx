import Link from "next/link"
import { Calendar, CheckCircle2, ChevronRight, Clock, Car, UserCheck, Utensils } from "lucide-react"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"
import { getCurrentUserHrData } from "./_lib"

export default async function HrPage() {
  const { profile, todayAttendance, leave, lunch, bookings } = await getCurrentUserHrData()

  const hrAreaCards = [
    {
      title: "Attendance",
      description: "Clock in and out, monitor monthly work hours, and view historical timesheets.",
      href: "/attendance",
      icon: Clock,
      badge: todayAttendance.isClockedIn ? "Clocked In" : todayAttendance.clockOut ? "Clocked Out" : "Not Clocked In",
      subLabel: todayAttendance.totalHours
        ? `${todayAttendance.totalHours.toFixed(1)} hrs today`
        : "Timesheets & Hours",
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      fill: "bg-amber-500",
      hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
      hoverText: "group-hover:text-amber-500",
    },
    {
      title: "Leave Management",
      description: "Apply for annual, casual, or medical leave, track approval stages, and submit evidence.",
      href: "/leave",
      icon: Calendar,
      badge: `${leave.annualRemainingDays} Days Annual`,
      subLabel:
        leave.pendingRequestsCount > 0
          ? `${leave.pendingRequestsCount} in review`
          : `${leave.casualRemainingDays} casual days also available`,
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      fill: "bg-emerald-500",
      hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
      hoverText: "group-hover:text-emerald-500",
    },
    {
      title: "Lunch Program",
      description: "Check daily menus, vote on catered options, submit meal ratings, and track orders.",
      href: "/lunch",
      icon: Utensils,
      badge: lunch.hasVoted ? "Submitted" : lunch.hasMenuToday ? "Menu Available" : "No Menu Today",
      subLabel: lunch.hasVoted ? "Choice recorded" : "Daily Menu & Voting",
      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
      fill: "bg-orange-500",
      hoverBorder: "hover:border-orange-500/60 dark:hover:border-orange-400/60",
      hoverText: "group-hover:text-orange-500",
    },
    {
      title: "Shared Resources",
      description: "Reserve pool vehicles, conference rooms, and company facilities for official tasks.",
      href: "/resources",
      icon: Car,
      badge: bookings.activeCount > 0 ? `${bookings.activeCount} Active` : "Available",
      subLabel: "Vehicles & Meeting Rooms",
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      fill: "bg-blue-500",
      hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
      hoverText: "group-hover:text-blue-500",
    },
  ]

  const attendanceStatusValue = todayAttendance.isClockedIn
    ? "Clocked In"
    : todayAttendance.clockOut
      ? "Clocked Out"
      : "Not Clocked"

  const attendanceDescription = todayAttendance.clockIn
    ? `Since ${todayAttendance.clockIn}${todayAttendance.totalHours ? ` (${todayAttendance.totalHours.toFixed(1)}h)` : ""}`
    : "No clock-in recorded today"

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Human Resources"
        description={`Manage your attendance, leave applications, daily lunch, and shared resource bookings${profile?.department ? ` in ${profile.department}` : ""}.`}
        icon={UserCheck}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5">
        <StatCard
          variant="compact"
          title="Today's Attendance"
          value={attendanceStatusValue}
          icon={Clock}
          description={attendanceDescription}
        />
        <StatCard
          variant="compact"
          title="Available Annual Leave"
          value={`${leave.annualRemainingDays} Days`}
          icon={Calendar}
          description={`${leave.casualRemainingDays} casual days also available`}
        />
        <StatCard
          variant="compact"
          title="Pending Requests"
          value={leave.pendingRequestsCount}
          icon={CheckCircle2}
          description={
            leave.pendingRequestsCount === 1
              ? "1 request awaiting review"
              : `${leave.pendingRequestsCount} requests awaiting review`
          }
        />
        <StatCard
          variant="compact"
          title="Today's Lunch"
          value={lunch.hasMenuToday ? (lunch.hasVoted ? "Selected" : "Menu Open") : "No Menu"}
          icon={Utensils}
          description={
            lunch.hasVoted ? "Meal preference logged" : lunch.hasMenuToday ? "Vote pending" : "No menu scheduled"
          }
          className="hidden sm:block"
        />
        <StatCard
          variant="compact"
          title="Shared Bookings"
          value={bookings.activeCount}
          icon={Car}
          description="Active or upcoming reservations"
          className="hidden sm:block"
        />
      </div>

      <Section title="HR Areas" description="Select an area below to view your records or submit new requests.">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-2">
          {hrAreaCards.map((item) => (
            <Link key={item.href} href={item.href} className="group block">
              <div
                className={cn(
                  "bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl",
                  item.hoverBorder
                )}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <IconFill
                        icon={item.icon}
                        fillColor={item.fill}
                        className={cn(
                          "h-9 w-9 rounded-lg border transition-transform duration-200 group-hover:scale-105",
                          item.color
                        )}
                        iconClassName="h-5 w-5"
                      />
                      <h3 className={cn("text-foreground text-base font-semibold transition-colors", item.hoverText)}>
                        {item.title}
                      </h3>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", item.color)}
                    >
                      {item.badge}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{item.description}</p>
                </div>
                <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                  <span className="text-muted-foreground text-[11px] font-medium">{item.subLabel}</span>
                  <IconFill
                    icon={ChevronRight}
                    fillColor={item.fill}
                    hoverTextClassName="group-hover:text-white"
                    className={cn(
                      "border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5",
                      item.hoverBorder
                    )}
                    iconClassName="text-muted-foreground h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="How HR Works" description="Learn how your HR records sync across the ERP.">
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p>
              Your daily attendance is recorded through clock-in activity and directly impacts your attendance score in
              PMS.
            </p>
            <p>
              Leave requests progress through supervisor and HR approvals. Once approved, your leave balances update
              automatically and reliever notifications are dispatched.
            </p>
            <p>
              Shared resources provide reservation tracking for fleet vehicles and conference rooms to avoid
              double-booking.
            </p>
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
