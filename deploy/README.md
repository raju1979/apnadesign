# VPS deployment

ApnaDesign runs as one persistent Node.js process: Next.js serves the web app and the custom server handles `/collaborate` WebSockets. Supabase remains hosted separately. Rust is not needed on the server: the checked-in WASM binary runs in the browser.

The live demo address is `https://apnadesign.ajarafashion.com`. Hostinger DNS has an A record named `apnadesign`, pointing to `65.75.203.202` with TTL 300; all existing DNS records were preserved and verified after adding it. Caddy automatically obtains and renews HTTPS certificates for the domain. The initial IP address `https://65.75.203.202` is also retained with its automatically renewed, short-lived public IP certificate from Let's Encrypt. IP certificates require a current Caddy release with ACME profile support. Inbound ports 80 and 443 are open. SSH remains on port 22; port 3000 is bound only to loopback.

Initial release: `/opt/apnadesign/releases/20261010-01`, deployed October 10, 2026 on Ubuntu 26.04 with Node.js 22.22.1 and Caddy 2.11.7. The official Caddy release `.deb` was checked against its GitHub SHA-256 digest; the Cloudsmith repository was unavailable and its added list file is disabled. Future Caddy updates need to be installed from an official release or a restored working repository. The VPS has 2 vCPUs and approximately 4 GB RAM. Supabase's Site URL is set to `https://apnadesign.ajarafashion.com`; the domain, HTTPS IP address, and localhost:3000 are allowed redirects, and the prior localhost:5173/reset-password entry is retained.

The app uses an unprivileged `apnadesign` system account. Release folders live in `/opt/apnadesign/releases`, with `/opt/apnadesign/current` pointing to the active release. Keep the previous release for rollback. Environment variables live in `/etc/apnadesign/environment` (root-owned, mode 600). Supply the two public Supabase environment variables during the build as well as at runtime, because Next.js embeds them in browser assets. Never deploy SSH private keys, local sessions, or test tokens.

Build each release on Linux with `npm ci`, `npm run typecheck`, `npm run build`. Keep `tsx` installed because the custom server runs through it. Copy `apnadesign.service` into `/etc/systemd/system` and `Caddyfile` into `/etc/caddy`. Validate the Caddy configuration before reloading it.

Useful commands:

```sh
systemctl status apnadesign caddy
journalctl -u apnadesign -n 50 --no-pager
journalctl -u caddy -n 50 --no-pager
systemctl restart apnadesign
```

For an update, build and check a new release before switching the `current` symlink and restarting `apnadesign`. For rollback, repoint the symlink to the previous release and restart the same service. One instance is required while collaboration rooms live in process memory.

Verify a deployment from the local project folder:

```sh
TEST_BASE_URL=https://apnadesign.ajarafashion.com node --env-file=.env.local node_modules/tsx/dist/cli.mjs tests/deployment-smoke.ts
TEST_BASE_URL=https://apnadesign.ajarafashion.com npm run test:server
```

The smoke check creates disposable Supabase anonymous sessions and a temporary project. It verifies guest link access, concurrent edits through separate WebSocket connections, live drag previews, persistence, reconnect, private image uploads, and viewer restrictions. Its temporary project and image are removed; test sessions are signed out. The check does not delete the anonymous Auth user records. It is an explicit integration test and is not included in the offline `npm test` suite.

When adding another domain, point its A record to the VPS, add its site address to Caddy, and use Caddy's default certificate issuer. Validate the configuration before reloading Caddy; `/etc/caddy/Caddyfile.before-domain` preserves the initial IP-only configuration. Update Supabase's Auth Site URL and allowed redirect URLs to the final HTTPS address. Existing sessions are scoped to the browser origin, so a new domain requires signing in again. For guest users, signing in again creates a new identity; use a guest share link from the original session or continue using the original address to access its projects.

## Automatic GitHub deployment

`.github/workflows/deploy.yml` runs on pushes to `main`, pull requests, and manual dispatch. Tests, type checking, and a production build must pass before deployment. Pull requests only run checks. Deployment runs use the `production` GitHub environment, restricted to the `main` branch. Deployments are serialized and an active deployment is not cancelled by a newer push.

The production environment stores four encrypted Actions secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, and `VPS_KNOWN_HOSTS`. The dedicated `apnadesign-deploy` account's Ed25519 key is restricted to the root-owned `/usr/local/bin/apnadesign-receive` command; SSH forwarding and PTY access are disabled. The receiver accepts only a full commit SHA and invokes `/usr/local/sbin/apnadesign-deploy` through a narrowly scoped sudo rule. The helper scripts are installed by the administrator, not automatically replaced from incoming source. Server host-key verification is pinned to the host key collected through the existing trusted SSH connection. The GitHub PAT used to configure this setup is not stored in Actions and can be revoked afterward.

Actions streams a `git archive` of the commit to the receiver. The installed helper extracts it as the unprivileged application account into a new release folder, installs locked dependencies, tests, and builds with the existing server environment. It then switches the release symlink and restarts the app. `/api/health` must return the expected commit SHA, both locally on the VPS and over public HTTPS. Activation failures restore the previous release and its runtime revision. Build failures leave the current app running. A successful deployment briefly restarts the collaboration server; browser clients reconnect afterward.

The two newest Actions releases and the rollback target are retained. Initial/manual releases, Supabase data, authentication configuration, Caddy, and domain DNS are not modified by deployment. Use the Actions page to follow runs or select **Run workflow** on `main` to redeploy. Systemd reads the deployed commit from `/etc/apnadesign/release` through an optional environment file. `REVISION` in each Actions release records the same commit.

For another VPS, install `apnadesign-deploy` and `apnadesign-receive` as root-owned executable files at the paths above, create the restricted deploy account and sudo rule, install the service unit, and configure that environment's four secrets. Do not give the Actions key a general root shell. To rotate access, add a fresh public key to that account's authorized keys, replace `VPS_SSH_KEY`, verify a deployment, and remove the old public key.
