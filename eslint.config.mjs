import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  ...nextVitals,
  {
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/immutability": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/static-components": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "warn",
      "import/no-anonymous-default-export": "off",
      "@next/next/no-img-element": "warn",
      "prefer-const": "error",
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.name='useEffect'] > ArrowFunctionExpression > BlockStatement > ExpressionStatement > CallExpression[callee.object.name='fetch']",
          message: "Do not fetch data inside useEffect. Use useQuery from @tanstack/react-query instead.",
        },
        {
          selector:
            "CallExpression[callee.property.name='split'][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "Do not derive business dates/times from toISOString(); use toLocalISODate(), toLocalYearMonth(), or toLocalTimeString() from '@/lib/utils/date'.",
        },
        {
          selector:
            "CallExpression[callee.property.name='slice'][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "Do not derive business dates/times from toISOString(); use toLocalISODate(), toLocalYearMonth(), or toLocalTimeString() from '@/lib/utils/date'.",
        },
      ],
    },
  },
  // ---------------------------------------------------------------------------
  // AGENTS.md enforcement: admin & dept client components must NOT query
  // Supabase directly from the browser — it bypasses middleware scope injection
  // (no x-admin-scope / x-dept-scope header). They must call a scoped /api route.
  // ---------------------------------------------------------------------------
  {
    files: ["app/admin/**/*.{ts,tsx}", "app/dept/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/client",
              message:
                "Admin/dept client components must not query Supabase directly (bypasses middleware scope injection). Fetch a scoped /api route that calls getRequestScope() instead — see AGENTS.md 'Admin Route Scoping Standard'.",
            },
          ],
        },
      ],
    },
  },
  // Temporary allowlist — pre-existing violators pending migration to scoped API
  // routes (Phase 3b). Remove each entry as its module is migrated; delete this
  // block once empty. DO NOT add new files here.
  {
    files: [
      "app/admin/assets/admin-assets-content.tsx",
      "app/admin/assets/issues/view.tsx",
      "app/admin/communications/_components/communications-composer.tsx",
      "app/admin/dev/tests/dev-tests-content.tsx",
      "app/admin/employees/admin-employee-content.tsx",
      "app/admin/hr/employees/admin-employee-content.tsx",
      "app/admin/hr/employees/pending-applications-modal.tsx",
      "app/admin/hr/leave/view.tsx",
      "app/admin/reports/action-tracker/action-tracker-content.tsx",
      "app/admin/reports/general-meeting/_components/week-setup-card.tsx",
      "app/admin/reports/mail/mail-digest-content.tsx",
      "app/admin/reports/mail/weekly-summary-content.tsx",
      "app/admin/reports/mail/_components/use-weekly-summary-send.ts",
      "app/admin/reports/weekly-reports/weekly-reports-content.tsx",
      "app/admin/tasks/management/admin-tasks-content.tsx",
      "app/admin/tasks/management/tasks-content-utils.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  globalIgnores(["scripts/**"]),
])
