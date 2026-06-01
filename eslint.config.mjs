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
  globalIgnores(["scripts/**"]),
])
