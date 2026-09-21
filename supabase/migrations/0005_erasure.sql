-- Kalib — account erasure (SPEC §12: export and erasure before anyone but the author uses it).
-- One call from the signed-in user deletes their auth.users row; every table references it
-- with `on delete cascade`, so all their data goes with it. Run once in the SQL editor.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
