# Filey Android Client APK

Separate client application responsibilities:

- Discover Filey servers using Android NSD
- Allow manual API URL entry
- Validate `/api/health` and `/api/discovery`
- Store the selected server URL
- Render the Filey UI through a WebView or native Compose screens
- Use Media3/ExoPlayer for native HLS playback when appropriate

The client must not assume the server is Android or Linux. Any compatible Filey API host can provide the files.
