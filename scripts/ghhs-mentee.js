/**
 * ghhs-mentee.js
 *
 * Keeps GHHS Mentee sessions in sync with GHHS Mentor signups.
 *
 * Monthly cycle (example: September -> October):
 *   - ~21st of September: mentors sign up for October GHHS Mentor slots.
 *   - 28th of September: frozen GHHS Mentee sessions are created for October
 *     and each signed-up mentor's mentee(s) are enrolled.
 *   - Every Tue/Thu/Sat after that (Sept 29, Oct 1, Oct 3, ...): re-check.
 *     New mentor signup  -> their mentee is added.
 *     Mentor dropped     -> their mentee is removed.
 *
 * Every run is a full reconciliation, so running it more than once is safe.
 *
 * Which dates are checked (based on today's date in Central time):
 *   - upcoming (after today) slots in the current month, and
 *   - from the 28th onward, also every slot in the next month.
 *
 * No emails go to mentors or mentees. Only the admin gets a detailed
 * summary of each run.
 *
 * Usage:
 *   SCHED_API_KEY=xxx node scripts/ghhs-mentee.js
 *
 * Environment variables:
 *   SCHED_API_KEY       (required) Sched.com API key
 *   SCHED_SUBDOMAIN     (default: stvincentsclinic2025)
 *   GHHS_CSV_PATH       Path to mentor/mentee CSV (mentor_email, mentee_email)
 *   THROTTLE_MS         (default: 500) delay between API calls
 *   DRY_RUN             (default: false) set to "true" for preview mode
 *   RUN_DATE            (optional) YYYY-MM-DD to pretend today is this date
 *   SMTP_HOST           SMTP server hostname
 *   SMTP_PORT           (default: 587) SMTP server port
 *   SMTP_USER           SMTP username
 *   SMTP_PASS           SMTP password
 *   EMAIL_FROM          From address for emails
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
    csvPath: process.env.GHHS_CSV_PATH || nodePath.join(__dirname, '..', 'ghhs_mentors.csv'),
    throttleMs: parseInt(process.env.THROTTLE_MS || '500', 10),
    dryRun: process.env.DRY_RUN === 'true',
    runDate: (process.env.RUN_DATE || '').trim(),
    // Day of the month on which next month's mentee sessions are generated
    newMonthDay: 28,
    menteeSeats: 2,
    timeZone: 'America/Chicago',
    smtp: {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    },
    emailFrom: process.env.EMAIL_FROM || '',
    adminEmail: 'eanaydan@utmb.edu'
};

const BASE_URL = `https://${CONFIG.subdomain}.sched.com/api`;

const MENTOR_SUBTYPE = 'GHHS Mentor';
const MENTEE_SUBTYPE = 'GHHS Mentee';

// =============================================================================
// Utility Functions
// =============================================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

const emailToUsername = (email) => normalizeEmail(email).split('@')[0];

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function formatTo12Hour(timeString) {
    const [hour, minute] = timeString.split(':');
    const hourInt = parseInt(hour, 10);
    const suffix = hourInt >= 12 ? 'PM' : 'AM';
    const hour12 = hourInt % 12 || 12;
    return `${hour12}:${minute} ${suffix}`;
}

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

const getSessionKey = (s) => getField(s, 'session_key', 'event_key', 'key');
const getSessionId = (s) => getField(s, 'id', 'event_id', 'session_id');
const getSessionName = (s) => getField(s, 'name', 'event_name', 'title');
const getSessionStart = (s) => getField(s, 'session_start', 'event_start', 'start');
const getSessionEnd = (s) => getField(s, 'session_end', 'event_end', 'end');
const getSessionVenue = (s) => getField(s, 'venue');
const getSessionSubtype = (s) => getField(s, 'session_subtype', 'event_subtype', 'subtype');

function getSeatUsername(seat) {
    const username = getField(seat, 'username');
    return username ? String(username).trim().toLowerCase() : emailToUsername(seat.email);
}

function extractDateFromSession(session) {
    const start = getSessionStart(session);
    if (!start) return null;
    const match = start.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function extractTime(dateTimeString) {
    if (!dateTimeString) return null;
    const match = dateTimeString.match(/(\d{2}:\d{2})$/);
    return match ? match[1] : null;
}

function generateSessionKey(dateStr, venue, subtype, startTime, endTime, seats) {
    const keyData = `${dateStr}${venue}General${subtype}${startTime}${endTime}${seats}`;
    const hash = Math.abs(keyData.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
    return `${dateStr.substring(2).replace(/-/g, '')}_${hash.toString(36).substring(0, 6)}`;
}

/** Today's date (YYYY-MM-DD) in Central time, or RUN_DATE if set. */
function getToday() {
    if (CONFIG.runDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(CONFIG.runDate)) {
            throw new Error(`RUN_DATE must be YYYY-MM-DD, got "${CONFIG.runDate}"`);
        }
        return CONFIG.runDate;
    }
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: CONFIG.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

/**
 * Months to check: the current month, plus next month once we reach the 28th.
 * Only slots after today are touched.
 */
function getTargetWindow(today) {
    const [year, month, day] = today.split('-').map(Number);
    const toYearMonth = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const months = [toYearMonth(year, month)];
    if (day >= CONFIG.newMonthDay) {
        months.push(month === 12 ? toYearMonth(year + 1, 1) : toYearMonth(year, month + 1));
    }
    return { today, months };
}

const isInWindow = (dateStr, window) =>
    dateStr > window.today && window.months.includes(dateStr.slice(0, 7));

/** date/venue/start/end info for a session, used to pair Mentor and Mentee sessions. */
function getSlotInfo(session) {
    const date = extractDateFromSession(session);
    const startTime = extractTime(getSessionStart(session));
    const endTime = extractTime(getSessionEnd(session));
    const venue = getSessionVenue(session);
    if (!date || !startTime || !endTime || !venue) return null;
    return { id: `${date}|${venue}|${startTime}|${endTime}`, date, startTime, endTime, venue };
}

const slotLabel = (slot) => `${slot.date} ${formatTo12Hour(slot.startTime)} @ ${slot.venue}`;

// =============================================================================
// CSV Parsing
// =============================================================================

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
            // Skip
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

function loadMentorMenteeMappings(csvPath) {
    const mappings = new Map();

    if (!fs.existsSync(csvPath)) {
        console.log(`No CSV found at ${csvPath}`);
        return mappings;
    }

    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    if (rows.length === 0) return mappings;

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const mentorCol = header.indexOf('mentor_email');
    const menteeCol = header.indexOf('mentee_email');

    if (mentorCol === -1 || menteeCol === -1) {
        console.log('CSV must have mentor_email and mentee_email columns');
        return mappings;
    }

    for (const cols of rows.slice(1)) {
        if (cols.length < Math.max(mentorCol, menteeCol) + 1) continue;

        const mentorEmail = normalizeEmail(cols[mentorCol]);
        const menteeEmail = normalizeEmail(cols[menteeCol]);

        if (!mentorEmail || !menteeEmail) continue;

        if (!mappings.has(mentorEmail)) {
            mappings.set(mentorEmail, []);
        }
        mappings.get(mentorEmail).push(menteeEmail);
    }

    return mappings;
}

// =============================================================================
// Sched API Functions
// =============================================================================

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

async function fetchAllSessions() {
    const sessions = [];
    const limit = 1000;
    let page = 1;

    while (true) {
        const batch = await schedApiCall('session/export', {
            format: 'json',
            custom_data: 'Y',
            page: String(page),
            limit: String(limit)
        });

        if (!Array.isArray(batch) || batch.length === 0) break;
        sessions.push(...batch);
        if (batch.length < limit) break;
        page++;
        await sleep(CONFIG.throttleMs);
    }

    return sessions;
}

async function fetchGoingAll() {
    const response = await schedApiCall('going/all', { format: 'json' });
    return (response && typeof response === 'object' && !Array.isArray(response))
        ? response
        : {};
}

async function fetchSessionSeats(sessionKey) {
    const response = await schedApiCall('session/seats', {
        key: sessionKey,
        type: 'attendance',
        format: 'json'
    });
    return Array.isArray(response) ? response : [];
}

async function createSession(params) {
    return schedApiCall('session/add', params);
}

async function enrollUserInSession(username, sessionKey) {
    // With role "attendee", user/mod adds sessions on top of existing ones.
    return schedApiCall('user/mod', {
        username,
        role: 'attendee',
        sessions: sessionKey
    });
}

async function removeUserFromSession(username, sessionId) {
    // role/del with NO sessions disconnects the user from ALL their sessions.
    // Never let that happen.
    if (!username || sessionId == null || String(sessionId).trim() === '') {
        throw new Error(`Refusing role/del without a username and session id (username=${username}, id=${sessionId})`);
    }
    return schedApiCall('role/del', {
        username,
        role: 'attendee',
        sessions: String(sessionId)
    });
}

async function isUserInSession(username, sessionKey) {
    const seats = await fetchSessionSeats(sessionKey);
    return seats.some((seat) => getSeatUsername(seat) === username);
}

// =============================================================================
// Email
// =============================================================================

function emailConfigured() {
    return !!(
        CONFIG.smtp.host &&
        CONFIG.smtp.user &&
        CONFIG.smtp.pass &&
        CONFIG.emailFrom
    );
}

function createTransporter() {
    return nodemailer.createTransport({
        host: CONFIG.smtp.host,
        port: CONFIG.smtp.port,
        secure: CONFIG.smtp.port === 465,
        auth: {
            user: CONFIG.smtp.user,
            pass: CONFIG.smtp.pass
        }
    });
}

function buildSummary(report) {
    const { window, added, removed, created, conflicts, attention, errors } = report;
    const lines = [];

    lines.push(`GHHS Mentee Report - ${window.today}`);
    lines.push('='.repeat(40));
    if (CONFIG.dryRun) lines.push('[DRY RUN - no changes were made; entries show what WOULD happen]');
    lines.push('');
    lines.push(`Checked: slots after ${window.today} in ${window.months.join(' and ')}`);
    lines.push(`Slots checked: ${report.slotsChecked}`);
    lines.push('');
    lines.push(`Mentees added:           ${added.length}`);
    lines.push(`Mentees removed:         ${removed.length}`);
    lines.push(`Mentee sessions created: ${created.length}`);
    lines.push(`Not added (conflict):    ${conflicts.length}`);
    lines.push(`Needs attention:         ${attention.length}`);
    lines.push(`Errors:                  ${errors.length}`);
    lines.push(`Already correct:         ${report.unchanged}`);

    const section = (title, items, format) => {
        if (items.length === 0) return;
        lines.push('');
        lines.push(title);
        for (const item of items) lines.push(`  - ${format(item)}`);
    };

    section('ADDED:', added, (a) =>
        `${a.slot}: ${a.menteeEmail} (mentor: ${a.mentorEmail}) -> ${a.sessionName}`);
    section('REMOVED:', removed, (r) =>
        `${r.slot}: ${r.menteeEmail} removed from ${r.sessionName} - ${r.reason}`);
    section('MENTEE SESSIONS CREATED:', created, (c) =>
        `${c.slot}: ${c.sessionName} (${c.sessionKey})`);
    section('NOT ADDED - MENTEE ALREADY SCHEDULED THAT DAY:', conflicts, (c) =>
        `${c.slot}: ${c.menteeEmail} (mentor: ${c.mentorEmail}) - already in ${c.conflictsWith.join(', ')}`);
    section('NEEDS ATTENTION:', attention, (msg) => msg);
    section('ERRORS:', errors, (msg) => msg);

    if (added.length + removed.length + created.length === 0) {
        lines.push('');
        lines.push('No changes were needed this run.');
    }

    return lines.join('\n');
}

async function sendSummaryEmail(transporter, report, text) {
    const prefix = CONFIG.dryRun ? '[DRY RUN] ' : '';
    const subject = `${prefix}GHHS Mentee Report ${report.window.today}: ` +
        `+${report.added.length} added, -${report.removed.length} removed` +
        (report.errors.length || report.attention.length ? ' (needs review)' : '');

    try {
        await transporter.sendMail({
            from: CONFIG.emailFrom,
            to: CONFIG.adminEmail,
            subject,
            text
        });
        console.log(`Summary email sent to ${CONFIG.adminEmail}`);
    } catch (error) {
        console.error(`Failed to send summary email: ${error.message}`);
    }
}

// =============================================================================
// Main Logic
// =============================================================================

/** username -> Map(date -> Set(sessionKey)) from going/all. */
function buildScheduleMap(goingAll, sessionByKey) {
    const scheduleMap = new Map();

    for (const [username, sessionKeys] of Object.entries(goingAll)) {
        const byDate = new Map();
        for (const key of sessionKeys || []) {
            const session = sessionByKey.get(key);
            const date = session && extractDateFromSession(session);
            if (!date) continue;
            if (!byDate.has(date)) byDate.set(date, new Set());
            byDate.get(date).add(key);
        }
        scheduleMap.set(username.toLowerCase(), byDate);
    }

    return scheduleMap;
}

function addToScheduleMap(scheduleMap, username, date, sessionKey) {
    if (!scheduleMap.has(username)) scheduleMap.set(username, new Map());
    const byDate = scheduleMap.get(username);
    if (!byDate.has(date)) byDate.set(date, new Set());
    byDate.get(date).add(sessionKey);
}

/** Group GHHS Mentor and GHHS Mentee sessions in the window by date/venue/time. */
function buildSlots(allSessions, window, report) {
    const slots = new Map();

    for (const session of allSessions) {
        const subtype = getSessionSubtype(session);
        if (subtype !== MENTOR_SUBTYPE && subtype !== MENTEE_SUBTYPE) continue;

        const date = extractDateFromSession(session);
        if (!date || !isInWindow(date, window)) continue;

        const info = getSlotInfo(session);
        if (!info) {
            report.attention.push(
                `${getSessionName(session) || getSessionKey(session)}: missing date/time/venue, skipped.`
            );
            continue;
        }

        if (!slots.has(info.id)) {
            slots.set(info.id, { ...info, mentorSessions: [], menteeSessions: [] });
        }
        const slot = slots.get(info.id);
        (subtype === MENTOR_SUBTYPE ? slot.mentorSessions : slot.menteeSessions).push(session);
    }

    return [...slots.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function reconcileSlot(slot, ctx) {
    const { mentorToMentees, menteeToMentors, knownMentees, scheduleMap, sessionByKey, report } = ctx;
    const label = slotLabel(slot);
    console.log(`\n  ${label}`);

    // Read current state. If any read fails, skip the slot entirely so we never
    // remove anyone based on partial data.
    const signedUpMentors = [];
    const enrolled = new Map(); // username -> { email, session }
    try {
        for (const mentorSession of slot.mentorSessions) {
            const seats = await fetchSessionSeats(getSessionKey(mentorSession));
            await sleep(CONFIG.throttleMs);
            for (const seat of seats) {
                const email = normalizeEmail(seat.email);
                if (email) signedUpMentors.push(email);
            }
        }
        for (const menteeSession of slot.menteeSessions) {
            const seats = await fetchSessionSeats(getSessionKey(menteeSession));
            await sleep(CONFIG.throttleMs);
            for (const seat of seats) {
                enrolled.set(getSeatUsername(seat), {
                    email: normalizeEmail(seat.email) || getSeatUsername(seat),
                    session: menteeSession
                });
            }
        }
    } catch (error) {
        console.log(`    Error reading seats: ${error.message}`);
        report.errors.push(`${label}: could not read signups, slot skipped (${error.message})`);
        return;
    }

    // Who should be in the mentee session
    const desired = new Map(); // username -> { menteeEmail, mentorEmail }
    for (const mentorEmail of signedUpMentors) {
        const mentees = mentorToMentees.get(mentorEmail);
        if (!mentees) {
            report.attention.push(`${label}: ${mentorEmail} signed up for GHHS Mentor but is not in the mentor list.`);
            continue;
        }
        for (const menteeEmail of mentees) {
            desired.set(emailToUsername(menteeEmail), { menteeEmail, mentorEmail });
        }
    }

    console.log(`    Mentors: ${signedUpMentors.join(', ') || '(none)'}`);
    console.log(`    Should be enrolled: ${[...desired.values()].map((d) => d.menteeEmail).join(', ') || '(none)'}`);
    console.log(`    Currently enrolled: ${[...enrolled.values()].map((e) => e.email).join(', ') || '(none)'}`);

    if (slot.menteeSessions.length > 1) {
        report.attention.push(
            `${label}: ${slot.menteeSessions.length} GHHS Mentee sessions exist for this slot ` +
            `(${slot.menteeSessions.map(getSessionName).join(', ')}).`
        );
    }
    if (desired.size > CONFIG.menteeSeats) {
        report.attention.push(
            `${label}: ${desired.size} mentees should attend but the mentee session has ${CONFIG.menteeSeats} seats.`
        );
    }

    // 1. Remove mentees whose mentor is no longer signed up
    for (const [username, seat] of enrolled) {
        if (desired.has(username)) continue;

        const sessionName = getSessionName(seat.session);
        if (!knownMentees.has(username)) {
            report.attention.push(
                `${label}: ${seat.email} is in ${sessionName} but is not in the mentor/mentee list - left in place.`
            );
            continue;
        }

        const mentors = menteeToMentors.get(username) || [];
        const reason = `mentor ${mentors.join(' / ')} is no longer signed up for this shift`;
        const sessionId = getSessionId(seat.session);
        const sessionKey = getSessionKey(seat.session);

        if (!sessionId) {
            report.attention.push(
                `${label}: ${seat.email} should be removed from ${sessionName} (${reason}), ` +
                `but the session id is unknown - please remove manually.`
            );
            continue;
        }

        console.log(`    Removing ${seat.email} (${reason})`);
        if (!CONFIG.dryRun) {
            try {
                const response = await removeUserFromSession(username, sessionId);
                console.log(`    role/del response: ${JSON.stringify(response)}`);
                await sleep(1500);
                if (await isUserInSession(username, sessionKey)) {
                    report.attention.push(
                        `${label}: tried to remove ${seat.email} from ${sessionName} but Sched still lists them - please remove manually.`
                    );
                    continue;
                }
            } catch (error) {
                report.errors.push(`${label}: removing ${seat.email}: ${error.message}`);
                continue;
            }
        }

        report.removed.push({ slot: label, menteeEmail: seat.email, sessionName, reason });
    }

    // 2. Add mentees whose mentor is signed up
    for (const [username, { menteeEmail, mentorEmail }] of desired) {
        if (enrolled.has(username)) {
            report.unchanged++;
            continue;
        }

        // Conflict: mentee already has a different session on this date
        const slotMenteeKeys = new Set(slot.menteeSessions.map(getSessionKey));
        const sameDayKeys = scheduleMap.get(username)?.get(slot.date) || new Set();
        const conflictsWith = [...sameDayKeys]
            .filter((key) => !slotMenteeKeys.has(key))
            .map((key) => getSessionName(sessionByKey.get(key) || {}) || key);
        if (conflictsWith.length > 0) {
            console.log(`    CONFLICT: ${menteeEmail} already in ${conflictsWith.join(', ')}`);
            report.conflicts.push({ slot: label, menteeEmail, mentorEmail, conflictsWith });
            continue;
        }

        const menteeSession = await ensureMenteeSession(slot, label, report);
        if (!menteeSession) continue;
        const sessionKey = getSessionKey(menteeSession);
        const sessionName = getSessionName(menteeSession);

        console.log(`    Enrolling ${menteeEmail} in ${sessionName}`);
        if (!CONFIG.dryRun) {
            try {
                const response = await enrollUserInSession(username, sessionKey);
                console.log(`    user/mod response: ${JSON.stringify(response)}`);
                await sleep(1500);
                if (!(await isUserInSession(username, sessionKey))) {
                    report.attention.push(
                        `${label}: Sched accepted the enrollment of ${menteeEmail} into ${sessionName} ` +
                        `but does not list them - please check / add manually.`
                    );
                    continue;
                }
            } catch (error) {
                report.errors.push(`${label}: enrolling ${menteeEmail}: ${error.message}`);
                continue;
            }
        }

        report.added.push({ slot: label, menteeEmail, mentorEmail, sessionName });
        addToScheduleMap(scheduleMap, username, slot.date, sessionKey);
    }
}

/** Returns the slot's mentee session, creating it (frozen) if needed. */
async function ensureMenteeSession(slot, label, report) {
    if (slot.menteeSessions.length > 0) return slot.menteeSessions[0];

    const [, m, d] = slot.date.split('-');
    const name = `${m}/${d}_${slot.venue}_${MENTEE_SUBTYPE}_${formatTo12Hour(slot.startTime)}`;
    const key = generateSessionKey(slot.date, slot.venue, MENTEE_SUBTYPE, slot.startTime, slot.endTime, CONFIG.menteeSeats);

    console.log(`    Creating session: ${name}`);
    let alreadyExisted = false;
    if (!CONFIG.dryRun) {
        try {
            await createSession({
                session_key: key,
                name,
                session_start: `${slot.date} ${slot.startTime}`,
                session_end: `${slot.date} ${slot.endTime}`,
                session_type: 'General',
                session_subtype: MENTEE_SUBTYPE,
                venue: slot.venue,
                seats: String(CONFIG.menteeSeats),
                frozen: 'Y'
            });
            await sleep(CONFIG.throttleMs);
        } catch (error) {
            if (error.message.includes('already exists')) {
                alreadyExisted = true;
            } else {
                report.errors.push(`${label}: creating ${name}: ${error.message}`);
                return null;
            }
        }
    }

    if (!alreadyExisted) {
        report.created.push({ slot: label, sessionName: name, sessionKey: key });
    }

    const session = { session_key: key, name };
    slot.menteeSessions.push(session);
    return session;
}

async function main() {
    if (!CONFIG.apiKey) {
        throw new Error('SCHED_API_KEY is required');
    }

    const window = getTargetWindow(getToday());

    console.log('GHHS Mentee Sync');
    console.log(`Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Today (Central): ${window.today}`);
    console.log(`Checking slots after today in: ${window.months.join(', ')}`);
    console.log('');

    const report = {
        window,
        slotsChecked: 0,
        unchanged: 0,
        added: [],
        removed: [],
        created: [],
        conflicts: [],
        attention: [],
        errors: []
    };

    try {
        // Step 1: mentor -> mentee mappings
        console.log(`Loading mentor-mentee mappings from ${CONFIG.csvPath}...`);
        const mentorToMentees = loadMentorMenteeMappings(CONFIG.csvPath);
        console.log(`Loaded ${mentorToMentees.size} mentor(s) with mentee mappings.`);

        if (mentorToMentees.size === 0) {
            report.errors.push('No mentor/mentee mappings loaded from CSV - nothing was checked.');
        } else {
            const menteeToMentors = new Map();
            for (const [mentorEmail, mentees] of mentorToMentees) {
                for (const menteeEmail of mentees) {
                    const username = emailToUsername(menteeEmail);
                    if (!menteeToMentors.has(username)) menteeToMentors.set(username, []);
                    menteeToMentors.get(username).push(mentorEmail);
                }
            }
            const knownMentees = new Set(menteeToMentors.keys());

            // Step 2: sessions, grouped into slots
            console.log('\nFetching all sessions...');
            const allSessions = await fetchAllSessions();
            console.log(`Fetched ${allSessions.length} total sessions.`);

            const sessionByKey = new Map(allSessions.map((s) => [getSessionKey(s), s]));
            const slots = buildSlots(allSessions, window, report);
            report.slotsChecked = slots.length;
            console.log(`Found ${slots.length} GHHS slot(s) to check.`);

            // Step 3: everyone's schedule, for same-day conflict checks
            console.log('\nFetching going/all for conflict detection...');
            const goingAll = await fetchGoingAll();
            const scheduleMap = buildScheduleMap(goingAll, sessionByKey);

            // Step 4: reconcile each slot
            console.log('\nReconciling slots...');
            const ctx = { mentorToMentees, menteeToMentors, knownMentees, scheduleMap, sessionByKey, report };
            for (const slot of slots) {
                await reconcileSlot(slot, ctx);
            }
        }
    } catch (error) {
        report.errors.push(`Run stopped early: ${error.message}`);
        process.exitCode = 1;
    }

    // Step 5: admin summary (the only email this script sends)
    const summary = buildSummary(report);
    console.log('\n' + summary + '\n');

    if (emailConfigured()) {
        await sendSummaryEmail(createTransporter(), report, summary);
    } else {
        console.log('Email not configured - summary printed above only.');
    }

    console.log('Done.');
}

main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
});
