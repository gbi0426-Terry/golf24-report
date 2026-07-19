-- Golf24 coach booking platform schema
-- Run this in Supabase SQL Editor for project kmzuvxnemqbwqxyepfqp.
-- Table names intentionally use lowercase golf24_ prefix because PostgreSQL
-- folds unquoted identifiers to lowercase.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'golf24_booking_status') then
    create type golf24_booking_status as enum (
      'pending',
      'confirmed',
      'paid',
      'completed',
      'cancelled',
      'no_show'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'golf24_payment_status') then
    create type golf24_payment_status as enum (
      'pending',
      'paid',
      'refunded',
      'failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'golf24_notification_status') then
    create type golf24_notification_status as enum (
      'pending',
      'sent',
      'failed'
    );
  end if;
end $$;

create table if not exists golf24_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  line_user_id text unique,
  line_display_name text,
  line_picture_url text,
  line_friend boolean not null default false,
  level text,
  source text,
  campaign text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists golf24_coaches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  specialty text,
  bio text,
  certifications text,
  revenue_share numeric(5,4),
  line_user_id text unique,
  notify_enabled boolean not null default true,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf24_coaches_status_check check (status in ('active', 'inactive'))
);

create table if not exists golf24_admins (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'operator',
  line_user_id text unique,
  notify_enabled boolean not null default true,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf24_admins_role_check check (role in ('owner', 'manager', 'operator')),
  constraint golf24_admins_status_check check (status in ('active', 'inactive'))
);

create table if not exists golf24_courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  duration_min integer not null default 60,
  price integer,
  deposit integer,
  target text,
  package_size integer not null default 1,
  completion_days integer,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf24_courses_type_check check (type in ('trial', 'swing_check', 'package')),
  constraint golf24_courses_duration_check check (duration_min > 0),
  constraint golf24_courses_price_check check (price is null or price >= 0),
  constraint golf24_courses_deposit_check check (deposit is null or deposit >= 0)
);

create table if not exists golf24_bookings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references golf24_members(id) on delete restrict,
  coach_id uuid references golf24_coaches(id) on delete set null,
  course_id uuid not null references golf24_courses(id) on delete restrict,
  preferred_date date not null,
  preferred_slot text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status golf24_booking_status not null default 'pending',
  venue_status text not null default 'unchecked',
  admin_note text,
  source text,
  campaign text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf24_bookings_time_check check (end_at > start_at),
  constraint golf24_bookings_preferred_slot_check check (
    preferred_slot is null or preferred_slot in ('morning', 'afternoon', 'evening')
  ),
  constraint golf24_bookings_venue_status_check check (
    venue_status in ('unchecked', 'available_checked', 'held', 'confirmed', 'failed', 'cancelled')
  )
);

create table if not exists golf24_venue_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references golf24_bookings(id) on delete cascade,
  provider text not null default 'golf24_gobooking',
  room_id text not null,
  external_booking_id text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'available_checked',
  raw_payload jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf24_venue_bookings_time_check check (end_at > start_at),
  constraint golf24_venue_bookings_status_check check (
    status in ('available_checked', 'held', 'booked', 'failed', 'cancelled')
  )
);

create table if not exists golf24_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references golf24_bookings(id) on delete cascade,
  order_no text unique,
  amount integer not null,
  kind text not null default 'deposit',
  method text not null default 'ecpay',
  status golf24_payment_status not null default 'pending',
  paid_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf24_payments_amount_check check (amount >= 0),
  constraint golf24_payments_kind_check check (kind in ('deposit', 'full')),
  constraint golf24_payments_method_check check (method in ('ecpay', 'cash', 'transfer'))
);

create table if not exists golf24_lesson_records (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references golf24_bookings(id) on delete cascade,
  coach_id uuid references golf24_coaches(id) on delete set null,
  focus text,
  improvement text,
  video_url text,
  next_goal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists golf24_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references golf24_bookings(id) on delete cascade,
  recipient_type text not null,
  recipient_id uuid,
  line_user_id text,
  event text not null,
  status golf24_notification_status not null default 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf24_notifications_recipient_type_check check (
    recipient_type in ('coach', 'admin', 'member')
  ),
  constraint golf24_notifications_event_check check (
    event in (
      'booking_created',
      'coach_assigned',
      'booking_confirmed',
      'payment_link_sent'
    )
  )
);

create or replace function golf24_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists golf24_members_set_updated_at on golf24_members;
create trigger golf24_members_set_updated_at
before update on golf24_members
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_coaches_set_updated_at on golf24_coaches;
create trigger golf24_coaches_set_updated_at
before update on golf24_coaches
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_admins_set_updated_at on golf24_admins;
create trigger golf24_admins_set_updated_at
before update on golf24_admins
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_courses_set_updated_at on golf24_courses;
create trigger golf24_courses_set_updated_at
before update on golf24_courses
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_bookings_set_updated_at on golf24_bookings;
create trigger golf24_bookings_set_updated_at
before update on golf24_bookings
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_venue_bookings_set_updated_at on golf24_venue_bookings;
create trigger golf24_venue_bookings_set_updated_at
before update on golf24_venue_bookings
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_payments_set_updated_at on golf24_payments;
create trigger golf24_payments_set_updated_at
before update on golf24_payments
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_lesson_records_set_updated_at on golf24_lesson_records;
create trigger golf24_lesson_records_set_updated_at
before update on golf24_lesson_records
for each row execute function golf24_set_updated_at();

drop trigger if exists golf24_notifications_set_updated_at on golf24_notifications;
create trigger golf24_notifications_set_updated_at
before update on golf24_notifications
for each row execute function golf24_set_updated_at();

create index if not exists golf24_members_phone_idx on golf24_members(phone);
create index if not exists golf24_members_line_user_id_idx on golf24_members(line_user_id);
create index if not exists golf24_coaches_status_idx on golf24_coaches(status);
create index if not exists golf24_courses_active_idx on golf24_courses(active);
create index if not exists golf24_bookings_status_idx on golf24_bookings(status);
create index if not exists golf24_bookings_start_at_idx on golf24_bookings(start_at);
create index if not exists golf24_bookings_coach_id_idx on golf24_bookings(coach_id);
create index if not exists golf24_venue_bookings_room_time_idx
  on golf24_venue_bookings(room_id, start_at, end_at);
create index if not exists golf24_notifications_status_idx on golf24_notifications(status);

alter table golf24_members enable row level security;
alter table golf24_coaches enable row level security;
alter table golf24_admins enable row level security;
alter table golf24_courses enable row level security;
alter table golf24_bookings enable row level security;
alter table golf24_venue_bookings enable row level security;
alter table golf24_payments enable row level security;
alter table golf24_lesson_records enable row level security;
alter table golf24_notifications enable row level security;

drop policy if exists "Public can read active golf24 courses" on golf24_courses;
create policy "Public can read active golf24 courses"
on golf24_courses
for select
to anon, authenticated
using (active = true);

drop policy if exists "Public can read active golf24 coaches" on golf24_coaches;
create policy "Public can read active golf24 coaches"
on golf24_coaches
for select
to anon, authenticated
using (status = 'active');

insert into golf24_courses (
  name,
  type,
  duration_min,
  price,
  deposit,
  target,
  package_size,
  completion_days,
  active,
  sort_order
) values
  ('新手體驗課', 'trial', 60, 1500, 500, '第一次接觸高爾夫，建立基礎動作', 1, null, true, 10),
  ('揮桿檢測', 'swing_check', 60, 1500, 500, '已有基礎，想找出揮桿問題與改善方向', 1, null, true, 20),
  ('正式課程一期', 'package', 60, null, 500, '依體驗或檢測結果安排，一期五堂，須於一個月內完成', 5, 30, true, 30)
on conflict do nothing;
