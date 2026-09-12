const pageMeta = {
    home: { title: 'Home', eyebrow: 'Personal library', empty: 'No files uploaded yet...' },
    movies: { title: 'Movies', eyebrow: 'Video library', empty: 'Sorry, no videos found...' },
    music: { title: 'Music', eyebrow: 'Audio library', empty: 'Sorry, no music found...' },
    photos: { title: 'Photos', eyebrow: 'Image library', empty: 'Sorry, no photos found...' }
};
const navItems = [
    ['Home', 'home', 'ri-home-line'], ['Movies', 'movies', 'ri-video-line'],
    ['Music', 'music', 'ri-disc-line'], ['Photos', 'photos', 'ri-image-line'],
    ['Info', 'info', 'ri-question-line']
];
const API_BASE = '/api';
let activeHls = null;
let hlsConversionActive = false;
const hlsOptions = {
    startPosition: 0,
    manifestLoadingTimeOut: 10000,
    manifestLoadingMaxRetry: 30,
    manifestLoadingRetryDelay: 2000,
    manifestLoadingMaxRetryTimeout: 1200000,
    levelLoadingTimeOut: 10000,
    fragLoadingTimeOut: 20000,
};
let playbackRequest = 0;
let activePlaybackFile = null;
const state = {
    files: [],
    page: 'home', sort: 'default', listView: false
};
const $ = (selector) => document.querySelector(selector);
const toast = $('#toast');
let toastTimer;

function notify(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}
async function loadFilesFromApi() {
    try {
        const response = await fetch(`${API_BASE}/files`);
        if (!response.ok) return;
        const result = await response.json();
        if (Array.isArray(result.files)) state.files = result.files;
        renderPage();
    } catch {
        notify('Filey backend is unavailable');
    }
}
function renderNavigation() {
    $('#navbar').innerHTML = `<div class="nav-links">${navItems.map(([label, page, icon]) => `
        <a class="nav-link ${state.page === page ? 'active' : ''}" href="#${page}" data-page="${page}" aria-label="${label}" title="${label}"><i class="${icon}"></i><span>${label}</span></a>
    `).join('')}</div>`;
}
function visibleFiles() {
    let files = state.page === 'home' ? [...state.files] : state.files.filter((file) => file.type === state.page);
    if (state.sort === 'default') files.sort((a, b) => Date.parse(b.timeAdded || '') - Date.parse(a.timeAdded || ''));
    if (state.sort === 'oldest') files.sort((a, b) => Date.parse(a.timeAdded || '') - Date.parse(b.timeAdded || ''));
    if (state.sort === 'name_asc') files.sort((a, b) => a.name.localeCompare(b.name));
    if (state.sort === 'name_desc') files.sort((a, b) => b.name.localeCompare(a.name));
    if (state.sort === 'size_desc') files.sort((a, b) => Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0));
    if (state.sort === 'size_asc') files.sort((a, b) => Number(a.sizeBytes || 0) - Number(b.sizeBytes || 0));
    if (state.sort === 'type') files.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return files;
}
function fileIcon(file) {
    const hasThumbnail = file.type === 'photos';
    const fallback = file.type === 'movies' ? 'video-icon' : '';
    return `<span class="file-icon ${fallback}">${hasThumbnail ? `<img src="${API_BASE}/files/${file.id}/thumbnail" alt="" loading="lazy" onerror="this.remove()">` : ''}<i class="${file.icon}"></i></span>`;
}
function renderFiles() {
    const files = visibleFiles();
    const grid = $('#library-grid');
    grid.classList.toggle('list-view', state.listView);
    $('#empty-state').hidden = files.length !== 0;
    $('#empty-state p').textContent = pageMeta[state.page]?.empty || 'No information';
    grid.innerHTML = files.map((file) => `
        <article class="file-card" data-id="${file.id}" data-kind="${file.type}" tabindex="0" aria-label="${file.name}">
            <button class="file-more" type="button" aria-label="Actions for ${file.name}" title="More actions"><i class="ri-more-2-fill"></i></button>
            ${fileIcon(file)}
            <div class="file-details"><span class="file-name">${file.name}</span><small>${file.size || ''}</small></div>
            <a class="file-action" href="#" data-action="${file.action.toLowerCase()}">${file.action}</a>
        </article>
    `).join('');
}
function renderInfo() {
    $('#library-grid').className = 'library-grid info-grid';
    $('#library-grid').innerHTML = `<div class="info-panel"><i class="ri-hard-drive-3-line"></i><strong>Filey library</strong><span>Manage your personal movies, music, and photos from one workspace.</span></div><div class="info-panel"><i class="ri-file-list-3-line"></i><strong>${state.files.length} files</strong><span>Files are read from the connected Filey storage volume.</span></div><div class="info-panel"><i class="ri-command-line"></i><strong>Quick actions</strong><span>Use the card menu to view, play, download, rename, or delete files.</span></div>`;
    $('#empty-state').hidden = true;
}
function renderPage() {
    const meta = pageMeta[state.page];
    $('#page-title').textContent = meta?.title || 'Info';
    $('.eyebrow').textContent = meta?.eyebrow || 'About Filey';
    $('#sort-select').value = state.sort;
    $('#sort-select').closest('.sort-control').hidden = state.page === 'info';
    renderNavigation();
    state.page === 'info' ? renderInfo() : renderFiles();
}
function closeModals() {
    playbackRequest += 1;
    if (activePlaybackFile?.id && hlsConversionActive) fetch(`${API_BASE}/hls/${activePlaybackFile.id}/cancel`, { method: 'POST' }).catch(() => {});
    activePlaybackFile = null;
    hlsConversionActive = false;
    if (activeHls) { activeHls.destroy(); activeHls = null; }
    document.querySelectorAll('.modal-backdrop').forEach((modal) => { modal.hidden = true; });
    $('#media-modal .dialog').classList.remove('photo-dialog');
    $('#media-preview').innerHTML = '';
}
function mediaElement(file, url) {
    const tag = file.type === 'movies' ? 'video' : 'audio';
    const source = url ? ` src="${url}"` : '';
    return `<${tag} id="active-player" controls playsinline preload="metadata"${source}></${tag}>`;
}
function updatePlayerActions(player) {
    if (!player) return;
    $('#player-toggle').innerHTML = `<i class="ri-${player.paused ? 'play' : 'pause'}-fill"></i>`;
    $('#player-toggle').ariaLabel = player.paused ? 'Play' : 'Pause';
    $('#player-toggle').title = player.paused ? 'Play' : 'Pause';
    $('#mute-toggle').innerHTML = `<i class="ri-volume-${player.muted ? 'mute' : 'up'}-line"></i>`;
    $('#mute-toggle').ariaLabel = player.muted ? 'Unmute' : 'Mute';
    $('#mute-toggle').title = player.muted ? 'Unmute' : 'Mute';
}
function bindPlayerActions(player) {
    ['play', 'pause', 'volumechange'].forEach((eventName) => player.addEventListener(eventName, () => updatePlayerActions(player)));
    $('#player-toggle').onclick = () => {
        if (player.paused) {
            if (hlsConversionActive && activePlaybackFile?.id) fetch(`${API_BASE}/hls/${activePlaybackFile.id}/resume`, { method: 'POST' }).catch(() => {});
            player.play().catch(() => {});
        } else {
            if (hlsConversionActive && activePlaybackFile?.id) fetch(`${API_BASE}/hls/${activePlaybackFile.id}/pause`, { method: 'POST' }).catch(() => {});
            player.pause();
        }
    };
    $('#mute-toggle').onclick = () => { player.muted = !player.muted; updatePlayerActions(player); };
    updatePlayerActions(player);
}
async function openMedia(file) {
    const requestId = ++playbackRequest;
    activePlaybackFile = file;
    $('#media-title').textContent = file.name;
    $('#media-meta').textContent = `${file.type} · ${file.size || 'local file'}`;
    const previewUrl = typeof file.id === 'string' ? `${API_BASE}/files/${file.id}/${file.type === 'photos' ? 'view' : 'stream'}` : '';
    if (file.type === 'photos') {
        $('#media-modal .dialog').classList.add('photo-dialog');
        $('#media-preview').innerHTML = `<img src="${previewUrl}" alt="${file.name}">`;
        $('#media-modal').hidden = false;
        return;
    }
    const nativeMimeTypes = ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav'];
    const probe = document.createElement(file.type === 'movies' ? 'video' : 'audio');
    const canPlayNative = nativeMimeTypes.includes(file.mimeType) && Boolean(probe.canPlayType(file.mimeType).replace('no', ''));
    $('#media-preview').innerHTML = mediaElement(file, canPlayNative ? previewUrl : '');
    $('#media-modal').hidden = false;
    const player = $('#active-player');
    bindPlayerActions(player);
    if (canPlayNative) {
        player.addEventListener('error', () => requestHlsPlayback(file, requestId), { once: true });
        player.load();
        player.play().catch(() => {});
        return;
    }
    await requestHlsPlayback(file, requestId);
}
async function requestHlsPlayback(file, requestId) {
    notify('Preparing full playback conversion...');
    try {
        const playlistUrl = `${API_BASE}/hls/${file.id}/stream.m3u8`;
        hlsConversionActive = true;
        const start = await fetch(playlistUrl);
        if (!start.ok) throw new Error('HLS conversion request failed');
        if (requestId !== playbackRequest || $('#media-modal').hidden) return;
        const player = $('#active-player');
        if (!player || !window.Hls || !Hls.isSupported()) throw new Error('HLS playback is unavailable');
        activeHls = new Hls(hlsOptions);
        activeHls.loadSource(playlistUrl);
        activeHls.attachMedia(player);
        player.play().catch(() => notify('Press Play to start playback'));
        activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
            player.muted = false;
            updatePlayerActions(player);
            notify('Live playback ready');
        });
    } catch (error) {
        hlsConversionActive = false;
        notify(error.message || 'Unable to prepare playback');
    }
}
async function removeFile(file) {
    if (typeof file.id === 'string') {
        try { await fetch(`${API_BASE}/files/${file.id}`, { method: 'DELETE' }); } catch { /* Keep local state usable when offline. */ }
    }
    state.files = state.files.filter((item) => item.id !== file.id);
    renderPage(); notify(`${file.name} removed`);
}
async function renameFile(file) {
    const name = prompt('Rename file', file.name);
    if (!name?.trim()) return;
    if (typeof file.id === 'string') {
        try { await fetch(`${API_BASE}/files/${file.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) }); } catch { /* Keep local state usable when offline. */ }
    }
    file.name = name.trim(); renderPage(); notify('File renamed');
}
function downloadFile(file) {
    const link = document.createElement('a');
    if (typeof file.id === 'string') {
        link.href = `${API_BASE}/files/${file.id}/download`;
        link.download = file.originalName || file.name;
        link.click();
        notify('Download started');
        return;
    }
    notify('Download is unavailable without the Filey backend');
}
function showContextMenu(file, x, y) {
    const menu = $('#context-menu');
    const actions = [[file.type === 'movies' || file.type === 'music' ? 'Play' : 'View', 'ri-play-fill', () => openMedia(file)], ['Download', 'ri-download-2-line', () => downloadFile(file)], ['Rename', 'ri-edit-box-line', () => renameFile(file)], ['Delete', 'ri-delete-bin-3-line', () => removeFile(file)]];
    menu.innerHTML = actions.map(([label, icon], index) => `<button class="context-menu-item" type="button" data-menu-index="${index}"><i class="${icon}"></i><span>${label}</span></button>`).join('');
    menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
    menu.hidden = false;
    menu.querySelectorAll('.context-menu-item').forEach((button, index) => button.addEventListener('click', () => { menu.hidden = true; actions[index][2](); }));
}

$('#navbar').addEventListener('click', (event) => {
    const link = event.target.closest('[data-page]');
    if (!link) return;
    event.preventDefault(); state.page = link.dataset.page; history.replaceState(null, '', `#${state.page}`); renderPage();
});
$('#library-grid').addEventListener('click', (event) => {
    const card = event.target.closest('.file-card');
    if (!card) return;
    const file = state.files.find((item) => String(item.id) === card.dataset.id);
    if (!file) return;
    if (event.target.closest('.file-more')) showContextMenu(file, event.pageX, event.pageY);
    if (event.target.closest('.file-action')) { event.preventDefault(); openMedia(file); }
});
$('#library-grid').addEventListener('contextmenu', (event) => {
    const card = event.target.closest('.file-card');
    if (!card) return;
    event.preventDefault();
    const file = state.files.find((item) => String(item.id) === card.dataset.id);
    if (file) showContextMenu(file, event.pageX, event.pageY);
});
$('#sort-select').addEventListener('change', (event) => { state.sort = event.target.value; renderFiles(); });
$('#view-button').addEventListener('click', () => { state.listView = !state.listView; $('#view-button').innerHTML = `<i class="ri-${state.listView ? 'list-check' : 'layout-grid'}-line"></i>`; renderFiles(); });
$('#upload-button').addEventListener('click', () => { $('#upload-modal').hidden = false; });
$('#clean-button').addEventListener('click', async () => {
    try {
        const [cleanupResponse, cacheResponse] = await Promise.all([
            fetch(`${API_BASE}/clean`, { method: 'POST' }),
            fetch(`${API_BASE}/hls/clear`, { method: 'POST' })
        ]);
        const result = await cleanupResponse.json();
        notify(result.success && cacheResponse.ok ? 'Library and HLS cache cleared' : 'Cleanup failed');
    } catch {
        notify('Local library cleanup complete');
    }
});
$('#stop-hls-button').addEventListener('click', async () => {
    playbackRequest += 1;
    activePlaybackFile = null;
    hlsConversionActive = false;
    if (activeHls) { activeHls.destroy(); activeHls = null; }
    try {
        const response = await fetch(`${API_BASE}/hls/cancel`, { method: 'POST' });
        const result = await response.json();
        notify(result.stopped ? `Stopped ${result.stopped} HLS conversion${result.stopped === 1 ? '' : 's'}` : 'No HLS conversions running');
    } catch {
        notify('Unable to stop HLS conversions');
    }
});
$('#file-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $('#custom-name').placeholder = file.name;
    if ($('#file-category').value === 'auto') $('#file-category').value = file.type.startsWith('video') ? 'movies' : file.type.startsWith('audio') ? 'music' : file.type.startsWith('image') ? 'photos' : 'other';
});
$('#upload-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('#file-input').files[0];
    if (!file) { notify('Choose a file first'); return; }
    const type = file.type.startsWith('video') ? 'movies' : file.type.startsWith('audio') ? 'music' : file.type.startsWith('image') ? 'photos' : 'other';
    const selectedType = $('#file-category').value === 'auto' ? type : $('#file-category').value;
    const selectedIcon = document.querySelector('input[name="file-icon"]:checked').value;
    const customName = $('#custom-name').value.trim();
    const displayName = customName || file.name;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', displayName);
    formData.append('category', selectedType);
    formData.append('icon', selectedIcon);
    const progress = $('#upload-progress');
    const progressBar = $('#upload-progress-bar');
    const progressLabel = $('#upload-progress-label');
    const progressPercent = $('#upload-progress-percent');
    const submitButton = event.target.querySelector('.submit-button');
    progress.hidden = false;
    submitButton.disabled = true;
    submitButton.textContent = 'Uploading...';
    try {
        const result = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE}/upload`);
            xhr.upload.onprogress = (uploadEvent) => {
                if (!uploadEvent.lengthComputable) return;
                const percent = Math.round((uploadEvent.loaded / uploadEvent.total) * 100);
                progressBar.style.width = `${percent}%`;
                progressLabel.textContent = `Uploading ${file.name}`;
                progressPercent.textContent = `${percent}%`;
            };
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error('Filey rejected the upload'));
            xhr.onerror = () => reject(new Error('Upload connection failed'));
            xhr.send(formData);
        });
        state.files.unshift(result.file);
        progressBar.style.width = '100%';
        progressLabel.textContent = 'Upload complete';
        progressPercent.textContent = '100%';
    } catch (error) {
        progressLabel.textContent = 'Upload failed';
        notify(error.message || 'Upload failed');
        submitButton.disabled = false;
        submitButton.textContent = 'Add to library';
        return;
    }
    closeModals(); renderPage(); notify('File uploaded to Filey storage'); event.target.reset(); $('#file-input').value = ''; $('#custom-name').placeholder = 'Use original filename'; $('#file-category').value = 'auto';
});
document.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal]') || event.target.classList.contains('modal-backdrop')) closeModals();
    if (!event.target.closest('#context-menu')) $('#context-menu').hidden = true;
});
const initialPage = location.hash.slice(1).toLowerCase();
state.page = ['home', 'movies', 'music', 'photos', 'info'].includes(initialPage) ? initialPage : 'home';
renderPage();
loadFilesFromApi();
