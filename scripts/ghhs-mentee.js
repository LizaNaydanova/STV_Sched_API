/**
 * ghhs-mentee.js
 *
 * Automatically assigns mentees to GHHS Mentee sessions based on their mentors'
 * GHHS Mentor signups. Creates frozen GHHS Mentee sessions and enrolls mentees.
 *
 * Pipeline:
 *   1. Load mentor→mentee CSV from private gist
 *   2. session/export → filter GHHS Mentor sessions for next month
 *   3. going/all → build conflict detection map
 *   4. For each GHHS Mentor session with signups:
 *      a. session/seats → get mentor emails
 *      b. Create matching GHHS Mentee session (frozen)
 *      c. Enroll mentee(s) via user/mod
 *   5. Send admin summary email
 *
 * Usage:
 *   SCHED_API_KEY=xxx node scripts/ghhs-mentee.js
 *
 * Environment variables:
 *   SCHED_API_KEY       (required) Sched.com API key
 *   SCHED_SUBDOMAIN     (default: stvincentsclinic2025)
 *   GHHS_CSV_PATH       Path to local CSV (for testing without gist)
 *   THROTTLE_MS         (default: 500) delay between API calls
 *   DRY_RUN             (default: false) set to "true" for preview mode
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

const getSessionKey = (s) => getField(s, 'session_key', 'event_key', 'key', 'session_id');
const getSessionName = (s) => getField(s, 'name', 'event_name', 'title');
const getSessionStart = (s) => getField(s, 'session_start', 'event_start', 'start');
const getSessionEnd = (s) => getField(s, 'session_end', 'event_end', 'end');
const getSessionVenue = (s) => getField(s, 'venue');
const getSessionSubtype = (s) => getField(s, 'session_subtype', 'event_subtype', 'subtype');

function extractDateFromSession(session) {
    const start = getSessionStart(session);
    if (!start) return null;
    const match = start.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function extractTimeFromSession(session) {
    const start = getSessionStart(session);
    if (!start) return null;
    const match = start.match(/(\d{2}:\d{2})$/);
    return match ? match[1] : null;
}

function generateSessionKey(dateStr, venue, subtype, startTime, endTime, seats) {
    const keyData = `${dateStr}${venue}General${subtype}${startTime}${endTime}${seats}`;
    const hash = Math.abs(keyData.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
    return `${dateStr.substring(2).replace(/-/g, '')}_${hash.toString(36).substring(0, 6)}`;
}

function getNextMonth() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
        year: nextMonth.getFullYear(),
        month: nextMonth.getMonth() + 1
    };
}

function isSessionInMonth(session, year, month) {
    const dateStr = extractDateFromSession(session);
    if (!dateStr) return false;
    const [sessionYear, sessionMonth] = dateStr.split('-').map(Number);
    return sessionYear === year && sessionMonth === month;
}

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
    return schedApiCall('user/mod', {
        username,
        sessions: sessionKey
    });
}

// =============================================================================
// Email Functions
// =============================================================================

function emailConfigured() {
    return !!(
        CONFIG.smtp.host &&
        CONFIG.smtp.user &&
        CONFIG.smtp.pass &&
        CONFIG.emailFrom
    );
}

async function sendSummaryEmail(results) {
    const { enrolled, skipped, errors } = results;

    const subject = `GHHS Mentee Assignment Summary - ${new Date().toLocaleDateString()}`;

    let text = 'GHHS Mentee Assignment Summary\n';
    text += '================================\n\n';

    if (CONFIG.dryRun) {
        text += '[DRY RUN - No changes made]\n\n';
    }

    text += `Enrolled: ${enrolled.length}\n`;
    text += `Skipped (conflicts): ${skipped.length}\n`;
    text += `Errors: ${errors.length}\n\n`;

    if (enrolled.length > 0) {
        text += 'ENROLLED:\n';
        for (const e of enrolled) {
            text += `  - ${e.menteeEmail} -> ${e.sessionName} (mentor: ${e.mentorEmail})\n`;
        }
        text += '\n';
    }

    if (skipped.length > 0) {
        text += 'SKIPPED (already registered that day):\n';
        for (const s of skipped) {
            text += `  - ${s.menteeEmail} (mentor: ${s.mentorEmail}) - conflict: ${s.conflict}\n`;
        }
        text += '\n';
    }

    if (errors.length > 0) {
        text += 'ERRORS:\n';
        for (const e of errors) {
            text += `  - ${e.message}\n`;
        }
    }

    console.log('\n' + text);

    if (!emailConfigured()) {
        console.log('Email not configured - skipping email send');
        return;
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
            to: CONFIG.adminEmail,
            subject,
            text
        });
        console.log(`Summary email sent to ${CONFIG.adminEmail}`);
    } catch (error) {
        console.error(`Failed to send email: ${error.message}`);
    }
}

// =============================================================================
// Main Logic
// =============================================================================

function buildConflictMap(goingAll, sessions) {
    const userDateMap = new Map();

    const sessionKeyToDate = new Map();
    for (const session of sessions) {
        const key = getSessionKey(session);
        const date = extractDateFromSession(session);
        if (key && date) {
            sessionKeyToDate.set(key, date);
        }
    }

    for (const [username, sessionKeys] of Object.entries(goingAll)) {
        const email = `${username}@utmb.edu`;
        if (!userDateMap.has(email)) {
            userDateMap.set(email, new Set());
        }

        for (const key of sessionKeys) {
            const date = sessionKeyToDate.get(key);
            if (date) {
                userDateMap.get(email).add(date);
            }
        }
    }

    return userDateMap;
}

async function main() {
    if (!CONFIG.apiKey) {
        throw new Error('SCHED_API_KEY is required');
    }

    console.log('GHHS Mentee Assignment Script');
    console.log(`Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log('');

    const results = { enrolled: [], skipped: [], errors: [] };

    // Step 1: Load mentor-mentee mappings
    console.log(`Loading mentor-mentee mappings from ${CONFIG.csvPath}...`);
    const mentorToMentees = loadMentorMenteeMappings(CONFIG.csvPath);
    console.log(`Loaded ${mentorToMentees.size} mentor(s) with mentee mappings.`);

    if (mentorToMentees.size === 0) {
        console.log('No mappings found. Exiting.');
        return;
    }

    // Step 2: Fetch all sessions and filter for GHHS Mentor in next month
    console.log('\nFetching all sessions...');
    const allSessions = await fetchAllSessions();
    console.log(`Fetched ${allSessions.length} total sessions.`);

    const { year, month } = getNextMonth();
    console.log(`Filtering for GHHS Mentor sessions in ${year}-${String(month).padStart(2, '0')}...`);

    const mentorSessions = allSessions.filter((s) => {
        const subtype = getSessionSubtype(s);
        return subtype === 'GHHS Mentor' && isSessionInMonth(s, year, month);
    });
    console.log(`Found ${mentorSessions.length} GHHS Mentor sessions for next month.`);

    // Build session map for lookup (to check if Mentee session already exists)
    const existingSessionKeys = new Set(allSessions.map(getSessionKey));

    // Step 3: Build conflict map
    console.log('\nFetching going/all for conflict detection...');
    const goingAll = await fetchGoingAll();
    const conflictMap = buildConflictMap(goingAll, allSessions);

    // Step 4: Process each mentor session
    console.log('\nProcessing GHHS Mentor sessions...');

    for (const mentorSession of mentorSessions) {
        const mentorSessionKey = getSessionKey(mentorSession);
        const mentorSessionName = getSessionName(mentorSession);
        const sessionDate = extractDateFromSession(mentorSession);
        const sessionTime = extractTimeFromSession(mentorSession);
        const sessionVenue = getSessionVenue(mentorSession);
        const sessionEnd = getSessionEnd(mentorSession);
        const endTime = sessionEnd ? sessionEnd.match(/(\d{2}:\d{2})$/)?.[1] : null;

        if (!sessionDate || !sessionTime || !sessionVenue || !endTime) {
            console.log(`  Skipping ${mentorSessionKey} - missing date/time/venue info`);
            continue;
        }

        console.log(`\n  Processing: ${mentorSessionName}`);

        // Get mentor signups
        let mentorSignups;
        try {
            mentorSignups = await fetchSessionSeats(mentorSessionKey);
            await sleep(CONFIG.throttleMs);
        } catch (error) {
            console.log(`    Error fetching seats: ${error.message}`);
            results.errors.push({ message: `${mentorSessionKey}: ${error.message}` });
            continue;
        }

        if (mentorSignups.length === 0) {
            console.log(`    No mentor signups for this session.`);
            continue;
        }

        console.log(`    Found ${mentorSignups.length} mentor signup(s).`);

        for (const signup of mentorSignups) {
            const mentorEmail = normalizeEmail(signup.email);
            if (!mentorEmail) continue;

            const mentees = mentorToMentees.get(mentorEmail);
            if (!mentees || mentees.length === 0) {
                console.log(`    ${mentorEmail} - not in mentor list, skipping.`);
                continue;
            }

            console.log(`    ${mentorEmail} has ${mentees.length} mentee(s).`);

            for (const menteeEmail of mentees) {
                const menteeUsername = emailToUsername(menteeEmail);

                // Check for conflicts
                const menteeDates = conflictMap.get(menteeEmail) || new Set();
                if (menteeDates.has(sessionDate)) {
                    console.log(`      ${menteeEmail} - CONFLICT: already registered on ${sessionDate}`);
                    results.skipped.push({
                        menteeEmail,
                        mentorEmail,
                        conflict: `Already registered on ${sessionDate}`
                    });
                    continue;
                }

                // Generate mentee session details
                const [y, m, d] = sessionDate.split('-');
                const menteeSessionName = `${m}/${d}_${sessionVenue}_GHHS Mentee_${formatTo12Hour(sessionTime)}`;
                const menteeSessionKey = generateSessionKey(sessionDate, sessionVenue, 'GHHS Mentee', sessionTime, endTime, 2);

                // Create session if it doesn't exist
                if (!existingSessionKeys.has(menteeSessionKey)) {
                    console.log(`      Creating session: ${menteeSessionName}`);

                    if (!CONFIG.dryRun) {
                        try {
                            await createSession({
                                session_key: menteeSessionKey,
                                name: menteeSessionName,
                                session_start: `${sessionDate} ${sessionTime}`,
                                session_end: `${sessionDate} ${endTime}`,
                                session_type: 'General',
                                session_subtype: 'GHHS Mentee',
                                venue: sessionVenue,
                                seats: '2',
                                frozen: 'Y'
                            });
                            existingSessionKeys.add(menteeSessionKey);
                            await sleep(CONFIG.throttleMs);
                        } catch (error) {
                            if (error.message.includes('already exists')) {
                                console.log(`      Session already exists (detected via error).`);
                                existingSessionKeys.add(menteeSessionKey);
                            } else {
                                console.log(`      Error creating session: ${error.message}`);
                                results.errors.push({ message: `Create ${menteeSessionKey}: ${error.message}` });
                                continue;
                            }
                        }
                    } else {
                        console.log(`      [DRY RUN] Would create session: ${menteeSessionKey}`);
                        existingSessionKeys.add(menteeSessionKey);
                    }
                }

                // Enroll mentee
                console.log(`      Enrolling ${menteeEmail} in ${menteeSessionName}`);

                if (!CONFIG.dryRun) {
                    try {
                        await enrollUserInSession(menteeUsername, menteeSessionKey);
                        await sleep(CONFIG.throttleMs);
                    } catch (error) {
                        console.log(`      Error enrolling: ${error.message}`);
                        results.errors.push({ message: `Enroll ${menteeEmail}: ${error.message}` });
                        continue;
                    }
                } else {
                    console.log(`      [DRY RUN] Would enroll ${menteeUsername} in ${menteeSessionKey}`);
                }

                results.enrolled.push({
                    menteeEmail,
                    mentorEmail,
                    sessionName: menteeSessionName
                });

                // Update conflict map to prevent duplicate enrollments in same run
                if (!conflictMap.has(menteeEmail)) {
                    conflictMap.set(menteeEmail, new Set());
                }
                conflictMap.get(menteeEmail).add(sessionDate);
            }
        }
    }

    // Step 5: Send summary email
    console.log('\n==================================================');
    console.log('SENDING SUMMARY');
    console.log('==================================================');
    await sendSummaryEmail(results);

    console.log('\nDone.');
}

main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
});
