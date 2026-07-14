require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const { getDb } = require('./db');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { haversineKm } = require('./utils/haversine');
const createDonorSearchRouter = require('./routes/donorSearchRoutes');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Configure multer for file uploads
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `gov-id-${req.userId}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG) and PDF files are allowed'));
    }
  }
});

// Profile image storage — stored in /uploads/profile-photos/ and publicly served
const PROFILE_UPLOAD_DIR = path.join(UPLOAD_DIR, 'profile-photos');
if (!fs.existsSync(PROFILE_UPLOAD_DIR)) {
  fs.mkdirSync(PROFILE_UPLOAD_DIR, { recursive: true });
}

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROFILE_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const allowedExts = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
    const ext = allowedExts[file.mimetype] ||
      (/\.(jpe?g|png|webp|gif)$/i.test(path.extname(file.originalname))
        ? path.extname(file.originalname).toLowerCase()
        : '.jpg');
    cb(null, `profile-${req.userId}-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const profileUpload = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed as profile photos'));
    }
  }
});

// Serve uploaded files (gov IDs, profile photos, etc.)
app.use('/uploads', express.static(UPLOAD_DIR));
// Serve static assets (images, email banners, etc.)
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Session — required for Passport Google OAuth; keep cookie.secure=false for localhost HTTP
const session = require('express-session');
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,   // must be false for plain HTTP (localhost); set true only behind HTTPS in prod
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

function nowIso() {
  return new Date().toISOString();
}

function signToken(user) {
  return jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing Authorization header' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function pickUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pickDonor(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    bloodType: row.blood_type,
    age: row.age,
    gender: row.gender,
    contact: row.contact,
    occupation: row.occupation,
    location: row.location,
    state: row.state || '',
    latitude: row.latitude,
    longitude: row.longitude,
    availability: row.availability || 'available',
    reliability: row.reliability,
    govIdPath: row.gov_id_path,
    profileImagePath: row.profile_image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseBloodTypes(q) {
  if (!q) return [];
  if (Array.isArray(q)) return q.map(String).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
  return String(q)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Passport Google OAuth setup ---
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  console.log('[Google OAuth] Configuring Google strategy with callback:', GOOGLE_CALLBACK_URL);
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          console.log('[Google OAuth] Profile received:', profile.id, profile.displayName);
          const db = getDb();
          const email =
            (profile.emails && profile.emails[0] && profile.emails[0].value && profile.emails[0].value.toLowerCase()) ||
            null;
          if (!email) return done(new Error('Google account has no email'));
          const firstName = (profile.name && profile.name.givenName) || 'Google';
          const lastName = (profile.name && profile.name.familyName) || 'User';

          let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
          const ts = nowIso();
          if (!user) {
            console.log('[Google OAuth] Creating new user for:', email);
            const info = db
              .prepare(
                'INSERT INTO users (email, password_hash, first_name, last_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)'
              )
              .run(email, 'google-oauth', firstName, lastName, ts, ts);
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
          } else {
            console.log('[Google OAuth] Existing user found:', email);
          }
          return done(null, user);
        } catch (err) {
          console.error('[Google OAuth] Strategy error:', err);
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    console.log('[Google OAuth] Serializing user:', user.id);
    done(null, user.id);
  });
  passport.deserializeUser((id, done) => {
    try {
      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });
} else {
  console.warn('[Google OAuth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google Sign-In disabled.');
}

// --- Auth ---
app.post('/api/auth/register', (req, res) => {
  const db = getDb();
  const { email, password, firstName, lastName } = req.body || {};
  if (!email || !password || !firstName || !lastName) return res.status(400).json({ error: 'Missing fields' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = bcrypt.hashSync(String(password), 10);
  const ts = nowIso();
  const info = db
    .prepare(
      'INSERT INTO users (email, password_hash, first_name, last_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)'
    )
    .run(String(email).toLowerCase(), passwordHash, String(firstName), String(lastName), ts, ts);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);
  return res.json({ token, user: pickUser(user) });
});

// Google OAuth status check (always available — used by frontend to decide whether to show the button)
app.get('/api/auth/google/status', (req, res) => {
  res.json({ configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
});

// Google OAuth entry & callback
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  app.get(
    '/api/auth/google',
    (req, res, next) => {
      console.log('[Google OAuth] Initiating OAuth flow');
      next();
    },
    passport.authenticate('google', {
      scope: ['profile', 'email'],
    })
  );

  app.get(
    '/api/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/?googleError=auth_failed' }),
    (req, res) => {
      if (!req.user) {
        console.error('[Google OAuth] Callback: no user on req');
        return res.redirect('/?googleError=no_user');
      }
      console.log('[Google OAuth] Callback success for user:', req.user.id);
      const token = signToken(req.user);
      const u = pickUser(req.user);
      const redirectUrl = `/?googleToken=${encodeURIComponent(token)}&firstName=${encodeURIComponent(
        u.firstName
      )}&lastName=${encodeURIComponent(u.lastName)}`;
      return res.redirect(redirectUrl);
    }
  );
}

app.post('/api/auth/login', (req, res) => {
  const db = getDb();
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(user);
  return res.json({ token, user: pickUser(user) });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  return res.json({ user: pickUser(user) });
});

// --- User ---
app.patch('/api/users/me', authRequired, (req, res) => {
  const db = getDb();
  const { role } = req.body || {};
  if (role !== 'donor' && role !== 'seeker' && role !== null) return res.status(400).json({ error: 'Invalid role' });
  const ts = nowIso();
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, ts, req.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  return res.json({ user: pickUser(user) });
});

// --- Donor profile ---
app.get('/api/donors/me', authRequired, (req, res) => {
  const db = getDb();
  const donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(req.userId);
  return res.json({ donor: pickDonor(donor) });
});

app.put('/api/donors/me', authRequired, upload.single('govId'), (req, res) => {
  const db = getDb();
  const {
    bloodType,
    age,
    gender,
    contact,
    occupation,
    location,
    state = '',
    latitude = null,
    longitude = null,
    availability = 'available',
  } = req.body || {};

  if (!bloodType || !age || !gender || !contact || !occupation || !location) {
    // Delete uploaded file if validation fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Missing donor fields' });
  }
  if (availability !== 'available' && availability !== 'unavailable') {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Invalid availability' });
  }

  const ts = nowIso();
  let govIdPath = null;
  
  // Handle file upload
  if (req.file) {
    govIdPath = `/uploads/${req.file.filename}`;
    
    // Delete old file if updating
    const existing = db.prepare('SELECT gov_id_path FROM donors WHERE user_id = ?').get(req.userId);
    if (existing && existing.gov_id_path) {
      const oldPath = path.join(__dirname, existing.gov_id_path);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (err) {
          console.error('Error deleting old file:', err);
        }
      }
    }
  }

  const existing = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(req.userId);
  if (existing) {
    if (govIdPath) {
      db.prepare(
        `UPDATE donors
         SET blood_type=?, age=?, gender=?, contact=?, occupation=?, location=?, state=?, latitude=?, longitude=?, availability=?, gov_id_path=?, updated_at=?
         WHERE user_id=?`
      ).run(
        String(bloodType),
        Number(age),
        String(gender),
        String(contact),
        String(occupation),
        String(location),
        String(state || ''),
        latitude === '' ? null : latitude,
        longitude === '' ? null : longitude,
        String(availability),
        govIdPath,
        ts,
        req.userId
      );
    } else {
      db.prepare(
        `UPDATE donors
         SET blood_type=?, age=?, gender=?, contact=?, occupation=?, location=?, state=?, latitude=?, longitude=?, availability=?, updated_at=?
         WHERE user_id=?`
      ).run(
        String(bloodType),
        Number(age),
        String(gender),
        String(contact),
        String(occupation),
        String(location),
        String(state || ''),
        latitude === '' ? null : latitude,
        longitude === '' ? null : longitude,
        String(availability),
        ts,
        req.userId
      );
    }
  } else {
    db.prepare(
      `INSERT INTO donors
       (user_id, blood_type, age, gender, contact, occupation, location, state, latitude, longitude, availability, gov_id_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.userId,
      String(bloodType),
      Number(age),
      String(gender),
      String(contact),
      String(occupation),
      String(location),
      String(state || ''),
      latitude === '' ? null : latitude,
      longitude === '' ? null : longitude,
      String(availability),
      govIdPath,
      ts,
      ts
    );
  }

  // Ensure role is donor once profile exists
  db.prepare('UPDATE users SET role = COALESCE(role, ?), updated_at=? WHERE id=?').run('donor', ts, req.userId);

  const donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(req.userId);
  return res.json({ donor: pickDonor(donor) });
});

// Donor donations - persist in DB
app.get('/api/donors/me/donations', authRequired, (req, res) => {
  const db = getDb();
  const donor = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(req.userId);
  if (!donor) return res.json({ donations: [] });
  const rows = db.prepare('SELECT * FROM donations WHERE donor_id = ? ORDER BY donation_date DESC').all(donor.id);
  const donations = rows.map(r => ({
    id: r.id,
    donorId: donor.id,
    date: r.donation_date,
    type: r.type || 'Whole Blood',
    createdAt: r.created_at,
  }));
  return res.json({ donations });
});

app.post('/api/donors/me/donations', authRequired, (req, res) => {
  const db = getDb();
  const donor = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(req.userId);
  if (!donor) return res.status(404).json({ error: 'Donor profile not found' });
  const { type = 'Whole Blood' } = req.body || {};
  const ts = nowIso();
  const donationDate = new Date().toISOString().split('T')[0];
  const info = db.prepare(
    'INSERT INTO donations (donor_id, donation_date, type, created_at) VALUES (?, ?, ?, ?)'
  ).run(donor.id, donationDate, String(type || 'Whole Blood'), ts);
  const row = db.prepare('SELECT * FROM donations WHERE id = ?').get(info.lastInsertRowid);
  return res.json({
    donation: {
      id: row.id,
      donorId: donor.id,
      date: row.donation_date,
      type: row.type,
      createdAt: row.created_at,
    },
  });
});

// Profile image — served publicly from /uploads/profile-photos/<filename>
app.get('/api/donors/me/profile-image', authRequired, (req, res) => {
  const db = getDb();
  const donor = db.prepare('SELECT profile_image_path, user_id FROM donors WHERE user_id = ?').get(req.userId);
  if (!donor || !donor.profile_image_path) return res.status(404).end();
  const filename = path.basename(donor.profile_image_path);
  const filePath = path.join(PROFILE_UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const ext = path.extname(filePath).toLowerCase();
  const mimes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  res.type(mimes[ext] || 'image/jpeg');
  return res.sendFile(path.resolve(filePath));
});

app.post('/api/donors/me/profile-image', authRequired, profileUpload.single('profileImage'), (req, res) => {
  const db = getDb();
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
  const filename = req.file.filename;
  const publicUrl = `/uploads/profile-photos/${filename}`;
  const ts = nowIso();
  const donor = db.prepare('SELECT id, profile_image_path FROM donors WHERE user_id = ?').get(req.userId);
  if (!donor) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Donor profile not found. Complete donor setup first.' });
  }
  // Delete old photo file
  if (donor.profile_image_path) {
    const oldFile = path.join(PROFILE_UPLOAD_DIR, path.basename(donor.profile_image_path));
    if (fs.existsSync(oldFile)) {
      try { fs.unlinkSync(oldFile); } catch (e) { console.error('[Profile Photo] Error deleting old photo:', e); }
    }
  }
  db.prepare('UPDATE donors SET profile_image_path = ?, updated_at = ? WHERE user_id = ?')
    .run(filename, ts, req.userId);
  const updated = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(req.userId);
  return res.json({ donor: pickDonor(updated), profileImageUrl: publicUrl });
}, (err, req, res, _next) => {
  console.error('[Profile Photo] Upload error:', err.message);
  return res.status(400).json({ error: err.message || 'Upload failed' });
});

app.patch('/api/donors/me', authRequired, (req, res) => {
  const db = getDb();
  const { availability } = req.body || {};
  if (availability !== 'available' && availability !== 'unavailable') return res.status(400).json({ error: 'Invalid availability' });
  const ts = nowIso();
  db.prepare('UPDATE donors SET availability=?, updated_at=? WHERE user_id=?').run(String(availability), ts, req.userId);
  const donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(req.userId);
  return res.json({ donor: pickDonor(donor) || null });
});

// Search donors (public-ish, but we keep it behind auth to match app usage)
app.get('/api/donors/search', authRequired, (req, res) => {
  const db = getDb();
  const bloodTypes = parseBloodTypes(req.query.bloodTypes);
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : null;
  const lng = req.query.lng !== undefined ? Number(req.query.lng) : null;
  const radiusKm = req.query.radiusKm !== undefined ? Number(req.query.radiusKm) : null;
  const state = String(req.query.state || '');

  let rows = db
    .prepare(
      `SELECT d.*, u.first_name, u.last_name
       FROM donors d
       JOIN users u ON u.id = d.user_id
       WHERE d.availability = 'available'`
    )
    .all();

  if (bloodTypes.length) rows = rows.filter((r) => bloodTypes.includes(r.blood_type));
  if (state) {
    const s = state.toLowerCase();
    rows = rows.filter((r) => String(r.state || r.location || '').toLowerCase().includes(s));
  }

  let donors = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    bloodType: r.blood_type,
    age: r.age,
    gender: r.gender,
    occupation: r.occupation,
    location: r.location,
    state: r.state,
    latitude: r.latitude != null ? String(r.latitude) : '',
    longitude: r.longitude != null ? String(r.longitude) : '',
    availability: r.availability,
    reliability: r.reliability,
    contact: r.contact,
    user: { firstName: r.first_name, lastName: r.last_name },
    distanceKm: null,
  }));

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    donors = donors
      .map((d) => {
        const dLat = Number(d.latitude);
        const dLng = Number(d.longitude);
        if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return { ...d, distanceKm: null };
        return { ...d, distanceKm: haversineKm(lat, lng, dLat, dLng) };
      })
      .filter((d) => (radiusKm && Number.isFinite(d.distanceKm) ? d.distanceKm <= radiusKm : true));
  }

  return res.json({ donors });
});

// Extended donor search with email notifications
app.use('/api/donors', createDonorSearchRouter(authRequired));

// Full donor details including contact (for authenticated users viewing donor profile)
app.get('/api/donors/:donorId', authRequired, (req, res) => {
  const db = getDb();
  const donorId = Number(req.params.donorId);
  const row = db
    .prepare(
      `SELECT d.*, u.first_name, u.last_name
       FROM donors d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = ?`
    )
    .get(donorId);
  if (!row) return res.status(404).json({ error: 'Donor not found' });
  return res.json({
    donor: {
      id: row.id,
      userId: row.user_id,
      bloodType: row.blood_type,
      age: row.age,
      gender: row.gender,
      occupation: row.occupation,
      location: row.location,
      state: row.state,
      latitude: row.latitude != null ? String(row.latitude) : '',
      longitude: row.longitude != null ? String(row.longitude) : '',
      availability: row.availability,
      reliability: row.reliability,
      contact: row.contact || '',
      user: { firstName: row.first_name, lastName: row.last_name },
    },
  });
});

// Return contact details for a donor.
// Relaxed policy: any authenticated user can view donor contact once they open the modal,
// so seeker "Contact Donor" flows work without requiring an accepted request first.
app.get('/api/donors/:donorId/contact', authRequired, (req, res) => {
  const db = getDb();
  const donorId = Number(req.params.donorId);
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(donorId);
  if (!donor) return res.status(404).json({ error: 'Donor not found' });

  return res.json({ contact: donor.contact });
});

// --- Requests ---
app.get('/api/requests/me', authRequired, (req, res) => {
  const db = getDb();

  const asSeeker = db
    .prepare(
      `SELECT r.*,
              d.user_id AS donor_user_id,
              du.first_name AS donor_first_name, du.last_name AS donor_last_name,
              d.contact AS donor_contact
       FROM requests r
       JOIN donors d ON d.id = r.donor_id
       JOIN users du ON du.id = d.user_id
       WHERE r.seeker_user_id = ?
       ORDER BY r.created_at DESC`
    )
    .all(req.userId)
    .map((r) => ({
      id: String(r.id),
      seekerId: String(r.seeker_user_id),
      donorId: String(r.donor_id),
      bloodType: r.blood_type,
      urgency: r.urgency,
      location: r.location,
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      donorName: `${r.donor_first_name} ${r.donor_last_name}`,
      donorContact: r.status === 'accepted' ? r.donor_contact : '',
    }));

  const myDonor = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(req.userId);
  const asDonor = myDonor
    ? db
        .prepare(
          `SELECT r.*,
                  su.first_name AS seeker_first_name, su.last_name AS seeker_last_name
           FROM requests r
           JOIN users su ON su.id = r.seeker_user_id
           WHERE r.donor_id = ?
           ORDER BY r.created_at DESC`
        )
        .all(myDonor.id)
        .map((r) => ({
          id: String(r.id),
          seekerId: String(r.seeker_user_id),
          donorId: String(r.donor_id),
          bloodType: r.blood_type,
          urgency: r.urgency,
          location: r.location,
          message: r.message,
          status: r.status,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          seekerName: `${r.seeker_first_name} ${r.seeker_last_name}`,
        }))
    : [];

  return res.json({ asSeeker, asDonor });
});

app.post('/api/requests', authRequired, (req, res) => {
  const db = getDb();
  const { donorId, bloodType, urgency, location, message = '' } = req.body || {};
  if (!donorId || !bloodType || !urgency) return res.status(400).json({ error: 'Missing fields' });
  const donor = db.prepare('SELECT id FROM donors WHERE id = ?').get(Number(donorId));
  if (!donor) return res.status(404).json({ error: 'Donor not found' });

  const existing = db
    .prepare(`SELECT id FROM requests WHERE seeker_user_id=? AND donor_id=? AND status='pending' LIMIT 1`)
    .get(req.userId, Number(donorId));
  if (existing) return res.status(409).json({ error: 'Request already pending' });

  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO requests (seeker_user_id, donor_id, blood_type, urgency, location, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(req.userId, Number(donorId), String(bloodType), String(urgency), String(location || 'Not specified'), String(message || ''), ts, ts);

  return res.json({ requestId: String(info.lastInsertRowid) });
});

app.post('/api/requests/broadcast', authRequired, (req, res) => {
  const db = getDb();
  const { bloodType, urgency, location, message = '', lat = null, lng = null, radiusKm = null } = req.body || {};
  if (!bloodType || !urgency || !location) return res.status(400).json({ error: 'Missing fields' });

  let donors = db.prepare("SELECT id, latitude, longitude FROM donors WHERE availability='available' AND blood_type=?").all(String(bloodType));

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number.isFinite(Number(radiusKm))) {
    const cLat = Number(lat);
    const cLng = Number(lng);
    const rKm = Number(radiusKm);
    donors = donors.filter((d) => {
      if (d.latitude == null || d.longitude == null) return false;
      return haversineKm(cLat, cLng, Number(d.latitude), Number(d.longitude)) <= rKm;
    });
  }

  const ts = nowIso();
  let created = 0;
  for (const d of donors) {
    const exists = db
      .prepare(`SELECT id FROM requests WHERE seeker_user_id=? AND donor_id=? AND status='pending' LIMIT 1`)
      .get(req.userId, d.id);
    if (exists) continue;
    db.prepare(
      `INSERT INTO requests (seeker_user_id, donor_id, blood_type, urgency, location, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(req.userId, d.id, String(bloodType), String(urgency), String(location), String(message || ''), ts, ts);
    created += 1;
  }

  return res.json({ created });
});

app.patch('/api/requests/:id', authRequired, (req, res) => {
  const db = getDb();
  const requestId = Number(req.params.id);
  const { status } = req.body || {};
  if (!['accepted', 'rejected', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const reqRow = db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });

  const myDonor = db.prepare('SELECT id FROM donors WHERE user_id=?').get(req.userId);
  const isDonorOwner = myDonor && Number(myDonor.id) === Number(reqRow.donor_id);
  const isSeekerOwner = Number(reqRow.seeker_user_id) === Number(req.userId);

  if ((status === 'accepted' || status === 'rejected') && !isDonorOwner) {
    return res.status(403).json({ error: 'Only the donor can accept/reject' });
  }
  if (status === 'completed' && !(isSeekerOwner || isDonorOwner)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  const ts = nowIso();
  db.prepare('UPDATE requests SET status=?, updated_at=? WHERE id=?').run(String(status), ts, requestId);

  if (status === 'completed') {
    const donorId = reqRow.donor_id;
    const existing = db.prepare('SELECT id FROM donations WHERE request_id = ?').get(requestId);
    if (!existing) {
      const donationDate = new Date().toISOString().split('T')[0];
      try {
        db.prepare(
          'INSERT INTO donations (donor_id, request_id, donation_date, type, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(donorId, requestId, donationDate, 'Whole Blood', ts);
      } catch (e) {
        if (!String(e.message).includes('UNIQUE')) console.error('Donation insert:', e);
      }
    }
  }

  return res.json({ ok: true });
});

app.delete('/api/requests/:id', authRequired, (req, res) => {
  const db = getDb();
  const requestId = Number(req.params.id);
  const reqRow = db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });

  const myDonor = db.prepare('SELECT id FROM donors WHERE user_id=?').get(req.userId);
  const isDonorOwner = myDonor && Number(myDonor.id) === Number(reqRow.donor_id);
  const isSeekerOwner = Number(reqRow.seeker_user_id) === Number(req.userId);
  if (!isDonorOwner && !isSeekerOwner) return res.status(403).json({ error: 'Not allowed' });

  db.prepare('DELETE FROM requests WHERE id=?').run(requestId);
  return res.json({ ok: true });
});

// --- Serve frontend ---
app.use(express.static(path.join(__dirname), { index: false }));

// Helper to inject Google Maps API key from environment into index.html at runtime.
// This replaces the placeholder 'YOUR_GOOGLE_MAPS_API_KEY_HERE' used in index.html
// with the value from process.env.GOOGLE_MAPS_API_KEY, so seeker maps work when
// the key is configured in the .env file.
function sendIndexHtml(_req, res) {
  try {
    const indexPath = path.join(__dirname, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (mapsKey && mapsKey !== 'your_google_maps_api_key_here') {
      html = html.replace(/'YOUR_GOOGLE_MAPS_API_KEY_HERE'/g, `'${mapsKey}'`);
    }

    return res.type('html').send(html);
  } catch (err) {
    console.error('Error sending index.html:', err);
    return res.status(500).send('Failed to load application.');
  }
}

app.get('/', sendIndexHtml);
// SPA fallback (Express 5 doesn't accept "*" as a route pattern)
app.get(/^(?!\/api\/).*/, sendIndexHtml);

app.listen(PORT, () => {
  // Ensure DB initializes
  getDb();
  console.log(`Backend running on http://localhost:${PORT}`);
});


