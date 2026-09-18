-- 0006_profile_brokerage_details.sql
-- Settings stores the brokerage the way the forms print it.
--
-- `brokerage_address` was one free-text line, and every form that prints a
-- brokerage prints it as four separate boxes — street, city, province, postal
-- code — plus a phone and a fax. Forms 271, 272, 320 and 324 each have all
-- four; 320, 324, 371 and 372 have the fax. With one line there was nothing
-- to put in them, so they generated blank no matter how completely the
-- realtor filled the intake.
--
-- brokerage_address is kept rather than dropped. Its value seeds
-- brokerage_street below, and production runs the previous deploy for a few
-- minutes after this migration applies — that code still writes the column,
-- and a dropped column would turn its profile save into a 500.

alter table public.profiles
  add column if not exists brokerage_street       text,
  add column if not exists brokerage_city         text,
  add column if not exists brokerage_province     text,
  add column if not exists brokerage_postal_code  text,
  add column if not exists brokerage_phone        text,
  add column if not exists brokerage_fax          text,
  -- The agent's own address, for the "Email Address:" box beside the
  -- brokerage block on Forms 101 and 400. Separate from the sign-in email:
  -- people sign in with a personal address and put the brokerage one on a
  -- contract, and the account's address is not ours to print on a document.
  add column if not exists agent_email            text;

-- Carry the single line over as the street, which is what it was being used
-- for. Only where the realtor hasn't already filled the new field.
update public.profiles
   set brokerage_street = brokerage_address
 where brokerage_street is null
   and coalesce(brokerage_address, '') <> '';

-- Ontario forms print the postal abbreviation and the box holds two
-- characters — see the province default in the intake schema.
update public.profiles
   set brokerage_province = 'ON'
 where brokerage_province is null;
