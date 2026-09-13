# Changelog

## v0.1.0 - Initial documented release

### Added

- Browser library views for Home, Movies, Music, Photos, and Other files.
- Grid/list browsing, sorting, pagination, upload, rename, download, and delete workflows.
- Browser playback with FFmpeg-backed HLS conversion support.
- Storage settings, platform naming, browser preferences, and in-app guidance.
- Linux deployment with systemd, Gunicorn, FFmpeg, configurable storage, and optional Nginx support.
- Product README, advertising brochure, landing page, and UI screenshot documentation.

### Release notes

Filey is a self-hosted personal media library. It does not currently provide user accounts, public sharing links, or built-in authentication. Deploy it on a trusted network or protect it with an appropriately configured reverse proxy. FFmpeg is required for media conversion and generated thumbnails.