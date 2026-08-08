// Freezes (or unfreezes) Sched.com sessions on a given date by setting the
// custom `frozen` field via session/mod. Run directly (locally or from CI):
//
//   SCHED_API_KEY=xxx node scripts/freeze-shifts.js
//
// Env vars:
//   SCHED_API_KEY     (required) Sched.com API key
//   SCHED_SUBDOMAIN   (default: stvincentsclinic2025)
//   TARGET_DATE       (default: 2026-08-29) YYYY-MM-DD, ignored if SESSION_KEY is set
//   SESSION_KEY       (optional) freeze/unfreeze a single session, for testing
//   FREEZE_VALUE      (default: Y) 'Y' or 'N'
//   DRY_RUN           (default: false) 'true' to preview without calling session/mod
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
    const body = new URLSearchParams({ ...params, api_key: SCHED_API_KEY });
    const response = await fetch(`${BASE_URL}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${path} failed (${response.status}): ${text}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${path} returned non-JSON: ${text}`);
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

function selectTargets(allSessions) {
    if (SESSION_KEY) {
        return allSessions.filter((s) => s.session_key === SESSION_KEY);
    }
    return allSessions.filter((s) => typeof s.session_start === 'string' && s.session_start.startsWith(TARGET_DATE));
}

async function main() {
    if (!SCHED_API_KEY) {
        throw new Error('SCHED_API_KEY is required');
    }

    console.log(`Fetching sessions from ${BASE_URL} ...`);
    const allSessions = await fetchAllSessions();
    console.log(`Fetched ${allSessions.length} total sessions.`);

    const targets = selectTargets(allSessions);
    console.log(SESSION_KEY
        ? `Matched ${targets.length} session(s) for session_key=${SESSION_KEY}.`
        : `Matched ${targets.length} session(s) on ${TARGET_DATE}.`);

    const toChange = targets.filter((s) => s.frozen !== FREEZE_VALUE);
    const alreadyCorrect = targets.length - toChange.length;
    console.log(`${alreadyCorrect} already frozen='${FREEZE_VALUE}' (skipped). ${toChange.length} need updating.`);

    if (toChange.length === 0) {
        console.log('Nothing to do.');
        return;
    }

    if (DRY_RUN) {
        console.log('\n[DRY RUN] Would set frozen=%s on:', FREEZE_VALUE);
        for (const s of toChange) {
            console.log(`  - ${s.session_key}  ${s.name}  (${s.session_start})`);
        }
        return;
    }

    const results = [];
    for (const s of toChange) {
        try {
            await schedApiCall('session/mod', { session_key: s.session_key, frozen: FREEZE_VALUE });
            results.push({ session_key: s.session_key, name: s.name, ok: true });
            console.log(`✓ mod sent: ${s.session_key}  ${s.name}`);
        } catch (error) {
            results.push({ session_key: s.session_key, name: s.name, ok: false, error: error.message });
            console.log(`✗ mod failed: ${s.session_key}  ${s.name} - ${error.message}`);
        }
        await sleep(500);
    }

    console.log('\nVerifying changes actually persisted (frozen is undocumented for session/mod)...');
    const verifySessions = await fetchAllSessions();
    const verifyByKey = new Map(verifySessions.map((s) => [s.session_key, s]));

    let failures = 0;
    for (const r of results) {
        const current = verifyByKey.get(r.session_key);
        const verified = r.ok && current && current.frozen === FREEZE_VALUE;
        if (!verified) {
            failures += 1;
            console.log(`✗ VERIFY FAILED: ${r.session_key}  ${r.name}  (frozen is now '${current ? current.frozen : 'unknown'}')`);
        } else {
            console.log(`✓ verified: ${r.session_key}  ${r.name}`);
        }
    }

    console.log(`\nDone. ${results.length - failures}/${results.length} verified as frozen='${FREEZE_VALUE}'.`);
    if (failures > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
});
