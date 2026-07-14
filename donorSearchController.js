const { getDb } = require('../db');
const { haversineKm } = require('../utils/haversine');
const {
  isEmailConfigured,
  sendToMultipleDonors,
} = require('../services/emailService');

function parseBloodTypes(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map(String)
      .flatMap((v) => v.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(input)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function searchAndNotifyDonors(req, res) {
  const db = getDb();
  const {
    bloodTypes: rawBloodTypes,
    lat,
    lng,
    radiusKm,
    state,
    location,
    patientName,
    unitsNeeded,
    caseType,
    contact,
    message,
  } = req.body || {};

  const bloodTypes = parseBloodTypes(rawBloodTypes);
  const centerLat = lat != null ? Number(lat) : null;
  const centerLng = lng != null ? Number(lng) : null;
  const searchRadiusKm =
    radiusKm != null ? Number(radiusKm) : null;
  const stateStr = String(state || '');

  let rows = db
    .prepare(
      `SELECT d.*, u.first_name, u.last_name, u.email
       FROM donors d
       JOIN users u ON u.id = d.user_id
       WHERE d.availability = 'available'`
    )
    .all();

  if (bloodTypes.length) {
    rows = rows.filter((r) => bloodTypes.includes(r.blood_type));
  }
  if (stateStr) {
    const s = stateStr.toLowerCase();
    rows = rows.filter((r) =>
      String(r.state || r.location || '')
        .toLowerCase()
        .includes(s)
    );
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
    user: {
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
    },
    distanceKm: null,
  }));

  if (
    Number.isFinite(centerLat) &&
    Number.isFinite(centerLng)
  ) {
    donors = donors
      .map((d) => {
        const dLat = Number(d.latitude);
        const dLng = Number(d.longitude);
        if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) {
          return { ...d, distanceKm: null };
        }
        return {
          ...d,
          distanceKm: haversineKm(centerLat, centerLng, dLat, dLng),
        };
      })
      .filter((d) =>
        searchRadiusKm && Number.isFinite(d.distanceKm)
          ? d.distanceKm <= searchRadiusKm
          : true
      );
  }

  const NOTIFY_RADIUS_KM = Number(
    process.env.NOTIFY_RADIUS_KM || 10
  );
  const MAX_EMAILS_PER_SEARCH = Number(
    process.env.MAX_EMAILS_PER_SEARCH || 25
  );

  let emailResult = {
    enabled: false,
    attempted: 0,
    sentCount: 0,
    failures: [],
  };

  if (isEmailConfigured()) {
    emailResult.enabled = true;

    const withinRadius = donors.filter(
      (d) =>
        Number.isFinite(d.distanceKm) &&
        d.distanceKm <= NOTIFY_RADIUS_KM &&
        d.user &&
        d.user.email
    );

    const limited = withinRadius.slice(
      0,
      MAX_EMAILS_PER_SEARCH
    );
    const emails = limited.map((d) => d.user.email);
    emailResult.attempted = emails.length;

    if (emails.length) {
      const bloodGroup =
        bloodTypes && bloodTypes.length
          ? bloodTypes.join(', ')
          : null;
      const emailPayload = {
        bloodGroup,
        unitsNeeded: unitsNeeded || null,
        patientName: patientName || null,
        location: location || null,
        caseType: caseType || null,
        contact: contact || null,
        message:
          message ||
          'This is an automated alert from BloodConnect based on a nearby urgent search.',
      };

      // Build subject and a short plain-text preview similar to the email body
      const subject =
        'URGENT BLOOD REQUIREMENT' +
        (bloodGroup ? ` - ${bloodGroup}` : '');
      const plainLines = [
        'URGENT BLOOD REQUIREMENT',
        bloodGroup ? `Blood group needed: ${bloodGroup}` : null,
        emailPayload.unitsNeeded ? `Units needed: ${emailPayload.unitsNeeded}` : null,
        emailPayload.patientName ? `Patient: ${emailPayload.patientName}` : null,
        emailPayload.location ? `Location: ${emailPayload.location}` : null,
        emailPayload.caseType ? `Case type: ${emailPayload.caseType}` : null,
        emailPayload.contact ? `Contact: ${emailPayload.contact}` : null,
        '',
        emailPayload.message,
      ].filter(Boolean);
      const bodyPreviewFull = plainLines.join('\n');
      const bodyPreview =
        bodyPreviewFull.length > 500
          ? `${bodyPreviewFull.slice(0, 497)}...`
          : bodyPreviewFull;

      try {
        const { sentCount, failures } =
          await sendToMultipleDonors(emails, emailPayload);
        emailResult.sentCount = sentCount;
        emailResult.failures = failures;

        // Persist a log entry in email_logs for each donor we attempted
        const ts = new Date().toISOString();
        const insertStmt = db.prepare(
          `INSERT INTO email_logs (
             seeker_user_id,
             donor_id,
             recipient_email,
             subject,
             body_preview,
             payload_json,
             status,
             error_message,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        const failureMap = new Map(
          (failures || []).map((f) => [
            String(f.email || '').toLowerCase(),
            f.error || null,
          ])
        );

        for (const donor of limited) {
          const email = String(donor.user.email || '').toLowerCase();
          const errMsg = failureMap.get(email) || null;
          const status = errMsg ? 'failed' : 'sent';
          insertStmt.run(
            Number.isFinite(Number(req.userId)) ? Number(req.userId) : null,
            Number.isFinite(Number(donor.id)) ? Number(donor.id) : null,
            email,
            subject,
            bodyPreview,
            JSON.stringify(emailPayload),
            status,
            errMsg,
            ts
          );
        }
      } catch (err) {
        emailResult.failures.push({
          email: 'batch',
          error: err.message || String(err),
        });

        // Log a batch-level failure so it is visible in the database as well
        const ts = new Date().toISOString();
        db.prepare(
          `INSERT INTO email_logs (
             seeker_user_id,
             donor_id,
             recipient_email,
             subject,
             body_preview,
             payload_json,
             status,
             error_message,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          Number.isFinite(Number(req.userId)) ? Number(req.userId) : null,
          null,
          '',
          'URGENT BLOOD REQUIREMENT',
          'Batch email send failed.',
          JSON.stringify({ error: err.message || String(err) }),
          'failed',
          err.message || String(err),
          ts
        );
      }
    }
  }

  return res.json({
    donors,
    email: emailResult,
  });
}

module.exports = { searchAndNotifyDonors };

