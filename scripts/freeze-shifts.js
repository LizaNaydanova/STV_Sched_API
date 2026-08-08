// Freezes (or unfreezes) Sched.com sessions on a given date by setting the
// custom `frozen` field. Run directly (locally or from CI):
//
//   SCHED_API_KEY=xxx node scripts/freeze-shifts.js
//
// Env vars:
//   SCHED_API_KEY     (required) Sched.com API key
//   SCHED_SUBDOMAIN   (default: stvincentsclinic2025)
//   TARGET_DATE       (default: 2026-08-29) YYYY-MM-DD, ignored if SESSION_KEY is set
//   SESSION_KEY       (optional) freeze/unfreeze a single session, for testing
//   FREEZE_VALUE      (default: Y) 'Y' or 'N'
//   DRY_RUN           (default: false) 'true' to preview without writing
//
// IMPORTANT: confirmed live against the real event that neither
// session/mod (returns "Ok" but silently drops the frozen field) nor
// session/add (create-only - errors "already exists and is active" on a
// duplicate session_key) can change frozen on an existing session.
// session/add's own error message says "Use api/event/mod to modify data
// for this event" - an undocumented endpoint distinct from session/mod,
// which this script uses instead.
const fetch = require('node-fetch');

const SCHED_API_KEY = process.env.SCHED_API_KEY;
const SUBDOMAIN = process.env.SCHED_SUBDOMAIN || 'stvincentsclinic2025';
const TARGET_DATE = process.env.TARGET_DATE || '2026-08-29';
const SESSION_KEY = process.env.SESSION_KEY || '';
const FREEZE_VALUE = process.env.FREEZE_VALUE || 'Y';
const DRY_RUN = process.env.DRY_RUN === 'true';

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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${path} failed (${response.status}): ${text}`);
    }
    // Some endpoints (session/add, session/mod) return plain text like "Ok"
    // on success rather than JSON - only session/export is guaranteed JSON.
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function fetchAllSessions() {
    const sessions = [];
    const limit = 1000;
    let page = 1;
    for (;;) {
        const batch = await schedApiCall('session/export', {
            format: 'json',
            custom_data: 'Y',
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

// Sched's session/export doesn't document its exact field name/format for the
// start date (it may differ from the 'session_start: YYYY-MM-DD HH:MM' used by
// session/add), so instead of relying on one field, scan every string field of
// each session for any common representation of the target date.
function dateVariants(dateStr) {
    const [y, m, d] = dateStr.split('-');
    const mNoZero = String(parseInt(m, 10));
    const dNoZero = String(parseInt(d, 10));
    return [
        dateStr, // 2026-08-29
        `${m}/${d}/${y}`, // 08/29/2026
        `${mNoZero}/${dNoZero}/${y}`, // 8/29/2026
        `${m}-${d}-${y}`, // 08-29-2026
        `${y}/${m}/${d}` // 2026/08/29
    ];
}

function sessionMatchesDate(session, dateStr) {
    const variants = dateVariants(dateStr);
    return Object.values(session).some(
        (v) => typeof v === 'string' && variants.some((variant) => v.includes(variant))
    );
}

// The exact field names returned by session/export aren't documented and
// don't all match the names session/add expects as input - resolve by exact
// name first, then case-insensitively.
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

// 'id' is Sched's internal opaque hash and is NOT the session_key. The real
// session_key (the value originally passed to session/add) comes back as
// 'event_key' in session/export - confirmed against a live sample where
// event_key ("260829_irozmn") matched this app's addSlot key format exactly,
// while id was an unrelated 32-char internal hash.
const getKey = (s) => getField(s, 'session_key', 'event_key', 'key', 'session_id');
const getFrozen = (s) => getField(s, 'frozen');
const getStart = (s) => getField(s, 'session_start', 'event_start', 'start', 'session_date', 'date');

function selectTargets(allSessions) {
    if (SESSION_KEY) {
        return allSessions.filter((s) => getKey(s) === SESSION_KEY);
    }
    return allSessions.filter((s) => sessionMatchesDate(s, TARGET_DATE));
}

// A live test confirmed session/add is create-only: calling it again with an
// existing session_key returns "ERR: Session Key '...' already exists and is
// active! Use api/event/mod to modify data for this event." - Sched's own
// error message pointing at an undocumented endpoint, distinct from
// session/mod (which silently drops the frozen field). Export data is also
// entirely event_*-prefixed, not session_*-prefixed, reinforcing that
// event/mod is the real modify endpoint for this API generation.
function isErrorResponse(response) {
    return typeof response === 'string' && /^err/i.test(response.trim());
}

async function main() {
    if (!SCHED_API_KEY) {
        throw new Error('SCHED_API_KEY is required');
    }

    console.log(`Fetching sessions from ${BASE_URL} ...`);
    const allSessions = await fetchAllSessions();
    const initialCount = allSessions.length;
    console.log(`Fetched ${initialCount} total sessions.`);

    const targets = selectTargets(allSessions);
    console.log(SESSION_KEY
        ? `Matched ${targets.length} session(s) for session_key=${SESSION_KEY}.`
        : `Matched ${targets.length} session(s) on ${TARGET_DATE}.`);

    if (targets.length > 0) {
        console.log('\nSample matched session (verify field names look right):');
        console.log(JSON.stringify(targets[0], null, 2));
    } else if (allSessions.length > 0) {
        console.log('\nNo matches - dumping a sample session so the field names/format can be inspected:');
        console.log(JSON.stringify(allSessions[0], null, 2));
    }

    const missingKey = targets.filter((s) => getKey(s) === undefined);
    if (missingKey.length > 0) {
        console.log(`\nWARNING: ${missingKey.length} matched session(s) have no resolvable session_key field - they will be skipped. Check the sample dump above for the real field name.`);
    }

    const toChange = targets.filter((s) => getKey(s) !== undefined && getFrozen(s) !== FREEZE_VALUE);
    const alreadyCorrect = targets.length - missingKey.length - toChange.length;
    console.log(`${alreadyCorrect} already frozen='${FREEZE_VALUE}' (skipped). ${toChange.length} need updating.`);

    if (toChange.length === 0) {
        console.log('Nothing to do.');
        return;
    }

    if (DRY_RUN) {
        console.log('\n[DRY RUN] Would call event/mod to set frozen=%s on:', FREEZE_VALUE);
        for (const s of toChange) {
            console.log(`  - ${getKey(s)}  ${s.name}  (${getStart(s)})`);
        }
        return;
    }

    const results = [];
    for (const s of toChange) {
        const key = getKey(s);
        try {
            const response = await schedApiCall('event/mod', { session_key: key, frozen: FREEZE_VALUE });
            if (isErrorResponse(response)) {
                results.push({ session_key: key, name: s.name, ok: false, error: response });
                console.log(`✗ event/mod rejected: ${key}  ${s.name} - ${response}`);
            } else {
                results.push({ session_key: key, name: s.name, ok: true });
                console.log(`✓ event/mod sent: ${key}  ${s.name}  (response: ${JSON.stringify(response)})`);
            }
        } catch (error) {
            results.push({ session_key: key, name: s.name, ok: false, error: error.message });
            console.log(`✗ event/mod failed: ${key}  ${s.name} - ${error.message}`);
        }
        await sleep(500);
    }

    console.log('\nVerifying changes actually persisted...');
    const verifySessions = await fetchAllSessions();
    const verifyByKey = new Map(verifySessions.map((s) => [getKey(s), s]));

    if (verifySessions.length !== initialCount) {
        console.log(`\n🚨 CRITICAL: session count changed from ${initialCount} to ${verifySessions.length} - event/mod may have created a duplicate instead of updating in place. Investigate before trusting this run.`);
    }

    let failures = 0;
    for (const r of results) {
        const current = verifyByKey.get(r.session_key);
        const verified = r.ok && current && getFrozen(current) === FREEZE_VALUE;
        if (!verified) {
            failures += 1;
            console.log(`✗ VERIFY FAILED: ${r.session_key}  ${r.name}  (frozen is now '${current ? getFrozen(current) : 'unknown'}')`);
        } else {
            console.log(`✓ verified: ${r.session_key}  ${r.name}`);
        }
    }

    console.log(`\nDone. ${results.length - failures}/${results.length} verified as frozen='${FREEZE_VALUE}'.`);
    if (failures > 0 || verifySessions.length !== initialCount) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
});
