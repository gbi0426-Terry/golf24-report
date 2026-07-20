-- Golf24 public booking submission RPC
-- Run in Supabase SQL Editor after supabase/schema.sql.

create or replace function public.golf24_submit_booking(
  p_line_user_id text,
  p_line_display_name text,
  p_line_picture_url text,
  p_name text,
  p_phone text,
  p_course_name text,
  p_coach_name text,
  p_level text,
  p_preferred_date date,
  p_preferred_slot text,
  p_source text,
  p_campaign text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_course_id uuid;
  v_coach_id uuid;
  v_booking_id uuid;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_duration_min integer;
  v_slot_time time;
  v_source text;
begin
  if nullif(trim(p_name), '') is null then
    raise exception 'name is required';
  end if;

  if nullif(trim(p_phone), '') is null then
    raise exception 'phone is required';
  end if;

  if p_preferred_date is null then
    raise exception 'preferred date is required';
  end if;

  if p_preferred_date < current_date then
    raise exception 'preferred date cannot be in the past';
  end if;

  if p_preferred_slot not in ('morning', 'afternoon', 'evening') then
    raise exception 'preferred slot is invalid';
  end if;

  select id, duration_min
    into v_course_id, v_duration_min
  from golf24_courses
  where active = true
    and name = p_course_name
  order by sort_order, created_at
  limit 1;

  if v_course_id is null then
    raise exception 'course not found';
  end if;

  if nullif(trim(coalesce(p_coach_name, '')), '') is not null then
    select id
      into v_coach_id
    from golf24_coaches
    where status = 'active'
      and name = p_coach_name
    order by created_at
    limit 1;
  end if;

  v_slot_time := case p_preferred_slot
    when 'morning' then time '09:00'
    when 'afternoon' then time '13:00'
    when 'evening' then time '19:00'
  end;

  v_start_at := (p_preferred_date + v_slot_time) at time zone 'Asia/Taipei';
  v_end_at := v_start_at + make_interval(mins => v_duration_min);
  v_source := coalesce(nullif(trim(p_source), ''), 'LINE LIFF');

  if nullif(trim(coalesce(p_line_user_id, '')), '') is not null then
    insert into golf24_members (
      name,
      phone,
      line_user_id,
      line_display_name,
      line_picture_url,
      level,
      source,
      campaign,
      note
    )
    values (
      trim(p_name),
      trim(p_phone),
      trim(p_line_user_id),
      nullif(trim(coalesce(p_line_display_name, '')), ''),
      nullif(trim(coalesce(p_line_picture_url, '')), ''),
      nullif(trim(coalesce(p_level, '')), ''),
      v_source,
      nullif(trim(coalesce(p_campaign, '')), ''),
      nullif(trim(coalesce(p_note, '')), '')
    )
    on conflict (line_user_id) do update
    set name = excluded.name,
        phone = excluded.phone,
        line_display_name = excluded.line_display_name,
        line_picture_url = excluded.line_picture_url,
        level = excluded.level,
        source = excluded.source,
        campaign = excluded.campaign,
        note = excluded.note,
        updated_at = now()
    returning id into v_member_id;
  else
    insert into golf24_members (
      name,
      phone,
      level,
      source,
      campaign,
      note
    )
    values (
      trim(p_name),
      trim(p_phone),
      nullif(trim(coalesce(p_level, '')), ''),
      v_source,
      nullif(trim(coalesce(p_campaign, '')), ''),
      nullif(trim(coalesce(p_note, '')), '')
    )
    returning id into v_member_id;
  end if;

  insert into golf24_bookings (
    member_id,
    coach_id,
    course_id,
    preferred_date,
    preferred_slot,
    start_at,
    end_at,
    status,
    venue_status,
    source,
    campaign
  )
  values (
    v_member_id,
    v_coach_id,
    v_course_id,
    p_preferred_date,
    p_preferred_slot,
    v_start_at,
    v_end_at,
    'pending',
    'unchecked',
    v_source,
    nullif(trim(coalesce(p_campaign, '')), '')
  )
  returning id into v_booking_id;

  insert into golf24_venue_bookings (
    booking_id,
    room_id,
    start_at,
    end_at,
    status,
    raw_payload
  )
  values (
    v_booking_id,
    '130128070312263491',
    v_start_at,
    v_end_at,
    'available_checked',
    jsonb_build_object('phase', 'manual_confirmation_required')
  );

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member_id,
    'booking_id', v_booking_id,
    'start_at', v_start_at,
    'end_at', v_end_at
  );
end;
$$;

grant execute on function public.golf24_submit_booking(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text
) to anon, authenticated;
