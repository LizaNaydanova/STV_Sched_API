/**
 * new-to-exp.js
 *
 * Identifies volunteers ready to transition from "new" to "exp" ticket status,
 * removes their "new" ticket, adds "exp" ticket (if not already present), and
 * sends email notifications.
 *
 * A user qualifies when they hold a "new" ticket and have checked into at least
 * CHECKIN_THRESHOLD shifts with "New" in the session name.
 *
 * Data sources:
 *   - Live Sched API (going/all, session/seats)
 *   - Historical CSV export of deleted sessions
 *
 * Usage:
 *   SCHED_API_KEY=xxx node scripts/new-to-exp.js
 *
 * Environment variables:
 *   SCHED_API_KEY      (required) Sched.com API key
 *   SCHED_SUBDOMAIN    (default: stvincentsclinic2025)
 *   CHECKIN_THRESHOLD  (default: 3) minimum checked-in shifts to qualify
 *   TICKET_BATCH_SIZE  (default: 100) users per ticket/user/get batch
 *   THROTTLE_MS        (default: 500) delay between API calls
 *   TICKET_PAUSE_MS    (default: 1000) pause between delete and put operations
 *   HISTORICAL_CSV     (default: historical_attendance/old_shifts.csv)
 *   DRY_RUN            (default: false) set to "true" for practice mode
 *   SMTP_HOST          SMTP server hostname
 *   SMTP_PORT          (default: 587) SMTP server port
 *   SMTP_USER          SMTP username
 *   SMTP_PASS          SMTP password
 *   EMAIL_FROM         From address for emails
 *   ALERT_EMAIL        (default: eanaydan@utmb.edu) recipient for notifications
 *
 * Pipeline:
 *   1. user/list           - fetch all event users
 *   2. ticket/user/get     - identify "new" ticket holders (batched)
 *   3. going/all           - get all users' registered session keys
 *   4. session/export      - resolve session keys to names
 *   5. session/seats       - get checkin data for relevant sessions
 *   6. HISTORICAL_CSV      - merge historical checkins, dedupe by session name
 *   7. ticket/user/delete  - remove "new" ticket from qualifying users
 *   8. ticket/user/put     - add "exp" ticket (if not already present)
 *   9. Send emails         - notify about ticket upgrade
 */

const fetch = require('node-fetch');
const fs = require('fs');
const nodePath = require('path');
const nodemailer = require('nodemailer');

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
    apiKey: process.env.SCHED_API_KEY,
    subdomain: process.env.SCHED_SUBDOMAIN || 'stvincentsclinic2025',
    checkinThreshold: parseInt(process.env.CHECKIN_THRESHOLD || '3', 10),
    ticketBatchSize: parseInt(process.env.TICKET_BATCH_SIZE || '100', 10),
    throttleMs: parseInt(process.env.THROTTLE_MS || '500', 10),
    ticketPauseMs: parseInt(process.env.TICKET_PAUSE_MS || '1000', 10),
    historicalCsv: process.env.HISTORICAL_CSV
        || nodePath.join(__dirname, '..', 'historical_attendance', 'old_shifts.csv'),
    dryRun: process.env.DRY_RUN === 'true',
    smtp: {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    },
    emailFrom: process.env.EMAIL_FROM || '',
    alertEmail: process.env.ALERT_EMAIL || 'eanaydan@utmb.edu'
};

const BASE_URL = `https://${CONFIG.subdomain}.sched.com/api`;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Delays execution for the specified duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalizes an email address to lowercase trimmed form.
 * @param {string|undefined} email - Raw email string
 * @returns {string} Normalized email or empty string
 */
const normalizeEmail = (email) => (email || '').trim().toLowerCase();

/**
 * Attempts to parse text as JSON, returning the original text on failure.
 * @param {string} text - Text to parse
 * @returns {any} Parsed JSON or original text
 */
function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * Splits an array into chunks of the specified size.
 * @param {any[]} arr - Array to chunk
 * @param {number} size - Maximum chunk size
 * @returns {any[][]} Array of chunks
 */
function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

/**
 * Retrieves a field value from an object, trying multiple candidate keys.
 * Falls back to case-insensitive matching if exact match not found.
 * @param {Object} obj - Object to search
 * @param {...string} candidates - Field names to try in order
 * @returns {any} Field value or undefined
 */
function getField(obj, ...candidates) {
    for (const key of candidates) {
        if (obj[key] !== undefined) return obj[key];
    }

    const lowerKeyMap = Object.fromEntries(
        Object.keys(obj).map((k) => [k.toLowerCase(), k])
    );

    for (const candidate of candidates) {
        const realKey = lowerKeyMap[candidate.toLowerCase()];
        if (realKey && obj[realKey] !== undefined) return obj[realKey];
    }

    return undefined;
}

/** Extracts session key from a session object. */
const getSessionKey = (s) => getField(s, 'session_key', 'event_key', 'key', 'session_id');

/** Extracts session name from a session object. */
const getSessionName = (s) => getField(s, 'name', 'event_name', 'title');

/** Checks if a session name indicates a "New" volunteer shift. */
const isNewShift = (name) => (name || '').toLowerCase().includes('new');

// =============================================================================
// CSV Parsing
// =============================================================================

/**
 * Parses RFC 4180-style CSV text.
 * Handles quoted fields containing commas and escaped double-quotes ("").
 * @param {string} text - Raw CSV content
 * @returns {string[][]} Array of rows, each row an array of field values
 */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\r') {
            // Skip carriage returns; newline handles row ending
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

// =============================================================================
// Sched API Functions
// =============================================================================

/**
 * Makes a POST request to the Sched Event API.
 * @param {string} endpoint - API endpoint path
 * @param {Object} params - Request parameters (api_key added automatically)
 * @returns {Promise<any>} Parsed JSON response or raw text
 * @throws {Error} If request fails
 */
async function schedApiCall(endpoint, params = {}) {
    const cleanParams = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v != null)
    );

    const body = new URLSearchParams({ ...cleanParams, api_key: CONFIG.apiKey });

    const response = await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'STV-Sched-API/1.0'
        },
        body: body.toString()
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${endpoint} failed (${response.status}): ${text}`);
    }

    return tryParseJson(text);
}

/**
 * Makes a POST request to the Sched Ticket API (JSON body).
 * @param {string} endpoint - API endpoint path
 * @param {Object} body - JSON request body
 * @returns {Promise<any>} Parsed JSON response or raw text
 * @throws {Error} If request fails
 */
async function schedTicketApiCall(endpoint, body) {
    const query = new URLSearchParams({ api_key: CONFIG.apiKey });

    const response = await fetch(`${BASE_URL}/${endpoint}?${query}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'STV-Sched-API/1.0'
        },
        body: JSON.stringify(body)
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${endpoint} failed (${response.status}): ${text}`);
    }

    return tryParseJson(text);
}

/**
 * Removes specified tickets from users.
 * @param {Object[]} users - Array of {username, email, tickets: [ticketNames]}
 * @returns {Promise<any>} API response
 */
async function deleteUserTickets(users) {
    return schedTicketApiCall('ticket/user/delete', users);
}

/**
 * Adds specified tickets to users.
 * @param {Object[]} users - Array of {username, email, tickets: [ticketNames]}
 * @returns {Promise<any>} API response
 */
async function putUserTickets(users) {
    return schedTicketApiCall('ticket/user/put', users);
}

// =============================================================================
// Email Functions
// =============================================================================

/**
 * Checks if email is properly configured.
 * @returns {boolean}
 */
function emailConfigured() {
    return !!(
        CONFIG.smtp.host &&
        CONFIG.smtp.user &&
        CONFIG.smtp.pass &&
        CONFIG.emailFrom &&
        CONFIG.alertEmail
    );
}

/**
 * Sends an individual email notification about ticket upgrade.
 * @param {Object} user - User object with username, email, name
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendTicketUpgradeEmail(user) {
    const subject = 'St. Vincent\'s Clinic - Experienced Volunteer Status';
    const text = `You have completed 3 New Volunteer shifts and have been given an experienced ticket. As a reminder, you must complete the checklist.`;

    console.log(`  Sending email notification for ${user.username}...`);

    if (!emailConfigured()) {
        console.log('    ⚠ Email not sent - SMTP not configured');
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: CONFIG.smtp.host,
        port: CONFIG.smtp.port,
        secure: CONFIG.smtp.port === 465,
        auth: {
            user: CONFIG.smtp.user,
            pass: CONFIG.smtp.pass
        }
    });

    try {
        await transporter.sendMail({
            from: CONFIG.emailFrom,
            to: CONFIG.alertEmail,
            subject,
            text
        });
        console.log(`    ✓ Email sent to ${CONFIG.alertEmail}`);
        return true;
    } catch (error) {
        console.error(`    ✗ Email failed: ${error.message}`);
        return false;
    }
}

// =============================================================================
// Ticket Processing Functions
// =============================================================================

/**
 * Processes qualifying users: removes "new" ticket, adds "exp" ticket if missing,
 * and sends email notifications.
 * @param {Object[]} qualifyingUsers - Users who qualify for upgrade
 * @returns {Promise<void>}
 */
async function processTicketUpgrades(qualifyingUsers) {
    if (qualifyingUsers.length === 0) {
        console.log('No users to process for ticket upgrade.');
        return;
    }

    console.log('\n==================================================');
    console.log('PROCESSING TICKET UPGRADES');
    console.log('==================================================');
    console.log(`Processing ${qualifyingUsers.length} user(s)...\n`);

    const usersToRemoveNew = qualifyingUsers.map((u) => ({
        username: u.username,
        email: u.email,
        tickets: ['new']
    }));

    const usersToAddExp = qualifyingUsers
        .filter((u) => !u.hasExpTicket)
        .map((u) => ({
            username: u.username,
            email: u.email,
            tickets: ['exp']
        }));

    console.log(`Step 1: Removing "new" ticket from ${usersToRemoveNew.length} user(s)...`);

    if (CONFIG.dryRun) {
        console.log('[DRY RUN] Would remove "new" ticket from:');
        for (const u of usersToRemoveNew) {
            console.log(`  - ${u.username} (${u.email})`);
        }
    } else {
        try {
            const deleteResult = await deleteUserTickets(usersToRemoveNew);
            console.log('Delete result:', JSON.stringify(deleteResult, null, 2));
        } catch (error) {
            console.error(`✗ Failed to remove "new" tickets: ${error.message}`);
            return;
        }
    }

    console.log(`\nPausing ${CONFIG.ticketPauseMs}ms before adding "exp" tickets...`);
    await sleep(CONFIG.ticketPauseMs);

    if (usersToAddExp.length > 0) {
        console.log(`\nStep 2: Adding "exp" ticket to ${usersToAddExp.length} user(s) who don't already have it...`);

        if (CONFIG.dryRun) {
            console.log('[DRY RUN] Would add "exp" ticket to:');
            for (const u of usersToAddExp) {
                console.log(`  - ${u.username} (${u.email})`);
            }
        } else {
            try {
                const putResult = await putUserTickets(usersToAddExp);
                console.log('Put result:', JSON.stringify(putResult, null, 2));
            } catch (error) {
                console.error(`✗ Failed to add "exp" tickets: ${error.message}`);
                return;
            }
        }
    } else {
        console.log('\nStep 2: All qualifying users already have "exp" ticket - skipping.');
    }

    console.log('\nStep 3: Sending email notifications...');
    for (const user of qualifyingUsers) {
        await sendTicketUpgradeEmail(user);
        await sleep(CONFIG.throttleMs);
    }

    console.log('\n==================================================');
    console.log('TICKET UPGRADE PROCESSING COMPLETE');
    console.log('==================================================');
}

// =============================================================================
// Data Fetching Functions
// =============================================================================

/**
 * Fetches all users registered for the event.
 * @returns {Promise<Object[]>} Array of user objects with username, email, name
 */
async function fetchAllUsers() {
    const response = await schedApiCall('user/list', {
        format: 'json',
        fields: 'username,email,name'
    });
    return Array.isArray(response) ? response : [];
}

/**
 * Identifies users who hold a "new" ticket.
 * @param {Object[]} users - All event users
 * @returns {Promise<Object[]>} Users with "new" ticket, including hasExpTicket flag
 */
async function findNewTicketUsers(users) {
    const newUsers = [];

    for (const batch of chunk(users, CONFIG.ticketBatchSize)) {
        const payload = batch.map((u) => ({ username: u.username, email: u.email }));
        const response = await schedTicketApiCall('ticket/user/get', payload);
        const results = Array.isArray(response.result) ? response.result : [];

        for (const result of results) {
            if (result.status !== 'OK' || !Array.isArray(result.tickets)) continue;
            if (!result.tickets.includes('new')) continue;

            const match = batch.find(
                (u) => u.username === result.username || u.email === result.email
            );

            newUsers.push({
                username: result.username || match?.username,
                email: result.email || match?.email,
                name: match?.name,
                hasExpTicket: result.tickets.includes('exp')
            });
        }

        await sleep(CONFIG.throttleMs);
    }

    return newUsers;
}

/**
 * Fetches session registrations for all users (username -> [session_keys]).
 * @returns {Promise<Object>} Map of username to array of session keys
 */
async function fetchGoingAll() {
    const response = await schedApiCall('going/all', { format: 'json' });
    return (response && typeof response === 'object' && !Array.isArray(response))
        ? response
        : {};
}

/**
 * Fetches all sessions and builds a key-to-name mapping.
 * Handles pagination for large event catalogs.
 * @returns {Promise<Map<string, string>>} Map of session key to session name
 */
async function buildSessionKeyToNameMap() {
    const keyToName = new Map();
    const pageSize = 1000;
    let page = 1;

    while (true) {
        const batch = await schedApiCall('session/export', {
            format: 'json',
            page: String(page),
            limit: String(pageSize)
        });

        if (!Array.isArray(batch) || batch.length === 0) break;

        for (const session of batch) {
            const key = getSessionKey(session);
            if (key) {
                keyToName.set(key, getSessionName(session) || key);
            }
        }

        if (batch.length < pageSize) break;
        page++;
    }

    return keyToName;
}

// =============================================================================
// Checkin Data Collection
// =============================================================================

/**
 * Loads historical checkins from a CSV export of deleted sessions.
 * @param {string} csvPath - Path to the historical CSV file
 * @returns {Map<string, Set<string>>} Map of email to set of session names
 */
function loadHistoricalCheckins(csvPath) {
    const checkins = new Map();

    if (!fs.existsSync(csvPath)) {
        console.log(`No historical CSV found at ${csvPath} - skipping.`);
        return checkins;
    }

    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    if (rows.length === 0) return checkins;

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const colIndex = {
        email: header.indexOf('email'),
        sessionName: header.indexOf('session name'),
        checkedIn: header.indexOf('checked-in'),
        checkinDate: header.indexOf('check-in date')
    };

    for (const cols of rows.slice(1)) {
        if (cols.length < header.length) continue;

        const email = normalizeEmail(cols[colIndex.email]);
        const sessionName = (cols[colIndex.sessionName] || '').trim();
        const checkedIn = (cols[colIndex.checkedIn] || '').trim().toUpperCase();
        const checkinDate = (cols[colIndex.checkinDate] || '').trim();

        if (!email || !sessionName) continue;
        if (checkedIn !== 'Y' || !checkinDate) continue;
        if (!isNewShift(sessionName)) continue;

        if (!checkins.has(email)) checkins.set(email, new Set());
        checkins.get(email).add(sessionName);
    }

    return checkins;
}

/**
 * Collects live checkin data from Sched for sessions attended by "new" users.
 * Only scans sessions that at least one "new" ticket holder is registered for.
 * @param {Object[]} newUsers - Users with "new" tickets
 * @param {Object} goingAll - Username to session keys mapping
 * @param {Map<string, string>} keyToName - Session key to name mapping
 * @returns {Promise<Map<string, Set<string>>>} Map of email to set of session names
 */
async function collectLiveCheckins(newUsers, goingAll, keyToName) {
    const relevantSessionKeys = new Set();
    for (const user of newUsers) {
        for (const key of (goingAll[user.username] || [])) {
            relevantSessionKeys.add(key);
        }
    }

    console.log(
        `Narrowed to ${relevantSessionKeys.size} session(s) registered to a "new" ticket holder ` +
        `(out of ${Object.keys(goingAll).length} users tracked by going/all).`
    );

    const checkins = new Map();
    let processed = 0;

    for (const key of relevantSessionKeys) {
        processed++;

        let seats;
        try {
            seats = await schedApiCall('session/seats', {
                key,
                type: 'attendance',
                format: 'json'
            });
        } catch (error) {
            console.log(`  ✗ session/seats failed for ${key}: ${error.message}`);
            continue;
        }

        const sessionName = keyToName.get(key) || key;
        if (!isNewShift(sessionName)) continue;

        if (Array.isArray(seats)) {
            for (const attendee of seats) {
                if (!attendee.email || !attendee.checkin_date) continue;

                const email = normalizeEmail(attendee.email);
                if (!checkins.has(email)) checkins.set(email, new Set());
                checkins.get(email).add(sessionName);
            }
        }

        if (processed % 25 === 0) {
            console.log(`  ...scanned ${processed}/${relevantSessionKeys.size} sessions`);
        }

        await sleep(CONFIG.throttleMs);
    }

    return checkins;
}

// =============================================================================
// Results Processing
// =============================================================================

/**
 * Merges live and historical checkins, calculates counts per user.
 * @param {Object[]} newUsers - Users with "new" tickets
 * @param {Map<string, Set<string>>} liveCheckins - Live checkin data
 * @param {Map<string, Set<string>>} historicalCheckins - Historical checkin data
 * @returns {Object[]} Users with checkin counts and qualification status
 */
function calculateCheckinCounts(newUsers, liveCheckins, historicalCheckins) {
    return newUsers.map((user) => {
        const email = normalizeEmail(user.email);
        const live = liveCheckins.get(email) || new Set();
        const historical = historicalCheckins.get(email) || new Set();
        const merged = new Set([...live, ...historical]);

        return {
            ...user,
            liveCount: live.size,
            historicalCount: historical.size,
            checkedInShifts: merged.size
        };
    });
}

/**
 * Formats a user result line for console output.
 * @param {Object} user - User with checkin data
 * @param {boolean} verbose - Include breakdown of live/historical counts
 * @returns {string} Formatted output line
 */
function formatUserResult(user, verbose = false) {
    const expTag = user.hasExpTicket ? ' [ALSO HAS EXP TICKET]' : '';

    if (verbose) {
        return `  ${user.username} (${user.email}) - ` +
            `live: ${user.liveCount}, historical: ${user.historicalCount}, ` +
            `total unique: ${user.checkedInShifts}${expTag}`;
    }

    return `  ${user.name || user.username} - ` +
        `username: ${user.username}, email: ${user.email}, ` +
        `checked-in shifts: ${user.checkedInShifts}${expTag}`;
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    if (!CONFIG.apiKey) {
        throw new Error('SCHED_API_KEY is required');
    }

    console.log('New-to-Exp Volunteer Upgrade Script');
    console.log(`Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Alert email recipient: ${CONFIG.alertEmail}`);
    console.log('');

    // Step 1: Fetch all users
    console.log('Fetching all users...');
    const users = await fetchAllUsers();
    console.log(`Fetched ${users.length} user(s).`);

    // Step 2: Identify "new" ticket holders
    console.log('\nChecking which users hold a "new" ticket...');
    const newUsers = await findNewTicketUsers(users);
    console.log(`${newUsers.length} user(s) hold a "new" ticket.`);

    if (newUsers.length === 0) {
        console.log('Nothing to do.');
        return;
    }

    // Step 3: Fetch session registration data
    console.log('\nFetching going/all (every user\'s registered sessions)...');
    const goingAll = await fetchGoingAll();

    // Step 4: Build session key-to-name mapping
    console.log('\nFetching session/export (to resolve session names)...');
    const keyToName = await buildSessionKeyToNameMap();

    // Step 5: Collect live checkins
    console.log('\nScanning session/seats for the narrowed session set...');
    const liveCheckins = await collectLiveCheckins(newUsers, goingAll, keyToName);

    // Step 6: Load historical checkins
    console.log(`\nLoading historical checkins from ${CONFIG.historicalCsv} ...`);
    const historicalCheckins = loadHistoricalCheckins(CONFIG.historicalCsv);

    // Calculate and display results
    const usersWithCounts = calculateCheckinCounts(newUsers, liveCheckins, historicalCheckins);
    const qualifying = usersWithCounts.filter((u) => u.checkedInShifts >= CONFIG.checkinThreshold);

    console.log('\nChecked-in "New" shift counts for all "new" ticket holders (live + historical, deduped):');
    for (const user of usersWithCounts) {
        console.log(formatUserResult(user, true));
    }

    console.log(`\n=== Users with a "new" ticket checked in to ${CONFIG.checkinThreshold}+ "New" shifts ===`);
    if (qualifying.length === 0) {
        console.log('None.');
    } else {
        for (const user of qualifying) {
            console.log(formatUserResult(user, false));
        }
    }

    await processTicketUpgrades(qualifying);
}

main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
});
