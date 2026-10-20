-- Fails the build if the migrations do not create a table the API expects.
-- Keep this list in step with EXPECTED_TABLES in smartattend-api/index.ts.
do $$
declare missing text;
begin
  select string_agg(t, ', ' order by t) into missing
    from unnest(array[
      'users','tokens','devices','courses','slots','enrollments','sessions','attendance',
      'excusals','attempts','challenges','settings','roster','password_reset_tokens',
      'password_reset_requests','feedback'
    ]) as t
   where to_regclass('smartattend.' || t) is null;

  if missing is not null then
    raise exception 'migrations did not create: %', missing;
  end if;
  raise notice 'all expected tables present';
end $$;