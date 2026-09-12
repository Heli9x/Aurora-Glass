# Production Debian Server

The production service uses Gunicorn, not Flask's development server. It intentionally runs one worker with multiple threads because the HLS manager owns conversion state and FFmpeg process handles in memory.

## Install

```bash
cd deployment/linux/server
FILEY_STORAGE_DIR=/run/media/heli9x/FS-STORAGE ./install.sh
```

The installer installs Python, FFmpeg, Gunicorn, copies the unchanged Filey-01 source into `/opt/filey`, and enables `filey-server.service`.

## Operations

```bash
systemctl status filey-server
journalctl -u filey-server -f
systemctl restart filey-server
curl http://127.0.0.1:9100/api/files
```

## Uninstall

The uninstall script removes the installed application, service, environment file, and `filey` system user. It preserves the configured media storage.

```bash
./uninstall.sh
./uninstall.sh --yes
```

## Optional Nginx

Install Nginx and copy `nginx-filey.conf` to `/etc/nginx/sites-available/filey`, then enable it:

```bash
sudo apt-get install nginx
sudo cp nginx-filey.conf /etc/nginx/sites-available/filey
sudo ln -s /etc/nginx/sites-available/filey /etc/nginx/sites-enabled/filey
sudo nginx -t && sudo systemctl reload nginx
```

Nginx is configured for streaming and large uploads: request buffering is disabled and media timeouts are extended.
