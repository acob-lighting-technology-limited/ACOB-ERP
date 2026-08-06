"use client"

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react"
import { motion, useMotionValue, useSpring, useTransform, useScroll, useInView, animate } from "framer-motion"
import "./launch.css"

const ASSET = "/launch-video"

const MODULES: { icon: string; name: string }[] = [
  { icon: "🕒", name: "Attendance" },
  { icon: "💳", name: "Payroll" },
  { icon: "💰", name: "Finance & Payments" },
  { icon: "🌴", name: "Leave" },
  { icon: "🏆", name: "Performance (PMS)" },
  { icon: "✅", name: "Tasks" },
  { icon: "📁", name: "Projects" },
  { icon: "🛎️", name: "Help Desk" },
  { icon: "📚", name: "Documentation" },
  { icon: "📊", name: "Reports & Meetings" },
  { icon: "💬", name: "Feedback" },
  { icon: "📦", name: "Assets" },
  { icon: "✉️", name: "Correspondence" },
  { icon: "📢", name: "Communications" },
  { icon: "👥", name: "Employees & Directory" },
  { icon: "🚐", name: "Shared Resources" },
  { icon: "🌐", name: "Network Monitoring" },
  { icon: "🧾", name: "Onboarding" },
  { icon: "💵", name: "Requisitions" },
  { icon: "🏢", name: "Department & Offices" },
]

const FEATURES: { tag: string; title: string; body: string; shot: string; url: string }[] = [
  {
    tag: "Attendance & Time",
    title: "Every clock-in, live. No manual registers.",
    body: "Staff clock themselves in, field teams are location-verified against approved sites, and managers watch the full roster update in real time.",
    shot: `${ASSET}/shots/attendance.png`,
    url: "matrix / attendance",
  },
  {
    tag: "Payroll",
    title: "Attendance flows straight into pay.",
    body: "Pay periods are calculated, reviewed, and run from a single screen — accurate, auditable, and on time, every cycle.",
    shot: `${ASSET}/shots/payroll.png`,
    url: "matrix / payroll",
  },
  {
    tag: "Performance",
    title: "One score, from everywhere performance shows up.",
    body: "KPI, goals, attendance, CBT, behaviour and reviews — all rolled into one live performance profile for every employee.",
    shot: `${ASSET}/shots/pms.png`,
    url: "matrix / pms",
  },
  {
    tag: "Secured by design",
    title: "Nothing happens that we can't account for.",
    body: "Access controlled by role, protected at the database itself, and every action written to a permanent audit trail.",
    shot: `${ASSET}/shots/audit-logs.png`,
    url: "matrix / audit-logs",
  },
]

/* ---------- 3D tilt on mouse move ---------- */
function Tilt({ children, className, intensity = 8 }: { children: ReactNode; className?: string; intensity?: number }) {
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.5)
  const rx = useSpring(useTransform(y, [0, 1], [intensity, -intensity]), { stiffness: 150, damping: 18 })
  const ry = useSpring(useTransform(x, [0, 1], [-intensity, intensity]), { stiffness: 150, damping: 18 })
  return (
    <motion.div
      className={className}
      style={{ transformStyle: "preserve-3d", rotateX: rx, rotateY: ry }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        x.set((e.clientX - r.left) / r.width)
        y.set((e.clientY - r.top) / r.height)
      }}
      onMouseLeave={() => {
        x.set(0.5)
        y.set(0.5)
      }}
    >
      {children}
    </motion.div>
  )
}

/* ---------- scroll reveal ---------- */
function Reveal({
  children,
  delay = 0,
  y = 30,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}

/* ---------- animated counter ---------- */
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!inView) return
    const controls = animate(0, to, { duration: 1.3, ease: "easeOut", onUpdate: (v) => setVal(Math.round(v)) })
    return () => controls.stop()
  }, [inView, to])
  return (
    <span ref={ref}>
      {val}
      {suffix}
    </span>
  )
}

/* ---------- floating hero chip ---------- */
function FloatChip({ style, delay, children }: { style: CSSProperties; delay: number; children: ReactNode }) {
  return (
    <motion.div
      className="lp-chip"
      style={style}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1, y: [0, -12, 0] }}
      transition={{
        opacity: { duration: 0.6, delay },
        scale: { duration: 0.6, delay },
        y: { duration: 6, delay, repeat: Infinity, ease: "easeInOut" },
      }}
    >
      {children}
    </motion.div>
  )
}

export default function LaunchClient() {
  const heroRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] })
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 120])
  const heroFade = useTransform(scrollYProgress, [0, 1], [1, 0])

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div className="lp">
      {/* animated background */}
      <div className="lp-aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="lp-grain" aria-hidden />

      <div className="lp-shell">
        {/* hero */}
        <header className="lp-hero" ref={heroRef}>
          <div className="lp-orbits" aria-hidden>
            <FloatChip style={{ left: "7%", top: "20%", rotate: "-6deg" } as CSSProperties} delay={0.3}>
              <b>🕒</b> Attendance
            </FloatChip>
            <FloatChip style={{ right: "8%", top: "16%", rotate: "5deg" } as CSSProperties} delay={0.5}>
              <b>💳</b> Payroll
            </FloatChip>
            <FloatChip style={{ left: "11%", bottom: "14%", rotate: "4deg" } as CSSProperties} delay={0.7}>
              <b>🏆</b> Performance
            </FloatChip>
            <FloatChip style={{ right: "10%", bottom: "18%", rotate: "-5deg" } as CSSProperties} delay={0.9}>
              <b>🔐</b> Security
            </FloatChip>
          </div>

          <motion.div className="lp-wrap" style={{ y: heroY, opacity: heroFade }}>
            <motion.img
              className="lp-hero-logo"
              src={`${ASSET}/assets/matrix-logo.png`}
              alt="Matrix"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            />
            <motion.span
              className="lp-eyebrow"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              ACOB Lighting Technology Limited
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              One platform. <span className="grad">Every operation.</span>
            </motion.h1>
            <motion.p
              className="sub"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.35 }}
            >
              Matrix is the enterprise workspace that unifies every department, process and record for ACOB Lighting —
              finally connected in one secure system.
            </motion.p>
            <motion.div
              className="lp-hero-cta"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
            >
              <button className="lp-btn lp-btn-primary" onClick={() => scrollTo("presentation")}>
                ▶ Watch the presentation
              </button>
              <a className="lp-btn lp-btn-ghost" href="/auth/login">
                Enter Matrix →
              </a>
            </motion.div>
          </motion.div>

          <motion.button
            className="lp-scroll-cue"
            onClick={() => scrollTo("stats")}
            aria-label="Scroll down"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, 8, 0] }}
            transition={{
              opacity: { delay: 1, duration: 0.6 },
              y: { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
            }}
          >
            <span />
          </motion.button>
        </header>

        {/* stat band */}
        <div className="lp-wrap" id="stats">
          <Reveal>
            <div className="lp-band">
              <div>
                <div className="n">
                  <Counter to={20} suffix="+" />
                </div>
                <div className="l">Connected modules</div>
              </div>
              <div>
                <div className="n">1</div>
                <div className="l">Secure workspace</div>
              </div>
              <div>
                <div className="n">
                  <Counter to={100} suffix="%" />
                </div>
                <div className="l">Paper trails, eliminated</div>
              </div>
              <div>
                <div className="n">Real&nbsp;time</div>
                <div className="l">Across every department</div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* the story */}
        <section className="lp-section">
          <div className="lp-wrap lp-head-center">
            <Reveal>
              <div className="lp-kicker">Why Matrix</div>
              <h2 className="lp-h2">From scattered, to one.</h2>
              <p className="lp-sub">
                Correspondence here, progress reports there, records somewhere else entirely. Matrix brings the whole
                organization into a single grid — where every department, process and record finally connects.
              </p>
            </Reveal>
            <div className="lp-story">
              {[
                {
                  k: "Before",
                  t: "A dozen systems",
                  d: "Spreadsheets, paper forms, and tools that never spoke to each other.",
                },
                { k: "The shift", t: "One secure grid", d: "Every workflow rebuilt into a single connected platform." },
                { k: "Now", t: "Total visibility", d: "Leadership sees the whole organization, live, at a glance." },
              ].map((s, i) => (
                <Reveal key={s.k} delay={i * 0.1}>
                  <div className="lp-story-card">
                    <span className="lp-story-k">{s.k}</span>
                    <h4>{s.t}</h4>
                    <p>{s.d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* modules universe */}
        <section className="lp-section">
          <div className="lp-wrap lp-head-center">
            <Reveal>
              <div className="lp-kicker">One workspace</div>
              <h2 className="lp-h2">Twenty modules. Zero silos.</h2>
              <p className="lp-sub">
                Everything the organization runs on — from onboarding to audit — built into one secure system.
              </p>
            </Reveal>
          </div>
          <div className="lp-wrap">
            <div className="lp-modules-grid">
              {MODULES.map((m, idx) => (
                <motion.div
                  key={m.name}
                  className="lp-mod"
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.5, delay: (idx % 4) * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`)
                    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`)
                  }}
                >
                  <span className="ico">{m.icon}</span>
                  <span className="nm">{m.name}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* presentation deck embedded as a section */}
        <section className="lp-section" id="presentation">
          <div className="lp-wrap lp-head-center">
            <Reveal>
              <div className="lp-kicker">The launch presentation</div>
              <h2 className="lp-h2">See Matrix, module by module.</h2>
              <p className="lp-sub">Press play inside the frame for the full narrated walkthrough.</p>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="lp-deck-frame">
                <div className="bar">
                  <i />
                  <i />
                  <i />
                  <span>matrix — launch presentation</span>
                </div>
                <div className="lp-deck-wrap">
                  <iframe
                    src={`${ASSET}/deck-final.html`}
                    title="Matrix launch presentation"
                    allow="fullscreen; autoplay"
                    loading="lazy"
                  />
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <p className="lp-film-alt">
                <a href={`${ASSET}/deck-final.html`} target="_blank" rel="noopener">
                  Open in full screen →
                </a>
              </p>
            </Reveal>
          </div>
        </section>

        {/* feature showcases */}
        <section className="lp-section">
          <div className="lp-wrap lp-head-center">
            <Reveal>
              <div className="lp-kicker">Inside the platform</div>
              <h2 className="lp-h2">Built for how the work really happens.</h2>
            </Reveal>
          </div>
          <div className="lp-wrap">
            {FEATURES.map((f) => (
              <div className="lp-feature" key={f.tag}>
                <Reveal className="lp-feature-copy">
                  <span className="tag">{f.tag}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </Reveal>
                <Reveal delay={0.1}>
                  <Tilt className="lp-shot" intensity={7}>
                    <div className="bar">
                      <i />
                      <i />
                      <i />
                      <span>{f.url}</span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.shot} alt={f.tag} loading="lazy" />
                  </Tilt>
                </Reveal>
              </div>
            ))}
          </div>
        </section>

        {/* security band */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal>
              <div className="lp-secure">
                <div className="lp-kicker">Secured by design</div>
                <h2 className="lp-h2" style={{ margin: "14px auto 0" }}>
                  Enterprise-grade, from the database up.
                </h2>
                <p className="lp-sub" style={{ margin: "18px auto 0" }}>
                  Role-based access, database-level security, and a permanent audit trail on every action — plus network
                  activity monitoring across the office.
                </p>
                <div className="lp-chips">
                  <span className="c">Role-based access</span>
                  <span className="c">Database-level security</span>
                  <span className="c">Full audit trail</span>
                  <span className="c">Network monitoring</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* final CTA */}
        <section className="lp-cta">
          <div className="lp-wrap">
            <Reveal>
              <h2>
                This is how ACOB Lighting <span className="grad">works now.</span>
              </h2>
              <div className="lp-hero-cta">
                <a className="lp-btn lp-btn-primary" href="/auth/login">
                  Enter Matrix →
                </a>
                <button className="lp-btn lp-btn-ghost" onClick={() => scrollTo("presentation")}>
                  Watch the presentation
                </button>
              </div>
            </Reveal>
          </div>
        </section>

        {/* footer */}
        <footer className="lp-wrap">
          <div className="lp-footer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${ASSET}/assets/matrix-logo.png`} alt="Matrix" />
            <span className="powered">
              Powered by <b>ACOB LIGHTING TECHNOLOGY LIMITED</b>
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
