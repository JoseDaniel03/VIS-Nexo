# Native invitations to PC worlds

Start an updated Horizon instance through VIS Nexo. Open a singleplayer world, open the friend's chat
in VIS Portals, and select **Invitar a mi mundo**. The game opens its existing native friends tunnel;
the recipient sees **Unirme** and **Rechazar** in the social panel. The recipient starts their own updated
Horizon instance, stays at its title screen and selects **Unirme**. With multiple running instances VIS asks
which one to use. **Dejar de compartir mundo** closes the tunnel and the social room.

The launcher remains open to renew the invitation lease. Codes are encrypted with the existing pinned
ECDH/AES-GCM identity and stored only as opaque envelopes on the service, separately from chat history.
No descriptor tokens or Microsoft credentials reach the WebView or social service. Changing a public
handle does not change the internal account used to authorize invitations.

Apply `services/social/migrations/0014_world_invites.sql` before deploying the Worker. Health reports
schema 11. Old Workers keep chat working but do not support world invitations. Update both VIS Nexo and
the Horizon fork: old game executables do not expose the restricted launcher endpoint.

A reachable configured Horizon relay or VPN is necessary where direct connectivity fails (e.g. CGNAT).
This change does not deploy a relay, alter Microsoft authentication or provide Android builds.
Invitations expire after ten minutes; closed or unrenewed rooms cannot be accepted. These delivery rules
do not revoke a tunnel code already received: stop sharing to invalidate that game session's codes.

Validation: cargo check passed (existing warnings), dedicated world API and UI-flow tests passed, native
command parser tests passed. The complete social authentication/migration suite also passed after integrating the latest main changes.
A local TCP bridge runtime test was blocked by sandbox socket permissions. Full Horizon compilation, real two-PC play, relay fallback and rendered UI
verification remain outstanding. No production release or deployment was performed.

