const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ADMIN_PIN = process.env.ADMIN_PIN;
const SYSTEM_RECIPIENTS = (process.env.LINE_NOTIFY_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

function json(res, status, body) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

function assertAdmin(req) {
    if (!ADMIN_PIN) throw new Error('ADMIN_PIN is not set in Vercel Environment Variables');
    if (req.headers['x-admin-pin'] !== ADMIN_PIN) {
        const error = new Error('管理密碼錯誤');
        error.statusCode = 401;
        throw error;
    }
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase environment variables are not set');
    if (!LINE_CHANNEL_ACCESS_TOKEN) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set');
}

async function supabaseFetch(path) {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error((body && body.message) || `Supabase request failed (${response.status})`);
    return body;
}

async function pushMessage(userId) {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            to: userId,
            messages: [{ type: 'text', text: 'Golf24 通知測試成功\n這表示你已設定為新預約通知對象。' }]
        })
    });
    if (!response.ok) throw new Error(`LINE push failed (${response.status})`);
}

export default async function handler(req, res) {
    try {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
        assertAdmin(req);

        const [admins, coaches] = await Promise.all([
            supabaseFetch('/rest/v1/golf24_admins?select=line_user_id&notify_enabled=eq.true&status=eq.active&line_user_id=not.is.null'),
            supabaseFetch('/rest/v1/golf24_coaches?select=line_user_id&notify_enabled=eq.true&status=eq.active&line_user_id=not.is.null')
        ]);
        const recipients = [...new Set([
            ...SYSTEM_RECIPIENTS,
            ...(admins || []).map((person) => person.line_user_id),
            ...(coaches || []).map((person) => person.line_user_id)
        ].filter(Boolean))];
        if (!recipients.length) throw new Error('目前沒有啟用的通知對象');

        const results = await Promise.allSettled(recipients.map(pushMessage));
        const sentCount = results.filter((result) => result.status === 'fulfilled').length;
        const failedCount = results.length - sentCount;
        return json(res, 200, { ok: true, data: { sentCount, failedCount } });
    } catch (error) {
        return json(res, error.statusCode || 500, { ok: false, error: error.message || '測試通知失敗' });
    }
}
