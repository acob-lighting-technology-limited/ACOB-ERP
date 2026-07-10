# Fixes Implemented: Employee Onboarding Form Styling

I have fixed the styling issues in `app/form/page.tsx` to ensure proper light and dark mode support.

## Issue
- The previous implementation used hardcoded colors (e.g., `bg-white`, `text-gray-900`), which caused the form to look broken or low-contrast in dark mode.

## Fix
- **Semantic Colors**: Replaced all hardcoded specific colors with shadcn/ui semantic tailwind classes (e.g., `bg-background`, `text-foreground`, `bg-card`, `border-border`).
- **Logo Visibility**: Added `brightness` and `invert` filters to the logo so it remains visible against dark backgrounds if it is a dark logo.
- **Consistency**: Ensured all inputs, texts, borders, and backgrounds automatically adapt to the user's system theme preference.

## Verification
Navigate to `/form` and toggle your system or browser theme between Light and Dark. The form should adapt seamlessly.
