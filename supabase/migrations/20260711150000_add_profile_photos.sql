-- Adds employee profile photos. Storage is private and server-mediated only
-- (no storage.objects RLS policies granted to anon/authenticated — every
-- read/write goes through app/api/profile/avatar/route.ts using the
-- service-role client, matching the payment_documents/fleet_booking_documents
-- pattern). /birthday now sources each celebrant's photo from here instead
-- of the old public/images/birthday/*.jpg files.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile_photos',
  'profile_photos',
  false,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
