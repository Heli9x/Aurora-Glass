# Linux Filey Client

The client is API-oriented and may run as a browser, WebView, or desktop wrapper. It must accept a server URL rather than assume localhost.

Example:

```text
http://192.168.31.139:9100
```

Discovery should query `_filey._tcp` via Avahi/mDNS when available, then validate candidates with `/api/health`. Manual URL entry is the fallback for hosts that do not advertise discovery.

The current UI source remains in `Filey-01`; this directory contains deployment guidance only.
