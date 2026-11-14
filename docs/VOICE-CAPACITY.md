# Voice room capacity

The fixed 16-participant admission limit is removed. By default VOICE_MAX_PARTICIPANTS is unset (or 0), so no participant-count cap is applied. A positive safe integer optionally sets an operator-selected room capacity. Invalid values return a configuration error. Existing device exclusivity, project authorization and proximity rules remain active.

This does not promise unlimited simultaneous audio: the current WebRTC mesh uses a connection per audible peer. CPU, upload bandwidth, TURN and signaling capacity still constrain practical room size. Large global channels need load testing and an SFU architecture.

Android status: the integrated Android v0.2.0 companion provides identity, friends, projects, community and account management on the same Ceibo/Portals service. It does not yet run the Horizon game or the desktop voice integration. No new Android game APK has been validated for this change.

