create table smartattend.auth_rate_limits (
  scope text not null check (scope in ('identifier', 'network')),
  key_hash text not null check (length(key_hash) = 64),
  window_start timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  primary key (scope, key_hash, window_start)
);

create index auth_rate_limits_window_idx on smartattend.auth_rate_limits(window_start);
alter table smartattend.auth_rate_limits enable row level security;
revoke all on smartattend.auth_rate_limits from public, anon, authenticated;
