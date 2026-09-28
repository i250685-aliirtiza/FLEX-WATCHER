import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function cleanHeader(value, label) {
  const text = String(value ?? '').trim();
  if (!text || /[\r\n]/.test(text)) throw new Error(`Invalid ${label}.`);
  return text;
}

function emailAddress(value, label) {
  const address = cleanHeader(value, label);
  if (!EMAIL_RE.test(address)) throw new Error(`Invalid ${label}: expected a plain email address.`);
  return address;
}

function recipients(value) {
  const list = String(value ?? '')
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((item, index) => emailAddress(item, `FLEX_EMAIL_TO recipient ${index + 1}`));
  if (!list.length) throw new Error('Missing FLEX_EMAIL_TO.');
  return [...new Set(list)];
}

export function loadEmailConfig(env = process.env) {
  const rawUser = String(env.FLEX_SMTP_USER ?? '').trim();
  const rawPass = String(env.FLEX_SMTP_PASS ?? '');
  const rawTo = String(env.FLEX_EMAIL_TO ?? '').trim();
  const rawFrom = String(env.FLEX_EMAIL_FROM ?? '').trim();
  const rawHost = String(env.FLEX_SMTP_HOST ?? '').trim();
  const rawPort = String(env.FLEX_SMTP_PORT ?? '').trim();

  const anyEmailSetting = [rawUser, rawPass, rawTo, rawFrom, rawHost, rawPort].some(Boolean);
  if (!anyEmailSetting) return null;

  if (!rawUser || !rawPass || !rawTo) {
    throw new Error('Email configuration is incomplete. Set FLEX_SMTP_USER, FLEX_SMTP_PASS, and FLEX_EMAIL_TO together.');
  }

  const host = rawHost || 'smtp.gmail.com';
  if (/\s/.test(host) || /[\r\n]/.test(host)) throw new Error('Invalid FLEX_SMTP_HOST.');

  const port = Number(rawPort || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FLEX_SMTP_PORT must be an integer from 1 to 65535.');

  const user = emailAddress(rawUser, 'FLEX_SMTP_USER');
  const from = emailAddress(rawFrom || rawUser, 'FLEX_EMAIL_FROM');
  const to = recipients(rawTo);
  const pass = host.toLowerCase() === 'smtp.gmail.com' ? rawPass.replace(/\s+/g, '') : rawPass;
  if (!pass) throw new Error('FLEX_SMTP_PASS cannot be empty.');

  return { host, port, user, pass, from, to };
}

const present = value => value !== null && value !== undefined && String(value).trim() !== '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const score = a => finite(a?.obtained) ? `${a.obtained}${finite(a.total) ? `/${a.total}` : ''}` : 'Not available';

export function buildMarksEmail(change, detectedAt = new Date()) {
  if (!change?.now || Array.isArray(change)) throw new Error('buildMarksEmail requires exactly one mark change.');
  const a = change.now;
  const course = a.courseName || a.courseCode || 'Course';
  const assessment = a.assessmentTitle || [a.category, a.assessmentNumber].filter(present).join(' ') || 'Assessment';
  const heading = change.type === 'changed' ? 'Marks Updated' : 'New Marks Posted';
  const percentage = finite(a.obtained) && finite(a.total) && a.total > 0 && Number.isFinite(a.obtained / a.total * 100)
    ? `${Number((a.obtained / a.total * 100).toFixed(2))}%` : null;
  const detected = detectedAt.toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' PKT';
  const fields = [['Course', course], ['Course code', a.courseCode], ['Assessment', assessment],
    ['Marks Obtained', finite(a.obtained) ? a.obtained : null], ['Total Marks', finite(a.total) ? a.total : null],
    ['Percentage', percentage], ['Previous', change.type === 'changed' && finite(change.old?.obtained) ? score(change.old) : null],
    ['New', score(a)], ['Weightage', finite(a.weightage) ? a.weightage : null], ['Detected', detected]].filter(([, value]) => present(value));
  const text = ['FLEX Marks Update', heading, '', ...fields.map(([key, value]) => `${key}: ${value}`)].join('\n') + '\n';
  const rows = fields.map(([key, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #edf0f3;color:#64748b;width:38%;vertical-align:top">${escapeHtml(key)}</td><td style="padding:10px 0 10px 12px;border-bottom:1px solid #edf0f3;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#f3f5f8;color:#172033;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:28px 24px"><p style="margin:0 0 20px;font-size:12px;letter-spacing:2px;color:#64748b">FLEX MARKS UPDATE</p><p style="margin:0 0 12px;color:#2563eb;font-size:13px">${escapeHtml(heading)}</p><h1 style="margin:0 0 8px;font-size:24px;word-break:break-word">${escapeHtml(course)}</h1><p style="margin:0;font-size:18px;color:#64748b">${escapeHtml(assessment)}</p><div style="margin:24px 0;padding:24px 12px;background:#f8fafc;text-align:center;border-radius:8px"><div style="font-size:38px;font-weight:bold">${escapeHtml(score(a))}</div>${percentage ? `<p style="margin:8px 0 0;color:#2563eb;font-size:20px">${escapeHtml(percentage)}</p>` : ''}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.5">${rows}</table></td></tr></table></td></tr></table></body></html>`;
  return { subject: cleanHeader(`${course} ${assessment} \u2014 ${score(a)}`, 'email subject'), text, html };
}

export function buildTestEmail(now = new Date()) {
  return {
    subject: 'FLEX Watcher - Email Test',
    text: [
      'FLEX Marks Watcher',
      '',
      'Email delivery is configured correctly.',
      `Test sent: ${now.toLocaleString()}`,
      '',
      'No FLEX mark or saved snapshot was changed by this test.',
      '',
    ].join('\n'),
  };
}

export function buildSessionExpiredEmail(detectedAt = new Date(), recoveryUrl = '') {
  const safeUrl = /^https:\/\//i.test(String(recoveryUrl)) ? String(recoveryUrl) : '';
  const detected = detectedAt.toLocaleString();
  const text = ['FLEX Watcher \u2014 Login Required', '', 'Your FLEX authentication session was lost.', 'Marks monitoring is paused. The server is still running and no marks will be processed until authentication returns.', `Detected: ${detected}`, safeUrl ? `Re-authenticate FLEX: ${safeUrl}` : 'Open the configured private browser access page to log in manually.', ''].join('\n');
  const button = safeUrl ? `<p style="margin:24px 0"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">Re-authenticate FLEX</a></p>` : '';
  return { subject: '\uD83D\uDD10 FLEX Watcher \u2014 Login Required', text, html: `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial;color:#172033"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px"><table role="presentation" style="max-width:560px;background:#fff;padding:28px;border:1px solid #e2e8f0;border-radius:12px"><tr><td><h1 style="font-size:24px">FLEX Watcher \u2014 Login Required</h1><p>Your FLEX authentication session was lost. Marks monitoring is temporarily paused; the server is still running.</p><p>Detected: ${escapeHtml(detected)}</p>${button}<p style="color:#64748b">No passwords, cookies, or session secrets are included in this message.</p></td></tr></table></td></tr></table></body></html>` };
}

export function buildRecoveryEmail(recoveredAt = new Date(), pollMs = 15000) {
  const detected = recoveredAt.toLocaleString();
  return { subject: '\u2705 FLEX Watcher Back Online', text: `FLEX Watcher Back Online\n\nAuthentication restored successfully. FLEX marks monitoring has resumed automatically.\nRecovered: ${detected}\nPoll interval: ${Math.round(pollMs / 1000)} seconds\n`, html: `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial;color:#172033"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px"><table role="presentation" style="max-width:560px;background:#fff;padding:28px;border:1px solid #e2e8f0;border-radius:12px"><tr><td><h1 style="color:#15803d">FLEX Watcher Back Online</h1><p>Authentication restored successfully. FLEX marks monitoring has resumed automatically.</p><p>Recovered: ${escapeHtml(detected)}<br>Poll interval: ${Math.round(pollMs / 1000)} seconds</p></td></tr></table></td></tr></table></body></html>` };
}

class SmtpReader {
  constructor(socket) {
    this.buffer = '';
    this.lines = [];
    this.waiters = [];
    this.failure = null;

    socket.on('data', chunk => this.push(chunk.toString('utf8')));
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed unexpectedly.')));
  }

  push(text) {
    this.buffer += text;
    while (true) {
      const index = this.buffer.indexOf('\n');
      if (index === -1) break;
      const line = this.buffer.slice(0, index + 1).replace(/\r?\n$/, '');
      this.buffer = this.buffer.slice(index + 1);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(line);
      else this.lines.push(line);
    }
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  line() {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async response() {
    const lines = [];
    const first = await this.line();
    lines.push(first);
    const match = /^(\d{3})([ -])/.exec(first);
    if (!match) throw new Error('SMTP server returned a malformed response.');
    const code = Number(match[1]);
    if (match[2] === '-') {
      while (true) {
        const line = await this.line();
        lines.push(line);
        if (line.startsWith(`${match[1]} `)) break;
      }
    }
    return { code, lines };
  }
}

async function expect(reader, allowed, step) {
  const response = await reader.response();
  if (!allowed.includes(response.code)) {
    throw new Error(`SMTP ${step} failed with code ${response.code}.`);
  }
  return response;
}

function writeLine(socket, line) {
  socket.write(`${line}\r\n`);
}

function dotStuff(text) {
  return text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

export function rawMessage(config, message) {
  const subject = cleanHeader(message.subject, 'email subject');
  const encodedSubject = [...subject.matchAll(/[\s\S]{1,18}/gu)].map(m => `=?UTF-8?B?${Buffer.from(m[0]).toString('base64')}?=`).join('\r\n ');
  const boundary = `flex-${randomUUID()}`;
  const part = (type, value) => [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', Buffer.from(String(value ?? '')).toString('base64').match(/.{1,76}/g)?.join('\r\n') || ''].join('\r\n');
  const body = message.html
    ? [`Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, part('text/plain', message.text), `--${boundary}`, part('text/html', message.html), `--${boundary}--`].join('\r\n')
    : part('text/plain', message.text);
  return [`From: ${config.from}`, `To: ${config.to.join(', ')}`, `Subject: ${encodedSubject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', body].join('\r\n');
}

async function openTls(config, timeoutMs) {
  const socket = tls.connect({
    host: config.host,
    port: config.port,
    servername: config.host,
    rejectUnauthorized: true,
  });
  // A total deadline also bounds servers that trickle bytes without completing SMTP.
  const deadline = setTimeout(() => socket.destroy(new Error(`SMTP timeout after ${timeoutMs}ms.`)), timeoutMs);
  socket.once('close', () => clearTimeout(deadline));
  const reader = new SmtpReader(socket);

  await new Promise((resolve, reject) => {
    const onSecure = () => {
      socket.off('error', onError);
      resolve();
    };
    const onError = error => {
      socket.off('secureConnect', onSecure);
      reject(error);
    };
    socket.once('secureConnect', onSecure);
    socket.once('error', onError);
  });

  return { socket, reader };
}

export async function sendEmail(config, message, { timeoutMs = 15000 } = {}) {
  if (!config) throw new Error('Email is not configured.');
  const { socket, reader } = await openTls(config, timeoutMs);

  try {
    await expect(reader, [220], 'greeting');

    writeLine(socket, 'EHLO flex-watcher');
    await expect(reader, [250], 'EHLO');

    writeLine(socket, 'AUTH LOGIN');
    await expect(reader, [334], 'AUTH LOGIN');
    writeLine(socket, Buffer.from(config.user, 'utf8').toString('base64'));
    await expect(reader, [334], 'username');
    writeLine(socket, Buffer.from(config.pass, 'utf8').toString('base64'));
    await expect(reader, [235], 'authentication');

    writeLine(socket, `MAIL FROM:<${config.from}>`);
    await expect(reader, [250], 'MAIL FROM');

    for (const to of config.to) {
      writeLine(socket, `RCPT TO:<${to}>`);
      await expect(reader, [250, 251], 'RCPT TO');
    }

    writeLine(socket, 'DATA');
    await expect(reader, [354], 'DATA');
    socket.write(`${dotStuff(rawMessage(config, message))}\r\n.\r\n`);
    await expect(reader, [250], 'message delivery');

    writeLine(socket, 'QUIT');
    // DATA acceptance already confirms delivery. A failed QUIT must not cause a duplicate.
    try { await expect(reader, [221], 'QUIT'); } catch { /* message accepted */ }
    return { recipients: config.to.length };
  } finally {
    socket.destroy();
  }
}
