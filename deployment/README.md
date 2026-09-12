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
./install.sh
```

The installer expects the source project at `../../Filey-01` relative to this directory. It installs Python dependencies, FFmpeg, and a systemd service. Configure `FILEY_STORAGE_DIR` before starting the service.

## Android status

The Android directories define the separation and API contract. APK implementation requires an Android SDK/Gradle environment and platform-specific storage access through the Storage Access Framework.
