const pageMeta = {
    home: { title: 'Home', eyebrow: 'Personal library', empty: 'No files uploaded yet...' },
    movies: { title: 'Movies', eyebrow: 'Video library', empty: 'Sorry, no videos found...' },
    music: { title: 'Music', eyebrow: 'Audio library', empty: 'Sorry, no music found...' },
    photos: { title: 'Photos', eyebrow: 'Image library', empty: 'Sorry, no photos found...' }
};
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
    query: '',
    listView: false,
    storageDir: '',
    candidates: [],
    categories: [],
    nativeRoots: {},
    stats: null,
    hls: null
};

const renameDialog = new RenameDialog({ onRenamed });
const media = new MediaPlayer({ onDownload: downloadFile });
const upload = new Upload({ onUploaded });
const contextMenu = new ContextMenu();
const pagination = new Pagination();
const guide = new Guide();
const settings = new Settings();
const confirmDialog = new ConfirmDialog();
const libraryDrawer = new LibraryDrawer();
const actionDrawer = new ActionDrawer();
const loginView = new LoginView({
    onSignedIn: () => startApp(),
    onRetry: () => checkAuth()
});
authState.onUnauthorized = handleUnauthorized;

settings.onCreateUser = async (payload) => {
    try {
        const response = await apiFetch(`${API_BASE}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok){
            settings.setUsersStatus(data.error || 'Could not add user', 'error');
            return false;
        }
        await loadUsers();
        return true;
    } catch {
        settings.setUsersStatus('Could not add user', 'error');
        return false;
    }
};

settings.onUpdateUser = async (id, payload) => {
    try {
        const response = await apiFetch(`${API_BASE}/users/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok){
            settings.setUsersStatus(data.error || 'Could not update user', 'error');
            return false;
        }
        await loadUsers();
        return true;
    } catch {
        settings.setUsersStatus('Could not update user', 'error');
        return false;
    }
};

settings.onDeleteUser = async (id) => {
    try {
        const response = await apiFetch(`${API_BASE}/users/${id}`, { method: 'DELETE' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok){
            settings.setUsersStatus(data.error || 'Could not delete user', 'error');
            return;
        }
        await loadUsers();
        settings.setUsersStatus('User deleted');
    } catch {
        settings.setUsersStatus('Could not delete user', 'error');
    }
};

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
        Libraries: ['ri-stack-line', 'libraries', null, () => openLibraries()],
        Info: ['ri-question-line', '#info'],
        Settings: ['ri-settings-3-line', '#settings']
    },
    actions: {
        'Actions': [() => actionDrawer.open(), 'ri-apps-2-line']
    }
}, true);
actionDrawer.setActions([
    { label: 'Upload', icon: 'ri-upload-cloud-2-line', run: () => upload.open() },
    { label: 'Clean library', icon: 'ri-brush-3-fill', run: () => cleanLibrary() },
    { label: 'Stop all conversions', icon: 'ri-stop-circle-line', danger: true, run: () => stopHls() }
]);
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
    offerMigration();
};

settings.onPrefsChange = (prefs) => applyPrefs(prefs, true);

settings.onSaveHls = async (hls) => {
    const response = await saveSettings({ hls });
    if (!response) return;
    if (!response.ok){
        const data = await response.json().catch(() => ({}));
        settings.setHlsStatus(data.error || 'Could not save transcoding limits', 'error');
        return;
    }
    const result = await response.json();
    if (result.hls){
        state.hls = result.hls;
        settings.setHls(state.hls);
    }
    settings.setHlsStatus('Transcoding limits saved — applied to the next conversion');
    notify.show('Transcoding limits saved');
};

settings.onSaveCategories = async (categories) => {
    let response = await saveSettings({ categories });
    if (!response) return;
    if (response.status === 409){
        const preview = await response.json().catch(() => ({}));
        if (!preview.needs_confirmation) {
            settings.setCategoryStatus(preview.error || 'Could not save libraries', 'error');
            return;
        }
        const changes = (preview.relayout || []).map((item) =>
            `${item.label}: ${item.files} file${item.files === 1 ? '' : 's'} (${formatBytes(item.bytes)})\n${item.from} -> ${item.to}`
        ).join('\n\n');
        const choice = await confirmDialog.ask({
            title: 'Confirm library relayout',
            body: `Changing these library roots will ${preview.relayout.some((item) => item.mode === 'managed')
                ? 'move managed files and preserve linked files at their current locations'
                : 'keep linked files at their current locations'}:\n\n${changes}`,
            options: [
                { label: 'Cancel', value: 'cancel' },
                { label: 'Apply changes', value: 'apply', danger: true }
            ]
        });
        if (choice !== 'apply') return;
        response = await saveSettings({ categories, confirm_relayout: true });
        if (!response) return;
    }
    if (!response.ok){
        const data = await response.json().catch(() => ({}));
        settings.setCategoryStatus(data.error || 'Could not save libraries', 'error');
        return;
    }
    applyCategories(await response.json());
    settings.setCategoryStatus('Libraries saved');
    notify.show('Libraries saved');
};

settings.onAddCategory = async (payload) => {
    try {
        const response = await apiFetch(`${API_BASE}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok){
            settings.setCategoryStatus(data.error || 'Could not add library', 'error');
            return false;
        }
        applyCategories(data);
        settings.setCategoryStatus('Library added');
        notify.show('Library added');
        return true;
    } catch {
        settings.setCategoryStatus('Could not add library', 'error');
        return false;
    }
};

settings.onDeleteCategory = async (id, force = false) => {
    try {
        const response = await apiFetch(`${API_BASE}/categories/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
        const data = await response.json().catch(() => ({}));
        if (response.status === 409){
            if (window.confirm(`${data.error}. Files stay in the index unless removed. Continue?`)){
                return settings.onDeleteCategory(id, true);
            }
            return;
        }
        if (!response.ok){
            settings.setCategoryStatus(data.error || 'Could not remove library', 'error');
            return;
        }
        applyCategories(data);
        settings.setCategoryStatus('Library removed');
        notify.show('Library removed');
    } catch {
        settings.setCategoryStatus('Could not remove library', 'error');
    }
};

settings.onScanCategory = async (id) => {
    try {
        const response = await apiFetch(`${API_BASE}/library/scan?category=${encodeURIComponent(id)}`, { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok){
            settings.setCategoryStatus(data.error || 'Scan failed', 'error');
            return;
        }
        settings.setCategoryStatus(`Indexed ${data.added} new file${data.added === 1 ? '' : 's'}`);
        notify.show(`Indexed ${data.added} new file${data.added === 1 ? '' : 's'}`);
        reload();
    } catch {
        settings.setCategoryStatus('Scan failed', 'error');
    }
};

navbar.onSearch = (query) => {
    state.query = query;
    state.pageNumber = 1;
    loadPage(true);
};

function applyCategories(result){
    state.categories = Array.isArray(result.categories) ? result.categories : state.categories;
    state.nativeRoots = result.native_roots && typeof result.native_roots === 'object' ? result.native_roots : state.nativeRoots;
    syncCategoryNavigation();
    upload.setCategories(state.categories);
    if (state.page === 'settings') settings.setCategories({
        categories: state.categories,
        native_roots: state.nativeRoots,
        modes: result.modes
    });
}

const pageCache = new Map();
let fetchToken = 0;
const builtInPages = ['home', 'movies', 'music', 'photos', 'other', 'info', 'settings'];
let pages = [...builtInPages];

function categoryLinks(){
    const links = {
        Home: ['ri-home-line', '#home'],
        Libraries: ['ri-stack-line', 'libraries', null, () => openLibraries()],
        Info: ['ri-question-line', '#info']
    };
    if (isAdmin()) links.Settings = ['ri-settings-3-line', '#settings'];
    return links;
}

function libraryPages(){
    return state.categories.length
        ? state.categories.map((category) => category.id)
        : ['movies', 'music', 'photos', 'other'];
}

async function openLibraries(){
    libraryDrawer.open(state.categories, state.page);
    try {
        const response = await apiFetch(`${API_BASE}/categories`);
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data.categories)) return;
        state.categories = data.categories;
        if (libraryDrawer.isOpen()) libraryDrawer.setLibraries(state.categories, state.page);
    } catch {
        /* Counts from the last load are shown. */
    }
}

function syncCategoryNavigation(){
    pages = [...builtInPages, ...state.categories.filter((category) => !category.builtin).map((category) => category.id)];
    if (!isAdmin()) pages = pages.filter((page) => page !== 'settings');
    navbar.setLinks(categoryLinks());
    if (!pages.includes(state.page)){
        state.page = 'home';
        if (location.hash !== '#home') location.hash = 'home';
    }
}

function currentType(){
    return state.page === 'home' || state.page === 'info' || state.page === 'settings' ? '' : state.page;
}

function pageKey(){
    return `${currentType()}|${state.sort}|${state.perPage}|${state.pageNumber}|${state.query}`;
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
    if (state.query) params.set('q', state.query);
    const token = ++fetchToken;
    try {
        const response = await apiFetch(`${API_BASE}/files?${params}`);
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
    const category = state.categories.find((item) => item.id === state.page);
    const meta = pageMeta[state.page] || (category ? {
        eyebrow: `${category.label} library`,
        empty: `No files in ${category.label} yet...`
    } : null);
    const terms = state.query ? state.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
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
            titleTerms: terms,
            tags: file.size ? [file.size] : [],
            btnText: file.action,
            onOpen: () => openMedia(file),
            onContext: (event) => showContextMenu(file, event)
        });
    });
    if (state.query){
        const count = state.total;
        gallery.setMeta({ eyebrow: `${count} result${count === 1 ? '' : 's'} for "${state.query}"` });
        gallery.showEmpty(files.length === 0, `No results for "${state.query}"`);
    } else {
        gallery.setMeta({ eyebrow: meta?.eyebrow });
        gallery.showEmpty(files.length === 0, meta?.empty || 'No information');
    }
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
        candidates: state.candidates,
        hls: state.hls
    });
    settings.setCategories({
        categories: state.categories,
        native_roots: state.nativeRoots
    });
    settings.setPrefs({
        sort: state.sort,
        perPage: state.perPage,
        view: state.listView ? 'list' : 'grid'
    });
    settings.setUsersVisible(isAdmin());
    if (isAdmin()) loadUsers();
}

function renderPage(){
    const category = state.categories.find((item) => item.id === state.page);
    const meta = pageMeta[state.page] || (category ? {
        title: category.label,
        eyebrow: `${category.label} library`,
        empty: `No files in ${category.label} yet...`
    } : null);
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
    navbar.setActive(state.page, libraryPages().includes(state.page) ? 'libraries' : '');
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
    const items = [
        { icon: 'ri-play-fill', label: primary, onClick: () => openMedia(file) },
        { icon: 'ri-download-2-line', label: 'Download', onClick: () => downloadFile(file) }
    ];
    if (isAdmin()){
        items.push(
            { icon: 'ri-edit-box-line', label: 'Rename', onClick: () => renameDialog.open(file) },
            { icon: 'ri-delete-bin-3-line', label: 'Delete', onClick: () => removeFile(file) }
        );
    }
    contextMenu.open(event.clientX, event.clientY, items);
}

async function removeFile(file){
    if (typeof file.id === 'string'){
        try {
            let response = await apiFetch(`${API_BASE}/files/${file.id}`, { method: 'DELETE' });
            if (response.status === 409){
                const choice = await confirmDialog.ask({
                    title: 'Remove linked file',
                    body: `"${file.name}" lives in a shared folder. Remove it from Filey, or delete the original file permanently?`,
                    options: [
                        { label: 'Remove from Filey', value: 'remove' },
                        { label: 'Delete permanently', value: 'delete', danger: true }
                    ]
                });
                if (!choice) return;
                response = await apiFetch(`${API_BASE}/files/${file.id}?delete_source=${choice === 'delete' ? 'true' : 'false'}`, { method: 'DELETE' });
            }
            if (!response.ok){
                notify.show('Delete failed');
                return;
            }
        } catch {
            notify.show('Delete failed');
            return;
        }
    }
    state.files = state.files.filter((item) => item.id !== file.id);
    reload();
    notify.show(`${file.name} removed`);
}

async function offerMigration(){
    try {
        const response = await apiFetch(`${API_BASE}/library/migrate?dry_run=true`, { method: 'POST' });
        if (!response.ok) return;
        const preview = await response.json();
        const moves = preview.moves || {};
        const total = (moves.hls || 0) + (moves.photos || 0);
        if (!total) return;
        const choice = await confirmDialog.ask({
            title: 'Migrate caches',
            body: `${moves.hls || 0} HLS and ${moves.photos || 0} thumbnail cache entries can be moved into the new per-category layout now.`,
            options: [
                { label: 'Not now', value: 'skip' },
                { label: 'Migrate now', value: 'run' }
            ]
        });
        if (choice === 'run'){
            await apiFetch(`${API_BASE}/library/migrate`, { method: 'POST' });
            notify.show('Caches migrated');
        }
    } catch {
        /* Migration is best-effort. */
    }
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
    if (record.type === 'music') window.fileyMusicPlayer?.editor?.open(record, { setup: true });
}

async function cleanLibrary(){
    try {
        const [cleanupResponse, cacheResponse] = await Promise.all([
            apiFetch(`${API_BASE}/clean`, { method: 'POST' }),
            apiFetch(`${API_BASE}/hls/clear`, { method: 'POST' })
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
        const response = await apiFetch(`${API_BASE}/hls/cancel`, { method: 'POST' });
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
        const response = await apiFetch(`${API_BASE}/settings`);
        if (!response.ok) return;
        const result = await response.json();
        if (typeof result.platform_name === 'string' && result.platform_name){
            PLATFORM_NAME = result.platform_name;
        }
        state.storageDir = typeof result.storage_dir === 'string' ? result.storage_dir : '';
        state.candidates = Array.isArray(result.candidates) ? result.candidates : [];
        state.hls = result.hls && typeof result.hls === 'object' ? result.hls : null;
        state.categories = Array.isArray(result.categories) ? result.categories : [];
        state.nativeRoots = result.native_roots && typeof result.native_roots === 'object' ? result.native_roots : {};
        syncCategoryNavigation();
        upload.setCategories(state.categories);
    } catch {
        return;
    }
    applyBrand();
    renderPage();
}

function saveSettings(payload){
    return apiFetch(`${API_BASE}/settings`, {
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
    const categoryStats = state.categories
        .filter((category) => !category.builtin)
        .map((category) => ({
            icon: category.icon || 'ri-folder-6-fill',
            title: category.label,
            text: '',
            stat: `count.${category.id}`
        }));
    return [
        {
            icon: 'ri-rocket-line',
            title: 'Get started',
            body: [
                { icon: 'ri-folder-6-fill', title: 'What is this?', text: `${PLATFORM_NAME} is a personal media library. Browse the built-in Movies, Music, Photos, and Other libraries, or create libraries for your own file types.` },
                { icon: 'ri-upload-cloud-2-line', title: 'Add files', text: 'Open Actions in the top bar and choose Upload. Filey detects the built-in category from the file type; choose a custom library in the upload dialog when needed.' },
                { icon: 'ri-settings-3-line', title: 'Customize', text: 'Use Settings to choose a separate folder and storage mode for each library, create custom libraries, or change Filey’s managed storage location.' }
            ]
        },
        {
            icon: 'ri-search-line',
            title: 'Search',
            body: [
                { icon: 'ri-search-line', title: 'Search the whole library', text: 'Select the magnifying-glass control in the top bar and type to search every library, including files in native or custom folders. Press Escape to clear the search.' },
                { icon: 'ri-file-search-line', title: 'What search finds', text: 'Search matches names, original filenames, tags, file types, categories, and file extensions. Results work with sorting and pagination.' }
            ]
        },
        {
            icon: 'ri-play-circle-line',
            title: 'Play media',
            body: [
                { icon: 'ri-play-fill', title: 'Play / View / Open', text: "Each card's button matches the file type: Play for movies and music, View for photos, Open for other files." },
                { icon: 'ri-video-line', title: 'Why conversion?', text: 'Common formats play instantly. For formats the browser cannot decode (e.g. MKV), the server converts on demand (HLS) and streams it. You may see "Preparing full playback conversion" once.' },
                { icon: 'ri-stop-circle-line', title: 'Pause and stop', text: 'Open Actions in the top bar and choose Stop all conversions to cancel any running conversions. Partial conversions are cached for reuse.' }
            ]
        },
        {
            icon: 'ri-file-list-3-line',
            title: 'Manage files',
            body: [
                { icon: 'ri-more-2-fill', title: 'File menu', text: 'Use the "more" button on any card for Download, Rename, Delete, or to open the file again.' },
                { icon: 'ri-brush-3-fill', title: 'Clean library', text: 'Cleans up records of missing files and regenerated caches (thumbnails, HLS segments).' },
                { icon: 'ri-delete-bin-3-line', title: 'Delete a linked file', text: 'Filey asks whether to Remove from Filey (keep the original file) or Delete permanently (also delete the original file).' },
                { icon: 'ri-folder-add-line', title: 'Create a library', text: 'In Settings, add a library with a name, optional extensions (such as .gguf or .safetensors), a folder, and a storage mode. Custom libraries are created only when you add them.' }
            ]
        },
        {
            icon: 'ri-sort-desc',
            title: 'Browse and sort',
            body: [
                { icon: 'ri-stack-line', title: 'Libraries', text: 'Select Libraries in the top bar to open every library (Movies, Music, Photos, Other and your own) with its file count. Pick one to browse it; use Scan in Settings to index existing files in a linked folder.' },
                { icon: 'ri-sort-desc', title: 'Sorting', text: 'Use the sort menu to order by recent, oldest, name (A-Z / Z-A), size, or media type. Music can also be sorted by artist, album, genre, or release year.' },
                { icon: 'ri-layout-grid-line', title: 'Views', text: 'Toggle between grid and list view with the view button. Pagination uses Prev / Next below the gallery.' },
                { icon: 'ri-hourglass-line', title: 'Paging', text: 'The gallery shows one page at a time; already-viewed pages are cached so going back is instant.' }
            ]
        },
        {
            icon: 'ri-hard-drive-3-line',
            title: 'Library storage',
            body: [
                { icon: 'ri-folder-settings-line', title: 'Managed mode', text: 'Filey copies uploads into the library’s selected folder and manages those files. Without a custom folder, the existing Filey storage layout is used.' },
                { icon: 'ri-links-line', title: 'Linked mode', text: 'Use a folder that already contains files. Filey indexes them in place and does not move them. Use Scan to find supported files.' },
                { icon: 'ri-arrow-left-right-line', title: 'Change a library folder', text: 'Saving a changed root shows a move preview and asks for confirmation. Confirming moves managed files; linked files stay in their existing folder and remain available.' },
                { icon: 'ri-shield-keyhole-line', title: 'Filey index and caches', text: "UUID index records and generated thumbnails/transcoding caches remain in Filey's managed storage. They are not written into your native or linked media folders." }
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
                ...categoryStats,
                { icon: 'ri-database-2-line', title: 'HLS cache', text: '', stat: 'hls.bytes' },
                { icon: 'ri-drive-line', title: 'Free space', text: '', stat: 'storage.free' }
            ]
        },
        {
            icon: 'ri-shield-user-line',
            title: 'Accounts and roles',
            body: [
                { icon: 'ri-user-line', title: 'Clients', text: 'Clients can browse every library, search, play and view media, open thumbnails, and download files.' },
                { icon: 'ri-admin-line', title: 'Admins', text: 'Admins can do everything a client can, plus upload, rename, delete, manage libraries and settings, run maintenance, and create accounts.' },
                { icon: 'ri-lock-line', title: 'Sign in', text: 'Every account signs in with a username and password. There is no open registration: the first admin is created on the server, then admins add users in Settings → Users.' },
                { icon: 'ri-shield-keyhole-line', title: 'Server-side checks', text: 'Permissions are enforced by the server on every request. Hiding buttons in the interface is only a convenience, not the security boundary.' }
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
    const values = {
        total: stats.total,
        'count.movies': stats.counts?.movies ?? 0,
        'count.music': stats.counts?.music ?? 0,
        'count.photos': stats.counts?.photos ?? 0,
        'count.other': stats.counts?.other ?? 0,
        'hls.bytes': stats.hls_cache ? stats.hls_cache.bytes : 0,
        'photo.bytes': stats.photo_cache ? stats.photo_cache.bytes : 0,
        'storage.free': stats.storage ? stats.storage.free : 0
    };
    Object.entries(stats.counts || {}).forEach(([category, count]) => {
        values[`count.${category}`] = count;
    });
    return values;
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
        const response = await apiFetch(`${API_BASE}/stats`);
        if (!response.ok) return;
        const result = await response.json();
        state.stats = result;
        if (state.page === 'info') guide.applyStats(flattenStats(result), formatStat);
    } catch {
        return;
    }
}

function setAppVisible(visible){
    const shell = document.querySelector('.app-shell');
    if (shell) shell.hidden = !visible;
}

function resetClientState(){
    pageCache.clear();
    state.files = [];
    state.total = 0;
    state.pageNumber = 1;
    state.stats = null;
    state.categories = [];
    state.nativeRoots = {};
    gallery.clear();
}

function handleUnauthorized(){
    window.mediaDock?.closeAll();
    clearAuthUser();
    resetClientState();
    navbar.setAccount(null);
    setAppVisible(false);
    loginView.show(false);
}

async function loadUsers(){
    if (!isAdmin()) return;
    try {
        const response = await apiFetch(`${API_BASE}/users`);
        if (!response.ok) return;
        const data = await response.json();
        settings.setUsers(
            Array.isArray(data.users) ? data.users : [],
            authState.user ? authState.user.id : null
        );
    } catch {
        settings.setUsersStatus('Could not load users', 'error');
    }
}

async function startApp(){
    pageCache.clear();
    navbar.setAccount(authState.user, signOut);
    navbar.setAdminVisible(isAdmin());

    const initialPage = location.hash.slice(1).toLowerCase();
    state.page = pages.includes(initialPage) || /^[a-z0-9][a-z0-9-]{0,39}$/.test(initialPage)
        ? initialPage
        : 'home';

    const savedPrefs = loadPrefs();
    if (typeof savedPrefs.sort === 'string') state.sort = savedPrefs.sort;
    if (Number.isFinite(savedPrefs.perPage)){
        state.perPage = Math.min(96, Math.max(1, Math.floor(savedPrefs.perPage)));
    }
    if (savedPrefs.view === 'list') state.listView = true;

    setAppVisible(true);
    await loadSettings();
    if (state.page === 'settings' && !isAdmin()) state.page = 'home';
    renderPage();
    await loadPage();
}

async function signOut(){
    window.mediaDock?.closeAll();
    try {
        await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch {
        /* Sign out locally even if the server is unreachable. */
    }
    clearAuthUser();
    resetClientState();
    navbar.setAccount(null);
    setAppVisible(false);
    loginView.show(false);
    if (location.hash !== '#home'){
        history.replaceState(null, '', `${location.pathname}${location.search}#home`);
    }
}

async function checkAuth(){
    try {
        const response = await apiFetch(`${API_BASE}/auth/me`, { skipAuthHandling: true });
        if (response.ok){
            const data = await response.json();
            setAuthUser(data.user, data.csrf_token);
            loginView.hide();
            await startApp();
            return true;
        }
        const data = await response.json().catch(() => ({}));
        authState.setupRequired = Boolean(data.setup_required);
        clearAuthUser();
        setAppVisible(false);
        loginView.show(authState.setupRequired);
        return false;
    } catch {
        clearAuthUser();
        setAppVisible(false);
        loginView.show(false);
        loginView.setMessage('Filey backend is unavailable');
        return false;
    }
}

window.addEventListener('hashchange', () => {
    if (!authState.user) return;
    const page = location.hash.slice(1).toLowerCase();
    state.page = pages.includes(page) ? page : 'home';
    state.pageNumber = 1;
    loadPage();
});

checkAuth();