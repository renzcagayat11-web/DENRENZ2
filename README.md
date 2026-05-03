# DENR Permit — Minimal Local Scaffold

This workspace contains a minimal scaffold demonstrating a Firebase-backed web portal and a small admin Node service using `firebase-admin`.

What was added
- `server.js` — Express service with admin endpoints (`/admin/createStaff`, `/admin/analytics`).
- Updated `index.html` — Web UI for Firebase Auth, simple application creation, and admin actions.
- Updated `package.json` — added dependencies and `start` script.

Requirements
- Node.js (16+)
- A Firebase project with Firestore and Authentication enabled.
- Service account JSON at `serviceAccountKey.json` in the project root or set `GOOGLE_APPLICATION_CREDENTIALS` to its path.

Quick start

1. Install dependencies:

```bash
npm install
```

2. Ensure `serviceAccountKey.json` exists in the project root (download from Firebase Console) or set `GOOGLE_APPLICATION_CREDENTIALS`.

3. Run the server (provides admin endpoints):

```bash
npm start
```

4. Serve the web UI (in a separate terminal):

```bash
npx http-server -c-1 .
```

Open the web UI in the browser (http://localhost:8080 by default) and use the Authentication section to sign up / sign in. To create a staff account from the UI, sign in as an admin (an admin must have a custom claim `role: 'admin'`). Use the server endpoint to create staff accounts programmatically.

Notes
- This is a minimal demo scaffold. For production you should:
  - Harden Firebase Security Rules and Cloud Functions.
  - Use HTTPS and a proper host for the server.
  - Add input validation, error handling, and logging.

Additional utilities
- `setup-admin.js` — helper script to create or promote an admin user. Usage:

```bash
# interactive
node setup-admin.js

# or provide args: email password "Display Name"
node setup-admin.js admin@domain.com SuperSecret123 "DENR Admin"
```

The script requires the same `serviceAccountKey.json` or `GOOGLE_APPLICATION_CREDENTIALS` environment variable as the server.

Files and structure
- `index.html` — main web UI (loads assets/js/app.js and assets/css/styles.css)
- `assets/js/app.js` — main web client logic (Firebase Auth + Firestore actions)
- `assets/css/styles.css` — site styles and layout
- `server.js` — Express admin API (creates staff, analytics)
- `setup-admin.js`, `set-claims-only.js` — helper scripts for admin account setup
 - `server/` — backend code and helpers (server/server.js, server/firebase.js, server/setup-admin.js, etc.)
- `firestore.rules` — recommended rules to deploy to your Firebase project

Serve notes
- The web UI is now modular: open http://localhost:8080 (or the URL shown by `http-server`) and use the improved UI.


Firestore security rules
- A sample `firestore.rules` is included. To deploy rules with the Firebase CLI:

```bash
npx firebase login
npx firebase init firestore
# choose the project and rules file, then:
npx firebase deploy --only firestore:rules
```

The sample rules allow only authenticated users to create applications (tied to their uid), and only users with `role: 'staff'` or `role: 'admin'` custom claims to update application status. Adjust for your policies before production.
