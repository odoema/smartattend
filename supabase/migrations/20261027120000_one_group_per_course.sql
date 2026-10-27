-- One group per course unit, plus indexes for foreign keys the advisor flagged.
-- Applied to production on 2026-10-27 (the trigger was run by hand first; this file
-- records it so a fresh project gets the same rule). Safe to run more than once.

create or replace function smartattend.one_group_per_course()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_code  text;
  v_group text;
  v_other text;
begin
  select code, group_name into v_code, v_group
  from smartattend.courses where id = new.course_id;

  if v_group is null then
    return new;
  end if;

  select oc.group_name into v_other
  from smartattend.enrollments e
  join smartattend.courses oc on oc.id = e.course_id
  where e.student_id = new.student_id
    and oc.code = v_code
    and oc.id <> new.course_id
    and oc.group_name is not null
    and not oc.is_demo
  limit 1;

  if v_other is not null then
    raise exception 'You''re already on % in %. Each course unit is taken in one group only.', v_code, v_other;
  end if;

  return new;
end;
$$;

drop trigger if exists one_group_per_course on smartattend.enrollments;
create trigger one_group_per_course
before insert on smartattend.enrollments
for each row execute function smartattend.one_group_per_course();

create index if not exists attempts_student_idx on smartattend.attempts(student_id);
create index if not exists excusals_student_idx on smartattend.excusals(student_id);
create index if not exists excusals_excused_by_idx on smartattend.excusals(excused_by);
create index if not exists feedback_user_idx on smartattend.feedback(user_id);
create index if not exists sessions_opened_by_idx on smartattend.sessions(opened_by);
