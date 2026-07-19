# Supabase Setup

Project:

```text
https://supabase.com/dashboard/project/kmzuvxnemqbwqxyepfqp
```

## Naming

All Golf24 tables use the lowercase `golf24_` prefix.

Although the business-facing name is `Golf24_XXXX`, PostgreSQL folds unquoted
identifiers to lowercase. Lowercase table names avoid quoting problems in SQL
and application code.

## Create Tables

1. Open the Supabase project.
2. Go to `SQL Editor`.
3. Create a new query.
4. Paste the full content of:

```text
supabase/schema.sql
```

5. Run the query.

## Expected Tables

After running the schema, Table Editor should show:

```text
golf24_members
golf24_coaches
golf24_admins
golf24_courses
golf24_bookings
golf24_venue_bookings
golf24_payments
golf24_lesson_records
golf24_notifications
```

Default course rows should exist in `golf24_courses`:

```text
新手體驗課
揮桿檢測
正式課程一期
```

## Important

Do not paste secrets into SQL Editor.

Do not commit:

```text
SUPABASE_SERVICE_ROLE_KEY
LINE_CHANNEL_ACCESS_TOKEN
LINE_*_CHANNEL_SECRET
```
