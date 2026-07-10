# ERP KSS Removal Guide

This KSS presentation is temporary. When it is no longer needed, remove it from the ERP app using the checklist below.

## What To Delete

Delete these route and support files:

- `app/erp-kss-presentation/`
- `components/kss/`
- `lib/kss/`
- `types/presentation.ts`

Delete the old standalone folder too if it still exists:

- `erp-kss-presentation/`

## What To Revert

Remove the special KSS header exclusion from:

- `components/header-wrapper.tsx`

Specifically remove this condition:

```ts
if (pathname?.startsWith("/erp-kss-presentation")) {
  return null
}
```

If the old standalone folder has already been deleted, remove its TypeScript exclusion from:

- `tsconfig.json`

Specifically remove:

```json
"erp-kss-presentation"
```

## ERP Frame Policy

The ERP is currently set up in a same-origin-safe way for this route:

- `X-Frame-Options: SAMEORIGIN`
- `frame-ancestors 'self'`
- `frame-src 'self'`

These settings are still safe even after the KSS is removed, so they do not have to be reverted unless you want to tighten the policy further.

If you want to fully remove KSS-related iframe support later, review:

- `next.config.mjs`

## Suggested Removal Order

1. Delete `app/erp-kss-presentation`
2. Delete `components/kss`
3. Delete `lib/kss`
4. Delete `types/presentation.ts`
5. Remove the KSS condition from `components/header-wrapper.tsx`
6. Delete the old outer `erp-kss-presentation` folder if it still exists
7. Remove the `erp-kss-presentation` entry from `tsconfig.json` if the old outer folder is gone

## Verify After Removal

Run:

```bash
npx eslint . --ext .ts,.tsx
npx tsc --noEmit
```

Do not consider the removal complete until both pass.
