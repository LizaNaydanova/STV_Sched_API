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
