-- SmartAttend schema. Run once in the Supabase SQL editor of the target project.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists smartattend;
revoke all on schema smartattend from public, anon, authenticated;

create table smartattend.users(id uuid primary key default gen_random_uuid(), role text not null check (role in ('student','lecturer','admin')), full_name text not null, email text not null unique, reg_no text unique, password_hash text not null, created_at timestamptz not null default now());
create table smartattend.tokens(token_hash text primary key, user_id uuid not null references smartattend.users(id) on delete cascade, created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '30 days');
create index on smartattend.tokens(user_id);
create table smartattend.devices(id uuid primary key default gen_random_uuid(), user_id uuid not null references smartattend.users(id) on delete cascade, credential_id text not null unique, public_key text not null, counter bigint not null default 0, transports text[], label text, rp_id text not null, origin text not null, created_at timestamptz not null default now(), revoked_at timestamptz);
create unique index devices_one_active on smartattend.devices(user_id) where revoked_at is null;
create table smartattend.courses(id uuid primary key default gen_random_uuid(), code text not null, title text not null, lecturer_id uuid not null references smartattend.users(id), venue text, lat double precision, lng double precision, radius_m int not null default 50 check (radius_m between 15 and 500), join_code text not null unique, created_at timestamptz not null default now());
create index on smartattend.courses(lecturer_id);
create table smartattend.slots(id uuid primary key default gen_random_uuid(), course_id uuid not null references smartattend.courses(id) on delete cascade, weekday int not null check (weekday between 0 and 6), start_time time not null, end_time time not null check (end_time > start_time));
create index on smartattend.slots(course_id);
create table smartattend.enrollments(course_id uuid not null references smartattend.courses(id) on delete cascade, student_id uuid not null references smartattend.users(id) on delete cascade, joined_at timestamptz not null default now(), primary key(course_id, student_id));
create index on smartattend.enrollments(student_id);
create table smartattend.sessions(id uuid primary key default gen_random_uuid(), course_id uuid not null references smartattend.courses(id) on delete cascade, opened_by uuid not null references smartattend.users(id), opened_at timestamptz not null default now(), closed_at timestamptz, finalised_at timestamptz, status text not null default 'open' check (status in ('open','checkout','closed')), lat double precision not null, lng double precision not null, radius_m int not null, scheduled boolean not null default true);
create unique index sessions_one_live on smartattend.sessions(course_id) where status <> 'closed';
create table smartattend.attendance(session_id uuid not null references smartattend.sessions(id) on delete cascade, student_id uuid not null references smartattend.users(id) on delete cascade, check_in_at timestamptz not null default now(), check_out_at timestamptz, dist_in int, acc_in int, dist_out int, primary key(session_id, student_id));
create index on smartattend.attendance(student_id);
create table smartattend.excusals(session_id uuid not null references smartattend.sessions(id) on delete cascade, student_id uuid not null references smartattend.users(id) on delete cascade, excused_by uuid not null references smartattend.users(id), at timestamptz not null default now(), primary key(session_id, student_id));
create table smartattend.attempts(id bigserial primary key, session_id uuid references smartattend.sessions(id) on delete cascade, student_id uuid not null references smartattend.users(id) on delete cascade, at timestamptz not null default now(), mode text, stage text, reason text);
create index on smartattend.attempts(session_id);
create table smartattend.challenges(user_id uuid not null references smartattend.users(id) on delete cascade, purpose text not null, challenge text not null, context jsonb, created_at timestamptz not null default now(), primary key(user_id, purpose));
create table smartattend.settings(key text primary key, value text not null);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='smartattend' loop
    execute format('alter table smartattend.%I enable row level security', t);
    execute format('revoke all on smartattend.%I from public, anon, authenticated', t);
  end loop; end $$;

insert into smartattend.settings values
 ('lecturer_code', upper(substr(md5(random()::text),1,6))),
 ('admin_code', upper(substr(md5(random()::text),1,8))),
 ('allowed_origins','https://smartattend.live');

-- Class lists (rosters) and join approval
create table smartattend.roster(course_id uuid not null references smartattend.courses(id) on delete cascade, reg_no text not null, full_name text, added_at timestamptz not null default now(), primary key(course_id, reg_no));
alter table smartattend.roster enable row level security;
revoke all on smartattend.roster from public, anon, authenticated;
alter table smartattend.enrollments add column status text not null default 'active' check (status in ('active','pending'));
create index on smartattend.enrollments(course_id, status);

-- Demo / test-lab flags
alter table smartattend.users add column is_demo boolean not null default false;
alter table smartattend.courses add column is_demo boolean not null default false;
alter table smartattend.attendance add column simulated boolean not null default false;

-- Timetable awareness
alter table smartattend.courses add column group_name text, add column facilitators text, add column term_start date;
alter table smartattend.sessions add column ends_at timestamptz;
create index on smartattend.slots(weekday);
