// Simple proxy server to avoid CORS issues with Sched.com API
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const {
    createSlotsForMonth,
    createLeadershipSlotsForDay,
    createGeneralSlotsForDay
} = require('./js/main');

let schedule = null;
try {
    schedule = require('node-schedule');
} catch (error) {
    schedule = null;
}

const app = express();
const PORT = 3000;
const SUBDOMAIN = "stvincentsclinic2025";

// Enable CORS for all routes
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML, CSS, JS)
app.use(express.static('.'));

async function schedApiCall(path, params, apiKey) {
    const formData = new URLSearchParams();
    formData.append('api_key', apiKey);

    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined || value === null) {
            continue;
        }

        formData.append(key, String(value));
    }

    const response = await fetch(`https://${SUBDOMAIN}.sched.com/api/${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'STV-Sched-API/1.0'
        },
        body: formData.toString()
    });

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(`API Error for ${path}: ${responseText} (Status: ${response.status})`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return JSON.parse(responseText);
    }

    try {
        return JSON.parse(responseText);
    } catch (error) {
        return responseText;
    }
}

function parseSchedDateTime(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalizedValue = value.includes('T') ? value : value.replace(' ', 'T');
    const parsedDate = new Date(normalizedValue);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function normalizeSessionListResponse(response) {
    if (Array.isArray(response)) {
        return response;
    }

    if (!response || typeof response !== 'object') {
        return [];
    }

    if (Array.isArray(response.sessions)) {
        return response.sessions;
    }

    if (Array.isArray(response.session)) {
        return response.session;
    }

    if (Array.isArray(response.data)) {
        return response.data;
    }

    return [];
}

function getSessionStart(session) {
    return parseSchedDateTime(
        session.session_start ||
        session.start ||
        session.start_time ||
        session.starts_at ||
        session.begin_at
    );
}

function isSessionFrozen(session) {
    return session.frozen === 'Y' || session.frozen === true || session.frozen === 1 || session.frozen === '1';
}

function toNumber(value) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function isSessionFull(session) {
    const explicitFlags = [
        session.full,
        session.is_full,
        session.isFull,
        session.status,
        session.session_status
    ];

    if (explicitFlags.some((value) => value === true || value === 1 || value === '1' || value === 'Y' || value === 'y')) {
        return true;
    }

    if (explicitFlags.some((value) => typeof value === 'string' && value.toLowerCase() === 'full')) {
        return true;
    }

    const seatFields = [
        ['seats', 'registered'],
        ['seats', 'attendees'],
        ['seats', 'filled'],
        ['capacity', 'registered'],
        ['capacity', 'attendees']
    ];

    for (const [capacityField, usedField] of seatFields) {
        const capacity = toNumber(session[capacityField]);
        const used = toNumber(session[usedField]);

        if (capacity !== null && used !== null && used >= capacity) {
            return true;
        }
    }

    const remainingFields = [
        session.seats_remaining,
        session.available_seats,
        session.open_seats,
        session.remaining_seats
    ];

    if (remainingFields.some((value) => toNumber(value) === 0)) {
        return true;
    }

    return false;
}

async function listSchedSessions(apiKey) {
    const response = await schedApiCall('session/list', {}, apiKey);
    return normalizeSessionListResponse(response);
}

async function freezeSchedSession(apiKey, session) {
    const sessionKey = session.session_key || session.key || session.id;

    if (!sessionKey) {
        throw new Error('Session is missing a session_key.');
    }

    return schedApiCall('session/edit', {
        session_key: sessionKey,
        frozen: 'Y'
    }, apiKey);
}

async function freezeFullSessionsWithinHours(apiKey, hoursAhead = 48, logger = console) {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() + (hoursAhead * 60 * 60 * 1000));
    const sessions = await listSchedSessions(apiKey);

    const matchingSessions = sessions.filter((session) => {
        if (isSessionFrozen(session) || !isSessionFull(session)) {
            return false;
        }

        const startTime = getSessionStart(session);
        return startTime && startTime > now && startTime <= cutoffTime;
    });

    if (matchingSessions.length === 0) {
        logger.log(`No full sessions found within the next ${hoursAhead} hours.`);
        return { checked: sessions.length, frozen: 0 };
    }

    let frozenCount = 0;

    for (const session of matchingSessions) {
        await freezeSchedSession(apiKey, session);
        frozenCount += 1;

        const sessionLabel = session.name || session.title || session.session_name || session.session_key || 'session';
        logger.log(`Frozen full session: ${sessionLabel}`);
    }

    return { checked: sessions.length, frozen: frozenCount };
}

function scheduleFullSessionFreezeJob({
    apiKey,
    hoursAhead = 48,
    cron = '*/15 * * * *',
    logger = console
} = {}) {
    if (!schedule) {
        throw new Error('node-schedule is not installed. Run npm install node-schedule to enable scheduled freezes.');
    }

    if (!apiKey) {
        throw new Error('apiKey is required to schedule full-session freezes.');
    }

    return schedule.scheduleJob(cron, async () => {
        try {
            await freezeFullSessionsWithinHours(apiKey, hoursAhead, logger);
        } catch (error) {
            logger.error('Full-session freeze job failed:', error);
        }
    });
}

function getCurrentMonthData(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth() + 1;
    return {
        year,
        month,
        monthString: `${year}-${String(month).padStart(2, '0')}`
    };
}

function scheduleMonthlyCreateSlots({
    apiKey,
    slotCreator,
    monthDataProvider = () => getCurrentMonthData(),
    logger = console
} = {}) {
    if (!schedule) {
        throw new Error('node-schedule is not installed. Run npm install node-schedule to enable monthly scheduling.');
    }

    if (!apiKey) {
        throw new Error('apiKey is required to schedule monthly slot creation.');
    }

    if (typeof slotCreator !== 'function') {
        throw new Error('slotCreator must be a function.');
    }

    return schedule.scheduleJob('0 20 21 * *', async () => {
        try {
            const monthData = await Promise.resolve(monthDataProvider());

            if (!monthData) {
                logger.warn('Monthly slot creation skipped because no month data was provided.');
                return;
            }

            await createSlotsForMonth(apiKey, slotCreator, {
                monthData,
                clearOutput: () => {},
                appendOutput: (text) => logger.log(text.trimEnd()),
                silent: true
            });
        } catch (error) {
            logger.error('Monthly slot creation failed:', error);
        }
    });
}

module.exports = {
    scheduleMonthlyCreateSlots,
    scheduleFullSessionFreezeJob,
    freezeFullSessionsWithinHours
};

if (process.env.ENABLE_FULL_SESSION_FREEZE_JOB === 'true' && schedule) {
    const apiKey = process.env.SCHED_API_KEY;
    const hoursAhead = Number(process.env.SCHED_FREEZE_LOOKAHEAD_HOURS || 48);
    const cron = process.env.SCHED_FREEZE_CRON || '*/15 * * * *';

    scheduleFullSessionFreezeJob({
        apiKey,
        hoursAhead,
        cron
    });

    console.log(`\n✓ Full-session freeze job enabled every ${cron} for sessions within ${hoursAhead} hours.\n`);
} else if (process.env.ENABLE_FULL_SESSION_FREEZE_JOB === 'true') {
    console.warn('Full-session freeze job was requested, but node-schedule is not installed.');
}

if (process.env.ENABLE_MONTHLY_SLOT_SCHEDULER === 'true' && schedule) {
    const apiKey = process.env.SCHED_API_KEY;
    const slotType = (process.env.SCHED_SLOT_TYPE || 'leadership').toLowerCase();
    const slotCreator = slotType === 'general' ? createGeneralSlotsForDay : createLeadershipSlotsForDay;

    scheduleMonthlyCreateSlots({
        apiKey,
        slotCreator,
        monthDataProvider: () => getCurrentMonthData()
    });

    console.log(`\n✓ Monthly slot scheduler enabled for the 21st of every month (${slotType}).\n`);
} else if (process.env.ENABLE_MONTHLY_SLOT_SCHEDULER === 'true') {
    console.warn('Monthly slot scheduler was requested, but node-schedule is not installed.');
}

// Proxy endpoint for Sched.com API
app.post('/api/*', async (req, res) => {
    try {
        // Extract the path after /api/
        const apiPath = req.params[0];
        const schedUrl = `https://${SUBDOMAIN}.sched.com/api/${apiPath}`;

        // Forward the request to Sched.com
        const formData = new URLSearchParams();
        for (const key in req.body) {
            formData.append(key, req.body[key]);
        }

        const response = await fetch(schedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'STV-Sched-API/1.0'
            },
            body: formData.toString()
        });

        const responseText = await response.text();

        // Try to parse as JSON, otherwise return as text
        try {
            const jsonData = JSON.parse(responseText);
            res.json(jsonData);
        } catch (e) {
            res.send(responseText);
        }

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n✓ Proxy server running on http://localhost:${PORT}`);
    console.log(`✓ Open http://localhost:${PORT}/index.html in your browser\n`);
});
