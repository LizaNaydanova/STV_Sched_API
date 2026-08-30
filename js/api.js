// =================================================================
// ====================== API HELPER FUNCTIONS =====================
// =================================================================

/**
 * A generic function to make API calls via the local proxy server.
 * @param {string} path - The API endpoint path.
 * @param {object} params - An object of parameters for the request.
 * @param {string} apiKey - Your Sched.com API key.
 * @returns {Promise<any>}
 */
async function schedApiCall(path, params, apiKey) {
    params.api_key = apiKey;

    // Use local proxy server to avoid CORS issues
    const url = `/api/${path}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error for ${path}: ${errorText} (Status: ${response.status})`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }
    } catch (error) {
        console.error(`API call to ${path} failed:`, error);
        throw error;
    }
}

/**
 * A generic function to make Ticket API calls via the local proxy server.
 * Unlike the main event API, Ticket API endpoints expect the api_key as a
 * query string parameter and a raw JSON body (often an array for batch
 * operations), rather than a flat form-encoded object.
 * @param {string} path - The Ticket API endpoint path (e.g. 'ticket/user/get').
 * @param {object|Array} body - The JSON payload for the request.
 * @param {string} apiKey - Your Sched.com API key.
 * @param {object} [extraParams] - Additional query string parameters.
 * @returns {Promise<any>}
 */
async function schedTicketApiCall(path, body, apiKey, extraParams = {}) {
    const query = new URLSearchParams({ api_key: apiKey, ...extraParams });
    const url = `/api/${path}?${query.toString()}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error for ${path}: ${errorText} (Status: ${response.status})`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }
    } catch (error) {
        console.error(`API call to ${path} failed:`, error);
        throw error;
    }
}

// =================================================================
// ====================== API FUNCTIONS ============================
// =================================================================

/**
 * Creates a new session.
 * @param {string} apiKey - Your Sched.com API key.
 * @param {object} options - An object containing the session details.
 * @param {string} options.session_key - A unique key for the session.
 * @param {string} options.name - The title of the session.
 * @param {string} options.session_start - The start date and time (e.g., 'YYYY-MM-DD HH:MM').
 * @param {string} options.session_end - The end date and time (e.g., 'YYYY-MM-DD HH:MM').
 * @param {string} options.session_type - The category or type of the session.
 * @param {string} [options.session_subtype] - The subcategory (optional).
 * @param {string} [options.venue] - The location of the session.
 * @param {number} [options.seats] - The number of available seats.
 * @param {string} [options.frozen] - Whether the session is frozen ('Y' or 'N').
 * @returns {Promise<any>} A promise that resolves with the API response.
 */
async function addSession(apiKey, options = {}) {
    const params = {
        ...options
    };
    return schedApiCall('session/add', params, apiKey);
}

/**
 * Gets all tickets owned by a list of users (batch, up to 100 users per request).
 * @param {string} apiKey - Your Sched.com read/write API key.
 * @param {Array<object>} users - The users to look up.
 * @param {string} [users[].username] - The user's username (takes priority over email if both given).
 * @param {string} [users[].email] - The user's email.
 * @returns {Promise<any>} A promise that resolves with { result: [{username, email, tickets, status}], status, code }.
 */
async function getUserTickets(apiKey, users = []) {
    return schedTicketApiCall('ticket/user/get', users, apiKey);
}

/**
 * Adds tickets of particular ticket types to a list of users (batch, up to 100 users per request).
 * @param {string} apiKey - Your Sched.com read/write API key.
 * @param {Array<object>} users - The users to update.
 * @param {string} [users[].username] - The user's username (takes priority over email if both given).
 * @param {string} [users[].email] - The user's email. Required to create the user if they don't exist.
 * @param {string} [users[].name] - The user's name, used only when creating a new user.
 * @param {string[]} users[].tickets - Ticket type Keys to assign. Repeat a key to assign multiple copies.
 * @param {boolean} [createUser=true] - If true, creates a new user account when the user is missing.
 * @returns {Promise<any>} A promise that resolves with { result: [{username, email, name, tickets, status}], status, code }.
 */
async function putUserTickets(apiKey, users = [], createUser = true) {
    return schedTicketApiCall('ticket/user/put', users, apiKey, { create_user: createUser });
}

/**
 * Removes tickets of particular ticket types from a list of users (batch, up to 100 users per request).
 * @param {string} apiKey - Your Sched.com read/write API key.
 * @param {Array<object>} users - The users to update.
 * @param {string} [users[].username] - The user's username (takes priority over email if both given).
 * @param {string} [users[].email] - The user's email.
 * @param {string[]} users[].tickets - Ticket type Keys to remove. Repeat a key to remove multiple copies.
 * @returns {Promise<any>} A promise that resolves with { result: [{username, email, tickets, status}], status, code }.
 */
async function deleteUserTickets(apiKey, users = []) {
    return schedTicketApiCall('ticket/user/delete', users, apiKey);
}