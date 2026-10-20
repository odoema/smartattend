-- Single-use, short-lived tokens for password recovery on SmartAttend's custom auth accounts.
create table smartattend.password_reset_tokens (
  token_hash text primary key check (length(token_hash) = 64),
  user_id uuid not null references smartattend.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz,
  check (expires_at > created_at)
);
create index password_reset_tokens_user_id_idx on smartattend.password_reset_tokens(user_id);
create index password_reset_tokens_expiry_idx on smartattend.password_reset_tokens(expires_at);
alter table smartattend.password_reset_tokens enable row level security;
revoke all on smartattend.password_reset_tokens from anon, authenticated;

-- Pseudonymous request history supports per-identifier and per-IP throttling; rows are pruned by the edge function.
create table smartattend.password_reset_requests (
  id bigint generated always as identity primary key,
  identifier_hash text not null check (length(identifier_hash) = 64),
  ip_hash text not null check (length(ip_hash) = 64),
  requested_at timestamptz not null default now()
);
create index password_reset_requests_identifier_time_idx on smartattend.password_reset_requests(identifier_hash, requested_at desc);
create index password_reset_requests_ip_time_idx on smartattend.password_reset_requests(ip_hash, requested_at desc);
alter table smartattend.password_reset_requests enable row level security;
revoke all on smartattend.password_reset_requests from anon, authenticated;
