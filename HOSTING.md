# Host + CI/CD setup

## 1. Prepare VPS
Use Ubuntu 24.04+ (or compatible Linux with systemd).

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx sqlite3 rsync curl git
```

Install Node.js 22+ (required by `node:sqlite`):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

Create app and data directories:

```bash
sudo mkdir -p /opt/flomik-labs /var/lib/flomik-labs /var/backups/flomik-labs
sudo chown -R "$USER:$USER" /opt/flomik-labs
sudo chown -R www-data:www-data /var/lib/flomik-labs /var/backups/flomik-labs
```

## 2. Deploy app first time

```bash
git clone <your-repo-url> /opt/flomik-labs
cd /opt/flomik-labs
npm ci
cp deploy/env/.env.example .env
```

Edit `/opt/flomik-labs/.env` if paths/port differ.

## 3. Install systemd units
Copy units:

```bash
sudo cp /opt/flomik-labs/deploy/systemd/flomik-labs.service /etc/systemd/system/
sudo cp /opt/flomik-labs/deploy/systemd/flomik-labs-backup.service /etc/systemd/system/
sudo cp /opt/flomik-labs/deploy/systemd/flomik-labs-backup.timer /etc/systemd/system/
sudo cp /opt/flomik-labs/deploy/backup/backup-flomik-labs.sh /usr/local/bin/backup-flomik-labs.sh
sudo chmod +x /usr/local/bin/backup-flomik-labs.sh
```

If app files are owned by your deploy user, update service user/group in:
`/etc/systemd/system/flomik-labs.service`

Enable services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now flomik-labs
sudo systemctl enable --now flomik-labs-backup.timer
```

Check status:

```bash
sudo systemctl status flomik-labs --no-pager
systemctl list-timers --all | grep flomik-labs-backup
curl -fsS http://127.0.0.1:3000/api/health
```

## 4. Configure nginx

```bash
sudo cp /opt/flomik-labs/deploy/nginx/flomik-labs.conf /etc/nginx/sites-available/flomik-labs
sudo ln -sf /etc/nginx/sites-available/flomik-labs /etc/nginx/sites-enabled/flomik-labs
```

Edit `server_name` in `/etc/nginx/sites-available/flomik-labs`.

Then reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Enable HTTPS:

```bash
sudo certbot --nginx -d language.flomik.xyz
```

## 5. GitHub Actions CI/CD
Repository already contains:

- `.github/workflows/ci.yml`
- `.github/workflows/cd.yml`

Set GitHub secrets:

- `SSH_HOST`: server IP or DNS
- `SSH_USER`: deploy user on server
- `SSH_KEY`: private SSH key for that user
- `SSH_PORT`: optional, defaults to `22`

`APP_DIR` in CD is fixed to `/opt/flomik-labs` in `.github/workflows/cd.yml`.
If you want another path, edit that file.

### Required sudo permissions for deploy user
CD restarts service via:

```bash
sudo -n systemctl daemon-reload
sudo -n systemctl restart flomik-labs
```

Allow passwordless commands (example):

```bash
echo '<deploy-user> ALL=NOPASSWD: /bin/systemctl daemon-reload, /bin/systemctl restart flomik-labs' | sudo tee /etc/sudoers.d/flomik-labs-deploy
sudo chmod 440 /etc/sudoers.d/flomik-labs-deploy
```

## 6. Release flow
Every push/PR runs CI smoke test.

Every push to `main` runs CD:
1. smoke test
2. rsync project to server
3. `npm ci --omit=dev` on server
4. restart `flomik-labs` service
5. verify `http://127.0.0.1:3000/api/health`
