-- Hardening after the security review.
--
-- 1. A clinician on a link moves only the treatments added through that link. A treatment the patient (or another
--    clinician) added is carried forward by them only after the patient accepted it: scheduled, started or completed.
-- 2. What a clinician adds through a link carries the clinician's own name as its author: the name fields cannot be
--    filled with someone else's.

-- ---------------------------------------------------------------- 1. treatments through the link
create or replace function public.share_treatment_item_status(p_session_token text, p_item uuid, p_status text, p_date date, p_reason text,
                                                   p_confirm boolean default false, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_name text; v_res jsonb;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('treatment_plans' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_status = 'accepted' then return jsonb_build_object('status', 'patient_decides'); end if;
  if not exists (select 1 from public.treatment_items i join public.treatment_plans p on p.id = i.plan_id
                  where i.id = p_item and i.patient_id = (c.o_share).patient_id and i.record_status = 'active'
                    and p.status <> 'superseded' and p.record_status = 'active') then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- the clinician moves what was added through this link; what the patient or another clinician added, they only carry
  -- forward once the patient has accepted it (schedule, start, complete) — never cancel, defer or refer it
  if not exists (select 1 from public.treatment_items i
                  where i.id = p_item
                    and (i.contributed_by in (select sc.id from public.share_contributors sc where sc.share_id = (c.o_share).id)
                         or (i.status in ('accepted', 'scheduled', 'in_progress') and p_status in ('scheduled', 'in_progress', 'completed')))) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  begin
    v_res := app.treatment_item_transition(p_item, p_status, p_date, p_reason, p_confirm, c.o_contributor, v_name);
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid', 'reason', sqlerrm);
  end;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'treatment_items', 'id', p_item, 'status', p_status));
  return v_res;
end $$;

-- ---------------------------------------------------------------- 2. the author of a clinician's addition is the clinician
create function app.contributor_author() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_cur text; v_col text := tg_argv[0];
begin
  if new.contributed_by is null then return new; end if;
  select sc.full_name into v_name from public.share_contributors sc where sc.id = new.contributed_by;
  if v_name is null then return new; end if;
  v_cur := to_jsonb(new) ->> v_col;
  -- the clinician's name, alone or followed by their clinic, is kept as written
  if v_cur is null or not (v_cur = v_name or v_cur like v_name || ' — %') then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, left(v_name, 200)));
  end if;
  return new;
end $$;
revoke all on function app.contributor_author() from public;

create trigger clinical_notes_contrib_author before insert on public.clinical_notes for each row execute function app.contributor_author('author_name');
create trigger encounters_contrib_author before insert on public.encounters for each row execute function app.contributor_author('practitioner_name');
create trigger procedures_contrib_author before insert on public.procedures for each row execute function app.contributor_author('operator_name');
create trigger medications_contrib_author before insert on public.medications for each row execute function app.contributor_author('prescriber_name');
create trigger test_orders_contrib_author before insert on public.test_orders for each row execute function app.contributor_author('ordered_by');
create trigger dental_exams_contrib_author before insert on public.dental_exams for each row execute function app.contributor_author('examiner_name');
