const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_PIN = process.env.ADMIN_PIN;

function json(res, status, body) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function assertAdmin(req) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase environment variables are not set');
    if (!ADMIN_PIN) throw new Error('ADMIN_PIN is not set in Vercel Environment Variables');
    if (req.headers['x-admin-pin'] !== ADMIN_PIN) {
        const error = new Error('管理密碼錯誤');
        error.statusCode = 401;
        throw error;
    }
}

async function supabaseFetch(path, options = {}) {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
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
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!response.ok) throw new Error((body && body.message) || `Supabase request failed (${response.status})`);
    return body;
}

async function listBookings() {
    const select = [
        'id', 'preferred_date', 'preferred_slot', 'start_at', 'end_at', 'status', 'venue_status', 'admin_note', 'source', 'created_at',
        'golf24_members(name,phone,line_display_name,level,source,note)',
        'golf24_courses(name,type,price,package_size)',
        'golf24_coaches(name)'
    ].join(',');
    return supabaseFetch(`/rest/v1/golf24_bookings?select=${encodeURIComponent(select)}&order=created_at.desc&limit=200`, { method: 'GET' });
}

async function updateBooking(body) {
    const id = clean(body.id);
    const allowedStatuses = new Set(['pending', 'confirmed', 'paid', 'completed', 'cancelled', 'no_show']);
    if (!id) throw new Error('缺少預約編號');
    if (!allowedStatuses.has(body.status)) throw new Error('不支援的預約狀態');
    const rows = await supabaseFetch(`/rest/v1/golf24_bookings?id=eq.${encodeURIComponent(id)}&select=*`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: body.status, admin_note: clean(body.admin_note) || null })
    });
    return Array.isArray(rows) ? rows[0] : rows;
}

export default async function handler(req, res) {
    try {
        assertAdmin(req);
        if (req.method === 'GET') return json(res, 200, { ok: true, data: await listBookings() });
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        if (req.method === 'PATCH') return json(res, 200, { ok: true, data: await updateBooking(body) });
        return json(res, 405, { ok: false, error: 'Method not allowed' });
    } catch (error) {
        console.error(error);
        return json(res, error.statusCode || 500, { ok: false, error: error.message || 'Booking admin API failed' });
    }
}
