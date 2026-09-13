# Debian Filey Server

Run `install.sh` from this directory. It installs Python, FFmpeg, `rsync`, a virtual environment, and a systemd service. The source `Filey-01` directory is copied into `/opt/filey` by default; the original project remains unchanged.

Override storage and install locations:

```bash
FILEY_STORAGE_DIR=/mnt/media FILEY_INSTALL_DIR=/opt/filey ./install.sh
```

Useful commands:

```bash
systemctl status filey-server
journalctl -u filey-server -f
systemctl restart filey-server
```
