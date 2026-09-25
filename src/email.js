import tls from 'node:tls';

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

function changeTitle(change) {
  const a = change.now;
  return `${a.courseCode} ${a.category} ${a.assessmentNumber}`;
}

export function buildMarksEmail(changes, detectedAt = new Date()) {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('buildMarksEmail requires at least one mark change.');

  let subject;
  if (changes.length === 1) {
    subject = changes[0].type === 'changed'
      ? `FLEX - Mark Updated: ${changeTitle(changes[0])}`
      : `FLEX - New Mark: ${changeTitle(changes[0])}`;
  } else {
    subject = `FLEX - ${changes.length} Mark Updates`;
  }

  const lines = [
    'FLEX Marks Watcher',
    `Detected: ${detectedAt.toLocaleString()}`,
    '',
  ];

  for (const change of changes) {
    const a = change.now;
    lines.push(change.type === 'changed' ? '[MARK CHANGED]' : '[NEW MARK]');
    lines.push(`${a.courseCode} - ${a.courseName}`);
    lines.push(`${a.category} ${a.assessmentNumber}`);
    if (change.type === 'changed') lines.push(`Old: ${change.old.obtained}/${a.total}`);
    lines.push(`New: ${a.obtained}/${a.total}`);
    if (a.weightage !== null && a.weightage !== undefined) lines.push(`Weightage: ${a.weightage}`);
    lines.push('');
  }

  return { subject: cleanHeader(subject, 'email subject'), text: lines.join('\n').trimEnd() + '\n' };
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

export function buildSessionExpiredEmail(detectedAt = new Date()) {
  return {
    subject: 'FLEX Watcher Alert - Session Expired',
    text: [
      'FLEX Marks Watcher Alert',
      `Detected: ${detectedAt.toLocaleString()}`,
      '',
      'Your FLEX session is no longer authenticated.',
      'A new session cookie is required.',
      '',
      'The watcher will continue polling, but marks cannot be checked until a valid session is provided.',
      'The saved marks snapshot remains unchanged.',
      '',
    ].join('\n'),
  };
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

function rawMessage(config, message) {
  const subject = cleanHeader(message.subject, 'email subject');
  const text = String(message.text ?? '');
  return [
    `From: ${config.from}`,
    `To: ${config.to.join(', ')}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ].join('\r\n');
}

async function openTls(config, timeoutMs) {
  const socket = tls.connect({
    host: config.host,
    port: config.port,
    servername: config.host,
    rejectUnauthorized: true,
  });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`SMTP timeout after ${timeoutMs}ms.`)));
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
    await expect(reader, [221], 'QUIT');
    return { recipients: config.to.length };
  } finally {
    socket.destroy();
  }
}
