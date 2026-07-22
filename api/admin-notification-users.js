const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_PIN = process.env.ADMIN_PIN;
const SYSTEM_NOTIFY_USER_IDS = (process.env.LINE_NOTIFY_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

function json(res, status, body) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function assertConfig() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('Supabase environment variables are not set');
    }
}

function assertAdmin(req) {
    if (!ADMIN_PIN) {
        throw new Error('ADMIN_PIN is not set in Vercel Environment Variables');
    }
    const pin = req.headers['x-admin-pin'];
    if (pin !== ADMIN_PIN) {
        const error = new Error('管理密碼錯誤');
        error.statusCode = 401;
        throw error;
    }
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

function getTable(type) {
    if (type === 'admin') return 'golf24_admins';
    if (type === 'coach') return 'golf24_coaches';
    throw new Error('type must be admin or coach');
}

async function listUsers() {
    const [admins, coaches] = await Promise.all([
        supabaseFetch('/rest/v1/golf24_admins?select=id,name,role,line_user_id,notify_enabled,status,created_at,updated_at&order=created_at.asc', {
            method: 'GET'
        }),
        supabaseFetch('/rest/v1/golf24_coaches?select=id,name,specialty,line_user_id,notify_enabled,status,created_at,updated_at&order=created_at.asc', {
            method: 'GET'
        })
    ]);

    const savedRecipientIds = new Set([
        ...admins.map((admin) => admin.line_user_id),
        ...coaches.map((coach) => coach.line_user_id)
    ].filter(Boolean));

    return {
        admins: Array.isArray(admins) ? admins : [],
        coaches: Array.isArray(coaches) ? coaches : [],
        // These recipients are configured in Vercel and already receive new-booking alerts.
        systemRecipients: SYSTEM_NOTIFY_USER_IDS.filter((id) => !savedRecipientIds.has(id))
    };
}

async function saveUser(body) {
    const type = clean(body.type);
    const table = getTable(type);
    const id = clean(body.id);
    const name = clean(body.name);
    const lineUserId = clean(body.line_user_id);

    if (!name) throw new Error('請填姓名');
    if (!lineUserId || !lineUserId.startsWith('U')) {
        throw new Error('LINE userId 必須是 U 開頭');
    }

    const payload = {
        name,
        line_user_id: lineUserId,
        notify_enabled: Boolean(body.notify_enabled),
        status: clean(body.status) || 'active'
    };

    if (type === 'admin') {
        payload.role = clean(body.role) || 'operator';
    } else {
        payload.specialty = clean(body.specialty);
    }

    if (id) {
        const encodedId = encodeURIComponent(id);
        const rows = await supabaseFetch(`/rest/v1/${table}?id=eq.${encodedId}&select=*`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(payload)
        });
        return Array.isArray(rows) ? rows[0] : rows;
    }

    const rows = await supabaseFetch(`/rest/v1/${table}?select=*`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
    });
    return Array.isArray(rows) ? rows[0] : rows;
}

async function disableUser(body) {
    const type = clean(body.type);
    const table = getTable(type);
    const id = clean(body.id);
    if (!id) throw new Error('Missing id');

    const encodedId = encodeURIComponent(id);
    const rows = await supabaseFetch(`/rest/v1/${table}?id=eq.${encodedId}&select=*`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            status: 'inactive',
            notify_enabled: false
        })
    });
    return Array.isArray(rows) ? rows[0] : rows;
}

export default async function handler(req, res) {
    try {
        assertConfig();
        assertAdmin(req);

        if (req.method === 'GET') {
            return json(res, 200, { ok: true, data: await listUsers() });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

        if (req.method === 'POST') {
            return json(res, 200, { ok: true, data: await saveUser(body) });
        }

        if (req.method === 'DELETE') {
            return json(res, 200, { ok: true, data: await disableUser(body) });
        }

        return json(res, 405, { ok: false, error: 'Method not allowed' });
    } catch (error) {
        console.error(error);
        return json(res, error.statusCode || 500, { ok: false, error: error.message || 'Admin API failed' });
    }
}
