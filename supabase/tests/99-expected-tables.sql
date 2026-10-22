-- Fails the build if the migrations do not create a table the API expects.
-- Keep this list in step with EXPECTED_TABLES in smartattend-api/index.ts.
do $$
declare missing text;
begin
  select string_agg(t, ', ' order by t) into missing
    from unnest(array[
      'users','tokens','devices','courses','slots','enrollments','sessions','attendance',
      'excusals','attempts','challenges','settings','roster','password_reset_tokens',
      'password_reset_requests','feedback','auth_rate_limits'
    ]) as t
   where to_regclass('smartattend.' || t) is null;

  if missing is not null then
    raise exception 'migrations did not create: %', missing;
  end if;

  if not (select relrowsecurity from pg_class
          where oid = 'smartattend.auth_rate_limits'::regclass) then
    raise exception 'RLS is not enabled on smartattend.auth_rate_limits';
  end if;

  if has_table_privilege('anon', 'smartattend.auth_rate_limits', 'SELECT')
     or has_table_privilege('anon', 'smartattend.auth_rate_limits', 'INSERT')
     or has_table_privilege('anon', 'smartattend.auth_rate_limits', 'UPDATE')
     or has_table_privilege('anon', 'smartattend.auth_rate_limits', 'DELETE')
     or has_table_privilege('anon', 'smartattend.auth_rate_limits', 'TRUNCATE')
     or has_table_privilege('anon', 'smartattend.auth_rate_limits', 'REFERENCES')
     or has_table_privilege('anon', 'smartattend.auth_rate_limits', 'TRIGGER')
     or has_table_privilege('authenticated', 'smartattend.auth_rate_limits', 'SELECT')
     or has_table_privilege('authenticated', 'smartattend.auth_rate_limits', 'INSERT')
     or has_table_privilege('authenticated', 'smartattend.auth_rate_limits', 'UPDATE')
     or has_table_privilege('authenticated', 'smartattend.auth_rate_limits', 'DELETE')
     or has_table_privilege('authenticated', 'smartattend.auth_rate_limits', 'TRUNCATE')
     or has_table_privilege('authenticated', 'smartattend.auth_rate_limits', 'REFERENCES')
     or has_table_privilege('authenticated', 'smartattend.auth_rate_limits', 'TRIGGER') then
    raise exception 'anon/authenticated/public must have no data privileges on auth_rate_limits';
  end if;

  raise notice 'all expected tables present';
end $$;
