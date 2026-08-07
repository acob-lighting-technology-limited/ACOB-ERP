-- Imported from the acob-erp remote migration ledger (version 20260806111220).
-- Originally applied via the Supabase dashboard/MCP rather than through this repo;
-- captured here so the repository can reproduce production. Already applied — do not
-- re-run against a database that has it.

-- CREATE OR REPLACE with an extra defaulted parameter creates a second overload rather
-- than replacing the original. Any 19-argument call would still resolve to the old body,
-- which silently discards gender — exactly the bug being fixed. Drop the old signature so
-- only the gender-aware version exists.
DROP FUNCTION IF EXISTS public.atomic_complete_user_approval(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text,
  date, text, smallint, text, uuid
);
