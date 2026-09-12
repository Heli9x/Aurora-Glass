# Filey Android Server APK

Separate server application responsibilities:

- Run the Filey API in a foreground service
- Advertise `_filey._tcp` over Android NSD
- Use the Storage Access Framework for selected media roots
- Run FFmpeg/HLS workers with Android-compatible binaries
- Expose the shared API contract in `deployment/api/openapi.yaml`

Required Android pieces:

- Foreground service for conversions
- Notification channel showing active conversions
- Persisted tree URI permissions
- Network service discovery advertisement
- API health/discovery endpoints

This is a deployment scaffold; the APK requires an Android SDK and a platform-specific service implementation.
