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

        // Special handling for ticket/user endpoints (batch operations with JSON)
        if (apiPath === 'ticket/user/get') {
            const apiKey = req.body.api_key;
            const email = req.body.email;

            const schedUrl = `https://${SUBDOMAIN}.sched.com/api/${apiPath}?api_key=${apiKey}`;

            // Send JSON array as body
            const response = await fetch(schedUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'STV-Sched-API/1.0'
                },
                body: JSON.stringify([{ email }])
            });

            const responseText = await response.text();

            // Try to parse as JSON, otherwise return as text
            try {
                const jsonData = JSON.parse(responseText);
                res.json(jsonData);
            } catch (e) {
                res.send(responseText);
            }
            return;
        }

        // Special handling for ticket/user/put endpoint (add tickets)
        if (apiPath === 'ticket/user/put') {
            const apiKey = req.body.api_key;
            const payload = req.body.payload;

            const schedUrl = `https://${SUBDOMAIN}.sched.com/api/${apiPath}?api_key=${apiKey}`;

            // Send JSON array as body
            const response = await fetch(schedUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'STV-Sched-API/1.0'
                },
                body: payload
            });

            const responseText = await response.text();

            // Try to parse as JSON, otherwise return as text
            try {
                const jsonData = JSON.parse(responseText);
                res.json(jsonData);
            } catch (e) {
                res.send(responseText);
            }
            return;
        }

        // Special handling for ticket/user/delete endpoint (delete tickets)
        if (apiPath === 'ticket/user/delete') {
            const apiKey = req.body.api_key;
            const payload = req.body.payload;

            const schedUrl = `https://${SUBDOMAIN}.sched.com/api/${apiPath}?api_key=${apiKey}`;

            // Send JSON array as body
            const response = await fetch(schedUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'STV-Sched-API/1.0'
                },
                body: payload
            });

            const responseText = await response.text();

            // Try to parse as JSON, otherwise return as text
            try {
                const jsonData = JSON.parse(responseText);
                res.json(jsonData);
            } catch (e) {
                res.send(responseText);
            }
            return;
        }

        // Default handling for other endpoints
        const schedUrl = `https://${SUBDOMAIN}.sched.com/api/${apiPath}`;

        // Forward the request to Sched.com
        const formData = new URLSearchParams();
        for (const key in req.body) {
            formData.append(key, req.body[key]);
        }

        const response = await fetch(schedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'STV-Sched-API/1.0'
            },
            body: formData.toString()
        });

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
