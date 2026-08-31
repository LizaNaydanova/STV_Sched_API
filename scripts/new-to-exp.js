// Finds users who hold a "new" ticket and have been checked in to at least
// CHECKIN_THRESHOLD shifts, i.e. candidates ready to be moved from "new" to
// "exp". Counts both live Sched checkins and historical checkins from a CSV
// export of now-deleted sessions. Run directly (locally or from CI):
//
//   SCHED_API_KEY=xxx node scripts/new-to-exp.js
//
// Env vars:
//   SCHED_API_KEY      (required) Sched.com API key (used for both the event API and the Ticket API)
//   SCHED_SUBDOMAIN    (default: stvincentsclinic2025)
//   CHECKIN_THRESHOLD  (default: 3) minimum number of checked-in shifts to qualify
//   TICKET_BATCH_SIZE  (default: 100) users per ticket/user/get batch call
//   THROTTLE_MS        (default: 500) delay between session/seats calls
//   HISTORICAL_CSV     (default: historical_attendance/old_shifts.csv) historical checkin export
//
// NOTE: going/list and going/schedule were tried first to get each user's
// session history directly, but a live test proved they silently ignore the
// 'username' parameter and just return the logged-in account's own
// schedule - confirmed by requesting a different user's schedule and
// getting back identical session IDs to the logged-in user's own.
// going/all doesn't have that problem - it's a single bulk export keyed by
// username ({ username: [session_key, ...] }), confirmed (live) to include
// past sessions with real checkins, not just upcoming ones. There is no
// bulk attendance/checkin export though, so session/seats (the only
// endpoint that actually returns checkin_date) is still called per
// session - but going/all lets that be narrowed to only the sessions that
// at least one "new" ticket holder is actually registered for, instead of
// every session on the event.
//
// HISTORICAL_CSV covers shifts (Jul 2025 - Jul 2 2026) whose sessions have
// since been deleted from Sched entirely, so they can never show up via
// going/all/session/seats. To avoid double-counting any shift that happens
// to appear in both sources, checkins are deduped per user by session
// *name* (e.g. "06/06_Medicine_New_9:15 AM") rather than just counted -
// that name format is shared by both the CSV's "Session Name" column and
// Sched's own session 'name' field, and already encodes date/clinic/time,
// making it a reliable per-shift identifier across both sources.
//
// Pipeline:
//   1. user/list        - every user on the event
//   2. ticket/user/get  - (batched) which of them hold a "new" ticket
//   3. going/all        - every user's registered session keys (one call)
//   4. session/export   - to resolve session keys to their display name
//   5. session/seats    - only for sessions a "new" user is registered for
//   6. HISTORICAL_CSV   - merged in, deduped by (email, session name)
const fetch = require('node-fetch');
const fs = require('fs');
const nodePath = require('path');

const SCHED_API_KEY = process.env.SCHED_API_KEY;
const SUBDOMAIN = process.env.SCHED_SUBDOMAIN || 'stvincentsclinic2025';
const CHECKIN_THRESHOLD = parseInt(process.env.CHECKIN_THRESHOLD || '3', 10);
const TICKET_BATCH_SIZE = parseInt(process.env.TICKET_BATCH_SIZE || '100', 10);
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS || '500', 10);
const HISTORICAL_CSV = process.env.HISTORICAL_CSV
    || nodePath.join(__dirname, '..', 'historical_attendance', 'old_shifts.csv');

const BASE_URL = `https://${SUBDOMAIN}.sched.com/api`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function schedApiCall(path, params) {
    const clean = {};
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) clean[k] = v;
    }
    const body = new URLSearchParams({ ...clean, api_key: SCHED_API_KEY });
    const response = await fetch(`${BASE_URL}/${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'STV-Sched-API/1.0'
        },
        body: body.toString()
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${path} failed (${response.status}): ${text}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function schedTicketApiCall(path, body, extraParams = {}) {
    const query = new URLSearchParams({ api_key: SCHED_API_KEY, ...extraParams });
    const response = await fetch(`${BASE_URL}/${path}?${query.toString()}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'STV-Sched-API/1.0'
        },
        body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${path} failed (${response.status}): ${text}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function fetchAllUsers() {
    const response = await schedApiCall('user/list', { format: 'json', fields: 'username,email,name' });
    return Array.isArray(response) ? response : [];
}

async function findNewTicketUsers(users) {
    const newUsers = [];
    for (const batch of chunk(users, TICKET_BATCH_SIZE)) {
        const payload = batch.map((u) => ({ username: u.username, email: u.email }));
        const response = await schedTicketApiCall('ticket/user/get', payload);
        const results = Array.isArray(response.result) ? response.result : [];
        for (const r of results) {
            if (r.status === 'OK' && Array.isArray(r.tickets) && r.tickets.includes('new')) {
                const match = batch.find((u) => u.username === r.username || u.email === r.email);
                newUsers.push({
                    username: r.username || (match && match.username),
                    email: r.email || (match && match.email),
                    name: match && match.name
                });
            }
        }
        await sleep(THROTTLE_MS);
    }
    return newUsers;
}

async function fetchGoingAll() {
    const response = await schedApiCall('going/all', { format: 'json' });
    return (response && typeof response === 'object' && !Array.isArray(response)) ? response : {};
}

async function fetchAllSessions() {
    const sessions = [];
    const limit = 1000;
    let page = 1;
    for (;;) {
        const batch = await schedApiCall('session/export', {
            format: 'json',
            page: String(page),
            limit: String(limit)
        });
        if (!Array.isArray(batch) || batch.length === 0) break;
        sessions.push(...batch);
        if (batch.length < limit) break;
        page += 1;
    }
    return sessions;
}

function getField(session, ...candidates) {
    for (const c of candidates) {
        if (session[c] !== undefined) return session[c];
    }
    const lowerMap = {};
    for (const k of Object.keys(session)) lowerMap[k.toLowerCase()] = k;
    for (const c of candidates) {
        const realKey = lowerMap[c.toLowerCase()];
        if (realKey !== undefined && session[realKey] !== undefined) return session[realKey];
    }
    return undefined;
}

const getKey = (s) => getField(s, 'session_key', 'event_key', 'key', 'session_id');
const getName = (s) => getField(s, 'name', 'event_name', 'title');

// Minimal RFC 4180-style CSV parser (handles quoted fields containing
// commas, e.g. "Junior Director, Pharmacy", and escaped "" quotes).
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\r') {
            // ignore, \n (or end-of-file) below ends the row
        } else if (c === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

// Returns Map<lowercased email, Set<session name>> of shifts the CSV shows
// as actually checked in (Checked-in === 'Y' and a Check-in Date present).
function loadHistoricalShifts(csvPath) {
    const historical = new Map();
    if (!fs.existsSync(csvPath)) {
        console.log(`No historical CSV found at ${csvPath} - skipping.`);
        return historical;
    }

    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    if (rows.length === 0) return historical;

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
        email: header.indexOf('email'),
        sessionName: header.indexOf('session name'),
        checkedIn: header.indexOf('checked-in'),
        checkinDate: header.indexOf('check-in date')
    };

    for (const cols of rows.slice(1)) {
        if (cols.length < header.length) continue;
        const email = (cols[idx.email] || '').trim().toLowerCase();
        const sessionName = (cols[idx.sessionName] || '').trim();
        const checkedIn = (cols[idx.checkedIn] || '').trim().toUpperCase();
        const checkinDate = (cols[idx.checkinDate] || '').trim();
        if (!email || !sessionName || checkedIn !== 'Y' || !checkinDate) continue;

        if (!historical.has(email)) historical.set(email, new Set());
        historical.get(email).add(sessionName);
    }

    return historical;
}

async function buildKeyToNameMap() {
    const sessions = await fetchAllSessions();
    const map = new Map();
    for (const s of sessions) {
        const key = getKey(s);
        if (key) map.set(key, getName(s) || key);
    }
    return map;
}

// Returns Map<lowercased email, Set<session name>> of live checkins.
async function tallyLiveCheckins(newUsers, goingAll, keyToName) {
    const relevantSessions = new Set();
    for (const u of newUsers) {
        for (const key of (goingAll[u.username] || [])) relevantSessions.add(key);
    }

    console.log(`Narrowed to ${relevantSessions.size} session(s) registered to a "new" ticket holder (out of ${Object.keys(goingAll).length} users tracked by going/all).`);

    const liveShifts = new Map(); // email -> Set<session name>
    let i = 0;
    for (const key of relevantSessions) {
        i += 1;
        let seats;
        try {
            seats = await schedApiCall('session/seats', { key, type: 'attendance', format: 'json' });
        } catch (error) {
            console.log(`  ✗ session/seats failed for ${key}: ${error.message}`);
            continue;
        }

        const sessionName = keyToName.get(key) || key;
        if (Array.isArray(seats)) {
            for (const attendee of seats) {
                if (attendee.email && attendee.checkin_date) {
                    const email = attendee.email.trim().toLowerCase();
                    if (!liveShifts.has(email)) liveShifts.set(email, new Set());
                    liveShifts.get(email).add(sessionName);
                }
            }
        }

        if (i % 25 === 0) console.log(`  ...scanned ${i}/${relevantSessions.size} sessions`);
        await sleep(THROTTLE_MS);
    }

    return liveShifts;
}

async function main() {
    if (!SCHED_API_KEY) {
        throw new Error('SCHED_API_KEY is required');
    }

    console.log('Fetching all users...');
    const users = await fetchAllUsers();
    console.log(`Fetched ${users.length} user(s).`);

    console.log('\nChecking which users hold a "new" ticket...');
    const newUsers = await findNewTicketUsers(users);
    console.log(`${newUsers.length} user(s) hold a "new" ticket.`);

    if (newUsers.length === 0) {
        console.log('Nothing to do.');
        return;
    }

    console.log('\nFetching going/all (every user\'s registered sessions)...');
    const goingAll = await fetchGoingAll();

    console.log('\nFetching session/export (to resolve session names)...');
    const keyToName = await buildKeyToNameMap();

    console.log('\nScanning session/seats for the narrowed session set...');
    const liveShifts = await tallyLiveCheckins(newUsers, goingAll, keyToName);

    console.log(`\nLoading historical checkins from ${HISTORICAL_CSV} ...`);
    const historicalShifts = loadHistoricalShifts(HISTORICAL_CSV);

    const withCounts = newUsers.map((u) => {
        const email = (u.email || '').trim().toLowerCase();
        const live = liveShifts.get(email) || new Set();
        const historical = historicalShifts.get(email) || new Set();
        const merged = new Set([...live, ...historical]);
        return { ...u, liveCount: live.size, historicalCount: historical.size, checkedInShifts: merged.size };
    });

    const qualifying = withCounts.filter((u) => u.checkedInShifts >= CHECKIN_THRESHOLD);

    console.log('\nChecked-in shift counts for all "new" ticket holders (live + historical, deduped):');
    for (const u of withCounts) {
        console.log(`  ${u.username} (${u.email}) - live: ${u.liveCount}, historical: ${u.historicalCount}, total unique: ${u.checkedInShifts}`);
    }

    console.log(`\n=== Users with a "new" ticket checked in to ${CHECKIN_THRESHOLD}+ shifts ===`);
    if (qualifying.length === 0) {
        console.log('None.');
    } else {
        for (const u of qualifying) {
            console.log(`  ${u.name || u.username} - username: ${u.username}, email: ${u.email}, checked-in shifts: ${u.checkedInShifts}`);
        }
    }
}

main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
});
