// Simple proxy server to avoid CORS issues with Sched.com API
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;
const SUBDOMAIN = "stvincentsclinic2025";

// Enable CORS for all routes
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML, CSS, JS)
app.use(express.static('.'));

// Proxy endpoint for Sched.com API
app.post('/api/*', async (req, res) => {
    try {
        // Extract the path after /api/
        const apiPath = req.params[0];

        // Ticket API endpoints (ticket/*) expect the api_key as a query string
        // parameter and a raw JSON body (often an array for batch operations),
        // unlike the main event API which is form-encoded with api_key in the body.
        const isTicketApi = apiPath.startsWith('ticket/');

        const schedUrl = isTicketApi
            ? `https://${SUBDOMAIN}.sched.com/api/${apiPath}?${new URLSearchParams(req.query).toString()}`
            : `https://${SUBDOMAIN}.sched.com/api/${apiPath}`;

        const fetchOptions = isTicketApi
            ? {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'STV-Sched-API/1.0'
                },
                body: JSON.stringify(req.body)
            }
            : {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'STV-Sched-API/1.0'
                },
                body: new URLSearchParams(req.body).toString()
            };

        const response = await fetch(schedUrl, fetchOptions);

        const responseText = await response.text();

        // Try to parse as JSON, otherwise return as text
        try {
            const jsonData = JSON.parse(responseText);
            res.json(jsonData);
        } catch (e) {
            res.send(responseText);
        }

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n✓ Proxy server running on http://localhost:${PORT}`);
    console.log(`✓ Open http://localhost:${PORT}/index.html in your browser\n`);
});
