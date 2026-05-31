INSERT INTO public.correspondence_categories (name, code)
VALUES ('BID', 'BID')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name;
