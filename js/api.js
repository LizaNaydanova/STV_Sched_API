// =================================================================
// ======================== API CONFIGURATION ======================
// =================================================================

const SUBDOMAIN = "stvincentsclinic2025";

// =================================================================
// ====================== API HELPER FUNCTIONS =====================
// =================================================================

/**
 * A generic function to make API calls to the Sched.com API.
 * @param {string} path - The API endpoint path.
 * @param {object} params - An object of parameters for the query string.
 * @param {string} apiKey - Your Sched.com API key.
 * @returns {Promise<any>}
 */
async function schedApiCall(path, params, apiKey) {
    params.api_key = apiKey;

    const url = `https://${SUBDOMAIN}.sched.com/api/${path}`;

    // Create form data for POST request
    const formData = new URLSearchParams();
    for (const key in params) {
        formData.append(key, params[key]);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'STV-Sched-API/1.0'
            },
            body: formData.toString()
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error for ${path}: ${errorText} (Status: ${response.status})`);
        }

        const responseText = await response.text();
        try {
            return JSON.parse(responseText);
        } catch (e) {
            return responseText;
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