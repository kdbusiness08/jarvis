# Jarvis for Rise Agency: setup guide

This gets Jarvis live as your own private website in about 30 to 45 minutes. Do the steps in order. You only do this once.

**What you'll end up with:** a private web address (like `https://jarvis-rise.vercel.app`) that opens to a passcode screen. Type `jarvis` and he's listening.

---

## Before you start

You'll need these accounts. All are free to create.

| Account | What it's for | Cost |
|---|---|---|
| GitHub (github.com) | Holds the Jarvis files | Free |
| Vercel (vercel.com) | Runs the website | Free to start. See "Costs" at the bottom |
| Anthropic Console (console.anthropic.com) | Jarvis's brain | Pay as you go. Load $10 of credit to start |
| Spotify Developer (developer.spotify.com) | Music control | Free, but your Spotify account must be **Premium** |
| Google Cloud (console.cloud.google.com) | Google Calendar | Free |
| Whop | Sales and revenue | You already have this |

Keep a notes file open while you go. You'll copy a few keys into it.

---

## Step 1: Put the files on GitHub

1. Unzip `jarvis-app.zip`. You'll see `index.html`, `package.json`, `vercel.json`, `README.md` and a folder called `api`.
2. Go to **github.com**, sign in, and click the **+** (top right) → **New repository**.
3. Name it `jarvis`. Choose **Private**. Click **Create repository**.
4. On the next page, click the link **uploading an existing file**.
5. Open the unzipped folder, select **everything inside it** (including the `api` folder), and drag it into the browser window.
6. Wait until every file is listed, then click **Commit changes**.

Check: the repository should show the `api` folder and `index.html` at the top level, not inside another folder.

## Step 2: Launch it on Vercel

1. Go to **vercel.com** → **Sign up** → **Continue with GitHub**.
2. Click **Add New…** → **Project**.
3. Find `jarvis` in the list and click **Import**. If it's not listed, click **Adjust GitHub App Permissions** and give Vercel access to it.
4. Leave **Framework Preset** as **Other**. Click **Deploy**.
5. When it finishes, click the preview. Your web address is shown at the top, something like `https://jarvis-abc123.vercel.app`. **Copy it into your notes. You'll need it below.**

Optional: to get a nicer address, go to **Settings → Domains** and change it to something like `jarvis-rise.vercel.app`. If you do, use the new address everywhere below.

## Step 3: Give Jarvis a memory (so your data syncs between computer and phone)

1. In your Vercel project, click the **Storage** tab.
2. Click **Create Database** (or **Browse Marketplace**) → choose **Upstash** → **Upstash for Redis** → **Continue**.
3. Pick the **Free** plan and the region closest to Australia (Sydney if offered). Click **Create**.
4. When asked, connect it to your `jarvis` project (all environments). This adds the memory keys automatically.

## Step 4: Add the brain and Whop keys

**Anthropic key**

1. Go to **console.anthropic.com** → sign in → **Billing** → add $10 of credit.
2. Go to **API Keys** → **Create Key** → name it `jarvis` → copy the key (starts with `sk-ant-`).

**Whop key**

1. In your Whop dashboard, go to **Developer** (sometimes under Settings) → **API Keys** → create a company API key.
2. Give it read access to payments, plans, products and members (the "payment", "plan", "access pass" and "member" read permissions).
3. Copy the key. Also copy your company ID (it starts with `biz_` and is visible in your dashboard URL). The company ID is optional but recommended.

**Add them to Vercel**

In your Vercel project, go to **Settings → Environment Variables**. Add each of these (Name, then Value), then click **Save**:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your `sk-ant-…` key |
| `SESSION_SECRET` | any long random text, e.g. mash the keyboard for 40 characters |
| `WHOP_API_KEY` | your Whop key |
| `WHOP_COMPANY_ID` | your `biz_…` ID |
| `JARVIS_PASSWORD` | *(optional)* a different passcode. Leave it out to keep `jarvis` |

Then go to the **Deployments** tab → click the **⋯** on the newest one → **Redeploy**. Keys only take effect after a redeploy.

**Test it:** open your web address, type `jarvis`, and allow the microphone. Jarvis should greet you and brief you. Revenue should show "Live from Whop".

## Step 5: Connect Spotify

1. Go to **developer.spotify.com/dashboard** and log in with your Premium account.
2. Click **Create app**.
   - App name: `Jarvis`. Description: `My assistant`.
   - **Redirect URI**: your address + `/api/spotify-callback`, for example `https://jarvis-abc123.vercel.app/api/spotify-callback`. Click **Add**.
   - Tick **Web API**. Accept the terms. Click **Save**.
3. Open the app's **Settings**. Copy the **Client ID**, then click **View client secret** and copy that too.
4. In Vercel → **Settings → Environment Variables**, add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Then **Redeploy** (same as step 4).
5. Open Jarvis → **Settings** (sliders icon) → **Spotify** → **Connect** → **Agree**.

Spotify has to be open somewhere (desktop app, phone or web player) for Jarvis to start music. If nothing is playing, he'll use your computer.

## Step 6: Connect Google Calendar

1. Go to **console.cloud.google.com**. Accept the terms if asked.
2. Top bar: click the project picker → **New Project** → name it `Jarvis` → **Create**. Make sure it's selected.
3. Search the top bar for **Google Calendar API** → open it → **Enable**.
4. Search for **Google Auth Platform** (also called "OAuth consent screen") → **Get started**.
   - App name `Jarvis`, support email = your email → **Next**.
   - Audience: **External** → **Next**. Contact email: yours → **Next** → agree → **Create**.
5. In the left menu, click **Audience** → **Publish app** → **Confirm**. This stops Google logging Jarvis out every 7 days.
6. Left menu → **Clients** → **Create client**.
   - Application type: **Web application**. Name: `Jarvis`.
   - **Authorised redirect URIs** → **Add URI** → your address + `/api/google-callback`, e.g. `https://jarvis-abc123.vercel.app/api/google-callback`.
   - Click **Create**. Copy the **Client ID** and **Client secret**.
7. In Vercel, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then **Redeploy**.
8. Open Jarvis → **Settings** → **Google Calendar** → **Connect**. Google will warn "Google hasn't verified this app". That's expected, because it's your own private app. Click **Advanced** → **Go to Jarvis** → tick calendar access → **Continue**.

## Step 7: Make it feel like an app

- **Use Microsoft Edge.** It has the natural-sounding British voice (Ryan). In Jarvis → Settings → Voice, pick **Ryan (UK) Natural**.
- **Install it:** in Edge, click **⋯** → **Apps** → **Install this site as an app**. Jarvis gets his own window and taskbar icon.
- **Microphone:** when asked, click **Allow**. He then listens the whole time he's open and stops when you close him.
- **Pop-ups:** the first time you say "open a new spreadsheet", Edge may block it. Click the blocked pop-up icon at the right of the address bar → **Always allow**.
- **Listening style** (Settings → Listening):
  - *Answer when I say "Jarvis"* (default): say his name once, then keep talking freely for 45 seconds. Safe for sales calls.
  - *Answer everything I say*: talk to him like a person in the room. Say "Jarvis, go quiet" when you're on a call.

---

## Things to say

**Business**
- "Jarvis, brief me."
- "How far off the monthly goal are we?"
- "Set my monthly goal to fifty thousand and yearly to six hundred thousand."
- "New lead: Marcus from Instagram, closer at a SaaS company, follow up Thursday."
- "Marcus bought the mentorship for five grand." (moves him from lead to client)
- "Log a three thousand dollar sale from Tom, paid by bank transfer." (for sales outside Whop)
- "Who do I need to follow up with today?"
- "Take a note: best closing time this week was 7pm."
- "Write me a DM to re-engage leads who went cold." (appears on screen with a Copy button)
- "Give me three objection handlers for 'I can't afford it'."

**Calendar**
- "What's on today?"
- "Book a sales call with Marcus Friday at 2 for 45 minutes."
- "Move my 3pm to 4."
- He warns you 10 minutes before every event.

**Music**
- "Play my focus playlist." / "Play some Drake." / "Play Blinding Lights."
- "Pause", "skip", "volume up", "resume" (these work instantly, no AI needed)

**Apps and tools**
- "Open a new spreadsheet." (Excel online) / "new Word doc" / "open Gmail" / "open Whop"
- "Start a 25 minute focus timer."
- "Go quiet" / "Stop" / "Lock up"

**Sales alerts:** whenever a Whop sale lands, Jarvis announces it and tells you where the month stands against your goal.

---

## Costs and good to know

- **AI usage:** quick replies use Claude Haiku (very cheap). Drafts and strategy use Claude Sonnet. Normal daily use is typically a few dollars a month. Check usage anytime at console.anthropic.com.
- **Vercel:** the free Hobby plan is meant for personal, non-commercial projects. Since this runs your business, Vercel's Pro plan is the by-the-book option. You can start on Hobby and upgrade later.
- **Security:** the passcode `jarvis` is easy to guess. Your address isn't public, but anyone who found it and guessed the passcode could see your pipeline. To change it, set `JARVIS_PASSWORD` in Vercel and redeploy.
- **Something not working?** Open Jarvis → Settings → **Connections**. Each line tells you exactly what's missing.

## Optional settings (Vercel environment variables)

| Name | Default | What it does |
|---|---|---|
| `JARVIS_TZ` | `Australia/Brisbane` | Your time zone for dates and revenue periods |
| `JARVIS_MODEL` | `claude-sonnet-5-5` | Model for drafts and strategy |
| `JARVIS_FAST_MODEL` | `claude-haiku-4-5-20251001` | Model for quick replies |
