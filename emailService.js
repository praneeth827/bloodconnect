const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

let _transport = null;

function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_FROM
  );
}

function getTransport() {
  if (!isEmailConfigured()) {
    throw new Error('SMTP is not configured');
  }

  if (_transport) return _transport;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure =
    typeof process.env.SMTP_SECURE === 'string'
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;

  const auth =
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined;

  _transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
  });

  return _transport;
}

function buildBannerCid(attachments) {
  const bannerPath = process.env.EMAIL_BANNER_PATH;
  if (!bannerPath) return null;

  const absPath = path.isAbsolute(bannerPath)
    ? bannerPath
    : path.join(__dirname, '..', bannerPath);

  if (!fs.existsSync(absPath)) return null;

  const cid = 'bloodconnect-banner';
  attachments.push({
    filename: path.basename(absPath),
    path: absPath,
    cid,
  });
  return cid;
}

async function sendUrgentBloodEmail(to, payload) {
  if (!isEmailConfigured()) {
    throw new Error('SMTP is not configured');
  }

  const {
    bloodGroup,
    unitsNeeded,
    patientName,
    location,
    caseType,
    contact,
    message,
  } = payload || {};

  const from = process.env.SMTP_FROM;

  const attachments = [];
  const bannerCid = buildBannerCid(attachments);

  const subject =
    'URGENT BLOOD REQUIREMENT' +
    (bloodGroup ? ` - ${bloodGroup}` : '');

  const plainLines = [
    'URGENT BLOOD REQUIREMENT',
    bloodGroup ? `Blood group needed: ${bloodGroup}` : null,
    unitsNeeded ? `Units needed: ${unitsNeeded}` : null,
    patientName ? `Patient: ${patientName}` : null,
    location ? `Location: ${location}` : null,
    caseType ? `Case type: ${caseType}` : null,
    contact ? `Contact: ${contact}` : null,
    '',
    message || 'Please respond as soon as possible if you are available to donate.',
  ].filter(Boolean);

  const text = plainLines.join('\n');

  const htmlParts = [];
  htmlParts.push('<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif; line-height:1.6; color:#111827;">');
  if (bannerCid) {
    htmlParts.push(
      `<div style="text-align:center;margin-bottom:16px;"><img src="cid:${bannerCid}" alt="BloodConnect" style="max-width:100%;border-radius:8px;"/></div>`
    );
  }
  htmlParts.push(
    '<h1 style="color:#b91c1c;font-size:22px;margin-bottom:8px;">URGENT BLOOD REQUIREMENT</h1>'
  );
  if (bloodGroup) {
    htmlParts.push(
      `<p style="margin:4px 0;"><strong>Blood group needed:</strong> ${bloodGroup}</p>`
    );
  }
  if (unitsNeeded) {
    htmlParts.push(
      `<p style="margin:4px 0;"><strong>Units needed:</strong> ${unitsNeeded}</p>`
    );
  }
  if (patientName) {
    htmlParts.push(
      `<p style="margin:4px 0;"><strong>Patient:</strong> ${patientName}</p>`
    );
  }
  if (location) {
    htmlParts.push(
      `<p style="margin:4px 0;"><strong>Location:</strong> ${location}</p>`
    );
  }
  if (caseType) {
    htmlParts.push(
      `<p style="margin:4px 0;"><strong>Case type:</strong> ${caseType}</p>`
    );
  }
  if (contact) {
    htmlParts.push(
      `<p style="margin:4px 0;"><strong>Contact:</strong> ${contact}</p>`
    );
  }
  if (message) {
    htmlParts.push(
      `<p style="margin:12px 0;">${message}</p>`
    );
  }
  htmlParts.push(
    '<p style="margin-top:16px;">If you are available and eligible to donate, please reach out as soon as possible.</p>'
  );
  htmlParts.push('<p style="margin-top:16px;color:#6b7280;font-size:12px;">This message was sent via the BloodConnect platform.</p>');
  htmlParts.push('</div>');

  const html = htmlParts.join('');

  const transporter = getTransport();
  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });
}

async function sendToMultipleDonors(donorEmails, payload) {
  const emails = Array.from(
    new Set(
      (donorEmails || [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );

  if (!emails.length) {
    return { sentCount: 0, failures: [] };
  }

  const CONCURRENCY = Number(
    process.env.DONOR_NOTIFY_CONCURRENCY || 6
  );

  const failures = [];
  let sentCount = 0;

  for (let i = 0; i < emails.length; i += CONCURRENCY) {
    const batch = emails.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map(async (email) => {
        try {
          await sendUrgentBloodEmail(email, payload);
          sentCount += 1;
        } catch (err) {
          failures.push({ email, error: err.message || String(err) });
        }
      })
    );
  }

  return { sentCount, failures };
}

module.exports = {
  isEmailConfigured,
  sendUrgentBloodEmail,
  sendToMultipleDonors,
};

