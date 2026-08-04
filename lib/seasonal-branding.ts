export function isChristmasPeriod(date = new Date()): boolean {
  const year = date.getFullYear()
  const month = date.getMonth() + 1

  return year === 2026 && month === 12
}

export function isTemporary2026LogoPeriod(date = new Date()): boolean {
  return date.getFullYear() === 2026 && !isChristmasPeriod(date)
}

export function getSeasonalLogoPaths(theme: "light" | "dark", date = new Date()) {
  const isDark = theme === "dark"
  const logoPath = isDark ? "/images/matrix-logo-dark.png?v=4" : "/images/matrix-logo-light.png?v=4"

  return {
    navbar: logoPath,
    full: logoPath,
    icon: logoPath,
  }
}
