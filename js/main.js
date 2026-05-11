// =================================================================
// ========================= CONFIGURATION =========================
// =================================================================

// Store the loaded month data in memory
let loadedMonthData = null;

// Leadership roles configuration
const leadershipRoles = [
    { name: "Chair", seats: 1 },
    { name: "Encounter", seats: 1 },
    { name: "Front Desk", seats: 1 },
    { name: "In Person Support", seats: 1 },
    { name: "Distance Support", seats: 1 },
    { name: "Pharmacy", seats: 1 }
];

// Clinic configurations
const clinicConfigs = {
    "Medicine_Podiatry": {
        venue: "Medicine/Podiatry",
        leadership_times: { start: "16:15", end: "20:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "16:15", end: "18:15", seats: 3 },
            { name: "Leadership Volunteer", start: "17:30", end: "19:30", seats: 2 }
        ],
        general: [
            { name: "Ophtho Lead", start: "16:15", end: "18:15", seats: 1 },
            { name: "Ophtho Volunteer", start: "16:15", end: "18:15", seats: 2 },
            { name: "MS3/MS4/AI", start: "16:15", end: "18:15", seats: 4 },
            { name: "Podiatry", start: "16:15", end: "18:15", seats: 2 }
        ],
        shifts: {
            Experienced: [{ s: "16:15", e: "18:15", c: 4 }, { s: "17:30", e: "19:30", c: 4 }],
            New: [{ s: "16:15", e: "18:30", c: 4 }, { s: "17:30", e: "19:30", c: 4 }]
        }
    },
    "Ob_Gyn": {
        venue: "Ob/Gyn",
        leadership_times: { start: "16:15", end: "20:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "16:15", end: "18:15", seats: 3 },
            { name: "Leadership Volunteer", start: "17:30", end: "19:30", seats: 2 }
        ],
        general: [
            { name: "Ophtho Lead", start: "16:15", end: "18:15", seats: 1 },
            { name: "Ophtho Volunteer", start: "16:15", end: "18:15", seats: 2 },
            { name: "MS3/MS4/AI", start: "16:15", end: "18:15", seats: 4 },
            { name: "Family Planning Lead", start: "16:15", end: "18:15", seats: 2 },
            { name: "Family Planning Volunteer", start: "16:15", end: "18:15", seats: 2 },
            { name: "Family Planning Volunteer", start: "17:15", end: "19:15", seats: 2 },
            { name: "Family Planning Volunteer", start: "18:15", end: "20:15", seats: 2 }
        ],
        shifts: {
            Experienced: [{ s: "16:15", e: "18:15", c: 3 }, { s: "17:30", e: "19:30", c: 3 }],
            New: [{ s: "16:15", e: "18:15", c: 3 }, { s: "17:30", e: "19:30", c: 3 }]
        }
    },
    "Medicine": {
        venue: "Medicine",
        leadership_times: { start: "16:15", end: "20:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "16:15", end: "18:15", seats: 3 },
            { name: "Leadership Volunteer", start: "17:30", end: "19:30", seats: 2 }
        ],
        general: [
            { name: "Ophtho Lead", start: "16:15", end: "18:15", seats: 1 },
            { name: "Ophtho Volunteer", start: "16:15", end: "18:15", seats: 2 },
            { name: "MS3/MS4/AI", start: "16:15", end: "18:15", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "16:15", e: "18:15", c: 4 }, { s: "17:30", e: "19:30", c: 4 }],
            New: [{ s: "16:15", e: "18:30", c: 4 }, { s: "17:30", e: "19:30", c: 4 }]
        }
    },
    "Medicine_Sat": {
        venue: "Medicine",
        leadership_times: { start: "08:30", end: "13:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "09:15", end: "11:15", seats: 2 },
            { name: "Leadership Volunteer", start: "10:30", end: "12:30", seats: 2 }
        ],
        general: [
            { name: "MS3/MS4/AI", start: "09:15", end: "11:15", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "09:15", e: "11:30", c: 2 }, { s: "10:30", e: "12:30", c: 2 }],
            New: [{ s: "09:15", e: "11:15", c: 3 }, { s: "10:30", e: "12:30", c: 3 }]
        }
    },
    "Derm": {
        venue: "Derm",
        leadership_times: { start: "16:45", end: "20:45" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "16:45", end: "19:00", seats: 4 },
            { name: "Leadership Volunteer", start: "17:45", end: "19:45", seats: 2 }
        ],
        general: [
            { name: "MS3/MS4/AI", start: "16:45", end: "19:00", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "16:45", e: "19:00", c: 5 }, { s: "17:45", e: "19:45", c: 5 }],
            New: [{ s: "16:45", e: "19:00", c: 5 }, { s: "17:45", e: "19:45", c: 5 }]
        }
    },
    "Psych_Rheum": {
        venue: "Psych/Rheum",
        leadership_times: { start: "16:15", end: "20:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "16:15", end: "18:15", seats: 2 },
            { name: "Leadership Volunteer", start: "17:30", end: "19:30", seats: 2 }
        ],
        general: [
            { name: "MS3/MS4/AI", start: "16:15", end: "18:15", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "16:15", e: "18:15", c: 3 }, { s: "17:00", e: "19:00", c: 4 }, { s: "17:30", e: "19:30", c: 2 }],
            New: [{ s: "16:15", e: "18:15", c: 4 }, { s: "17:30", e: "19:30", c: 4 }]
        }
    },
    "Psych": {
        venue: "Psych",
        leadership_times: { start: "16:15", end: "20:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "16:15", end: "18:15", seats: 3 },
            { name: "Leadership Volunteer", start: "17:30", end: "19:30", seats: 2 }
        ],
        general: [
            { name: "MS3/MS4/AI", start: "16:15", end: "18:15", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "16:15", e: "18:15", c: 4 }, { s: "17:30", e: "19:30", c: 4 }],
            New: [{ s: "16:15", e: "18:15", c: 4 }, { s: "17:30", e: "19:30", c: 4 }]
        }
    },
    "Surgery_ENT": {
        venue: "Surgery/ENT",
        leadership_times: { start: "16:15", end: "20:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "16:15", end: "18:15", seats: 3 },
            { name: "Leadership Volunteer", start: "17:30", end: "19:30", seats: 3 }
        ],
        general: [
            { name: "MS3/MS4/AI", start: "16:15", end: "18:15", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "16:15", e: "18:15", c: 4 }, { s: "17:30", e: "19:30", c: 4 }],
            New: [{ s: "16:15", e: "18:15", c: 5 }, { s: "17:30", e: "19:30", c: 5 }]
        }
    },
    "Neuro": {
        venue: "Neuro",
        leadership_times: { start: "08:30", end: "12:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "09:15", end: "11:15", seats: 3 },
            { name: "Leadership Volunteer", start: "10:00", end: "12:30", seats: 3 }
        ],
        general: [
            { name: "MS3/MS4/AI", start: "09:15", end: "11:15", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "09:15", e: "11:15", c: 3 }, { s: "10:00", e: "12:30", c: 3 }],
            New: [{ s: "09:15", e: "11:15", c: 3 }, { s: "10:30", e: "12:30", c: 3 }]
        }
    }
};

// =================================================================
// ====================== HELPER FUNCTIONS =========================
// =================================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatTo12Hour(timeString) {
    const [hour, minute] = timeString.split(':');
    const hourInt = parseInt(hour, 10);
    const suffix = hourInt >= 12 ? 'PM' : 'AM';
    const hour12 = hourInt % 12 || 12;
    return `${hour12}:${minute} ${suffix}`;
}

async function addSlot(apiKey, day, type, subtype, venue, startTime, endTime, seats, frozen = true) {
    const dateStr = day.toISOString().substring(0, 10);
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const date = String(day.getDate()).padStart(2, '0');

    // Generate unique session_key using hash
    const keyData = `${dateStr}${venue}${type}${subtype}${startTime}${endTime}${seats}`;
    const hash = Math.abs(keyData.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
    const session_key = `${dateStr.substring(2).replace(/-/g, '')}_${hash.toString(36).substring(0, 6)}`;

    // Format display name
    const name = `${month}/${date}_${venue}_${subtype}_${formatTo12Hour(startTime)}`;

    const params = {
        session_key,
        name,
        session_start: `${dateStr} ${startTime}`,
        session_end: `${dateStr} ${endTime}`,
        session_type: type,
        session_subtype: subtype,
        venue,
        seats,
        frozen: frozen ? 'Y' : 'N'
    };

    try {
        await addSession(apiKey, params);
        appendResults(`✓ ${name}`);
    } catch (error) {
        appendResults(`✗ ${name} - ${error.message}`);
        throw error;
    }
    await sleep(500);
}

async function createLeadershipSlotsForDay(apiKey, day, config) {
    appendResults(`--- Leadership: ${config.venue} - ${day.toDateString()} ---`);

    // Leadership roles (Chair, Encounter, etc.)
    for (const role of leadershipRoles) {
        await addSlot(apiKey, day, "Leadership", role.name, config.venue,
            config.leadership_times.start, config.leadership_times.end, role.seats);
    }

    // Leadership volunteer slots
    for (const slot of config.leadership_volunteer_slots || []) {
        await addSlot(apiKey, day, "Leadership", slot.name, config.venue, slot.start, slot.end, slot.seats);
    }
}

async function createGeneralSlotsForDay(apiKey, day, config) {
    appendResults(`--- General: ${config.venue} - ${day.toDateString()} ---`);

    // General slots (MS3/MS4/AI, Ophtho, Family Planning, etc.)
    for (const slot of config.general || []) {
        await addSlot(apiKey, day, "General", slot.name, config.venue, slot.start, slot.end, slot.seats);
    }

    // Shift-based slots (Experienced, New)
    for (const subtype in config.shifts || {}) {
        for (const shift of config.shifts[subtype]) {
            await addSlot(apiKey, day, "General", subtype, config.venue, shift.s, shift.e, shift.c);
        }
    }
}


// =================================================================
// ==================== EVENT LISTENER SETUP =======================
// =================================================================

let resultsOutput;
let apiKeyInput;

function appendResults(text) {
    resultsOutput.textContent += text + "\n";
}

function clearResults() {
    resultsOutput.textContent = '';
}

document.addEventListener('DOMContentLoaded', function() {
    resultsOutput = document.getElementById('resultsOutput');
    apiKeyInput = document.getElementById('apiKey');
});

// =================================================================
// ====================== LOAD MONTH BUTTON ========================
// =================================================================

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('loadMonthBtn').addEventListener('click', () => {
        const selectedDate = document.getElementById('month-select').value;
        if (!selectedDate) return alert('Please select a month and year.');

        clearResults();
        const [year, month] = selectedDate.split('-');
        loadedMonthData = {
            year: parseInt(year),
            month: parseInt(month),
            monthString: selectedDate
        };

        appendResults(`✓ Month loaded: ${selectedDate}\n`);
    });
});

// Clinic schedule mapping: day of week → week number → clinic type
const CLINIC_SCHEDULE = {
    2: { 3: "Ob_Gyn" },  // Tuesday: Week 3 = Ob/Gyn, others = Medicine
    4: { 1: "Derm", 2: "Psych_Rheum", 3: "Surgery_ENT", 4: "Psych" },  // Thursday
    6: { 2: "Neuro", 4: "Neuro" }  // Saturday: Weeks 2,4 = Neuro, others = Medicine_Sat
};

// Helper: Get clinic type for a given day
function getClinicType(dayOfWeek, weekNumber) {
    const typeMap = CLINIC_SCHEDULE[dayOfWeek];
    if (!typeMap) return null;

    let clinicType = typeMap[weekNumber] || "Medicine";
    if (dayOfWeek === 6 && clinicType === "Medicine") {
        clinicType = "Medicine_Sat";
    }
    return clinicType;
}

// Helper: Create slots for entire month
async function createSlotsForMonth(apiKey, slotCreator) {
    if (!apiKeyInput.value.trim()) return alert('Please enter your API Key.');
    if (!loadedMonthData) return alert('Please load a month first.');

    clearResults();
    appendResults(`Creating slots for ${loadedMonthData.monthString}...\n`);

    const { year, month } = loadedMonthData;
    const counters = { 2: 0, 4: 0, 6: 0 };
    let day = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    while (day <= lastDay) {
        const dayOfWeek = day.getDay();
        if (counters[dayOfWeek] !== undefined) {
            counters[dayOfWeek]++;
            const clinicType = getClinicType(dayOfWeek, counters[dayOfWeek]);

            if (clinicType && clinicConfigs[clinicType]) {
                await slotCreator(apiKey, new Date(day), clinicConfigs[clinicType]);
            }
        }
        day.setDate(day.getDate() + 1);
    }

    appendResults('\n✓ Complete!');
}

// =================================================================
// ==================== BUTTON EVENT HANDLERS ======================
// =================================================================

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('createLeadershipSlotsBtn').addEventListener('click', async () => {
        try {
            await createSlotsForMonth(apiKeyInput.value.trim(), createLeadershipSlotsForDay);
        } catch (error) {
            appendResults(`\nError: ${error.message}`);
        }
    });
});

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('createGeneralSlotsBtn').addEventListener('click', async () => {
        try {
            await createSlotsForMonth(apiKeyInput.value.trim(), createGeneralSlotsForDay);
        } catch (error) {
            appendResults(`\nError: ${error.message}`);
        }
    });
});

// =================================================================
// ==================== GET USER SESSIONS BUTTON ===================
// =================================================================

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('getUserSessionsBtn').addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const username = document.getElementById('username').value.trim();

        if (!apiKey) return alert('Please enter your API Key.');
        if (!username) return alert('Please enter a username.');

        clearResults();
        appendResults(`Fetching sessions for user: ${username}...\n`);

        try {
            // Fetch all user sessions
            appendResults('Retrieving all user sessions...');
            const allSessions = await getAllUserSessions(apiKey, 'json');
            appendResults('✓ Data retrieved\n');

            // Filter sessions for the specified username
            const userSessions = allSessions.filter(session =>
                session.username && session.username.toLowerCase() === username.toLowerCase()
            );

            if (userSessions.length === 0) {
                appendResults(`\n⚠ No sessions found for user: ${username}`);
                return;
            }

            // Filter for checked-in sessions only
            const checkedInSessions = userSessions.filter(session => session.checkin === 'Y');

            appendResults(`\n✓ Total sessions signed up: ${userSessions.length}`);
            appendResults(`✓ Checked-in sessions: ${checkedInSessions.length}\n`);

            if (checkedInSessions.length === 0) {
                appendResults(`\n⚠ User has not checked into any sessions yet.`);
                return;
            }

            appendResults('\n--- Checked-In Sessions ---\n');

            // Display each checked-in session
            checkedInSessions.forEach((session, index) => {
                appendResults(`\n${index + 1}. ${session.event_name || 'Unnamed Session'}`);
                if (session.event_start) appendResults(`   Start: ${session.event_start}`);
                if (session.event_end) appendResults(`   End: ${session.event_end}`);
                if (session.venue) appendResults(`   Venue: ${session.venue}`);
                if (session.checkin_date) appendResults(`   ✓ Checked in at: ${session.checkin_date}`);
            });

        } catch (error) {
            appendResults(`\n✗ Error: ${error.message}`);
            console.error('Full error:', error);
        }
    });
});

// =================================================================
// ==================== GET USER TICKETS BUTTON ====================
// =================================================================

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('getUserTicketsBtn').addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const email = document.getElementById('ticketEmail').value.trim();

        if (!apiKey) return alert('Please enter your API Key.');
        if (!email) return alert('Please enter an email address.');

        clearResults();
        appendResults(`Fetching tickets for: ${email}...\n`);

        try {
            // Fetch user tickets
            appendResults('Retrieving user tickets...');
            const response = await getUserTickets(apiKey, email);
            appendResults('✓ Data retrieved\n');

            // Debug: show raw response
            appendResults('\n--- Raw Response ---');
            appendResults(JSON.stringify(response, null, 2));
            appendResults('\n');

            // Check response status
            if (response.status === 'ERROR') {
                appendResults(`\n✗ Error: ${response.message || 'User not found'}`);
                return;
            }

            // Extract tickets from result
            const userResults = response.result || [];

            if (userResults.length === 0) {
                appendResults(`\n⚠ No tickets found for: ${email}`);
                return;
            }

            // Get tickets from the first (and should be only) user result
            const userTickets = userResults[0]?.tickets || [];

            if (userTickets.length === 0) {
                appendResults(`\n⚠ User has no tickets.`);
                return;
            }

            appendResults(`\n✓ Found ${userTickets.length} ticket(s)\n`);
            appendResults('--- User Tickets ---\n');

            // Display each ticket
            userTickets.forEach((ticket, index) => {
                appendResults(`\n${index + 1}. ${ticket}`);
            });

        } catch (error) {
            appendResults(`\n✗ Error: ${error.message}`);
            console.error('Full error:', error);
        }
    });
});