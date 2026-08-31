// Finds users who hold a "new" ticket and have been checked in to at least
// CHECKIN_THRESHOLD shifts, i.e. candidates ready to be moved from "new" to
// "exp". Run directly (locally or from CI):
//
//   SCHED_API_KEY=xxx node scripts/new-to-exp.js
//
// Env vars:
//   SCHED_API_KEY      (required) Sched.com API key (used for both the event API and the Ticket API)
//   SCHED_SUBDOMAIN    (default: stvincentsclinic2025)
//   CHECKIN_THRESHOLD  (default: 3) minimum number of checked-in shifts to qualify
//   TICKET_BATCH_SIZE  (default: 100) users per ticket/user/get batch call
//   THROTTLE_MS        (default: 500) delay between session/seats calls
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
// Pipeline:
//   1. user/list        - every user on the event
//   2. ticket/user/get  - (batched) which of them hold a "new" ticket
//   3. going/all        - every user's registered session keys (one call)
//   4. session/seats    - only for sessions a "new" user is registered for
const fetch = require('node-fetch');

const SCHED_API_KEY = process.env.SCHED_API_KEY;
const SUBDOMAIN = process.env.SCHED_SUBDOMAIN || 'stvincentsclinic2025';
const CHECKIN_THRESHOLD = parseInt(process.env.CHECKIN_THRESHOLD || '3', 10);
const TICKET_BATCH_SIZE = parseInt(process.env.TICKET_BATCH_SIZE || '100', 10);
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS || '500', 10);

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

async function tallyCheckins(newUsers, goingAll) {
    // Narrow session/seats calls to only sessions at least one "new" user is
    // registered for, instead of every session on the event.
    const relevantSessions = new Set();
    for (const u of newUsers) {
        for (const key of (goingAll[u.username] || [])) relevantSessions.add(key);
    }

    console.log(`Narrowed to ${relevantSessions.size} session(s) registered to a "new" ticket holder (out of ${Object.keys(goingAll).length} users tracked by going/all).`);

    const checkinCounts = new Map(); // email -> number of sessions with a checkin_date
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

        if (Array.isArray(seats)) {
            for (const attendee of seats) {
                if (attendee.email && attendee.checkin_date) {
                    checkinCounts.set(attendee.email, (checkinCounts.get(attendee.email) || 0) + 1);
                }
            }
        }

        if (i % 25 === 0) console.log(`  ...scanned ${i}/${relevantSessions.size} sessions`);
        await sleep(THROTTLE_MS);
    }

    return checkinCounts;
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

    console.log('\nScanning session/seats for the narrowed session set...');
    const checkinCounts = await tallyCheckins(newUsers, goingAll);

    const qualifying = newUsers
        .map((u) => ({ ...u, checkedInShifts: checkinCounts.get(u.email) || 0 }))
        .filter((u) => u.checkedInShifts >= CHECKIN_THRESHOLD);

    console.log('\nChecked-in shift counts for all "new" ticket holders:');
    for (const u of newUsers) {
        console.log(`  ${u.username} (${u.email}) - checked in to ${checkinCounts.get(u.email) || 0} shift(s)`);
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
