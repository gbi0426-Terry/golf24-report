const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_NOTIFY_USER_IDS = (process.env.LINE_NOTIFY_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

function json(res, status, body) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

function firstString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function buildSummary(payload, bookingId) {
    const bookingNo = bookingId ? String(bookingId).slice(0, 8) : '未取得';
    return [
        'Golf24 新預約',
        `預約編號：${bookingNo}`,
        `姓名：${payload.p_name}`,
        `手機：${payload.p_phone}`,
        `課程：${payload.p_course_name}`,
        `教練：${payload.p_coach_name || '不指定'}`,
        `程度：${payload.p_level || '-'}`,
        `希望時間：${payload.p_preferred_date} ${payload.p_preferred_slot}`,
        `LINE：${payload.p_line_display_name || '尚未取得'}`,
        `來源：${payload.p_source || '-'}`,
        payload.p_note ? `備註：${payload.p_note}` : ''
    ].filter(Boolean).join('\n');
}

async function supabaseFetch(path, options = {}) {
    const url = `${SUPABASE_URL.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let body = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch (_) {
            body = text;
        }
    }

    if (!response.ok) {
        const message = body && body.message ? body.message : `Supabase request failed (${response.status})`;
        throw new Error(message);
    }

    return body;
}

async function fetchNotifyUserIds(coachName) {
    const ids = new Set(LINE_NOTIFY_USER_IDS);

    if (!SUPABASE_URL || !SUPABASE_KEY) return Array.from(ids);

    const admins = await supabaseFetch('/rest/v1/golf24_admins?select=line_user_id&notify_enabled=eq.true&status=eq.active&line_user_id=not.is.null', {
        method: 'GET'
    });
    if (Array.isArray(admins)) {
        admins.forEach((admin) => admin.line_user_id && ids.add(admin.line_user_id));
    }

    if (coachName) {
        const encodedName = encodeURIComponent(coachName);
        const coaches = await supabaseFetch(`/rest/v1/golf24_coaches?select=line_user_id&name=eq.${encodedName}&notify_enabled=eq.true&status=eq.active&line_user_id=not.is.null`, {
            method: 'GET'
        });
        if (Array.isArray(coaches)) {
            coaches.forEach((coach) => coach.line_user_id && ids.add(coach.line_user_id));
        }
    }

    return Array.from(ids);
}

async function pushLineMessage(to, text) {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            to,
            messages: [{ type: 'text', text }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LINE push failed (${response.status}): ${errorText}`);
    }
}

async function notifyLineRecipients(payload, bookingId) {
    if (!LINE_CHANNEL_ACCESS_TOKEN) {
        return { sent: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN is not set' };
    }

    const recipients = await fetchNotifyUserIds(payload.p_coach_name);
    if (recipients.length === 0) {
        return { sent: false, reason: 'No LINE recipients configured' };
    }

    const message = buildSummary(payload, bookingId);
    const results = await Promise.allSettled(recipients.map((userId) => pushLineMessage(userId, message)));
    const sentCount = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results
        .map((result, index) => ({ result, userId: recipients[index] }))
        .filter(({ result }) => result.status === 'rejected')
        .map(({ result, userId }) => ({ userId, message: result.reason.message }));

    return { sent: sentCount > 0, sent_count: sentCount, failed };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return json(res, 405, { ok: false, error: 'Method not allowed' });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return json(res, 500, { ok: false, error: 'Supabase environment variables are not set' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const payload = {
            p_line_user_id: firstString(body.line_user_id) || null,
            p_line_display_name: firstString(body.line_display_name) || null,
            p_line_picture_url: firstString(body.line_picture_url) || null,
            p_name: firstString(body.name),
            p_phone: firstString(body.phone),
            p_course_name: firstString(body.course),
            p_coach_name: firstString(body.coach) || '古教練',
            p_level: firstString(body.level) || null,
            p_preferred_date: firstString(body.date),
            p_preferred_slot: firstString(body.time_slot),
            p_source: firstString(body.source) || 'LINE LIFF',
            p_campaign: firstString(body.campaign) || null,
            p_note: firstString(body.note) || null
        };

        const missing = [];
        if (!payload.p_name) missing.push('姓名');
        if (!payload.p_phone) missing.push('手機');
        if (!payload.p_course_name) missing.push('課程');
        if (!payload.p_preferred_date) missing.push('日期');
        if (!payload.p_preferred_slot) missing.push('時段');

        if (missing.length > 0) {
            return json(res, 400, { ok: false, error: `請補上：${missing.join('、')}。` });
        }

        const bookingResult = await supabaseFetch('/rest/v1/rpc/golf24_submit_booking', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const notification = await notifyLineRecipients(payload, bookingResult && bookingResult.booking_id);

        return json(res, 200, {
            ok: true,
            booking: bookingResult,
            notification
        });
    } catch (error) {
        console.error(error);
        return json(res, 500, { ok: false, error: error.message || 'Booking submit failed' });
    }
}
