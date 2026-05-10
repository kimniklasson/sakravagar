-- Gör route feedback redigerbar för samma klientflöde som skapade raden.
-- API:t håller feedback-id:t i klient-state och använder det för att lägga
-- till kommentar eller ta bort rösten om användaren togglar av samma tumme.

create or replace function update_route_feedback_comment(
  p_feedback_id uuid,
  p_comment text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_comment text;
begin
  v_comment := nullif(btrim(coalesce(p_comment, '')), '');
  if v_comment is not null and char_length(v_comment) > 200 then
    raise exception 'comment too long';
  end if;

  update route_feedback
  set comment = v_comment
  where id = p_feedback_id;

  if not found then
    raise exception 'feedback not found';
  end if;

  return p_feedback_id;
end;
$$;

grant execute on function update_route_feedback_comment(uuid, text)
  to anon, authenticated;

create or replace function delete_route_feedback(
  p_feedback_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from route_feedback
  where id = p_feedback_id;

  return found;
end;
$$;

grant execute on function delete_route_feedback(uuid)
  to anon, authenticated;
