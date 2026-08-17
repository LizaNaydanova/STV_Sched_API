# STV Sched API - Quick Start

## Setup (One-time)

1. Install Node.js if you don't have it: https://nodejs.org/
2. Open a terminal in this folder and run:
   ```bash
   npm install
   ```

## Running the Application

1. Start the proxy server:
   ```bash
   npm start
   ```

2. Open your browser to: **http://localhost:3000/index.html**

3. Enter your Sched.com API key and use the interface normally

## What Changed?

- **No more CORS errors!** The proxy server handles API calls to Sched.com
- Cleaner error handling - you'll see real errors now
- Everything runs locally on port 3000

## Troubleshooting

- **Port 3000 already in use?** Edit `server.js` and change `PORT = 3000` to another number
- **npm not found?** Install Node.js from https://nodejs.org/



# Monthly Tasks
1. Generate Leadership Shifts
2. Generate General Slots
TODO: change times and number of shifts to match document, add 2 nursing to each clinic (mirror MS3/MS4 AI), add 2 audiology to each tuesday medicine clinic
FUTURE TODO: ophtho should be every other tuesday, audiology if medicine & tuesday, handling for admin days, handling for nephro, leadership shadowing optional button
3. Check slots against schedule for any cancelled clinic days
4. Make admin/dental day if extra Saturday
5. Leadership shadowing slots
6. Preceptorship slots - check with Emily how many
7. OBGYN needs type changed so obgyn tickets are specific
8. Delete extra ophtho
9. Make changes to .../Nephro clinic if happens that month
