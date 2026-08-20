-- ROLLBACK for the 2026-08-19 wipe of fabricated contract-staff auth emails.
--
-- Context: 46 contract-staff profiles were bulk-created on 2026-07-23. To satisfy the
-- profiles.id -> auth.users.id foreign key, the import generated @org.acoblighting.com
-- addresses that do not exist as real mailboxes and never will. This script restores
-- exactly what was removed, should that ever be needed.
--
-- The wipe removed the address from BOTH places it was stored:
--   * auth.users.email / email_confirmed_at  -> set to NULL
--   * auth.identities                        -> the provider='email' row was deleted
--
-- Every one of the 46 shared identical metadata, so it is reconstructed rather than
-- listed per row: confirmed at 2026-07-23 07:45:42.90509+00, provider 'email',
-- provider_id = user id, identity_data {sub, email, email_verified: true,
-- phone_verified: false}. auth.identities.id was a random uuid and is regenerated —
-- nothing references it.
--
-- Nothing else was touched. Profiles, employee numbers and all HR history were never
-- part of this change.

BEGIN;

CREATE TEMP TABLE _restore (user_id uuid, email text) ON COMMIT DROP;

INSERT INTO _restore (user_id, email) VALUES
  ('1c365dfc-8821-4a95-8f45-ba02d848bd31', 'a.abdulmalik@org.acoblighting.com'),
  ('6e40f198-34dd-4992-bed0-6409be20fa9c', 'a.ademola@org.acoblighting.com'),
  ('d4c5bc82-a509-4aba-a93e-83dbf298339a', 'a.agivo@org.acoblighting.com'),
  ('0c03e45c-b855-4fb3-a8e5-d649a0550999', 'a.aisha@org.acoblighting.com'),
  ('506df3e7-eda4-4199-8463-e3a474c415ae', 'a.akinbebije@org.acoblighting.com'),
  ('5570c115-50a7-4c23-a457-1a2948439207', 'a.benson@org.acoblighting.com'),
  ('cfb877ed-698a-4d48-9a68-80671d31d3f5', 'a.idowu@org.acoblighting.com'),
  ('e809a423-c348-43af-8b84-04cbc2db4f75', 'a.rabiu@org.acoblighting.com'),
  ('158dde7e-b15e-4a5f-837a-ec611521b9f0', 'a.sefui@org.acoblighting.com'),
  ('bd22d2ba-e0c3-4d4e-85bd-4c2e9078a82d', 'a.segun@org.acoblighting.com'),
  ('a197547f-ceae-45fb-a57d-8913171c8df7', 'a.tunde@org.acoblighting.com'),
  ('f4a183b3-1653-48f4-b0e0-612758ba02c6', 'a.tunde2@org.acoblighting.com'),
  ('754ffe0d-9c6d-4c87-ae97-45dc6f9d861d', 'b.adewale@org.acoblighting.com'),
  ('3d9a3338-74e7-46d1-ab23-4853f79785f9', 'd.adefila@org.acoblighting.com'),
  ('f2cc36a8-7f18-4384-adbd-a568cf1b95c3', 'd.peace@org.acoblighting.com'),
  ('1e2d9495-155d-46d3-95da-956226b9a74e', 'd.ujor@org.acoblighting.com'),
  ('d6a76170-7bb0-4fdb-9b6b-43d14840fb16', 'e.ezekiel@org.acoblighting.com'),
  ('67c79696-98fc-4cba-a86f-d5828398ddce', 'e.onyeka@org.acoblighting.com'),
  ('47b786f6-364d-472b-b4ab-e36a1c42983f', 'h.ode@org.acoblighting.com'),
  ('43e978c1-49c0-437a-b92b-f611250fb053', 'h.okechukwu@org.acoblighting.com'),
  ('c643b89e-2848-4d39-8c86-4f54f80ac9a3', 'h.shehu@org.acoblighting.com'),
  ('7f7a1b9a-3927-4b4f-881a-95d6ca02c555', 'h.usman@org.acoblighting.com'),
  ('d0f91249-e5f4-4911-951b-3566a1da7c82', 'i.bulus@org.acoblighting.com'),
  ('6b9394fa-df98-44d6-88e0-263df7f6eec5', 'i.faruku@org.acoblighting.com'),
  ('9b56ab9b-57be-48b5-8c05-ce3e517f86a5', 'j.jimoh@org.acoblighting.com'),
  ('cdb99505-bbb0-4874-b613-415618ce97df', 'l.micheal@org.acoblighting.com'),
  ('33292a57-017f-40ab-8b4a-4a7e0a127981', 'm.ehi@org.acoblighting.com'),
  ('6867a4ec-937e-4f0e-9ad6-040fe97000d0', 'm.odeyemi@org.acoblighting.com'),
  ('7aaf3fb2-1f57-425e-8945-637c7330deda', 'm.owanda@org.acoblighting.com'),
  ('83c0c8c8-f1b9-4fd9-bc28-5fc4f82e3734', 'm.wasiu@org.acoblighting.com'),
  ('6a7a7d2d-343b-45d4-af34-27798597b073', 'n.augustain@org.acoblighting.com'),
  ('8795bf91-d497-4406-9f27-5236ab2853c4', 'o.isa@org.acoblighting.com'),
  ('96387a53-0736-4670-96b2-14c5f5d8a9d8', 'r.bilyaminu@org.acoblighting.com'),
  ('ae30a5ef-19f9-4ff2-9447-5cbbe5f1d14f', 's.abioye@org.acoblighting.com'),
  ('9eb742ff-65c5-4700-8c0f-777bdaac3084', 's.adeiza@org.acoblighting.com'),
  ('0e9c1c3a-6ecc-48d5-b270-ce8232ae665e', 's.agya@org.acoblighting.com'),
  ('06e6aab7-2c40-4d66-9cf2-1fd12b324be1', 's.deyabu@org.acoblighting.com'),
  ('27fb9f70-3d20-4c78-b2dd-03ab7db9be42', 's.ibrahim@org.acoblighting.com'),
  ('5b0a8e89-e9a3-47a9-99a3-357dda117434', 's.ibrahim2@org.acoblighting.com'),
  ('adfd152f-08c5-46b2-81da-6d2ab385c732', 's.mohammed@org.acoblighting.com'),
  ('0b010d1f-7e10-48e3-90e0-45f31c959369', 's.mustapha@org.acoblighting.com'),
  ('77a05587-cd48-4548-8287-042e19fea78c', 's.oseni@org.acoblighting.com'),
  ('1403bd52-b151-4ba8-9146-cdaad390effb', 's.yunusa@org.acoblighting.com'),
  ('622c9236-57c6-4449-9906-f60ccf647e51', 't.bashir@org.acoblighting.com'),
  ('a4545c28-11c0-42a1-9cda-4f8ed0c31bf7', 'y.abdulahi@org.acoblighting.com'),
  ('58d38427-b625-47d7-89f9-dcdaa646f968', 'y.abubakar@org.acoblighting.com');

UPDATE auth.users u
SET email = r.email,
    email_confirmed_at = '2026-07-23 07:45:42.90509+00'::timestamptz
FROM _restore r
WHERE u.id = r.user_id;

INSERT INTO auth.identities
  (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  r.user_id,
  jsonb_build_object(
    'sub', r.user_id::text,
    'email', r.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  r.user_id::text,
  '2026-07-23 07:45:42.90509+00'::timestamptz,
  '2026-07-23 07:45:42.90509+00'::timestamptz,
  '2026-07-23 07:45:42.90509+00'::timestamptz
FROM _restore r
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities i
  WHERE i.user_id = r.user_id AND i.provider = 'email'
);

COMMIT;
