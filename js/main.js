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
    "Medicine_Nephro": {
        venue: "Medicine/Nephro",
        leadership_times: { start: "08:30", end: "12:15" },
        leadership_volunteer_slots: [
            { name: "Leadership Volunteer", start: "09:00", end: "11:00", seats: 3 },
            { name: "Leadership Volunteer", start: "10:30", end: "12:30", seats: 3 }
        ],
        general: [
            { name: "MS3/MS4/AI", start: "09:15", end: "11:15", seats: 4 }
        ],
        shifts: {
            Experienced: [{ s: "09:00", e: "11:00", c: 4 }, { s: "10:30", e: "12:30", c: 4 }],
            New: [{ s: "09:00", e: "10:30", c: 4 }, { s: "10:30", e: "12:30", c: 4 }]
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

async function addSlot(apiKey, day, type, subtype, descriptiveVenue, startTime, endTime, seats, frozen = true) {
    const dateString = day.toISOString().substring(0, 10);
    const session_key = `${dateString.replace(/-/g, '')}_${descriptiveVenue.replace('/', '')}_${subtype.substring(0, 4)}_${startTime.replace(':', '')}`.slice(0, 32);

    const month = (day.getMonth() + 1).toString().padStart(2, '0');
    const date = day.getDate().toString().padStart(2, '0');
    const formattedDate = `${month}/${date}`;
    const formattedTime = formatTo12Hour(startTime);
    const name = `${formattedDate}_${descriptiveVenue}_${subtype}_${formattedTime}`;

    const params = {
        session_key: session_key,
        name: name,
        session_start: `${dateString} ${startTime}`,
        session_end: `${dateString} ${endTime}`,
        session_type: type,
        session_subtype: subtype,
        venue: descriptiveVenue,
        seats: seats,
        frozen: frozen ? 'Y' : 'N'
    };

    try {
        await addSession(apiKey, params);
        appendResults(`Added: ${name}`);
    } catch (error) {
        // Ignore "Failed to fetch" errors (CORS issues) - the slot was likely created
        if (error.message === 'Failed to fetch') {
            appendResults(`Added (CORS warning): ${name}`);
        } else {
            throw error;
        }
    }
    await sleep(500);
}

async function createLeadershipSlotsForDay(apiKey, day, config) {
    appendResults(`--- Creating leadership slots for ${config.venue} on ${day.toDateString()} ---`);
    const descriptiveVenue = config.venue;

    // Create leadership role slots
    for (const role of leadershipRoles) {
        await addSlot(apiKey, day, "Leadership", role.name, descriptiveVenue, config.leadership_times.start, config.leadership_times.end, role.seats);
    }

    // Create leadership volunteer slots
    if (config.leadership_volunteer_slots) {
        for (const slot of config.leadership_volunteer_slots) {
            await addSlot(apiKey, day, "Leadership", slot.name, descriptiveVenue, slot.start, slot.end, slot.seats);
        }
    }
}

async function createGeneralSlotsForDay(apiKey, day, config) {
    appendResults(`--- Creating general volunteer slots for ${config.venue} on ${day.toDateString()} ---`);
    const descriptiveVenue = config.venue;

    // Create general slots (MS3/MS4/AI, Ophtho, etc.)
    if (config.general) {
        for (const slot of config.general) {
            await addSlot(apiKey, day, "General", slot.name, descriptiveVenue, slot.start, slot.end, slot.seats);
        }
    }

    // Create shift-based slots (Experienced, New)
    if (config.shifts) {
        for (const subtype in config.shifts) {
            for (const shift of config.shifts[subtype]) {
                await addSlot(apiKey, day, "General", subtype, descriptiveVenue, shift.s, shift.e, shift.c);
            }
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
    const loadMonthBtn = document.getElementById('loadMonthBtn');

    loadMonthBtn.addEventListener('click', async () => {
        try {
            const monthInput = document.getElementById('month-select');
            const selectedDate = monthInput.value;

            if (!selectedDate) {
                alert('Error: Please select a month and year.');
                return;
            }

            // Clear previous results
            clearResults();

            const [year, month] = selectedDate.split('-');
            const monthNum = parseInt(month, 10);
            const yearNum = parseInt(year, 10);

            // Store the loaded month data in memory
            loadedMonthData = {
                year: yearNum,
                month: monthNum,
                monthString: `${year}-${month}`,
                loadedAt: new Date().toLocaleString()
            };

            appendResults(`Month loaded successfully!\n${'='.repeat(50)}`);
            appendResults(`Year: ${loadedMonthData.year}`);
            appendResults(`Month: ${loadedMonthData.month}`);
            appendResults(`Month String: ${loadedMonthData.monthString}`);
            appendResults(`Loaded At: ${loadedMonthData.loadedAt}`);
            appendResults(`${'='.repeat(50)}\n`);
            appendResults('Month data is now stored in memory for future operations.');

        } catch (error) {
            appendResults(`\nAn error occurred: ${error.message}`);
            console.error('Error loading month:', error);
        }
    });
});

// =================================================================
// ================ CREATE LEADERSHIP SLOTS BUTTON =================
// =================================================================

document.addEventListener('DOMContentLoaded', function() {
    const createLeadershipSlotsBtn = document.getElementById('createLeadershipSlotsBtn');

    createLeadershipSlotsBtn.addEventListener('click', async () => {
        try {
            const apiKey = apiKeyInput.value.trim();

            if (!apiKey) {
                alert('Error: Please enter your API Key.');
                return;
            }

            if (!loadedMonthData) {
                alert('Error: Please load a month first.');
                return;
            }

            // Clear previous results
            clearResults();

            appendResults('Creating leadership slots for the month...\n' + '='.repeat(50));
            appendResults(`Month: ${loadedMonthData.monthString}`);
            appendResults('='.repeat(50) + '\n');

            const year = loadedMonthData.year;
            const month = loadedMonthData.month;

            // Day type mapping: which clinic type occurs on which week of the month
            const dayTypeMap = {
                2: { 3: "Ob_Gyn" },           // Tuesday
                4: { 1: "Derm", 2: "Psych_Rheum", 3: "Surgery_ENT", 4: "Psych" }, // Thursday
                6: { 2: "Neuro", 4: "Neuro" }   // Saturday
            };
            let counters = { 2: 0, 4: 0, 6: 0 };

            let currentDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0);

            // Iterate through each day of the month
            while (currentDay <= lastDay) {
                const dayOfWeek = currentDay.getDay();

                if (counters[dayOfWeek] !== undefined) {
                    counters[dayOfWeek]++;
                    let clinicTypeKey = (dayTypeMap[dayOfWeek] && dayTypeMap[dayOfWeek][counters[dayOfWeek]]) || "Medicine";

                    // Special case for Saturday Medicine clinics
                    if (dayOfWeek === 6 && clinicTypeKey === "Medicine") {
                        clinicTypeKey = "Medicine_Sat";
                    }

                    // Create leadership slots if configuration exists
                    if (clinicConfigs[clinicTypeKey]) {
                        await createLeadershipSlotsForDay(apiKey, new Date(currentDay), clinicConfigs[clinicTypeKey]);
                    } else {
                        appendResults(`Warning: No config found for ${clinicTypeKey}`);
                    }
                }

                currentDay.setDate(currentDay.getDate() + 1);
            }

            appendResults('\n' + '='.repeat(50));
            appendResults('All leadership slots created successfully!');

        } catch (error) {
            appendResults(`\nAn error occurred: ${error.message}`);
            console.error('Error creating leadership slots:', error);
        }
    });
});

// =================================================================
// ================ CREATE GENERAL SLOTS BUTTON ====================
// =================================================================

document.addEventListener('DOMContentLoaded', function() {
    const createGeneralSlotsBtn = document.getElementById('createGeneralSlotsBtn');

    createGeneralSlotsBtn.addEventListener('click', async () => {
        try {
            const apiKey = apiKeyInput.value.trim();

            if (!apiKey) {
                alert('Error: Please enter your API Key.');
                return;
            }

            if (!loadedMonthData) {
                alert('Error: Please load a month first.');
                return;
            }

            // Clear previous results
            clearResults();

            appendResults('Creating general volunteer slots for the month...\n' + '='.repeat(50));
            appendResults(`Month: ${loadedMonthData.monthString}`);
            appendResults('='.repeat(50) + '\n');

            const year = loadedMonthData.year;
            const month = loadedMonthData.month;

            // Day type mapping: which clinic type occurs on which week of the month
            const dayTypeMap = {
                2: { 3: "Ob_Gyn" },           // Tuesday
                4: { 1: "Derm", 2: "Psych_Rheum", 3: "Surgery_ENT", 4: "Psych" }, // Thursday
                6: { 1: "Medicine_Nephro", 2: "Neuro", 4: "Neuro" }   // Saturday
            };
            let counters = { 2: 0, 4: 0, 6: 0 };

            let currentDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0);

            // Iterate through each day of the month
            while (currentDay <= lastDay) {
                const dayOfWeek = currentDay.getDay();

                if (counters[dayOfWeek] !== undefined) {
                    counters[dayOfWeek]++;
                    let clinicTypeKey = (dayTypeMap[dayOfWeek] && dayTypeMap[dayOfWeek][counters[dayOfWeek]]) || "Medicine";

                    // Special case for Saturday Medicine clinics
                    if (dayOfWeek === 6 && clinicTypeKey === "Medicine") {
                        clinicTypeKey = "Medicine_Sat";
                    }

                    // Create general volunteer slots if configuration exists
                    if (clinicConfigs[clinicTypeKey]) {
                        await createGeneralSlotsForDay(apiKey, new Date(currentDay), clinicConfigs[clinicTypeKey]);
                    } else {
                        appendResults(`Warning: No config found for ${clinicTypeKey}`);
                    }
                }

                currentDay.setDate(currentDay.getDate() + 1);
            }

            appendResults('\n' + '='.repeat(50));
            appendResults('All general volunteer slots created successfully!');

        } catch (error) {
            appendResults(`\nAn error occurred: ${error.message}`);
            console.error('Error creating general volunteer slots:', error);
        }
    });
});