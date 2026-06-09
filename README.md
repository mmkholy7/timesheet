# Timesheet App

A personal timesheet app built with Vite + Supabase. Tracks hours by week and project, auto-saves to the cloud, and exports to Excel.

## Stack

- **Frontend**: Plain HTML/CSS/JS with Vite
- **Backend**: Supabase (Postgres + Auth)
- **Export**: SheetJS (xlsx)

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/timesheet.git
cd timesheet
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your Supabase keys:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Find these in: **Supabase Dashboard → Project Settings → API**

### 3. Set up the database

Run the contents of `supabase-schema.sql` in:  
**Supabase Dashboard → SQL Editor → New query**

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Deploy to GitHub Pages

```bash
npm run build
```

Then push the `dist/` folder, or use the GitHub Actions workflow below.

### GitHub Actions (auto-deploy on push)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

Add your Supabase keys as **GitHub Secrets**:  
Repo → Settings → Secrets → Actions → New repository secret

## Project Structure

```
timesheet/
├── index.html          # App shell
├── src/
│   ├── main.js         # Entry point, wires everything
│   ├── auth.js         # Supabase auth (sign in/up/out)
│   ├── data.js         # CRUD with Supabase
│   ├── timesheet.js    # Render + week navigation
│   ├── export.js       # Excel export
│   ├── ui.js           # Toast, loading, screen switching
│   └── style.css       # All styles
├── supabase-schema.sql # Run once in Supabase SQL editor
├── .env.example        # Copy to .env and fill keys
└── vite.config.js
```

## Features

- Email/password auth with persistent session
- Weekly timesheet grid (Sun–Sat)
- Multiple rows per week (rate + project code + daily hours)
- Auto-save to Supabase ~1s after changes
- Submit week (locks with green badge)
- Export all weeks to Excel (All Time sheet + per-week tabs)
- Week/month/all-time hour summaries
