# Festival Scavenger Hunt

A mobile-first festival scavenger hunt app built with Node.js, Express, vanilla HTML/CSS/JavaScript, Turso/libSQL, and Cloudinary.

## Features

- Public mobile challenge board
- Team name persistence in localStorage
- Photo uploads with Cloudinary-backed storage
- Challenge-specific entry gallery
- Public leaderboard
- Admin dashboard with password protection
- Automatic database initialization and seed data

## Requirements

- Node.js 20+
- A Turso database
- A Cloudinary account
- A local `.env` file with credentials

## Installation

1. Clone or open the project folder.
2. Install dependencies:

```bash
npm install
```

3. Copy the example environment file and add real values:

```bash
cp .env.example .env
```

4. Add your own environment variables in `.env`.

## Environment Variables

```env
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

ADMIN_PASSWORD=
```

## Running locally

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

Then open:

- http://localhost:3000/
- http://localhost:3000/leaderboard
- http://localhost:3000/admin

## Database initialization

The app creates the required SQLite/Turso tables automatically on startup if they do not exist. On the first initialization, a few starter challenges are inserted automatically; after that, deleting all challenges will not cause the starter challenges to return.

When `TURSO_DATABASE_URL` is configured, the app requires a valid `TURSO_AUTH_TOKEN` and will stop instead of falling back to local SQLite. This prevents hosted changes from appearing to save and then disappearing after a restart.

## How image uploads work

- The browser sends a file to the backend via multipart form upload.
- The Express server validates file type and size.
- The backend uploads the image to Cloudinary using server-side credentials.
- Cloudinary returns a secure URL and public ID.
- The app stores the Cloudinary URL and public ID in Turso as the source of truth for the submission record.

## Admin access

Visit `/admin` and enter the password from `ADMIN_PASSWORD`.

## Render deployment notes

This project is structured to be Render-friendly.

- Use the Node runtime and a standard web service.
- Set all environment variables in the Render dashboard.
- Keep uploaded files off the server filesystem. Cloudinary stores the actual images.
- Use the `npm start` command.

## Notes

- The server reads `process.env.PORT || 3000` for the listening port.
- The app does not permanently save uploaded files locally.
- If Cloudinary upload succeeds but the database write fails, the app attempts to clean up the Cloudinary image to avoid orphaned assets.
