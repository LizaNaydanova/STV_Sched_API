# Moving Scheduled Automation from GitHub Actions to cPanel (InMotion)

GitHub Actions is free-tier, so scheduled runs sit in a queue and can fire 30+ minutes late.
InMotion's cPanel gives two building blocks that fix this: **Setup Node.js App** (a managed
Node runtime) and **Cron Jobs** (fires on the server's real clock, no queue).

## Step-by-step

### 1. Get the code onto the server
- cPanel → **Git Version Control** → Create → paste the GitHub repo URL
  (`https://github.com/LizaNaydanova/STV_Sched_API.git`), set a repo path like
  `~/repos/STV_Sched_API`, branch `main`.
- This gives a **Pull or Deploy** action for future updates — no manual re-upload needed.
- If Git Version Control isn't available on the plan, upload via File Manager/SFTP instead,
  and update via SFTP going forward.

### 2. Create the Node.js app (Node runtime + npm)
- cPanel → **Setup Node.js App** → Create Application.
- Application root: the repo path from step 1.
- Node version: pick the highest available (script uses `luxon`, `nodemailer`, `node-fetch`;
  the old GitHub workflow used Node 20/24).
- Application startup file: irrelevant for cron usage — no persistent web server is needed
  for the automation scripts.
- Click **Create**. cPanel builds a virtualenv, e.g. `~/nodevenv/repos/STV_Sched_API/20/`.

### 3. Install dependencies
- On the Setup Node.js App page, click **Run NPM Install** for the app — installs everything
  in `package.json` inside the virtualenv.
- `nodemailer` and `luxon` were previously installed as an extra step in the GitHub workflow,
  not listed in `package.json`. Add them (and `dotenv`, for step 4) to `package.json` so
  `Run NPM Install` picks them up automatically.

### 4. Handle secrets (SCHED_API_KEY, SMTP_*)
Cron jobs don't inherit cPanel's Node app environment variables — they run as bare shell
commands. Cleanest fix:
- Add `dotenv` as a dependency, and `require('dotenv').config()` at the top of the scripts.
- Create a `.env` file **directly on the server** (not in git — already gitignored) at the
  repo root with `SCHED_API_KEY=...`, `SMTP_HOST=...`, etc.
- `chmod 600 .env` so only the account user can read it.

### 5. Create the cron job
- cPanel → **Cron Jobs** → Add New Cron Job.
- Schedule: minute `17`, everything else `*` (matches the old hourly-at-:17 GitHub schedule —
  server timezone doesn't matter here since it fires every hour regardless).
- Command, using the venv's Node binary directly (exact path shown on the Setup Node.js App
  page under "Enter to the virtual environment"):
  ```
  /home/USERNAME/nodevenv/repos/STV_Sched_API/20/bin/node /home/USERNAME/repos/STV_Sched_API/scripts/sched-automation.js >> /home/USERNAME/logs/sched-automation.log 2>&1
  ```
- cPanel cron also emails job output to the account email by default, so failures surface
  without manually tailing logs.

### 6. Test before trusting it
- SSH in (Advanced → Terminal, if enabled on the plan) or run the command manually once,
  first with `DRY_RUN=true node scripts/sched-automation.js`, to confirm the API key and SMTP
  work in this environment before letting it touch real Sched data.

### 7. Ongoing updates
- After pushing changes to GitHub: Git Version Control → Manage → **Update from Remote** →
  **Deploy HEAD Commit** (or `git pull` over SSH).

## Notes
- `scripts/sched-automation.js` is the recurring hourly job — it contains the freeze-48-hours-
  in-advance logic and is timezone-aware internally via `luxon` (`TIME_ZONE=America/Chicago`),
  so the cron trigger only needs to fire roughly hourly.
- `scripts/freeze-shifts.js` is the one-off/ad-hoc freeze script (used for the Aug 29 shift
  freeze) — run manually via SSH or a one-time cron entry rather than on a recurring schedule.
