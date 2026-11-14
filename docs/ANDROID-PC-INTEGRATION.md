# VIS Nexo PC / Android integration

The `codex/vis-portals-worlds` integration includes the Android companion v0.2.0 source from `cadc185662ae41264fffff95a5b566ff86574e04`, its Ceibo security work, and the desktop Portals/world invitations/server voice features. Both platforms authenticate to the same VIS Social HTTPS service. Tokens remain in native Rust memory; each device signs in independently.

## Database compatibility

Apply additive migrations in filename order. Community is 0011, recovery 0012, MFA login gate 0013, world invitations 0014 and voice 0015. Health reports schema 15 only when all required tables and credential fields exist. Production deployment remains manually initiated through the existing Cloudflare workflow; integration does not deploy it automatically. Keep Cloudflare/TURN credentials in GitHub environment secrets.

## Android build

The existing Android ARM64 debug workflow now also builds this integration branch, checks the mobile bridge and shared backend tests, and uploads a preview APK plus SHA-256. Its artifact contains the current mobile interface, not the Horizon game engine. Existing standalone v0.2.0 APKs do not change until replaced with a build from the integrated commit.

## Actual feature boundaries

Android supports identity, friends, presence, projects, community, account management and local instance metadata. Desktop retains its native game bridge, encrypted chat, world invitations and WebRTC server voice. Android does not yet execute Horizon/Java, decrypt desktop chat identities or capture server voice. No device pairing or automatic credential transfer is introduced. Sharing a backend does not synchronize local worlds or instance folders between devices.

The former fixed 16-person voice admission cap is removed. Tests cover 32 additional joins, optional operator capacity, private-project play permissions and proximity isolation. WebRTC mesh performance at large room sizes still requires load testing.

## Verification

Passed locally: merged Ceibo/Social migrations and authentication tests, Android feature and bridge contracts, realtime contracts, native command registration, world invitations/UI flow and voice media controls/capacity tests. Full Rust desktop compilation, Android APK build and two-device audio/network validation require their respective build environments and hardware.


## Android v0.3.0 game preview handoff

A separate experimental VIS McRust ARM64 APK is built from a pinned native Android port in horizon-VISNEXO. Nexo's owned Horizon 26.3 Vanilla entries now request that exact package/activity through the native WebView JNI handle. The handoff includes only schema, offline name, owner and instance ID; the game maps it to a sandboxed per-account/per-instance folder. No credentials or arbitrary paths are transferred. Java, PC feature parity, Android voice and two-device validation remain pending. The two APKs must be installed explicitly for this preview; Nexo reports a missing game APK instead of claiming installation succeeded.
