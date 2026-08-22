const fetch = require('node-fetch');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SCHED_API_KEY = process.env.SCHED_API_KEY;

const SUBDOMAIN =
    process.env.SCHED_SUBDOMAIN ||
    'stvincentsclinic2025';

const TIME_ZONE =
    process.env.TIME_ZONE ||
    'America/Chicago';

// --------------------------------------------------------------------------
// SAFETY
// --------------------------------------------------------------------------

// true  = practice only
// false = make real changes + send real emails
const DRY_RUN =
    process.env.DRY_RUN === 'true';

// Optional simulated current time for testing.
//
// Example:
// 2026-08-21T09:00:00-05:00
//
// Leave blank during normal operation.
const NOW_OVERRIDE =
    process.env.NOW_OVERRIDE || '';

// --------------------------------------------------------------------------
// EMAIL
// --------------------------------------------------------------------------

const SMTP_HOST =
    process.env.SMTP_HOST || '';

const SMTP_PORT =
    Number(
        process.env.SMTP_PORT || 587
    );

const SMTP_USER =
    process.env.SMTP_USER || '';

const SMTP_PASS =
    process.env.SMTP_PASS || '';

const EMAIL_FROM =
    process.env.EMAIL_FROM || '';

const ALERT_EMAIL =
    process.env.ALERT_EMAIL || '';

// Earliest time an underfilled leadership email may be sent.
//
// This means:
// 7:45 AM → wait
// 8:37 AM → may send
// 10:00 AM → may send if it has not already been sent
const LEADERSHIP_EMAIL_START_HOUR =
    Number(
        process.env.LEADERSHIP_EMAIL_START_HOUR ||
        8
    );

// GitHub Actions cache restores this directory between runs.
const EMAIL_STATE_DIR =
    process.env.EMAIL_STATE_DIR ||
    '.automation-state';

// --------------------------------------------------------------------------
// SCHED
// --------------------------------------------------------------------------

const BASE_URL =
    `https://${SUBDOMAIN}.sched.com/api`;

const sleep = (ms) =>
    new Promise(
        (resolve) => setTimeout(resolve, ms)
    );

// ============================================================================
// DATE / TIME
// ============================================================================

function getNow() {
    if (NOW_OVERRIDE) {
        const overridden =
            DateTime.fromISO(
                NOW_OVERRIDE,
                {
                    setZone: true
                }
            ).setZone(TIME_ZONE);

        if (!overridden.isValid) {
            throw new Error(
                `NOW_OVERRIDE is invalid: ${NOW_OVERRIDE}`
            );
        }

        return overridden;
    }

    return DateTime.now()
        .setZone(TIME_ZONE);
}

function parseSchedDateTime(value) {
    if (
        !value ||
        typeof value !== 'string'
    ) {
        return null;
    }

    const formats = [
        'yyyy-MM-dd HH:mm:ss',
        'yyyy-MM-dd HH:mm',
        "yyyy-MM-dd'T'HH:mm:ss",
        "yyyy-MM-dd'T'HH:mm"
    ];

    for (const format of formats) {
        const parsed =
            DateTime.fromFormat(
                value.trim(),
                format,
                {
                    zone: TIME_ZONE
                }
            );

        if (parsed.isValid) {
            return parsed;
        }
    }

    const iso =
        DateTime.fromISO(
            value.trim(),
            {
                zone: TIME_ZONE
            }
        );

    if (iso.isValid) {
        return iso.setZone(TIME_ZONE);
    }

    return null;
}

// ============================================================================
// SCHED API
// ============================================================================

async function schedApiCall(
    apiPath,
    params = {}
) {
    const clean = {};

    for (
        const [key, value]
        of Object.entries(params)
    ) {
        if (
            value !== undefined &&
            value !== null &&
            value !== ''
        ) {
            clean[key] = value;
        }
    }

    const body =
        new URLSearchParams({
            ...clean,
            api_key: SCHED_API_KEY
        });

    const response =
        await fetch(
            `${BASE_URL}/${apiPath}`,
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded',

                    'User-Agent':
                        'STV-Sched-Automation/1.0'
                },

                body:
                    body.toString()
            }
        );

    const text =
        await response.text();

    if (!response.ok) {
        throw new Error(
            `${apiPath} failed ` +
            `(${response.status}): ${text}`
        );
    }

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
        const batch =
            await schedApiCall(
                'session/export',
                {
                    format: 'json',
                    custom_data: 'Y',
                    page: String(page),
                    limit: String(limit)
                }
            );

        if (
            !Array.isArray(batch) ||
            batch.length === 0
        ) {
            break;
        }

        sessions.push(...batch);

        if (
            batch.length < limit
        ) {
            break;
        }

        page += 1;
    }

    return sessions;
}

// ============================================================================
// FIELD HELPERS
// ============================================================================

function getField(
    session,
    ...candidates
) {
    for (
        const candidate
        of candidates
    ) {
        if (
            session[candidate] !==
            undefined
        ) {
            return session[candidate];
        }
    }

    const lowerMap = {};

    for (
        const key
        of Object.keys(session)
    ) {
        lowerMap[
            key.toLowerCase()
        ] = key;
    }

    for (
        const candidate
        of candidates
    ) {
        const realKey =
            lowerMap[
                candidate.toLowerCase()
            ];

        if (
            realKey !== undefined &&
            session[realKey] !==
                undefined
        ) {
            return session[realKey];
        }
    }

    return undefined;
}

function getKey(session) {
    return getField(
        session,
        'session_key',
        'event_key',
        'key',
        'session_id'
    );
}

function getName(session) {
    return (
        getField(
            session,
            'name',
            'event_name',
            'session_name'
        ) ||
        'Unnamed session'
    );
}

function getStartRaw(session) {
    return getField(
        session,
        'session_start',
        'event_start',
        'start',
        'session_date',
        'date'
    );
}

function getStart(session) {
    return parseSchedDateTime(
        getStartRaw(session)
    );
}

// ============================================================================
// SESSION TYPE
// ============================================================================

function getType(session) {
    const raw =
        getField(
            session,
            'session_type',
            'event_type',
            'type'
        );

    if (raw) {
        const type =
            String(raw)
                .toLowerCase();

        // BOTH Leadership and Shadowing
        // follow the leadership 7-day rule.
        if (
            type.includes(
                'leadership'
            ) ||
            type.includes(
                'shadowing'
            )
        ) {
            return 'Leadership';
        }

        if (
            type.includes('general')
        ) {
            return 'General';
        }
    }

    // Fallback:
    // also look at the session name.
    const name =
        getName(session)
            .toLowerCase();

    if (
        name.includes(
            'leadership'
        ) ||
        name.includes(
            'shadowing'
        )
    ) {
        return 'Leadership';
    }

    return 'General';
}

function getRequiredSeats(session) {
    const raw =
        getField(
            session,
            'seats',
            'event_seats',
            'session_seats',
            'capacity'
        );

    const seats =
        Number(raw);

    if (
        !Number.isFinite(seats)
    ) {
        return null;
    }

    return seats;
}

function getFrozen(session) {
    return getField(
        session,
        'frozen'
    );
}

// ============================================================================
// ATTENDANCE / COVERAGE
// ============================================================================

async function getAttendanceCount(
    session
) {
    const key =
        getKey(session);

    if (!key) {
        throw new Error(
            'Cannot retrieve attendance: ' +
            'session has no key'
        );
    }

    const response =
        await schedApiCall(
            'session/seats',
            {
                key,
                type: 'attendance',
                format: 'json'
            }
        );

    if (
        !Array.isArray(response)
    ) {
        throw new Error(
            `Unexpected session/seats ` +
            `response for ${key}: ` +
            JSON.stringify(response)
        );
    }

    return response.length;
}

async function getCoverage(
    session
) {
    const required =
        getRequiredSeats(session);

    if (
        required === null ||
        required < 1
    ) {
        throw new Error(
            'Could not determine ' +
            'required seats'
        );
    }

    const registered =
        await getAttendanceCount(
            session
        );

    return {
        required,
        registered,

        full:
            registered >= required,

        missing:
            Math.max(
                required -
                    registered,
                0
            )
    };
}

// ============================================================================
// FREEZE / UNFREEZE
// ============================================================================

function isErrorResponse(
    response
) {
    return (
        typeof response ===
            'string' &&
        /^err/i.test(
            response.trim()
        )
    );
}

async function setFrozen(
    session,
    desiredValue,
    reason
) {
    const key =
        getKey(session);

    const name =
        getName(session);

    const current =
        getFrozen(session);

    console.log(
        `${
            desiredValue === 'Y'
                ? 'FREEZE'
                : 'UNFREEZE'
        }: ` +
        `${name} | ` +
        `${key} | ` +
        `${reason}`
    );

    // Already in desired state.
    if (
        current !== undefined &&
        current === desiredValue
    ) {
        console.log(
            `  Already frozen=` +
            `${desiredValue}; ` +
            `skipping.`
        );

        return true;
    }

    // Practice mode.
    if (DRY_RUN) {
        console.log(
            `  [DRY RUN] ` +
            `Would set frozen=` +
            `${desiredValue}`
        );

        return true;
    }

    const response =
        await schedApiCall(
            'event/mod',
            {
                session_key:
                    key,

                frozen:
                    desiredValue
            }
        );

    if (
        isErrorResponse(response)
    ) {
        console.log(
            `  ✗ Sched rejected ` +
            `update: ${response}`
        );

        return false;
    }

    console.log(
        '  ✓ event/mod sent successfully'
    );

    await sleep(500);

    return true;
}

// ============================================================================
// MONTHLY OPENING
// ============================================================================

function isInNextCalendarMonth(
    session,
    now
) {
    const start =
        getStart(session);

    if (!start) {
        return false;
    }

    const nextMonth =
        now.plus({
            months: 1
        }).startOf(
            'month'
        );

    return (
        start.year ===
            nextMonth.year &&
        start.month ===
            nextMonth.month
    );
}

async function handleMonthlyOpening(
    sessions,
    now
) {
    // Currently:
    // Open next month's sessions
    // on the 21st during the
    // 8 PM Central hour.
    //
    // Example:
    // 8:17 PM → runs
    // 8:40 PM → runs
    // 9:05 PM → does not run
    if (
        now.day !== 21 ||
        now.hour !== 20
    ) {
        return;
    }

    const nextMonth =
        now.plus({
            months: 1
        });

    console.log('');

    console.log(
        '=================================================='
    );

    console.log(
        `MONTHLY OPENING: ` +
        `${nextMonth.toFormat(
            'LLLL yyyy'
        )}`
    );

    console.log(
        '=================================================='
    );

    const targets =
        sessions.filter(
            (session) =>
                isInNextCalendarMonth(
                    session,
                    now
                )
        );

    console.log(
        `Found ${targets.length} ` +
        `session(s) in next month.`
    );

    for (
        const session
        of targets
    ) {
        const start =
            getStart(session);

        if (!start) {
            console.log(
                `Skipping ` +
                `${getName(session)}: ` +
                `could not parse date.`
            );

            continue;
        }

        const hoursAway =
            start.diff(
                now,
                'hours'
            ).hours;

        // Don't let monthly opening
        // override the leadership
        // 7-day rule.
        if (
            getType(session) ===
                'Leadership' &&
            hoursAway <= 168
        ) {
            console.log(
                `Skipping leadership ` +
                `session inside ` +
                `7-day deadline: ` +
                getName(session)
            );

            continue;
        }

        // Don't let monthly opening
        // override the General
        // 48-hour rule.
        if (
            getType(session) ===
                'General' &&
            hoursAway <= 48
        ) {
            console.log(
                `Skipping general ` +
                `session inside ` +
                `48-hour deadline: ` +
                getName(session)
            );

            continue;
        }

        await setFrozen(
            session,
            'N',
            'Monthly opening for ' +
            'next calendar month'
        );
    }
}

// ============================================================================
// EMAIL STATE
// ============================================================================

function getLeadershipEmailMarkerPath(
    now
) {
    const dateKey =
        now.toISODate();

    return path.join(
        EMAIL_STATE_DIR,
        `leadership-email-` +
        `${dateKey}.sent`
    );
}

function leadershipEmailAlreadySent(
    now
) {
    return fs.existsSync(
        getLeadershipEmailMarkerPath(
            now
        )
    );
}

function markLeadershipEmailSent(
    now
) {
    fs.mkdirSync(
        EMAIL_STATE_DIR,
        {
            recursive: true
        }
    );

    const markerPath =
        getLeadershipEmailMarkerPath(
            now
        );

    fs.writeFileSync(
        markerPath,

        `Sent at ${
            DateTime.now()
                .setZone(
                    TIME_ZONE
                )
                .toISO()
        }\n`,

        'utf8'
    );

    console.log(
        `✓ Saved leadership ` +
        `email marker: ` +
        `${markerPath}`
    );
}

// ============================================================================
// LEADERSHIP + SHADOWING
// EXACTLY 7 CALENDAR DAYS BEFORE
// ============================================================================

async function processLeadership(
    sessions,
    now
) {
    console.log('');

    console.log(
        '=================================================='
    );

    console.log(
        'LEADERSHIP / SHADOWING 7-DAY CHECK'
    );

    console.log(
        '=================================================='
    );

    const underfilledForEmail =
        [];

    for (
        const session
        of sessions
    ) {
        // Includes both Leadership
        // and Shadowing.
        if (
            getType(session) !==
            'Leadership'
        ) {
            continue;
        }

        const start =
            getStart(session);

        if (!start) {
            continue;
        }

        const clinicDate =
            start.startOf('day');

        const today =
            now.startOf('day');

        const calendarDaysAway =
            Math.round(
                clinicDate.diff(
                    today,
                    'days'
                ).days
            );

        // ONLY exactly 7
        // calendar days before.
        if (
            calendarDaysAway !== 7
        ) {
            continue;
        }

        let coverage;

        try {
            coverage =
                await getCoverage(
                    session
                );
        } catch (error) {
            console.log(
                `✗ Coverage check ` +
                `failed for ` +
                `${getName(session)}: ` +
                `${error.message}`
            );

            continue;
        }

        console.log(
            `${getName(session)}: ` +
            `${coverage.registered}/` +
            `${coverage.required} filled`
        );

        // ----------------------------------------------------------
        // FULL
        // ----------------------------------------------------------

        if (coverage.full) {
            await setFrozen(
                session,
                'Y',
                `Leadership full ` +
                `7 days before clinic ` +
                `(${coverage.registered}/` +
                `${coverage.required})`
            );
        }

        // ----------------------------------------------------------
        // UNDERFILLED
        // ----------------------------------------------------------

        else {
            // Leave/open the shift
            // so people can still sign up.
            await setFrozen(
                session,
                'N',
                `Leadership underfilled ` +
                `7 days before clinic ` +
                `(${coverage.registered}/` +
                `${coverage.required})`
            );

            // Add it to ONE combined
            // email report.
            underfilledForEmail.push({
                session,
                coverage
            });
        }

        await sleep(250);
    }

    // Nothing underfilled today.
    if (
        underfilledForEmail.length ===
        0
    ) {
        console.log(
            'No underfilled leadership ' +
            'sessions requiring an email.'
        );

        return;
    }

    // --------------------------------------------------------------
    // EMAIL TIME
    // --------------------------------------------------------------

    // Do not require GitHub to run
    // at exactly 8:00 AM.
    //
    // Any run after 8 AM can send.
    if (
        now.hour <
        LEADERSHIP_EMAIL_START_HOUR
    ) {
        console.log(
            `Leadership email ` +
            `not sent yet. ` +
            `Waiting until at least ` +
            `${LEADERSHIP_EMAIL_START_HOUR}:00 ` +
            `${TIME_ZONE}.`
        );

        return;
    }

    // --------------------------------------------------------------
    // DUPLICATE PROTECTION
    // --------------------------------------------------------------

    if (
        leadershipEmailAlreadySent(
            now
        )
    ) {
        console.log(
            `Leadership coverage ` +
            `email already sent for ` +
            `${now.toISODate()}; ` +
            `skipping duplicate.`
        );

        return;
    }

    // --------------------------------------------------------------
    // SEND
    // --------------------------------------------------------------

    const sent =
        await sendLeadershipAlert(
            underfilledForEmail
        );

    // Only create marker after
    // ACTUAL successful email.
    //
    // Failed email:
    // next GitHub run retries.
    //
    // DRY RUN:
    // marker is NOT created.
    if (sent) {
        markLeadershipEmailSent(
            now
        );
    }
}

// ============================================================================
// GENERAL
// WITHIN 48 HOURS
// ============================================================================

async function processGeneral(
    sessions,
    now
) {
    console.log('');

    console.log(
        '=================================================='
    );

    console.log(
        'GENERAL 48-HOUR CHECK'
    );

    console.log(
        '=================================================='
    );

    for (
        const session
        of sessions
    ) {
        if (
            getType(session) !==
            'General'
        ) {
            continue;
        }

        const start =
            getStart(session);

        if (!start) {
            continue;
        }

        const hoursAway =
            start.diff(
                now,
                'hours'
            ).hours;

        if (
            hoursAway <= 0 ||
            hoursAway > 48
        ) {
            continue;
        }

        let coverage;

        try {
            coverage =
                await getCoverage(
                    session
                );
        } catch (error) {
            console.log(
                `✗ Coverage check ` +
                `failed for ` +
                `${getName(session)}: ` +
                `${error.message}`
            );

            continue;
        }

        console.log(
            `${getName(session)}: ` +
            `${coverage.registered}/` +
            `${coverage.required} filled`
        );

        if (coverage.full) {
            await setFrozen(
                session,
                'Y',
                `General shift full ` +
                `within 48 hours ` +
                `(${coverage.registered}/` +
                `${coverage.required})`
            );
        } else {
            await setFrozen(
                session,
                'N',
                `General shift underfilled ` +
                `within 48 hours ` +
                `(${coverage.registered}/` +
                `${coverage.required})`
            );
        }

        await sleep(250);
    }
}

// ============================================================================
// EMAIL
// ============================================================================

function emailConfigured() {
    return (
        SMTP_HOST &&
        SMTP_USER &&
        SMTP_PASS &&
        EMAIL_FROM &&
        ALERT_EMAIL
    );
}

async function sendLeadershipAlert(
    items
) {
    // Sort shifts chronologically.
    const sorted =
        [...items].sort(
            (a, b) =>
                getStart(a.session)
                    .toMillis() -
                getStart(b.session)
                    .toMillis()
        );

    // Group by clinic date.
    const groupedByDate = {};

    for (
        const item
        of sorted
    ) {
        const start =
            getStart(
                item.session
            );

        const dateKey =
            start.toISODate();

        if (
            !groupedByDate[
                dateKey
            ]
        ) {
            groupedByDate[
                dateKey
            ] = [];
        }

        groupedByDate[
            dateKey
        ].push(item);
    }

    let text = '';

    text +=
        'The following St. Vincent\'s Clinic ' +
        'leadership/shadowing shifts are one week away ' +
        'and are not fully covered.\n\n';

    for (
        const [
            date,
            dateItems
        ]
        of Object.entries(
            groupedByDate
        )
    ) {
        const formattedDate =
            DateTime.fromISO(
                date,
                {
                    zone:
                        TIME_ZONE
                }
            ).toFormat(
                'cccc, LLLL d, yyyy'
            );

        text +=
            `${formattedDate}\n`;

        for (
            const item
            of dateItems
        ) {
            const {
                session,
                coverage
            } = item;

            text +=
                `- ${getName(session)}: ` +
                `${coverage.registered}/` +
                `${coverage.required} filled ` +
                `(${coverage.missing} still needed)\n`;
        }

        text += '\n';
    }

    text +=
        'These underfilled leadership/shadowing shifts ' +
        'have been left open in Sched so additional ' +
        'coverage can be found.\n';

    console.log('');

    console.log(
        '=================================================='
    );

    console.log(
        'LEADERSHIP COVERAGE EMAIL'
    );

    console.log(
        '=================================================='
    );

    console.log(text);

    // --------------------------------------------------------------
    // DRY RUN
    // --------------------------------------------------------------

    if (DRY_RUN) {
        console.log(
            `[DRY RUN] Would email ` +
            `${ALERT_EMAIL}.`
        );

        return false;
    }

    // --------------------------------------------------------------
    // CHECK CONFIGURATION
    // --------------------------------------------------------------

    if (
        !emailConfigured()
    ) {
        console.log(
            '⚠ Email not sent because ' +
            'SMTP secrets are not configured.'
        );

        console.log(
            `Intended recipient: ` +
            `${ALERT_EMAIL}`
        );

        return false;
    }

    // --------------------------------------------------------------
    // CREATE SMTP CONNECTION
    // --------------------------------------------------------------

    const transporter =
        nodemailer.createTransport({
            host:
                SMTP_HOST,

            port:
                SMTP_PORT,

            secure:
                SMTP_PORT === 465,

            auth: {
                user:
                    SMTP_USER,

                pass:
                    SMTP_PASS
            }
        });

    // --------------------------------------------------------------
    // SEND EMAIL
    // --------------------------------------------------------------

    try {
        await transporter.sendMail({
            from:
                EMAIL_FROM,

            to:
                ALERT_EMAIL,

            subject:
                'St. Vincent’s Clinic Leadership Coverage Needed',

            text
        });

        console.log(
            `✓ Leadership coverage ` +
            `email sent to ` +
            `${ALERT_EMAIL}`
        );

        return true;
    } catch (error) {
        console.error(
            `✗ Leadership coverage ` +
            `email failed: ` +
            `${error.message}`
        );

        // Don't save sent marker.
        // Next GitHub run can retry.
        return false;
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    if (!SCHED_API_KEY) {
        throw new Error(
            'SCHED_API_KEY is required'
        );
    }

    const now =
        getNow();

    console.log(
        'Sched automation starting...'
    );

    console.log(
        `Mode: ${
            DRY_RUN
                ? 'DRY RUN'
                : 'LIVE'
        }`
    );

    console.log(
        `Current time used by automation: ` +
        `${now.toISO()}`
    );

    if (NOW_OVERRIDE) {
        console.log(
            `*** USING SIMULATED TIME: ` +
            `${NOW_OVERRIDE} ***`
        );
    }

    console.log(
        `Time zone: ${TIME_ZONE}`
    );

    console.log(
        `Leadership email may send ` +
        `after: ` +
        `${LEADERSHIP_EMAIL_START_HOUR}:00`
    );

    console.log(
        `Fetching sessions from ` +
        `${BASE_URL} ...`
    );

    const sessions =
        await fetchAllSessions();

    console.log(
        `Fetched ` +
        `${sessions.length} ` +
        `total sessions.`
    );

    // --------------------------------------------------------------
    // MONTHLY OPENING
    // --------------------------------------------------------------

    await handleMonthlyOpening(
        sessions,
        now
    );

    // --------------------------------------------------------------
    // LEADERSHIP + SHADOWING
    // --------------------------------------------------------------

    await processLeadership(
        sessions,
        now
    );

    // --------------------------------------------------------------
    // GENERAL
    // --------------------------------------------------------------

    await processGeneral(
        sessions,
        now
    );

    console.log('');

    console.log(
        '=================================================='
    );

    console.log(
        'AUTOMATION COMPLETE'
    );

    console.log(
        '=================================================='
    );

    if (DRY_RUN) {
        console.log(
            'No Sched changes or emails ' +
            'were made because ' +
            'DRY_RUN=true.'
        );
    }
}

main().catch(
    (error) => {
        console.error(
            'Fatal error:',
            error
        );

        process.exitCode = 1;
    }
);
