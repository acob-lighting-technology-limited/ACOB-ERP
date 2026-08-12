# Email signature assets

## Do not rename, move, or delete anything in this folder

These files are referenced by **absolute URLs baked into email signatures that
staff have already pasted into Outlook and Gmail**. The generator emits
`${NEXT_PUBLIC_SITE_URL}/images/signature/<file>.png` (see
`components/signature-creator.tsx`), so every signature installed in a mailbox —
and every email already sent with one — keeps requesting these exact paths
forever.

Treat this folder as a frozen public API: **you can add files, never rename or
remove them.** A rename breaks the icons in mail that has already left the
building, and there is no way to audit or fix it after the fact.

## Canonical icons (currently emitted)

The `-email` suffixed set is what the generator uses today:

| File | Purpose |
| --- | --- |
| `phone-email.png` | Phone contact row |
| `mail-email.png` | Email contact row |
| `web-email.png` | Website contact row |
| `linkedin-email.png` | LinkedIn social link |
| `x-email.png` | X (Twitter) social link |
| `facebook-email.png` | Facebook social link |
| `instagram-email.png` | Instagram social link |
| `acob-10th-anniversary-email.jpg` | Anniversary signature logo |

The `-email` suffix exists because these are sized and flattened for email
clients, which strip CSS and handle transparency inconsistently. It is not
decorative — keep it on any new icon added for signature use.

`acob-10th-anniversary.png` (no suffix) is the print-quality version, used by
the report templates in `lib/reports/`, not by signatures.

## Previous-generation icons

`phone.png`, `mail.png`, `web.png`, `linkedin.png`, `x.png`, `facebook.png`,
`instagram.png` and `acob-logo.png` are unreferenced in code. They belong to an
earlier version of the generator that pointed at
`https://www.acoblighting.com/images/signature/...` — the marketing site rather
than this app. Signatures generated in that era are still in circulation, so
these stay put.

## Archived iterations

Thirteen abandoned variants (`-flat`, `-large`, `-safe`, `-v2`, and
`acob-logo-email.png`) from a round of Outlook/Gmail rendering debugging were
moved to `assets-archive/signature-icon-iterations/`. They were never emitted by
any generator, so nothing in the wild references them. They live outside
`public/` so they are no longer deployed or publicly fetchable.
