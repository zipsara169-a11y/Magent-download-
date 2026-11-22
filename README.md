# MAGNETX 2.0 — Browser Edition

A mobile-friendly browser torrent client UI powered by WebTorrent. It runs entirely in the visitor's browser; it does not upload downloaded files to a MAGNETX server.

## Important browser limitation

A browser WebTorrent client uses WebRTC data channels. It cannot connect directly to ordinary BitTorrent peers that only offer TCP/UDP. A torrent must have WebRTC-capable peers (for example WebTorrent Desktop, webtorrent-hybrid, or another compatible client), or a compatible web seed. Therefore no browser-only application can guarantee that every magnet link will work.

## Browser tracker handling

- Keeps `ws://` / `wss://` tracker entries supplied by the magnet URI.
- Adds the public WebTorrent WebSocket trackers documented by WebTorrent: `tracker.btorrent.xyz`, `tracker.fastcast.nz`, and `tracker.openwebtorrent.com`.
- Does not try UDP trackers from the browser; those cannot be used by browser WebTorrent.
- Shows tracker/peer warnings and reports a connection timeout if metadata does not arrive.

Tracker availability can change. A failed tracker does not necessarily mean all trackers failed or that the magnet is invalid.

## Deploy from Android (no PC)

### Vercel

1. Download/extract this ZIP on your phone if needed.
2. Upload the project folder to a GitHub repository, keeping `package.json`, `index.html`, `vite.config.js`, and `src/` at the repository root.
3. In Vercel, import that GitHub repository.
4. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
5. Deploy. Future updates can be uploaded to GitHub from the browser; Vercel will redeploy.

If using Vercel's ZIP/drop flow, upload the project contents as the project root, not a ZIP nested inside another folder.

## Local development

```bash
npm install
npm run dev
```

## Notes

- The WebTorrent browser bundle is loaded from the official `esm.sh` distribution at runtime, so an internet connection is required to initialize the engine.
- Large downloads may require substantial browser memory because files are assembled as browser Blobs before saving. Keep the tab open until the browser download starts.
- Use only torrents you are legally entitled to download and share.
