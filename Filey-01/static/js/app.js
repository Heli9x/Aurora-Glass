const pageMeta = {
    home: { title: 'Home', eyebrow: 'Personal library', empty: 'No files uploaded yet...' },
    movies: { title: 'Movies', eyebrow: 'Video library', empty: 'Sorry, no videos found...' },
    music: { title: 'Music', eyebrow: 'Audio library', empty: 'Sorry, no music found...' },
    photos: { title: 'Photos', eyebrow: 'Image library', empty: 'Sorry, no photos found...' }
};
const pages = ['home', 'movies', 'music', 'photos', 'info', 'settings'];
const PER_PAGE = 24;
const PREFS_KEY = 'filey.prefs';
let PLATFORM_NAME = 'Filey';
const state = {
    files: [],
    total: 0,
    pageNumber: 1,
    perPage: PER_PAGE,
    page: 'home',
    sort: 'default',
    listView: false,
    storageDir: '',
    candidates: [],
    stats: null
};

const renameDialog = new RenameDialog({ onRenamed });
const media = new MediaPlayer({ onDownload: downloadFile });
const upload = new Upload({ onUploaded });
const contextMenu = new ContextMenu();
const pagination = new Pagination();
const guide = new Guide();
const settings = new Settings();

const gallery = new Gallery({ title: 'Home', eyebrow: pageMeta.home.eyebrow });
gallery.render('library-container');
pagination.mount(gallery.footer);
gallery.setSortHandler((value) => {
    state.sort = value;
    state.pageNumber = 1;
    loadPage();
});
gallery.setViewHandler(() => {
    state.listView = gallery.listView;
    renderFiles();
});
pagination.onNavigate((delta) => {
    const next = state.pageNumber + delta;
    if (next < 1 || next > totalPages()) return;
    state.pageNumber = next;
    loadPage();
});

const navbar = new NavBar({
    logo: ['Filey', 'ri-folder-6-fill', '#home'],
    links: {
        Home: ['ri-home-line', '#home'],
        Movies: ['ri-video-line', '#movies'],
        Music: ['ri-disc-line', '#music'],
        Photos: ['ri-image-line', '#photos'],
        Info: ['ri-question-line', '#info'],
        Settings: ['ri-settings-3-line', '#settings']
    },
    actions: {
        'Upload': [() => upload.open(), 'ri-upload-cloud-2-line'],
        'Clean library': [cleanLibrary, 'ri-brush-3-fill'],
        'Stop all conversions': [stopHls, 'ri-stop-circle-line', ['danger-action']]
    }
}, true);
navbar.render('navbar');

settings.onSaveName = async (name) => {
    const response = await saveSettings({ name });
    if (!response) return;
    if (!response.ok){
        const data = await response.json().catch(() => ({}));
        settings.setNameStatus(data.error || 'Could not save platform name', 'error');
        return;
    }
    const result = await response.json();
    PLATFORM_NAME = result.platform_name || PLATFORM_NAME;
    applyBrand();
    settings.setNameStatus('Platform name updated');
    notify.show('Platform name updated');
};

settings.onSaveStorage = async (dir, name) => {
    const response = await saveSettings({ storage_dir: dir, name });
    if (!response) return;
    if (!response.ok){
        const data = await response.json().catch(() => ({}));
        settings.setStorageStatus(data.error || 'Could not save storage', 'error');
        return;
    }
    const result = await response.json();
    if (result.platform_name) PLATFORM_NAME = result.platform_name;
    applyBrand();
    settings.setStorageStatus(result.requires_restart
        ? 'Storage saved — restart the server to apply.'
        : 'Storage updated');
    notify.show(result.requires_restart ? 'Storage saved. Restart to apply.' : 'Storage updated');
};

settings.onPrefsChange = (prefs) => applyPrefs(prefs, true);

const pageCache = new Map();
let fetchToken = 0;

function currentType(){
    return state.page === 'home' || state.page === 'info' || state.page === 'settings' ? '' : state.page;
}

function pageKey(){
    return `${currentType()}|${state.sort}|${state.perPage}|${state.pageNumber}`;
}

function totalPages(){
    return Math.max(1, Math.ceil(state.total / state.perPage));
}

async function loadPage(force = false){
    const key = pageKey();
    if (!force && pageCache.has(key)){
        applyPage(pageCache.get(key));
        return;
    }
    const params = new URLSearchParams({
        page: String(state.pageNumber),
        per_page: String(state.perPage),
        sort: state.sort
    });
    const type = currentType();
    if (type) params.set('type', type);
    const token = ++fetchToken;
    try {
        const response = await fetch(`${API_BASE}/files?${params}`);
        if (!response.ok) return;
        const result = await response.json();
        if (token !== fetchToken) return;
        if (Array.isArray(result.files) && result.files.length === 0
            && Number.isFinite(result.total) && result.total > 0
            && state.pageNumber > 1){
            state.pageNumber = Math.max(1, Math.ceil(result.total / result.per_page));
            return loadPage(true);
        }
        pageCache.set(key, result);
        applyPage(result);
    } catch {
        notify.show(`${PLATFORM_NAME} backend is unavailable`);
        renderPage();
    }
}

function applyPage(result){
    state.files = Array.isArray(result.files) ? result.files : [];
    state.total = Number.isFinite(result.total) ? result.total : state.total;
    renderPage();
}

function reload(){
    pageCache.clear();
    loadPage(true);
}

function fileThumb(file){
    if (file.type !== 'photos') return '';
    return typeof file.id === 'string' ? `${API_BASE}/files/${file.id}/thumbnail` : '';
}

function renderFiles(){
    const meta = pageMeta[state.page];
    const files = state.page === 'home'
        ? state.files
        : state.files.filter((file) => file.type === state.page);
    gallery.setSortValue(state.sort);
    gallery.clear();
    files.forEach((file) => {
        gallery.addCard({
            id: file.id,
            kind: file.type,
            icon: file.icon,
            imgSrc: fileThumb(file),
            title: file.name,
            tags: file.size ? [file.size] : [],
            btnText: file.action,
            onOpen: () => openMedia(file),
            onContext: (event) => showContextMenu(file, event)
        });
    });
    gallery.showEmpty(files.length === 0, meta?.empty || 'No information');
    gallery.setFooterHidden(false);
    pagination.setPage(state.pageNumber, totalPages());
}

function renderInfo(){
    gallery.resetGrid();
    gallery.clear();
    gallery.content.classList.add('list-view', 'full-width');
    gallery.showEmpty(false);
    gallery.setSortValue(state.sort);
    guide.render(buildGuideSections(), gallery.content);
    if (state.stats) guide.applyStats(flattenStats(state.stats), formatStat);
    loadStats();
}

function renderSettings(){
    gallery.resetGrid();
    gallery.clear();
    gallery.content.classList.add('list-view', 'full-width');
    gallery.showEmpty(false);
    gallery.setSortValue(state.sort);
    settings.render(gallery.content);
    settings.setData({
        platform_name: PLATFORM_NAME,
        storage_dir: state.storageDir,
        candidates: state.candidates
    });
    settings.setPrefs({
        sort: state.sort,
        perPage: state.perPage,
        view: state.listView ? 'list' : 'grid'
    });
}

function renderPage(){
    const meta = pageMeta[state.page];
    const isInfo = state.page === 'info';
    const isSettings = state.page === 'settings';
    const metaTitle = meta?.title || (isSettings ? 'Settings' : 'Info');
    const metaEyebrow = meta?.eyebrow || (isSettings ? PLATFORM_NAME : `About ${PLATFORM_NAME}`);
    gallery.setMeta({
        title: metaTitle,
        eyebrow: metaEyebrow
    });
    gallery.setActionsHidden(isInfo || isSettings);
    gallery.setFooterHidden(isInfo || isSettings);
    gallery.setSortValue(state.sort);
    gallery.listView = state.listView;
    navbar.setActive(state.page);
    if (isInfo){
        renderInfo();
    } else if (isSettings){
        renderSettings();
    } else {
        gallery.resetGrid();
        renderFiles();
    }
}

function openMedia(file){
    media.open(file);
}

function downloadFile(file){
    if (typeof file.id === 'string'){
        const link = document.createElement('a');
        link.href = `${API_BASE}/files/${file.id}/download`;
        link.download = file.originalName || file.name;
        link.click();
        notify.show('Download started');
        return;
    }
    notify.show('Download is unavailable without the Filey backend');
}

function showContextMenu(file, event){
    const primary = file.action;
    contextMenu.open(event.clientX, event.clientY, [
        { icon: 'ri-play-fill', label: primary, onClick: () => openMedia(file) },
        { icon: 'ri-download-2-line', label: 'Download', onClick: () => downloadFile(file) },
        { icon: 'ri-edit-box-line', label: 'Rename', onClick: () => renameDialog.open(file) },
        { icon: 'ri-delete-bin-3-line', label: 'Delete', onClick: () => removeFile(file) }
    ]);
}

async function removeFile(file){
    if (typeof file.id === 'string'){
        try { await fetch(`${API_BASE}/files/${file.id}`, { method: 'DELETE' }); } catch { /* Keep local state usable when offline. */ }
    }
    state.files = state.files.filter((item) => item.id !== file.id);
    reload();
    notify.show(`${file.name} removed`);
}

function onRenamed(file, name){
    file.name = name;
    reload();
    notify.show('File renamed');
}

function onUploaded(record){
    state.files.unshift(record);
    state.pageNumber = 1;
    reload();
    notify.show(`File uploaded to ${PLATFORM_NAME} storage`);
}

async function cleanLibrary(){
    try {
        const [cleanupResponse, cacheResponse] = await Promise.all([
            fetch(`${API_BASE}/clean`, { method: 'POST' }),
            fetch(`${API_BASE}/hls/clear`, { method: 'POST' })
        ]);
        const result = await cleanupResponse.json();
        notify.show(result.success && cacheResponse.ok ? 'Library and HLS cache cleared' : 'Cleanup failed');
        if (result.success) reload();
    } catch {
        notify.show('Local library cleanup complete');
    }
}

async function stopHls(){
    media.stopAll();
    try {
        const response = await fetch(`${API_BASE}/hls/cancel`, { method: 'POST' });
        const result = await response.json();
        notify.show(result.stopped
            ? `Stopped ${result.stopped} HLS conversion${result.stopped === 1 ? '' : 's'}`
            : 'No HLS conversions running');
    } catch {
        notify.show('Unable to stop HLS conversions');
    }
}

function applyBrand(){
    document.title = PLATFORM_NAME;
    navbar.setBrand(PLATFORM_NAME);
}

async function loadSettings(){
    try {
        const response = await fetch(`${API_BASE}/settings`);
        if (!response.ok) return;
        const result = await response.json();
        if (typeof result.platform_name === 'string' && result.platform_name){
            PLATFORM_NAME = result.platform_name;
        }
        state.storageDir = typeof result.storage_dir === 'string' ? result.storage_dir : '';
        state.candidates = Array.isArray(result.candidates) ? result.candidates : [];
    } catch {
        return;
    }
    applyBrand();
    renderPage();
}

function saveSettings(payload){
    return fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(() => {
        notify.show('Settings failed to save');
        return null;
    });
}

function loadPrefs(){
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) return JSON.parse(raw) || {};
    } catch {
        return {};
    }
    return {};
}

function applyPrefs(prefs = {}, persist = false){
    if (typeof prefs.sort === 'string' && prefs.sort !== state.sort){
        state.sort = prefs.sort;
    }
    if (Number.isFinite(prefs.perPage) && prefs.perPage !== state.perPage){
        state.perPage = Math.min(96, Math.max(1, Math.floor(prefs.perPage)));
        pageCache.clear();
        state.pageNumber = 1;
    }
    if (prefs.view !== undefined) state.listView = prefs.view === 'list';
    if (persist){
        localStorage.setItem(PREFS_KEY, JSON.stringify({
            sort: state.sort,
            perPage: state.perPage,
            view: state.listView ? 'list' : 'grid'
        }));
    }
    if (state.page === 'settings' || state.page === 'info'){
        renderPage();
    } else {
        gallery.listView = state.listView;
        renderFiles();
        loadPage();
    }
}

function buildGuideSections(){
    return [
        {
            icon: 'ri-rocket-line',
            title: 'Get started',
            body: [
                { icon: 'ri-folder-6-fill', title: 'What is this?', text: `${PLATFORM_NAME} is a personal media library. Files are grouped into Movies, Music, Photos, and Other on your connected storage.` },
                { icon: 'ri-upload-cloud-2-line', title: 'Add files', text: 'Use Upload in the top bar and drop files. The category and icon are detected automatically from the file type.' },
                { icon: 'ri-settings-3-line', title: 'Customize', text: 'Open Settings in the top bar to rename the platform or change its storage directory.' }
            ]
        },
        {
            icon: 'ri-play-circle-line',
            title: 'Play media',
            body: [
                { icon: 'ri-play-fill', title: 'Play / View / Open', text: "Each card's button matches the file type: Play for movies and music, View for photos, Open for other files." },
                { icon: 'ri-video-line', title: 'Why conversion?', text: 'Common formats play instantly. For formats the browser cannot decode (e.g. MKV), the server converts on demand (HLS) and streams it. You may see "Preparing full playback conversion" once.' },
                { icon: 'ri-stop-circle-line', title: 'Pause and stop', text: 'Use Stop all conversions in the top bar to cancel any running conversions. Partial conversions are cached for reuse.' }
            ]
        },
        {
            icon: 'ri-file-list-3-line',
            title: 'Manage files',
            body: [
                { icon: 'ri-more-2-fill', title: 'File menu', text: 'Use the "more" button on any card for Download, Rename, Delete, or to open the file again.' },
                { icon: 'ri-brush-3-fill', title: 'Clean library', text: 'Cleans up records of missing files and regenerated caches (thumbnails, HLS segments).' },
                { icon: 'ri-delete-bin-3-line', title: 'Delete', text: 'Removes the file from storage. Deletions are permanent.' }
            ]
        },
        {
            icon: 'ri-sort-desc',
            title: 'Browse and sort',
            body: [
                { icon: 'ri-sort-desc', title: 'Sorting', text: 'Use the sort menu to order by recent, oldest, name (A-Z / Z-A), size, or media type.' },
                { icon: 'ri-layout-grid-line', title: 'Views', text: 'Toggle between grid and list view with the view button. Pagination uses Prev / Next below the gallery.' },
                { icon: 'ri-hourglass-line', title: 'Paging', text: 'The gallery shows one page at a time; already-viewed pages are cached so going back is instant.' }
            ]
        },
        {
            icon: 'ri-hard-drive-3-line',
            title: 'Storage',
            body: [
                { icon: 'ri-folder-open-line', title: 'Library location', text: state.storageDir || 'Reading storage details...' },
                { icon: 'ri-film-line', title: 'Files', text: '', stat: 'total' },
                { icon: 'ri-movie-2-line', title: 'Movies', text: '', stat: 'count.movies' },
                { icon: 'ri-music-2-line', title: 'Music', text: '', stat: 'count.music' },
                { icon: 'ri-image-2-line', title: 'Photos', text: '', stat: 'count.photos' },
                { icon: 'ri-file-3-line', title: 'Other', text: '', stat: 'count.other' },
                { icon: 'ri-database-2-line', title: 'HLS cache', text: '', stat: 'hls.bytes' },
                { icon: 'ri-drive-line', title: 'Free space', text: '', stat: 'storage.free' }
            ]
        },
        {
            icon: 'ri-question-line',
            title: 'About',
            body: [
                { icon: 'ri-service-line', title: 'Platform', text: PLATFORM_NAME },
                { icon: 'ri-command-line', title: 'API version', text: '1.0' },
                { icon: 'ri-link', title: 'Endpoints', text: '/api/health, /api/discovery, /api/files, /api/settings, /api/stats' },
                { icon: 'ri-settings-3-line', title: 'Customize', text: 'Open the Settings page to adjust the name, storage, and your defaults.' }
            ]
        }
    ];
}

function flattenStats(stats){
    return {
        total: stats.total,
        'count.movies': stats.counts ? stats.counts.movies : 0,
        'count.music': stats.counts ? stats.counts.music : 0,
        'count.photos': stats.counts ? stats.counts.photos : 0,
        'count.other': stats.counts ? stats.counts.other : 0,
        'hls.bytes': stats.hls_cache ? stats.hls_cache.bytes : 0,
        'photo.bytes': stats.photo_cache ? stats.photo_cache.bytes : 0,
        'storage.free': stats.storage ? stats.storage.free : 0
    };
}

function formatBytes(bytes){
    if (!Number.isFinite(bytes) || bytes < 0) return '…';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatStat(value, key){
    if (key === 'hls.bytes' || key === 'photo.bytes' || key === 'storage.free'){
        return formatBytes(value);
    }
    return String(value);
}

async function loadStats(){
    try {
        const response = await fetch(`${API_BASE}/stats`);
        if (!response.ok) return;
        const result = await response.json();
        state.stats = result;
        if (state.page === 'info') guide.applyStats(flattenStats(result), formatStat);
    } catch {
        return;
    }
}

const initialPage = location.hash.slice(1).toLowerCase();
state.page = pages.includes(initialPage) ? initialPage : 'home';

const savedPrefs = loadPrefs();
if (typeof savedPrefs.sort === 'string') state.sort = savedPrefs.sort;
if (Number.isFinite(savedPrefs.perPage)){
    state.perPage = Math.min(96, Math.max(1, Math.floor(savedPrefs.perPage)));
}
if (savedPrefs.view === 'list') state.listView = true;

window.addEventListener('hashchange', () => {
    const page = location.hash.slice(1).toLowerCase();
    state.page = pages.includes(page) ? page : 'home';
    state.pageNumber = 1;
    loadPage();
});

loadSettings();
renderPage();
loadPage();