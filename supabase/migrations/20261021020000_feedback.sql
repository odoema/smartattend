-- SmartAttend schema, part 5: feedback and support messages.
--
-- The business canvas lists "Feedback channels" and "Training & technical
-- support". This is where a message sent from the in-app Help screen lands; an
-- admin reads it under People & settings and marks it done.
create table if not exists smartattend.feedback(
  id bigserial primary key,
  user_id uuid references smartattend.users(id) on delete set null,
  role text,
  page text,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
-- the name is mandatory when IF NOT EXISTS is used
create index if not exists feedback_created_at_idx on smartattend.feedback(created_at desc);

alter table smartattend.feedback enable row level security;
revoke all on smartattend.feedback from public, anon, authenticated;