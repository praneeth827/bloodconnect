# BloodConnect — Blood Donation Management System

A full-stack, mobile-friendly web application that connects blood seekers with nearby donors in real time. Built with Node.js + Express backend, SQLite database, and a single-page HTML/CSS/Vanilla JS frontend.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in values
cp .env.example .env

# 3. Start the development server (auto-reload)
npm run dev

# 4. Open in browser
# http://localhost:3001
```

The app works immediately with email/password auth. Google Sign-In and Maps require additional setup (see [Configuration](#️-configuration)).

---

## ✨ Features

| Feature | Status |
|---|---|
| Email / password registration & login | ✅ Built-in |
| JWT session management (7-day tokens) | ✅ Built-in |
| Google OAuth Sign-In | ✅ Requires credentials |
| Donor profile — blood type, age, gender, contact, occupation | ✅ Built-in |
| GPS location detection + reverse geocoding (OpenStreetMap fallback) | ✅ Built-in |
| Profile photo upload with crop tool (100 × 100 thumbnail preview) | ✅ Built-in |
| Government ID upload (Aadhaar / PAN / Voter ID — JPEG, PNG, PDF) | ✅ Built-in |
| Donor eligibility quiz before profile creation | ✅ Built-in |
| Blood seeker search — filter by blood type, state, radius | ✅ Built-in |
| Top-3 smart recommendations (scored by distance + reliability) | ✅ Built-in |
| Interactive donor map with radius circle | ✅ Requires Google Maps key |
| Blood request system (single donor & broadcast) | ✅ Built-in |
| Accept / reject / complete requests with donation history | ✅ Built-in |
| Email alerts to nearby donors via SMTP | ✅ Requires SMTP config |
| Multilingual UI (EN, Telugu, Hindi, Tamil, Malayalam, Kannada) | ✅ Built-in |
| User progress panel (availability toggle, donation history) | ✅ Built-in |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (SPA) |
| Backend | Node.js 24, Express 5 |
| Database | SQLite via `better-sqlite3` |
| Authentication | Passport.js + `jsonwebtoken` + `bcryptjs` |
| File Upload | Multer |
| Google OAuth | `passport-google-oauth20` |
| Email | Nodemailer |
| Maps | Google Maps JavaScript API (optional) |
| Geocoding fallback | OpenStreetMap Nominatim |
| Image Cropping | Cropper.js (CDN) |

---

## 📁 Project Structure

```
blood-connect_final-main/
├── server.js                  # Express server — all API routes
├── db.js                      # SQLite init + schema migrations
├── index.html                 # Single-page frontend
├── styles.css                 # All styles
├── script.js                  # Frontend SPA class (BloodConnectApp)
├── package.json
├── .env                       # Your local config (never commit)
├── .env.example               # Config template
│
├── utils/
│   └── haversine.js           # Distance calculation
├── routes/
│   └── donorSearchRoutes.js   # POST /api/donors/search router
├── controllers/
│   └── donorSearchController.js  # Search + email notification logic
├── services/
│   └── emailService.js        # Nodemailer SMTP helpers
│
├── data/
│   └── bloodconnect.sqlite    # SQLite database (auto-created)
└── uploads/
    ├── profile-photos/        # Donor profile photos (auto-created)
    └── ...                    # Government ID files
```

---

## 📦 Installation

### Prerequisites

- **Node.js v18+** — [nodejs.org](https://nodejs.org/)
- **npm** (bundled with Node.js)

### Steps

```bash
# Clone the repository
git clone <repository-url>
cd blood-connect_final-main

# Install all dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values (see Configuration below)

# Run in development mode (nodemon auto-reload)
npm run dev

# Or run in production mode
npm start
```

The SQLite database and upload directories are created automatically on first run.

---

## ⚙️ Configuration

All configuration lives in `.env`. Copy `.env.example` to get started.

### Minimum required (everything works with these defaults)

```env
PORT=3001
JWT_SECRET=change_this_to_a_random_string
SESSION_SECRET=change_this_to_another_random_string
```

Generate secure secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Google Sign-In (OAuth 2.0)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → **APIs & Services → Credentials → Create OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Add authorized redirect URI:
   ```
   http://localhost:3001/api/auth/google/callback
   ```
5. Copy Client ID and Client Secret into `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
```

6. Add your Google account as a **Test user** in OAuth consent screen → Test users (required while app is in Testing mode)
7. Restart the server — the Google Sign-In button activates automatically.

> **Note:** If credentials are missing, the Google button is automatically disabled with a clear message. Email/password login always works.

### Google Maps (interactive donor map)

1. Enable **Maps JavaScript API** and **Geocoding API** in Google Cloud Console
2. Add your key to `.env`:

```env
GOOGLE_MAPS_API_KEY=AIzaSy...
```

The key is injected into `index.html` at runtime by the server. Without it, OpenStreetMap iframe maps are used as fallback.

### Email alerts (SMTP — optional)

Sends urgent blood requirement emails to donors within a configurable radius when a seeker performs a search.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@email.com
SMTP_PASS=your_app_password
SMTP_FROM="BloodConnect <no-reply@yourdomain.com>"

# Tuning
NOTIFY_RADIUS_KM=10
MAX_EMAILS_PER_SEARCH=25
DONOR_NOTIFY_CONCURRENCY=6
```

For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833) (not your login password).

---

## 🔌 API Reference

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register with email + password |
| `POST` | `/api/auth/login` | Login, returns JWT token |
| `GET` | `/api/auth/me` | Get current user (requires token) |
| `GET` | `/api/auth/google` | Start Google OAuth flow |
| `GET` | `/api/auth/google/callback` | Google OAuth callback |
| `GET` | `/api/auth/google/status` | Check if Google OAuth is configured |

### Donors

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/donors/me` | Get own donor profile |
| `PUT` | `/api/donors/me` | Create / update donor profile (multipart — includes `govId` file) |
| `PATCH` | `/api/donors/me` | Update availability only |
| `GET` | `/api/donors/me/donations` | Get own donation history |
| `POST` | `/api/donors/me/donations` | Log a donation |
| `GET` | `/api/donors/me/profile-image` | Fetch own profile photo |
| `POST` | `/api/donors/me/profile-image` | Upload profile photo (multipart — `profileImage`) |
| `GET` | `/api/donors/search` | Search donors (query params: `bloodTypes`, `lat`, `lng`, `radiusKm`, `state`) |
| `POST` | `/api/donors/search` | Search + send email alerts to nearby donors |
| `GET` | `/api/donors/:id` | Get donor details |
| `GET` | `/api/donors/:id/contact` | Get donor contact number |

### Requests

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/requests/me` | Get all requests (as seeker and as donor) |
| `POST` | `/api/requests` | Create a request to a specific donor |
| `POST` | `/api/requests/broadcast` | Broadcast to all matching donors |
| `PATCH` | `/api/requests/:id` | Update status: `accepted`, `rejected`, `completed` |
| `DELETE` | `/api/requests/:id` | Delete a request |

### Users

| Method | Endpoint | Description |
|---|---|---|
| `PATCH` | `/api/users/me` | Update role (`donor` or `seeker`) |

All endpoints except `/api/auth/register`, `/api/auth/login`, and `/api/auth/google/*` require `Authorization: Bearer <token>` header.

---

## 💾 Database

SQLite file lives at `data/bloodconnect.sqlite` and is auto-created with full schema on first start.

### Tables

| Table | Purpose |
|---|---|
| `users` | Registered accounts (email, password hash, name, role) |
| `donors` | Donor profiles (blood type, location, coordinates, availability) |
| `requests` | Blood requests between seekers and donors |
| `donations` | Donation records (linked to completed requests) |
| `email_logs` | Log of every email notification attempt |

### Migrations

Column additions are handled automatically at startup with `ALTER TABLE IF NOT EXISTS` guards — no manual migration step needed.

### Reset database

```bash
# WARNING: deletes all data
del data\bloodconnect.sqlite
```

---

## 📸 File Uploads

| Type | Field name | Destination | Max size | Allowed types |
|---|---|---|---|---|
| Government ID | `govId` | `uploads/` | 5 MB | JPEG, PNG, PDF |
| Profile photo | `profileImage` | `uploads/profile-photos/` | 5 MB | JPEG, PNG, WEBP |

Files are served statically at `/uploads/...`.

Profile photos display a filename + 100×100 thumbnail preview immediately after selection, with an inline crop tool before saving.

---

## 🌐 Multilingual Support

Language selector in the navbar. Preference saved to `localStorage`.

| Code | Language |
|---|---|
| `en` | English |
| `te` | తెలుగు (Telugu) |
| `hi` | हिन्दी (Hindi) |
| `ta` | தமிழ் (Tamil) |
| `ml` | മലയാളം (Malayalam) |
| `kn` | ಕನ್ನಡ (Kannada) |

---

## 🔧 Troubleshooting

### Server won't start

| Symptom | Fix |
|---|---|
| `Cannot find module` | Run `npm install` |
| `Port 3001 in use` | `npx kill-port 3001` or set `PORT=3002` in `.env` |
| `GOOGLE_CLIENT_ID not set` warning | Expected if Google creds not added yet — email/password login still works |

### Google Sign-In issues

| Symptom | Fix |
|---|---|
| Button disabled with notice | Add `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to `.env` and restart server |
| `redirect_uri_mismatch` | Redirect URI in Google Console must be exactly `http://localhost:3001/api/auth/google/callback` (no trailing slash) |
| `403: access_denied` | Add your Google account as a Test user in OAuth consent screen |
| Works in dev, fails on new domain | Add the new domain's callback URL to authorized redirect URIs in Google Console |

### Maps not loading

| Symptom | Fix |
|---|---|
| Map blank / `ApiNotActivatedMapError` | Enable Maps JavaScript API + Geocoding API in Google Cloud Console and ensure billing is set up |
| No markers | Check browser console; donors without saved coordinates are geocoded on-the-fly |

### File upload issues

| Symptom | Fix |
|---|---|
| `File too large` | Keep files under 5 MB |
| `Only image files allowed` | Profile photo must be JPEG, PNG, or WEBP; Gov ID must be JPEG, PNG, or PDF |
| Upload directory error | Ensure `uploads/` and `uploads/profile-photos/` exist and are writable |

### Location issues

| Symptom | Fix |
|---|---|
| GPS not working | Allow browser location permission; HTTPS required on some browsers |
| Coordinates not saving | Use the 📍 button or type a complete address including city and state |

---

## 🔒 Security

- Passwords hashed with **bcrypt** (cost factor 10)
- **JWT** tokens — 7-day expiry, verified on every protected route
- **Parameterized queries** throughout — no SQL injection surface
- File uploads validated by MIME type and extension, stored outside web root paths
- `.env` is in `.gitignore` — never committed
- Session cookie: `httpOnly: true`, `secure: false` for localhost HTTP (set `secure: true` behind HTTPS in production)

See [SECURITY.md](SECURITY.md) for full guidelines before pushing to a public repo.

---

## 📝 License

MIT — free to use for learning or commercial projects.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes
4. Open a pull request

---

*Made with ❤️ to connect blood donors and seekers.*
