const fetch = require('node-fetch');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SCHED_API_KEY = process.env.SCHED_API_KEY;
const SUBDOMAIN = process.env.SCHED_SUBDOMAIN || 'stvincentsclinic2025';

const TIME_ZONE = process.env.TIME_ZONE || 'America/Chicago';

// Practice/safety settings
const DRY_RUN = process.env.DRY_RUN === 'true';

// Optional simulated current time.
// Example:
// 2026-08-08T20:00:00-05:00
const NOW_OVERRIDE = process.env.NOW_OVERRIDE || '';

// Email settings
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const ALERT_EMAIL =
    process.env.ALERT_EMAIL || 'gebugari@utmb.edu';

const BASE_URL =
    `https://${SUBDOMAIN}.sched.com/api`;

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// DATE/TIME
// ============================================================================

function getNow() {
    if (NOW_OVERRIDE) {
        const overridden =
            DateTime.fromISO(NOW_OVERRIDE, {
                setZone: true
            }).setZone(TIME_ZONE);

        if (!overridden.isValid) {
            throw new Error(
                `NOW_OVERRIDE is invalid: ${NOW_OVERRIDE}`
            );
        }

        return overridden;
    }

    return DateTime.now().setZone(TIME_ZONE);
}

function parseSchedDateTime(value) {
    if (!value || typeof value !== 'string') {
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
    path,
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
            `${BASE_URL}/${path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded',
                    'User-Agent':
                        'STV-Sched-Automation/1.0'
                },
                body: body.toString()
            }
        );

    const text =
        await response.text();

    if (!response.ok) {
        throw new Error(
            `${path} failed (${response.status}): ${text}`
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

        if (batch.length < limit) {
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
    for (const candidate of candidates) {
        if (
            session[candidate] !== undefined
        ) {
            return session[candidate];
        }
    }

    const lowerMap = {};

    for (
        const key
        of Object.keys(session)
    ) {
        lowerMap[key.toLowerCase()] = key;
    }

    for (const candidate of candidates) {
        const realKey =
            lowerMap[
                candidate.toLowerCase()
            ];

        if (
            realKey !== undefined &&
            session[realKey] !== undefined
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
        ) || 'Unnamed session'
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
            String(raw).toLowerCase();

        if (
            type.includes('leadership')
        ) {
            return 'Leadership';
        }

        if (
            type.includes('general')
        ) {
            return 'General';
        }
    }

    const name =
        getName(session).toLowerCase();

    if (
        name.includes('leadership')
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

    const seats = Number(raw);

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

function isShadowingSession(session) {
    return getName(session)
        .toLowerCase()
        .includes('shadowing');
}

// ============================================================================
// ATTENDANCE / COVERAGE
// ============================================================================

async function getAttendanceCount(
    session
) {
    const key = getKey(session);

    if (!key) {
        throw new Error(
            'Cannot retrieve attendance: session has no key'
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

    if (!Array.isArray(response)) {
        throw new Error(
            `Unexpected session/seats response for ${key}: ` +
            JSON.stringify(response)
        );
    }

    return response.length;
}

async function getCoverage(session) {
    const required =
        getRequiredSeats(session);

    if (
        required === null ||
        required < 1
    ) {
        throw new Error(
            'Could not determine required seats'
        );
    }

    const registered =
        await getAttendanceCount(session);

    return {
        required,
        registered,
        full:
            registered >= required,
        missing:
            Math.max(
                required - registered,
                0
            )
    };
}

// ============================================================================
// FREEZE / UNFREEZE
// ============================================================================

function isErrorResponse(response) {
    return (
        typeof response === 'string' &&
        /^err/i.test(response.trim())
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
        `${desiredValue === 'Y'
            ? 'FREEZE'
            : 'UNFREEZE'}: ` +
        `${name} | ${key} | ${reason}`
    );

    if (
        current !== undefined &&
        current === desiredValue
    ) {
        console.log(
            `  Already frozen=${desiredValue}; skipping.`
        );

        return true;
    }

    if (DRY_RUN) {
        console.log(
            `  [DRY RUN] Would set frozen=${desiredValue}`
        );

        return true;
    }

    const response =
        await schedApiCall(
            'event/mod',
            {
                session_key: key,
                frozen: desiredValue
            }
        );

    if (
        isErrorResponse(response)
    ) {
        console.log(
            `  ✗ Sched rejected update: ${response}`
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
        now.plus({ months: 1 })
            .startOf('month');

    return (
        start.year === nextMonth.year &&
        start.month === nextMonth.month
    );
}

async function handleMonthlyOpening(
    sessions,
    now
) {
    // Only on the 21st during the 8 PM Central hour
    if (
        now.day !== 21 ||
        now.hour !== 20
    ) {
        return;
    }

    const nextMonth =
        now.plus({ months: 1 });

    console.log('');
    console.log(
        '=================================================='
    );
    console.log(
        `MONTHLY OPENING: ${nextMonth.toFormat('LLLL yyyy')}`
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
        `Found ${targets.length} session(s) in next month.`
    );

    for (
        const session
        of targets
    ) {
        const start =
            getStart(session);

        if (!start) {
            console.log(
                `Skipping ${getName(session)}: could not parse date.`
            );
            continue;
        }

        const hoursAway =
            start.diff(
                now,
                'hours'
            ).hours;

        // Do not let monthly opening override
        // leadership/general deadline rules.
        if (
            getType(session) === 'Leadership' &&
            hoursAway <= 168
        ) {
            console.log(
                `Skipping leadership session inside 7-day deadline: ` +
                getName(session)
            );
            continue;
        }

        if (
            getType(session) === 'General' &&
            hoursAway <= 48
        ) {
            console.log(
                `Skipping general session inside 48-hour deadline: ` +
                getName(session)
            );
            continue;
        }

        await setFrozen(
            session,
            'N',
            'Monthly opening for next calendar month'
        );
    }
}

// ============================================================================
// LEADERSHIP: EXACTLY 7 CALENDAR DAYS BEFORE
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
        'LEADERSHIP 7-DAY CHECK'
    );
    console.log(
        '=================================================='
    );

    const underfilledForEmail = [];

    for (
        const session
        of sessions
    ) {
        if (
            getType(session) !== 'Leadership'
        ) {
            continue;
        }

        // Shadowing slots do not count as required leadership coverage.
        if (
            isShadowingSession(session)
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
                clinicDate
                    .diff(
                        today,
                        'days'
                    )
                    .days
            );

        // Run the leadership rule only exactly
        // 7 calendar days before the clinic.
        if (
            calendarDaysAway !== 7
        ) {
            continue;
        }

        let coverage;

        try {
            coverage =
                await getCoverage(session);
        } catch (error) {
            console.log(
                `✗ Coverage check failed for ${getName(session)}: ` +
                error.message
            );

            continue;
        }

        console.log(
            `${getName(session)}: ` +
            `${coverage.registered}/${coverage.required} filled`
        );

        if (coverage.full) {
            await setFrozen(
                session,
                'Y',
                `Leadership full 7 days before clinic ` +
                `(${coverage.registered}/${coverage.required})`
            );
        } else {
            await setFrozen(
                session,
                'N',
                `Leadership underfilled 7 days before clinic ` +
                `(${coverage.registered}/${coverage.required})`
            );

            // Only queue the email during the 8 PM hour,
            // so an hourly workflow does not send repeated alerts.
            if (now.hour === 20) {
                underfilledForEmail.push({
                    session,
                    coverage
                });
            }
        }

        await sleep(250);
    }

    if (
        underfilledForEmail.length > 0
    ) {
        await sendLeadershipAlert(
            underfilledForEmail
        );
    }
}

// ============================================================================
// GENERAL: WITHIN 48 HOURS
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
            getType(session) !== 'General'
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
                await getCoverage(session);
        } catch (error) {
            console.log(
                `✗ Coverage check failed for ${getName(session)}: ` +
                error.message
            );

            continue;
        }

        console.log(
            `${getName(session)}: ` +
            `${coverage.registered}/${coverage.required} filled`
        );

        if (coverage.full) {
            await setFrozen(
                session,
                'Y',
                `General shift full within 48 hours ` +
                `(${coverage.registered}/${coverage.required})`
            );
        } else {
            await setFrozen(
                session,
                'N',
                `General shift underfilled within 48 hours ` +
                `(${coverage.registered}/${coverage.required})`
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
        EMAIL_FROM
    );
}

async function sendLeadershipAlert(
    items
) {
    const sorted =
        [...items].sort(
            (a, b) =>
                getStart(a.session)
                    .toMillis() -
                getStart(b.session)
                    .toMillis()
        );

    const groupedByDate = {};

    for (
        const item
        of sorted
    ) {
        const start =
            getStart(item.session);

        const dateKey =
            start.toISODate();

        if (
            !groupedByDate[dateKey]
        ) {
            groupedByDate[dateKey] = [];
        }

        groupedByDate[dateKey]
            .push(item);
    }

    let text = '';

    text +=
        'The following St. Vincent\'s Clinic leadership shifts are one week away and are not fully covered.\n\n';

    for (
        const [date, dateItems]
        of Object.entries(groupedByDate)
    ) {
        const formattedDate =
            DateTime.fromISO(
                date,
                {
                    zone: TIME_ZONE
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
                `${coverage.registered}/${coverage.required} filled ` +
                `(${coverage.missing} still needed)\n`;
        }

        text += '\n';
    }

    text +=
        'These underfilled leadership shifts have been left open in Sched so additional coverage can be found.\n';

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

    if (DRY_RUN) {
        console.log(
            `[DRY RUN] Would email ${ALERT_EMAIL}.`
        );
        return;
    }

    if (!emailConfigured()) {
        console.log(
            '⚠ Email not sent because SMTP secrets are not configured.'
        );

        console.log(
            `Intended recipient: ${ALERT_EMAIL}`
        );

        return;
    }

    const transporter =
        nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure:
                SMTP_PORT === 465,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            }
        });

    await transporter.sendMail({
        from: EMAIL_FROM,
        to: ALERT_EMAIL,
        subject:
            'St. Vincent’s Clinic Leadership Coverage Needed',
        text
    });

    console.log(
        `✓ Leadership coverage email sent to ${ALERT_EMAIL}`
    );
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
        `Mode: ${DRY_RUN
            ? 'DRY RUN'
            : 'LIVE'}`
    );

    console.log(
        `Current time used by automation: ${now.toISO()}`
    );

    if (NOW_OVERRIDE) {
        console.log(
            `*** USING SIMULATED TIME: ${NOW_OVERRIDE} ***`
        );
    }

    console.log(
        `Time zone: ${TIME_ZONE}`
    );

    console.log(
        `Fetching sessions from ${BASE_URL} ...`
    );

    const sessions =
        await fetchAllSessions();

    console.log(
        `Fetched ${sessions.length} total sessions.`
    );

    await handleMonthlyOpening(
        sessions,
        now
    );

    await processLeadership(
        sessions,
        now
    );

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
            'No Sched changes or emails were made because DRY_RUN=true.'
        );
    }
}

main().catch((error) => {
    console.error(
        'Fatal error:',
        error
    );

    process.exitCode = 1;
});
