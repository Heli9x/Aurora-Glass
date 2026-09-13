# Filey Deployment

This directory prepares the unchanged `Filey-01` project for separate server and client deployments.

## Targets

- `linux/server`: Debian/Linux Filey API server and systemd service
- `linux/client`: standalone client deployment notes and API configuration
- `android/server`: Android server APK preparation
- `android/client`: Android client APK preparation
- `api`: shared API contract

The original project remains at `../Filey-01` and is not edited by these deployment files.

## Current Linux server

```bash
cd deployment/linux/server
FILEY_STORAGE_DIR=/run/media/$USER/FS-STORAGE FILEY_BIND=0.0.0.0:9100 ./install.sh
```

The installer expects the source project at `../../Filey-01` relative to this directory. It installs Python dependencies, FFmpeg, Gunicorn, a dedicated `filey` service user, and a hardened systemd service. See `linux/server/PRODUCTION.md` for Nginx and operations guidance.

## Android status

The Android directories define the separation and API contract. APK implementation requires an Android SDK/Gradle environment and platform-specific storage access through the Storage Access Framework.
