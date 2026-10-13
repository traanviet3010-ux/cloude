# HieuSRO — VPS operations handover

Repository: `traanviet3010-ux/cloude`  
Deployment branch: `hieusro-digitalocean`  
VPS: DigitalOcean `hieusro-sg`, `143.198.217.75`, Ubuntu 24.04  
App directory: `/opt/hieusro/src`  
Site: https://play.143-198-217-75.sslip.io/

## Current objective
Keep LIVE data intact. Transition to TEST-only **after** confirming TEST readiness. Optimize iPhone asset loading and investigate unexpected reloads. Do not claim any server change is complete without live checks.

## Secure remote management

This proposal adds a **manual** workflow, `.github/workflows/hieusro-vps-ops.yml`, on a review branch. It is not active until merged and configured.

1. Create a dedicated, unprivileged `hieusro-ops` Linux account on the VPS, with a unique Ed25519 public key in `~hieusro-ops/.ssh/authorized_keys`. Do not use the root account or share private keys in chat.
2. Install and root-own `/usr/local/sbin/hieusro-ops` (mode 0755). Restrict `sudoers` to only the commands actually needed; do not grant general sudo or shell access.
3. The wrapper must accept exactly `status`, `test-health`, or `deploy`; reject other arguments. `deploy` must use the pinned branch, preserve LIVE state, make a backup, and verify TEST health. Do not enable deploy until tested.
4. In GitHub Settings → Environments, create `hieusro-vps` with required reviewers. Store `HIEUSRO_VPS_SSH_KEY` and `HIEUSRO_VPS_HOST_KEY` as **environment secrets**, not in repository files. The host key must be verified against the VPS console, never blindly accepted via ssh-keyscan.
5. Run the `status` operation first, then `test-health`. Only after these pass should deploy be enabled and explicitly approved.
6. For new ChatGPT conversations, connect GitHub and DigitalOcean, reference this file, verify what operations the connected tools support, and report any access limitations honestly.

**Important:** GitHub connector access does not itself imply the ability to dispatch GitHub Actions. The available connector may only read workflow runs. Never claim SSH is connected until a workflow executes successfully.

## Prior insecure relay
The older `digitalocean-ssh-relay.yml` published temporary public keys and accepted an encrypted SSH key through a branch file; it also disabled host-key verification. Do not reuse this mechanism. Disable or remove it after reviewing existing runs and permissions.

## Security rules
Never commit or paste credentials. No arbitrary command workflow input. No automatic deployment on every commit. Preserve backups and databases. Treat TEST-only and asset optimizations as pending until deployed and verified.
