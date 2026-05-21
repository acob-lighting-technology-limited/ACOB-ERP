-- Remote Web Check-In Feature
-- Creates attendance_sites table and adds remote check-in columns to
-- attendance_records and profiles.

-- ─── Sites table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_sites (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT         NOT NULL,
  address        TEXT,
  latitude       DECIMAL(10, 7) NOT NULL,
  longitude      DECIMAL(10, 7) NOT NULL,
  radius_metres  INTEGER      NOT NULL DEFAULT 150,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- RLS: readable by any authenticated user (needed for proximity check on clock-in);
-- writable only by service role / admins via API.
ALTER TABLE attendance_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read active sites"
  ON attendance_sites FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ─── New columns on attendance_records ───────────────────────────────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS selfie_url       TEXT,
  ADD COLUMN IF NOT EXISTS selfie_out_url   TEXT,
  ADD COLUMN IF NOT EXISTS latitude         DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS longitude        DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS site_id          UUID REFERENCES attendance_sites(id),
  ADD COLUMN IF NOT EXISTS location_verified   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS face_match_confidence DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS face_verified    BOOLEAN DEFAULT false;

-- ─── New columns on profiles ──────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS remote_checkin_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS face_reference_url     TEXT;

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_records_site_id
  ON attendance_records(site_id)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_sites_active
  ON attendance_sites(is_active);
