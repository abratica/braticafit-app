-- "Create your password" links from the welcome email.
-- Each welcome email carries a random token tied to the client's email. Opening it shows a
-- Create password screen. The link keeps working until they set a password (so tapping it
-- twice, or in two browsers, is fine), and expires after 30 days. Only the edge function
-- (service connection) reads or writes this table.

create table private.setup_links (
  token      text primary key,
  email      text not null check (email = lower(btrim(email))),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_at    timestamptz
);

create index setup_links_email on private.setup_links (email);

revoke all on private.setup_links from public, anon, authenticated;
