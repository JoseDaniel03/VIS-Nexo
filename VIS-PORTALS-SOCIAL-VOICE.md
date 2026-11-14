# VIS Portals: in-game social panel and server voice

Source implementation, pending deployment and end-to-end device validation.

## Player flow

Start Horizon through VIS Nexo. F8 opens the native Rust panel; Settings lets you select F6–F10.
The panel shows up to forty contacts, recent chats, world invitations and presence. Type a message and
press Enter. The panel is draggable; opening it releases the pointer and consumes keyboard input.
Private, unpublished singleplayer worlds pause by default. Pause/Resume and the automatic-pause setting
can keep them running. Published worlds and remote servers keep ticking. Microphone capture is opt-in.
V is push-to-talk while playing; opening the panel or losing focus releases it. The panel's Mic, Audio,
Voice and Devices controls provide mute, deafen, join/leave, device selection and individual volume.
Open-microphone mode is explicit. No private-call or group-call implementation is included.

The panel is drawn by Horizon. Networking, message encryption/history and voice processing stay in Nexo's
existing WebView process. Voice uses WebRTC, requests Opus at 32 kbit/s, mono capture, echo cancellation,
noise suppression and automatic gain. Actual support depends on WebView2/WebKit and the selected device;
these requests are not a guarantee that every platform implements every processing feature. No external
browser is opened. Nexo must stay running. A missing bridge clears the game's social snapshot after five
seconds. Messages and endpoint credentials are not written into the game world or crash logs by this code.

## Server voice deployment

Apply migration **0012_server_voice.sql** after 0011 and deploy the Worker and its imported modules together.
Health requires schema 12. A published VIS project and subscription/staff membership authorize its channel.
The initial mesh limit is **16 participants**. Each user has one active voice device; device collisions are
rejected rather than sharing a signalling session. Signals expire after thirty seconds, sessions after
forty-five seconds. Peer volume is attenuated by the server-approved distance.

Proximity is fail-closed by default. Trusted positions must be refreshed once per second and expire after
three seconds. Different dimensions cannot hear each other. A client cannot supply its own position to the
voice API. A deliberately global server channel can be configured with `VOICE_GLOBAL_PROJECTS` (comma list).

Configure the Worker with `VOICE_POSITION_PROJECT` and the **secret** `VOICE_POSITION_TOKEN`.
On a Horizon server with horizon-extras enabled, configure:

- `VIS_VOICE_URL`: the HTTPS VIS Social origin;
- `VIS_VOICE_PROJECT`: the same project ID;
- `VIS_VOICE_TOKEN`: the matching server-only secret (32+ characters);
- `VIS_VOICE_IDENTITIES`: absolute JSON file mapping verified Minecraft UUIDs to immutable VIS usernames.

The server's native publisher reads authoritative guest positions, uses a bounded background channel and
never blocks the simulation on HTTP. Maintain this identity binding on the trusted server and use online-mode
authentication; the publisher is not a replacement for Minecraft login authentication. A VSMedia/CanvasMC
adapter may publish the same snapshot to `POST /v1/voice/positions` with the server bearer secret:

```json
{"project_id":"virgoland","players":[{"username":"alice","dimension":"minecraft:overworld","x":10,"y":64,"z":20}]}
```

This repository includes Horizon's publisher and the shared API. The separate VSMedia/CanvasMC plugin has
not been modified. Its adapter still needs to be wired to this contract before those servers can publish
positions. The game/launcher never receive the position-publisher secret.

For Internet connectivity across NAT, deploy a TURN server and configure `VOICE_TURN_URL` and the **secret**
`VOICE_TURN_SECRET`. Coturn REST credentials are issued for ten minutes; the shared secret stays server-side.
There is no bundled public TURN service. Preserve credentials only in GitHub Secrets/environments and inject
them during deployment/server startup; do not put them in project packs, launcher files or version control.

VSMedia's audio source integration point is `serverVoice.attachMedia(mediaStream, volume)`, returning
`setVolume` and `stop`. It mixes an explicitly supplied source into the server stream without stopping
VSMedia's source when detached. No remote source is attached automatically and no microphone is recorded.

## Project menus

The instance's **Menú del juego** editor writes `.vis/menu.json`. Official projects require administrator
permission; personal instance owners may edit theirs. Restart Horizon to apply it. A data-only document
selects the assigned server and play/settings/friends/quit buttons with relative x/y/width coordinates.
The Play button connects to that server. No scripts, shell actions or arbitrary URL-opening actions are
accepted. This is a configuration editor, not a full visual FancyMenu replacement.

## Validation limits

- Nexo `cargo check --offline --tests`, complete social suite, invitation tests, voice authorization,
  authoritative proximity, microphone-consent/PTT/mute/deafen/cancellation tests and bridge checks passed.
- Native panel, publisher and menu parser were type-checked in an isolated harness with real winit/ureq;
  menu-validation tests passed. This does not replace compiling the full Horizon workspace.
- Full Horizon compilation, rendered UI, real microphones, playback, two computers, NAT/TURN, and VSMedia's
  separate plugin adapter remain unverified. No production deployment or release was performed.
