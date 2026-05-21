-- Add birthday column (MM-DD) as source of truth for automated birthday emails.
-- date_of_birth remains for the full date when the user adds their year via profile.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birthday TEXT;

UPDATE profiles SET birthday = '01-01' WHERE id = '1f2b8298-ad71-49f0-88e7-7cde534a869f'; -- Favour Onuoha-Eke
UPDATE profiles SET birthday = '01-03' WHERE id = '33df14ae-2302-4368-b17c-51180edd0545'; -- Samuel Ikuponiyi
UPDATE profiles SET birthday = '01-07' WHERE id = '55320e85-8bec-49c8-9115-f92f591aa5f6'; -- Vanessa Lawrence-Ukaegbu
UPDATE profiles SET birthday = '01-19' WHERE id = '2a98dd2e-5c4e-4c2b-bcdb-82156b74f626'; -- Agbaje Nurudeen
UPDATE profiles SET birthday = '02-03' WHERE id = 'ea313700-b7dc-43b0-b558-473325de7dee'; -- Ugochukwu Aniezue
UPDATE profiles SET birthday = '02-12' WHERE id = '40679780-7156-4758-81cb-3d5e10b7aed9'; -- Taiwo Peter (Peter Tawio Innocent)
UPDATE profiles SET birthday = '02-14' WHERE id = 'ccfc3041-94a9-4053-b395-d8e2e83cc317'; -- Valentina Ajiboye
UPDATE profiles SET birthday = '02-20' WHERE id = '750cecdb-7275-48a8-9e5e-91778a7a7cb4'; -- Oluwatobi Oladele
UPDATE profiles SET birthday = '03-02' WHERE id = '01b04acc-992a-4773-a6e9-d284321ef4d1'; -- Martins Ishaku
UPDATE profiles SET birthday = '03-04' WHERE id = '3791c0f4-dde9-41f8-a227-986273532d9c'; -- Abdulsamad Danmusa
UPDATE profiles SET birthday = '03-06' WHERE id = 'c0857f43-15bf-459b-b0df-28753c7463fe'; -- Emmanuel Ibanga
UPDATE profiles SET birthday = '03-08' WHERE id = 'a0840fc4-fb4a-4e11-ace6-ee876ed8a357'; -- Emmanuel Chinedu (Egbo)
UPDATE profiles SET birthday = '03-13' WHERE id = 'f16cd078-5324-4837-a011-50c57f9a32d5'; -- Surajo Idris (has full DOB 1998-03-13)
UPDATE profiles SET birthday = '03-15' WHERE id = 'bf9cf43b-363e-4775-8af1-a9f9d58ec681'; -- Rafiat Egunjobi (Toyosi/Omotoyosi)
UPDATE profiles SET birthday = '03-19' WHERE id = '9b517704-5597-4462-a087-41f67141d9a6'; -- Daniel Osa-Egonwa
UPDATE profiles SET birthday = '03-23' WHERE id = 'b4395c0d-c599-4067-91db-e8b62d43b6b7'; -- Peace Terna
UPDATE profiles SET birthday = '03-26' WHERE id = '3fe796c6-4247-482b-a7ed-72c3e6101177'; -- Andrew Inegbedion
UPDATE profiles SET birthday = '03-28' WHERE id = 'b1dbf7df-7e5f-4b90-ad81-07ce86892fcf'; -- Kennedy Odenigbo
UPDATE profiles SET birthday = '03-30' WHERE id = '247e0a49-ed86-46e1-8793-cffe933fedc4'; -- Joshua Ibe
UPDATE profiles SET birthday = '04-04' WHERE id = '90fab3bc-1d14-4690-b086-0169adca1553'; -- Anointed Emoghene (Ann)
UPDATE profiles SET birthday = '04-16' WHERE id = '057f8d91-9502-46c6-abce-491e0fa1a15a'; -- Oghenerune Orhorhomuke (Tansi)
UPDATE profiles SET birthday = '05-03' WHERE id = '496fbecc-10ca-4a60-b9f2-81f84259fd2c'; -- Alhamdu Bawa
UPDATE profiles SET birthday = '05-25' WHERE id = '5d51eddf-18e0-4f5d-aacd-a62225a153f1'; -- Philip Yakubu
UPDATE profiles SET birthday = '06-11' WHERE id = '9dcf4f6c-82aa-4208-ac73-1520395104ce'; -- Eliah Isah (Elija)
UPDATE profiles SET birthday = '06-13' WHERE id = 'ac201010-a443-4ed5-bf73-2e58859f7368'; -- Mercy Okoro
UPDATE profiles SET birthday = '06-16' WHERE id = '1aeae0c5-ef2f-4790-be14-d0e696be01af'; -- Chibuikem Ilonze (has full DOB 2002-06-16)
UPDATE profiles SET birthday = '06-18' WHERE id = '34d57c6a-7ed0-44d0-b9f6-e641ddeed319'; -- Gbenga Ajayi
UPDATE profiles SET birthday = '06-25' WHERE id = '28c76355-0060-4895-8912-4dd342e6d590'; -- Idongesit Sunday
UPDATE profiles SET birthday = '06-26' WHERE id = '08462838-2d7e-4c6b-99e4-2a72eb95865f'; -- Tochukwu Nnadozie
UPDATE profiles SET birthday = '07-02' WHERE id = 'bea1f79a-feac-4a6b-a7a9-a1592c8bf26b'; -- Azeez Afeez
UPDATE profiles SET birthday = '07-03' WHERE id = '38c8e111-225d-4fdc-8907-90c969a224ac'; -- John Dangana
UPDATE profiles SET birthday = '07-08' WHERE id = 'c6d934f4-8d43-4c1c-967e-103c9f49f82a'; -- Onyekachukwu Atishie
UPDATE profiles SET birthday = '07-19' WHERE id = 'd104df8f-c556-4f8b-add1-89998ab4b6f0'; -- Shirley Jackreece
UPDATE profiles SET birthday = '07-28' WHERE id = '626e3c30-3560-4abe-aeb4-24e569725c45'; -- Susan Eze
UPDATE profiles SET birthday = '08-13' WHERE id = '7cd5dba8-87de-4105-aebe-f9521402fc9c'; -- Edward Atoshi
UPDATE profiles SET birthday = '08-13' WHERE id = '49d12f45-b4fd-47c3-8312-784b466d6d29'; -- Peace Ofuafo
UPDATE profiles SET birthday = '08-20' WHERE id = '73a360d9-5830-453c-8358-7aa71e0c34c5'; -- Dennis Innug
UPDATE profiles SET birthday = '09-03' WHERE id = '468dddef-34dd-4d7d-9cad-1eb5a4ad815f'; -- Paul Ojonugua
UPDATE profiles SET birthday = '09-07' WHERE id = 'cea7112e-73b5-4a5c-815d-b7522e5a1d92'; -- Oluwatomi Bayode
UPDATE profiles SET birthday = '09-18' WHERE id = '2c38af91-3c4c-441a-bf46-b66be740df2f'; -- Jerome Egemasi (Jerome Peter)
UPDATE profiles SET birthday = '09-27' WHERE id = 'a2a10cac-a9a2-4449-9366-9af0e7f31f8a'; -- Thomas Olobo
UPDATE profiles SET birthday = '10-07' WHERE id = 'db25cfaa-bab7-425a-891c-05512327cd5b'; -- Caleb Obiechina
UPDATE profiles SET birthday = '10-21' WHERE id = '2fb47546-1924-4018-a19e-a7b5899743f3'; -- Lazarus Chiwendu
