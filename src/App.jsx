import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, Check, CheckCircle2, ChevronDown, CircleHelp,
  Clipboard, Clock3, Download, File, FileArchive, FileAudio, FileImage,
  FileText, FileVideo, FolderOpen, HardDrive, History, Link2, LoaderCircle,
  Magnet, Menu, Pause, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck,
  Trash2, Upload, X, Zap
} from 'lucide-react';

const fmtBytes = (n = 0) => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};
const fmtTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds === Infinity) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};
// Public WebTorrent trackers use WebSocket/WebRTC-compatible transport.
// UDP/TCP trackers are deliberately not passed to a browser client.
const DEFAULT_WEBRTC_TRACKERS = [
  // Public WebSocket trackers for browser/WebRTC peers.
  // Tracker availability can change; failures are non-fatal.
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce'
];

const getBrowserTrackers = (magnetUri) => {
  try {
    const query = magnetUri.slice(magnetUri.indexOf('?') + 1);
    const params = new URLSearchParams(query);
    const supplied = params.getAll('tr').filter(url => /^wss?:\/\//i.test(url));
    return [...new Set([...supplied, ...DEFAULT_WEBRTC_TRACKERS])];
  } catch {
    return DEFAULT_WEBRTC_TRACKERS;
  }
};

const fileIcon = (name) => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['mp4','mkv','mov','avi','webm'].includes(ext)) return FileVideo;
  if (['mp3','wav','flac','m4a','ogg'].includes(ext)) return FileAudio;
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return FileImage;
  if (['zip','rar','7z','tar','gz'].includes(ext)) return FileArchive;
  if (['txt','pdf','doc','docx','srt'].includes(ext)) return FileText;
  return File;
};

export default function App() {
  const clientRef = useRef(null);
  const torrentRef = useRef(null);
  const intervalRef = useRef(null);
  const connectTimeoutRef = useRef(null);
  const [magnet, setMagnet] = useState('');
  const [torrent, setTorrent] = useState(null);
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('magnetx-history') || '[]'); } catch { return []; }
  });
  const [activeTab, setActiveTab] = useState('downloader');
  const [showHelp, setShowHelp] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [stats, setStats] = useState({ progress: 0, speed: 0, peers: 0, downloaded: 0, total: 0, timeRemaining: Infinity, ratio: 0 });
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  useEffect(() => {
    let active = true;
    const loadBrowserEngine = () => new Promise((resolve, reject) => {
      // Use WebTorrent's documented browser UMD bundle. Loading the npm
      // package through Vite can pull Node-only modules into the browser build.
      if (typeof window.WebTorrent === 'function') return resolve(window.WebTorrent);
      const existing = document.querySelector('script[data-magnetx-webtorrent]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.WebTorrent), { once: true });
        existing.addEventListener('error', () => reject(new Error('WebTorrent CDN script failed to load.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js';
      script.async = true;
      script.dataset.magnetxWebtorrent = 'true';
      script.onload = () => typeof window.WebTorrent === 'function'
        ? resolve(window.WebTorrent)
        : reject(new Error('WebTorrent browser bundle loaded but its API was not found.'));
      script.onerror = () => reject(new Error('Could not load WebTorrent from jsDelivr. Check your connection or CDN access.'));
      document.head.appendChild(script);
    });
    loadBrowserEngine().then(WebTorrentBrowser => {
      if (!active) return;
      if (typeof WebTorrentBrowser.WEBRTC_SUPPORT === 'boolean' && !WebTorrentBrowser.WEBRTC_SUPPORT) {
        throw new Error('This browser does not support WebRTC data channels.');
      }
      clientRef.current = new WebTorrentBrowser();
      setEngineReady(true);
      setError('');
    }).catch(e => {
      if (active) setError(`WebTorrent could not start: ${e.message}. Open MAGNETX in a current browser over HTTPS and reload.`);
    });
    return () => {
      active = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      clientRef.current?.destroy(() => {});
    };
  }, []);

  useEffect(() => { localStorage.setItem('magnetx-history', JSON.stringify(history.slice(0, 30))); }, [history]);

  const filteredFiles = useMemo(() => files.filter(f => f.name.toLowerCase().includes(filter.toLowerCase())), [files, filter]);
  const progressLabel = `${Math.min(100, stats.progress).toFixed(1)}%`;

  const addHistory = (item) => setHistory(prev => [{ ...item, date: new Date().toISOString() }, ...prev.filter(x => x.infoHash !== item.infoHash)].slice(0, 30));

  const startTorrent = () => {
    const value = magnet.trim();
    if (!value) { setError('Paste a magnet link to continue.'); return; }
    if (!/^magnet:\?/i.test(value)) { setError('This does not look like a valid magnet URI.'); return; }
    if (!clientRef.current || !engineReady) { setError('Torrent engine is still loading. Please wait a moment and try again.'); return; }
    if (torrentRef.current) {
      try { torrentRef.current.destroy({ destroyStore: true }); } catch {}
      torrentRef.current = null;
    }
    setError(''); setNotice('Connecting to WebRTC peers…'); setFiles([]); setSelected({});
    setTorrent(null); setStatus('connecting'); setStats({ progress: 0, speed: 0, peers: 0, downloaded: 0, total: 0, timeRemaining: Infinity, ratio: 0 });
    try {
      const browserTrackers = getBrowserTrackers(value);
      const udpTrackerCount = (value.match(/[?&]tr=udp%3A|[?&]tr=udp:/gi) || []).length;
      if (udpTrackerCount) setNotice(`Browser mode: skipped ${udpTrackerCount} UDP tracker entr${udpTrackerCount === 1 ? 'y' : 'ies'}. Trying WebSocket trackers and WebRTC peers.`);
      const added = clientRef.current.add(value, { announce: browserTrackers }, t => {
        if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
        torrentRef.current = t;
        setTorrent({ name: t.name || 'Magnet download', infoHash: t.infoHash, magnetURI: t.magnetURI });
        const initial = t.files.map((f, i) => ({ id: i, name: f.name, length: f.length, selected: true, progress: 0 }));
        setFiles(initial); setSelected(Object.fromEntries(initial.map(f => [f.id, true])));
        setStatus('downloading'); setNotice('Torrent metadata received. Select files and start downloading.');
        addHistory({ name: t.name || 'Magnet download', infoHash: t.infoHash, magnetURI: t.magnetURI, state: 'Added' });
        t.on('done', () => { setStatus('completed'); setNotice('Torrent download completed.'); });
      });
      torrentRef.current = added;
      added.on('warning', e => {
        // A single dead tracker must not be treated as a fatal torrent error.
        // WebTorrent continues discovery through any remaining trackers/peers.
        const message = e?.message || String(e);
        setNotice(`Tracker warning (continuing with other sources): ${message}`);
      });
      added.on('error', e => { setError(e.message || 'Torrent error'); setStatus('error'); });
      connectTimeoutRef.current = setTimeout(() => {
        if (!torrentRef.current || !torrentRef.current.files?.length) {
          const peerCount = torrentRef.current?.numPeers || 0;
          setError(peerCount > 0
            ? `Found ${peerCount} peer(s), but torrent metadata has not arrived. This swarm may not have WebRTC-capable peers.`
            : 'No WebRTC peers or metadata received after 60 seconds. This magnet may have no browser-compatible peers, or its WebSocket trackers may be unreachable. Try another magnet that includes WebRTC peers.' );
          setStatus('error');
        }
      }, 60000);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        const t = torrentRef.current;
        if (!t) return;
        const torrentFiles = t.files || [];
        if (torrentFiles.length) {
          const nextFiles = torrentFiles.map((f, i) => ({ id: i, name: f.name, length: f.length, selected: !!selected[i], progress: f.progress || 0 }));
          setFiles(prev => nextFiles.map((f, i) => ({ ...f, selected: prev[i]?.selected ?? true })));
        }
        setStats({ progress: (t.progress || 0) * 100, speed: t.downloadSpeed || 0, peers: t.numPeers || 0, downloaded: t.downloaded || 0, total: t.length || 0, timeRemaining: t.timeRemaining, ratio: t.ratio || 0 });
      }, 1000);
    } catch (e) { setError(e.message || 'Unable to add this magnet link.'); setStatus('error'); }
  };

  const toggleFile = (id) => {
    const t = torrentRef.current; const f = t?.files[id]; if (!f) return;
    const next = !selected[id];
    setSelected(prev => ({ ...prev, [id]: next }));
    setFiles(prev => prev.map(x => x.id === id ? { ...x, selected: next } : x));
    try { next ? f.select() : f.deselect(); } catch {}
  };

  const pauseTorrent = () => {
    try { torrentRef.current?.pause(); setStatus('paused'); setNotice('Download paused.'); } catch (e) { setError(e.message); }
  };
  const resumeTorrent = () => {
    try { torrentRef.current?.resume(); setStatus('downloading'); setNotice('Download resumed.'); } catch (e) { setError(e.message); }
  };
  const stopTorrent = () => {
    if (torrentRef.current) { try { torrentRef.current.destroy({ destroyStore: true }); } catch {} }
    torrentRef.current = null; setTorrent(null); setFiles([]); setStatus('idle'); setStats({ progress: 0, speed: 0, peers: 0, downloaded: 0, total: 0, timeRemaining: Infinity, ratio: 0 }); setNotice('Torrent removed from this session.');
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
  };

  const downloadFile = async (file, index) => {
    const f = torrentRef.current?.files[index]; if (!f) return;
    setBusy(true); setError(''); setNotice(`Preparing ${file.name}…`);
    try {
      // WebTorrent assembles the selected file as a Blob in browser memory.
      const blob = await new Promise((resolve, reject) => f.getBlob((err, result) => err ? reject(err) : resolve(result)));
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = file.name.split('/').pop() || 'download'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(`Browser download started: ${file.name}`);
    } catch (e) { setError(`Could not prepare file: ${e.message}. Keep the tab open and try again.`); }
    finally { setBusy(false); }
  };

  const copyMagnet = async () => {
    if (!torrent?.magnetURI) return;
    try { await navigator.clipboard.writeText(torrent.magnetURI); setNotice('Magnet link copied.'); }
    catch { setNotice('Clipboard access is blocked by this browser.'); }
  };
  const restoreHistory = (item) => { setMagnet(item.magnetURI); setActiveTab('downloader'); setNotice('Magnet link loaded from history. Press Add Magnet to start.'); };
  const clearHistory = () => { setHistory([]); setNotice('Download history cleared.'); };

  return <div className="app-shell">
    <aside className={`sidebar ${showMobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Magnet size={22}/></div><div><b>MAGNET<span>X</span></b><small>BROWSER DOWNLOADER</small></div><button className="mobile-close icon-btn" onClick={() => setShowMobileNav(false)}><X size={18}/></button></div>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${activeTab === 'downloader' ? 'active' : ''}`} onClick={() => {setActiveTab('downloader');setShowMobileNav(false)}}><Download size={18}/> Downloader <span className="nav-dot"/></button>
      <button className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => {setActiveTab('history');setShowMobileNav(false)}}><History size={18}/> History <span className="nav-count">{history.length}</span></button>
      <div className="side-label tools-label">TOOLS</div>
      <button className="nav-item" onClick={() => setShowHelp(true)}><CircleHelp size={18}/> How it works</button>
      <div className="sidebar-bottom"><div className="secure-card"><div className="secure-icon"><ShieldCheck size={18}/></div><b>Browser-first privacy</b><p>Files are downloaded by your browser. MAGNETX does not upload them to a server.</p></div><div className="version"><span className="live-dot"/> Engine ready <span>v1.0.0</span></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><button className="icon-btn menu-btn" onClick={() => setShowMobileNav(true)}><Menu size={20}/></button><div className="breadcrumb">Workspace <span>/</span> <b>{activeTab === 'history' ? 'History' : 'Downloader'}</b></div><div className="top-actions"><div className="connection"><span className="live-dot"/> Browser engine</div><button className="icon-btn" title="Help" onClick={() => setShowHelp(true)}><CircleHelp size={19}/></button></div></header>

      <div className="content">
        {activeTab === 'downloader' ? <>
          <section className="page-heading"><div><div className="eyebrow"><Zap size={13}/> TORRENT DOWNLOAD ENGINE</div><h1>Download at the <em>speed</em><br className="desktop-break"/> of your connection.</h1><p>Paste a magnet link, connect to peers, and save files directly to your device.</p></div><div className="heading-orb"><div className="orb-inner"><Magnet size={34}/></div></div></section>

          <section className="input-card"><div className="input-card-head"><div className="input-icon"><Link2 size={18}/></div><div><b>Magnet link</b><small>Paste your magnet URI below to get started</small></div><span className="input-tag">WEBTORRENT</span></div><div className="magnet-input-wrap"><input value={magnet} onChange={e => setMagnet(e.target.value)} onKeyDown={e => e.key === 'Enter' && startTorrent()} placeholder="magnet:?xt=urn:btih:..." aria-label="Magnet link"/><button className="paste-btn" onClick={async () => {try {setMagnet(await navigator.clipboard.readText());setError('');} catch {setError('Clipboard permission denied. Paste the link manually.');}}}><Clipboard size={15}/> Paste</button></div><div className="input-footer"><span><ShieldCheck size={14}/> Your link stays in this browser</span><button className="primary-btn" onClick={startTorrent} disabled={status === 'connecting'}>{status === 'connecting' ? <><LoaderCircle className="spin" size={17}/> Connecting</> : <><Plus size={17}/> Add magnet</>}</button></div></section>

          {(error || notice) && <div className={`message ${error ? 'error' : 'notice'}`}><span>{error ? <X size={16}/> : <CheckCircle2 size={16}/>}</span><p>{error || notice}</p><button onClick={() => {setError('');setNotice('')}}><X size={15}/></button></div>}

          {torrent ? <>
            <section className="torrent-card"><div className="torrent-top"><div className="torrent-file-icon"><FileArchive size={23}/></div><div className="torrent-name"><h2>{torrent.name}</h2><p><span className="hash-label">INFO HASH</span> {torrent.infoHash}</p></div><div className={`status-pill ${status}`}><span/> {status}</div><button className="icon-btn remove-btn" title="Remove torrent" onClick={stopTorrent}><Trash2 size={17}/></button></div>
              <div className="progress-section"><div className="progress-label"><b>Overall progress</b><strong>{progressLabel}</strong></div><div className="progress-track"><div className="progress-fill" style={{width: `${Math.min(100, stats.progress)}%`}}/></div><div className="stats-grid"><div><span><ArrowDownToLine size={14}/> Downloaded</span><b>{fmtBytes(stats.downloaded)} <small>/ {fmtBytes(stats.total)}</small></b></div><div><span><Activity size={14}/> Download speed</span><b>{fmtBytes(stats.speed)}<small>/s</small></b></div><div><span><Zap size={14}/> Connected peers</span><b>{stats.peers}</b></div><div><span><Clock3 size={14}/> Time remaining</span><b>{fmtTime(stats.timeRemaining)}</b></div></div></div>
              <div className="torrent-actions">{status === 'paused' ? <button className="primary-btn" onClick={resumeTorrent}><Play size={16}/> Resume</button> : <button className="secondary-btn" onClick={pauseTorrent} disabled={status === 'completed' || status === 'error'}><Pause size={16}/> Pause</button>}<button className="secondary-btn" onClick={copyMagnet}><Clipboard size={16}/> Copy magnet</button><button className="danger-btn" onClick={stopTorrent}><X size={16}/> Stop</button></div>
            </section>
            <section className="files-card"><div className="section-title"><div><h2>Files in this torrent</h2><p>Select the files you want to save to your device.</p></div><span className="file-count">{files.length} FILES</span></div><div className="file-toolbar"><div className="file-search"><Search size={15}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter files..."/></div><button className="text-btn" onClick={() => {const all = Object.fromEntries(files.map(f => [f.id, true]));setSelected(all);setFiles(prev => prev.map(f => ({...f,selected:true})));torrentRef.current?.files.forEach(f => f.select());}}>Select all</button><button className="text-btn" onClick={() => {setSelected({});setFiles(prev => prev.map(f => ({...f,selected:false})));torrentRef.current?.files.forEach(f => f.deselect());}}>Clear</button></div><div className="file-list">{filteredFiles.map(file => {const Icon = fileIcon(file.name);return <div className="file-row" key={file.id}><label className="file-check"><input type="checkbox" checked={!!selected[file.id]} onChange={() => toggleFile(file.id)}/><span className="checkmark"><Check size={12}/></span></label><div className="file-type"><Icon size={18}/></div><div className="file-info"><b title={file.name}>{file.name.split('/').pop()}</b><small>{file.name.includes('/') ? file.name : 'Torrent file'} · {fmtBytes(file.length)}</small></div><div className="file-progress"><div><span style={{width:`${(file.progress || 0)*100}%`}}/></div><small>{((file.progress || 0)*100).toFixed(0)}%</small></div><button className="download-file-btn" disabled={!selected[file.id] || busy || (file.progress || 0) < 1} onClick={() => downloadFile(file,file.id)} title="Save file"><Download size={16}/></button></div>})}{filteredFiles.length === 0 && <div className="empty-small">No files match your search.</div>}</div><div className="files-footer"><span><ShieldCheck size={14}/> Files are prepared locally in your browser</span><button className="primary-btn" disabled={busy || !files.some(f => selected[f.id] && f.progress >= 1)} onClick={async () => {for (const f of files) if (selected[f.id] && f.progress >= 1) await downloadFile(f,f.id);}}>{busy ? <><LoaderCircle className="spin" size={16}/> Preparing</> : <><Download size={16}/> Download selected</>}</button></div></section>
          </> : <section className="empty-state"><div className="empty-art"><div className="empty-ring ring-one"/><div className="empty-ring ring-two"/><div className="empty-icon"><Magnet size={35}/></div><div className="float-chip chip-one"><ArrowDownToLine size={15}/></div><div className="float-chip chip-two"><Zap size={15}/></div></div><h2>Your next download starts here.</h2><p>Paste a magnet link above. MAGNETX will find the torrent metadata and show you the files available to download.</p><div className="empty-steps"><div><span>01</span><b>Paste magnet</b></div><div><span>02</span><b>Connect to peers</b></div><div><span>03</span><b>Save your files</b></div></div></section>}

          <section className="notice-panel"><div className="notice-icon"><ShieldCheck size={19}/></div><div><b>Built for browser-based transfers</b><p>MAGNETX uses WebTorrent over WebRTC. It keeps WebSocket (wss/ws) trackers from your magnet and adds public WebTorrent trackers. UDP/HTTP trackers cannot provide browser peer connections; traditional TCP/UDP-only peers are not reachable from a browser.</p></div><button onClick={() => setShowHelp(true)} aria-label="More information"><ChevronDown size={17}/></button></section>
        </> : <>
          <section className="page-heading history-heading"><div><div className="eyebrow"><History size={13}/> YOUR ACTIVITY</div><h1>Download <em>history.</em></h1><p>Your recent magnet links are saved locally in this browser.</p></div></section>
          <section className="files-card history-card"><div className="section-title"><div><h2>Recent torrents</h2><p>{history.length} saved entries</p></div><button className="text-btn clear-history" onClick={clearHistory} disabled={!history.length}><Trash2 size={14}/> Clear history</button></div>{history.length ? <div className="history-list">{history.map((item,i)=><div className="history-row" key={`${item.infoHash}-${i}`}><div className="file-type"><Magnet size={18}/></div><div className="file-info"><b>{item.name}</b><small>{item.infoHash} · {new Date(item.date).toLocaleString()}</small></div><span className="history-status">{item.state || 'Added'}</span><button className="secondary-btn small-btn" onClick={() => restoreHistory(item)}><RefreshCw size={14}/> Load</button></div>)}</div> : <div className="history-empty"><History size={28}/><b>No download history yet</b><p>Magnet links you add will appear here.</p><button className="primary-btn" onClick={() => setActiveTab('downloader')}>Go to downloader</button></div>}</section>
        </>}
        <footer className="footer"><span>© 2026 MAGNETX</span><span>Made for the open web <span className="footer-heart">◆</span></span><button onClick={() => setShowHelp(true)}>Help & limitations</button></footer>
      </div>
    </main>
    {showMobileNav && <div className="scrim" onClick={() => setShowMobileNav(false)}/>}
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><div className="help-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div className="input-icon"><CircleHelp size={18}/></div><div><h2>How MAGNETX works</h2><p>A few things to know before downloading.</p></div><button className="icon-btn" onClick={() => setShowHelp(false)}><X size={18}/></button></div><div className="help-content"><div><b>1. Browser peer support</b><p>WebTorrent in a browser communicates with WebRTC peers. The torrent must have WebRTC-capable peers or supported web seeds. Many public torrents have only traditional TCP/UDP peers and will not connect.</p></div><div><b>2. Downloading files</b><p>When a file is complete, MAGNETX creates a browser Blob and triggers a normal browser download. Large files may use significant memory. Keep this tab open until the file has been saved.</p></div><div><b>3. Direct links</b><p>A browser torrent session does not create a permanent public HTTP direct-download URL. Files are saved to your device through your browser.</p></div><div><b>4. Privacy and rights</b><p>Transfers run in your browser; this app does not provide a hosted storage server. Only download and share content you have the right to access.</p></div><div className="help-tip"><ShieldCheck size={17}/><span>Tip: Use a current Chrome, Edge, or Firefox browser over HTTPS for the best WebRTC compatibility.</span></div></div><button className="primary-btn modal-done" onClick={() => setShowHelp(false)}>Got it</button></div></div>}
  </div>;
}
