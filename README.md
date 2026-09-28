# FLEX Marks Notifier

FLEX Marks Notifier watches your authenticated FAST FLEX marks page and emails you when a mark is released or changed. It runs as a small always-on Node.js service on an Oracle Cloud Ubuntu VM.

The watcher does not log in to FLEX, store your FLEX password, solve CAPTCHAs, or bypass Turnstile. You first obtain a valid FLEX session cookie in your normal browser, then provide that cookie to the service. Each cycle uses the same cookie session in this order: `PrintAdmitCard?semid=20263` navigation, authenticated `Student/StudentMarks?semid=20263`, comparison, one email per changed assessment, then a 15-second wait. Both responses are checked for login/challenge/redirect failures before parsing.

## What you need

- A FAST/FLEX student account and a browser where you can log in normally.
- An Oracle Cloud account and an Ubuntu VM with internet access.
- An SSH key pair. Oracle uses the public key for SSH; the VM has no default password login.
- Optional: an SMTP account. Gmail users should use a Google App Password.

## 1. Create an Oracle Cloud account

Open [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) and create an account. Oracle may request phone verification and a payment card for identity verification; check the current [Free Tier terms and resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm) before continuing. Choose a home region close to you. Oracle Always Free capacity depends on region and availability.

## 2. Create the Ubuntu VM

In the Oracle Cloud Console:

1. Open **Compute → Instances → Create instance**.
2. Give it a name such as `flex-marks-notifier`.
3. Select an Ubuntu image (Ubuntu 22.04 or newer is recommended).
4. Select an Always Free eligible shape if available. ARM Ampere is fine; this project is pure Node.js.
5. Keep the default boot volume and public IPv4 address settings.
6. Under **Add SSH keys**, upload your public key or paste it.
7. Click **Create** and wait until the instance is running.

Copy the instance's public IP address. Oracle's [instance creation guide](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm) shows the current console screens.

From your computer, connect as `ubuntu`:

```bash
ssh -i ~/.ssh/your-oracle-key ubuntu@YOUR_PUBLIC_IP
```

On Windows PowerShell, the same command is usually:

```powershell
ssh -i "$env:USERPROFILE\.ssh\your-oracle-key" ubuntu@YOUR_PUBLIC_IP
```

If SSH does not connect, check that the instance is running and that its subnet security list allows TCP port 22. No inbound port is required for this watcher beyond SSH.

## 3. Install Node.js and download the project

Run these commands inside the Ubuntu VM. NodeSource publishes Node.js packages for supported Ubuntu versions and architectures ([installation instructions](https://github.com/nodesource/distributions#installation-instructions)).

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version

sudo useradd --system --home /opt/flex-marks-notifier --shell /usr/sbin/nologin flex-watcher
sudo git clone https://github.com/i250685-aliirtiza/FLEX-WATCHER.git /opt/flex-marks-notifier
sudo chown -R flex-watcher:flex-watcher /opt/flex-marks-notifier
cd /opt/flex-marks-notifier
sudo -u flex-watcher npm ci --omit=dev
```

The project requires Node.js 20.19 or newer.

## 4. Get your FLEX cookie safely

On your own computer:

1. Log in to FLEX normally in your browser.
2. Open Developer Tools → **Application/Storage → Cookies** for `flexstudent.nu.edu.pk`.
3. Copy the complete cookie header if possible, or copy the current `ASP.NET_SessionId` value.
4. Treat it like a password. Do not paste it into Git, chat, screenshots, or a shell command that will remain in history.

A cookie expires eventually. The service cannot renew it by logging in for you.

## 5. Configure the service

Create the root-owned environment file from the committed template:

```bash
sudo install -m 0600 -o root -g root /opt/flex-marks-notifier/.env.example /etc/flex-marks-notifier.env
sudoedit /etc/flex-marks-notifier.env
```

Set at least these values:

```ini
FLEX_COOKIE="ASP.NET_SessionId=PASTE_YOUR_CURRENT_COOKIE"
FLEX_SEMESTER_ID=20263
FLEX_SNAPSHOT_FILE=/var/lib/flex-marks-notifier/marks-snapshot.json
MARKS_POLL_MS=15000
FLEX_REQUEST_TIMEOUT_MS=30000
FLEX_RETRY_BASE_MS=300000
FLEX_RETRY_MAX_MS=1800000
```

Replace `20263` with the semester ID you want to watch. Keep the quotation marks if the cookie contains spaces or multiple cookie values. Verify permissions:

```bash
sudo chown root:root /etc/flex-marks-notifier.env
sudo chmod 600 /etc/flex-marks-notifier.env
sudo grep -E '^(FLEX_SEMESTER_ID|MARKS_POLL_MS|FLEX_REQUEST_TIMEOUT_MS)=' /etc/flex-marks-notifier.env
```

### Optional email notifications

Add all three required values together:

```ini
FLEX_SMTP_USER=your-address@gmail.com
FLEX_SMTP_PASS="your-google-app-password"
FLEX_EMAIL_TO=your-address@gmail.com
FLEX_EMAIL_FROM=your-address@gmail.com
FLEX_SMTP_HOST=smtp.gmail.com
FLEX_SMTP_PORT=465
```

For Gmail, create an App Password in your Google Account. Never use your normal Google password. Email sends one alert for a session expiry and suppresses repeats until a valid poll succeeds.

## 6. Install and start systemd

The repository includes [deploy/flex-marks-notifier.service](./deploy/flex-marks-notifier.service):

```bash
sudo install -m 0644 /opt/flex-marks-notifier/deploy/flex-marks-notifier.service /etc/systemd/system/flex-marks-notifier.service
sudo systemctl daemon-reload
sudo systemctl enable --now flex-marks-notifier
sudo systemctl status flex-marks-notifier --no-pager
```

Useful commands:

```bash
sudo systemctl start flex-marks-notifier
sudo systemctl stop flex-marks-notifier
sudo systemctl restart flex-marks-notifier
sudo systemctl status flex-marks-notifier
sudo journalctl -u flex-marks-notifier -f
sudo journalctl -u flex-marks-notifier -n 100 --no-pager
```

Healthy logs contain `AUTH VERIFIED` and `WATCHED | no mark changes`. A first successful poll creates the baseline and does not send an email.

## 7. Replace an expired cookie

When the logs show `AUTH EXPIRED`:

```bash
sudoedit /etc/flex-marks-notifier.env
# replace only FLEX_COOKIE, then save
sudo chmod 600 /etc/flex-marks-notifier.env
sudo systemctl restart flex-marks-notifier
sudo journalctl -u flex-marks-notifier -f
```

After a valid poll, the service logs `AUTH VERIFIED`, resets the one-time expiry alert, and continues using the existing last valid snapshot.

## 8. Updating the project

```bash
sudo systemctl stop flex-marks-notifier
cd /opt/flex-marks-notifier
sudo git pull --ff-only origin main
sudo -u flex-watcher npm ci --omit=dev
sudo systemctl daemon-reload
sudo systemctl start flex-marks-notifier
sudo systemctl status flex-marks-notifier --no-pager
```

The environment file and snapshot are outside the Git checkout, so updates do not replace them.

## Local development and tests

```bash
npm ci
npm test
```

For a one-shot local check, set `FLEX_RUN_ONCE=1` and provide a valid cookie. Do not put real credentials in tracked files. `.env.example` contains placeholders only; `.env`, `data/`, logs, captures, and key files are ignored.

## Troubleshooting

- **`AUTH EXPIRED`**: obtain a fresh browser cookie and restart the service.
- **`TRANSIENT FAILURE`**: check DNS, VM internet access, and FLEX availability. The saved snapshot is preserved.
- **`FLEX HTTP FAILURE`**: FLEX returned a server/error status; wait and let retry/backoff run.
- **`UNEXPECTED FLEX RESPONSE`**: FLEX returned a login, challenge, malformed, or unexpected page. Do not treat HTTP 200 alone as authentication.
- **No email**: check all three required SMTP variables, use a Gmail App Password, and inspect `journalctl` for SMTP errors.
- **Service will not start**: run `sudo journalctl -u flex-marks-notifier -n 100 --no-pager` and verify `/etc/flex-marks-notifier.env` permissions and values.

## Scope and live validation

Mark notifications are sent one assessment per email, sequentially, with HTML and plain-text alternatives. The watcher preserves the last valid marks snapshot on network, FLEX, parser, and notification failures; avoids overlapping polling; restarts after crashes; and handles SIGINT/SIGTERM. Remaining validation requires a real deployment: an overnight Oracle soak test (including approximately 03:00–03:15), and a real mark-change notification when a professor uploads or changes marks.

## Manual authentication recovery

When FLEX rejects an authenticated request, the watcher enters `WAITING_FOR_MANUAL_LOGIN`, pauses marks processing, and sends one `🔐 FLEX Watcher — Login Required` email. It continues a low-rate authentication check (`FLEX_RECOVERY_CHECK_MS`, default 15 seconds) without replacing the saved snapshot. When a valid `PrintAdmitCard -> StudentMarks` sequence succeeds, it logs `AUTH RECOVERED`, resumes the normal poll interval, and sends one `✅ FLEX Watcher Back Online` email. Network and HTTP server failures do not enter recovery mode.

Set `FLEX_RECOVERY_URL` only to a private, authenticated browser endpoint, such as a Tailscale-only noVNC URL:

```ini
FLEX_RECOVERY_URL=https://browser.your-tailnet.ts.net/
FLEX_RECOVERY_CHECK_MS=15000
```

The repository does not read Chromium’s encrypted cookie database or expose a public debugging port. To use a browser for manual login, run Chromium and noVNC on the VM under the `flex-watcher` account with a persistent profile such as `/var/lib/flex-marks-notifier/chrome-profile`, bind noVNC to the Tailscale interface or localhost, and require Tailscale authentication. Never place the profile, cookies, passwords, or Tailscale credentials in Git or in the email. The current supported watcher session remains the configured cookie jar; after a manual browser login, update that cookie through the existing protected environment-file procedure unless you deploy a separate, audited cookie-bridge.

For a safe state-machine check without waiting for expiry, run the automated suite; it covers `AUTHENTICATED -> AUTH_LOST -> WAITING_FOR_MANUAL_LOGIN -> AUTH_RECOVERED`.

### VM recovery checklist

Install the private networking and browser components according to their current Ubuntu documentation, then keep them under systemd. Do not open VNC, noVNC, Chrome DevTools, or the recovery endpoint in an Oracle security list. A typical private setup is:

```bash
sudo apt update
sudo apt install -y chromium-browser xvfb
# Install noVNC/websockify using your distro's current package or pinned release.
sudo systemctl enable --now tailscaled
sudo tailscale up
# Configure Chromium with --user-data-dir=/var/lib/flex-marks-notifier/chrome-profile
# Bind noVNC to the Tailscale address only and protect it with Tailscale ACLs.
```

The watcher itself survives SSH disconnects and VM reboots through `flex-marks-notifier.service`; the browser/noVNC process must likewise use a dedicated systemd unit and the same `flex-watcher` user.
