# Haven 1.0.1 — Patch Release

**Status: full release, validated on physical hardware (P09B / J4125).** This patch resolves the
confirmed defects from the live UI audit and a set of shared-component consistency improvements.
It is a UI-only patch on top of 1.0.0 — no router behaviour, permissions, rollback or signature
validation was changed.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`IMAGE_HASH_PLACEHOLDER`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`ISO_HASH_PLACEHOLDER`
(`MoCI-x86-64-Installer.iso`)

## Fixes
- **Devices → Permissions** now opens (it previously threw a `vendorForMac` ReferenceError). The
  dialog is accessible: labelled, focus-trapped, Escape to close, focus returned to the row.
- **System → Software** loads its toolbar and package list (previously stranded on "Loading" from a
  DOM `insertBefore` error). Errors now offer Retry.
- **Published Ports / DNS publishing** address fields use the shared styled input with a visible
  label and a responsive layout (previously tiny unstyled native inputs).
- **Dashboard throughput graph**: the "Mbps" unit no longer collides with the top Y-axis tick.
- **Network QoS**: an absent/empty classification config is shown as a valid empty state, distinct
  from a failed request (which offers Retry).
- **Diagnostics → Connected clients** now renders (it previously targeted a non-existent table and
  loaded forever); lease times are readable and errors are surfaced.

## Consistency
- Two-line device identity (name over MAC), spaced row actions, and device search.
- Neutral "Off" for intentionally disabled features; red reserved for unexpected failures.
- Docker: persistent selected tool, specific per-view empty states, Storage sizes formatted (KiB/MiB/GiB).
- Bounded System form widths; add-on assets are now cache-busted and the Docker manifest version aligned.

## Installing / upgrading
Same artifacts as 1.0.0: a signed firmware image and a guided dual-boot installer ISO. To upgrade an
existing Haven router, upload the image (`.img.gz`) and its `.sig` on **System → Firmware Upgrade**;
Haven verifies the signature, runs `sysupgrade --test`, then flashes after confirmation. Configuration
is preserved. See the [1.0.0 notes](RELEASE-1.0.0.md) for full install and verification instructions.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident Docker
> app data. Back up app data first, or upgrade empty-app systems.

## Verification
- All 11 frontend test suites pass, including a new behavioral regression suite covering the six fixes.
- Deployed and verified on the P09B: Permissions opens, Software loads, address fields styled, graph
  unit/tick separated, QoS and Diagnostics resolve; internet, Wi-Fi and LAN confirmed unchanged.

## Security posture
Unchanged from 1.0.0: firewall4/nftables stays; UPnP, delegated ports and DNS publishing remain opt-in;
add-ons off by default; no Docker socket exposure; secrets never exposed to the browser.