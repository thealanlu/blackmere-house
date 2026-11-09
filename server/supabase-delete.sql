-- Run in the dedicated Blackmere House Supabase project's SQL editor.
-- This function can only delete the authenticated caller's own Supabase login.
create or replace function public.blackmere_delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.blackmere_delete_my_account() from public, anon;
grant execute on function public.blackmere_delete_my_account() to authenticated;
