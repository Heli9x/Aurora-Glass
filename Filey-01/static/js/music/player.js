import { Lyrics, fromLyrica } from './lyrics.js';
import { AudioEditor } from './editor.js';
import { Theme } from './theme.js';
import { Profile } from './profile.js';
import { Playlist } from './playlist.js';
import { Controls } from './controls.js';
import { PlaylistView } from './playlist-view.js';

const DEFAULT_THEME_COLOR = '#575757';
const MAX_QUEUE_FILES = 500;
const DOCK_ID = 'music-player';

function showNotify(message){
    if (typeof notify !== 'undefined' && notify?.show) notify.show(message);
}

function stripExtension(name){
    return String(name || '').replace(/\.[^.\\/]+$/, '').trim();
}

export function toTrack(file, apiBase = '/api'){
    const stem = stripExtension(file?.name || file?.originalName || 'Unknown title') || 'Unknown title';
    const parts = stem.split(/\s+-\s+/);
    const guessedArtist = parts.length > 1 ? parts.shift().trim() : '';
    const title = parts.length ? parts.join(' - ').trim() : stem;
    const extension = String(file?.ext || '').replace(/^\./, '').toUpperCase();

    return {
        id: file?.id || '',
        title: title || stem,
        artist: file?.artist || guessedArtist || 'Unknown artist',
        genre: file?.genre || extension || 'Music',
        cover: file?.id && file?.hasCover ? `${apiBase}/files/${file.id}/cover` : '',
        audio: file?.id ? `${apiBase}/files/${file.id}/stream` : '',
        lyrics: { lines: [] },
        hasLyrics: Boolean(file?.hasLyrics),
        file,
        duration: 0,
        themeColor: DEFAULT_THEME_COLOR
    };
}

export class FileyMusicPlayer {
    constructor({
        apiFetch: fetchImpl = typeof apiFetch === 'function' ? apiFetch : null,
        apiBase = typeof API_BASE === 'string' ? API_BASE : '/api',
        ModalClass = typeof Modal === 'function' ? Modal : null
    } = {}){
        if (typeof ModalClass !== 'function') throw new Error('Filey music player requires the Filey Modal class');

        this.apiFetch = typeof fetchImpl === 'function' ? fetchImpl : null;
        this.apiBase = String(apiBase || '/api').replace(/\/$/, '');
        this.modal = new ModalClass('music-dialog', () => this._handleClose());
        this.modal.dialog.classList.add('filey-music-dialog');

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'filey-music-player';
        this.wrapper.innerHTML = `
            <header class="actions">
                <div class="group-btn">
                    <button class="fullscreen" id="fileyFullscreen" type="button" aria-label="Enter full screen" aria-pressed="false" title="Full screen">
                        <i class="ri-fullscreen-line"></i>
                    </button>
                    <button class="minimize" id="fileyMinimize" type="button" aria-label="Minimize to dock" title="Minimize to dock">
                        <i class="ri-subtract-line"></i>
                    </button>
                    <button class="edit-track" id="fileyEditTrack" type="button" aria-label="Edit audio details" title="Edit tags, cover and lyrics">
                        <i class="ri-edit-line"></i>
                    </button>
                    <button class="playlist" id="fileyTogglePlaylist" type="button" aria-label="Open playlist" aria-expanded="false" title="Playlist">
                        <i class="ri-play-list-2-line"></i>
                    </button>
                </div>
            </header>
            <div class="profile">
                <div class="cover">
                    <div class="cover-image">
                        <i class="icon ri-music-line"></i>
                    </div>
                </div>
                <div class="details">
                    <span class="genre">Genre</span>
                    <h2 class="title">Title</h2>
                    <span class="artist">Artist</span>
                </div>
            </div>
            <div class="lyrics-wrap">
                <div class="lyrics"></div>
            </div>
            <div class="controls">
                <div class="progress-status">
                    <div class="progress-bar" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <span class="progress"></span>
                    </div>
                    <div class="control-options">
                        <div class="time-taken">0:00</div>
                        <div class="group-btn">
                            <button class="previous" id="playPrevious" type="button" aria-label="Previous track" title="Previous">
                                <i class="ri-skip-left-line"></i>
                            </button>
                            <button class="repeat" id="repeatSong" type="button" aria-label="Repeat off" aria-pressed="false" title="Repeat: off">
                                <i class="ri-repeat-2-line"></i>
                            </button>
                            <button class="play-pause" id="togglePlay" type="button" aria-label="Play" title="Play">
                                <i class="ri-play-line"></i>
                            </button>
                            <button class="next" id="playNext" type="button" aria-label="Next track" title="Next">
                                <i class="ri-skip-right-line"></i>
                            </button>
                        </div>
                        <div class="total-time">0:00</div>
                    </div>
                </div>
            </div>
            <aside class="playlist-panel" id="fileyPlaylistPanel" aria-hidden="true" aria-label="Playlist">
                <div class="playlist-header">
                    <h3>Playlist</h3>
                    <div class="playlist-actions">
                        <button id="fileyClearPlaylist" type="button" aria-label="Clear playlist" title="Clear playlist" disabled>
                            <i class="ri-delete-bin-line"></i>
                        </button>
                        <button id="fileyClosePlaylist" type="button" aria-label="Close playlist" title="Close playlist">
                            <i class="ri-close-line"></i>
                        </button>
                    </div>
                </div>
                <ul class="playlist-list" id="fileyPlaylistList"></ul>
            </aside>
            <audio id="fileyMusicAudio" preload="metadata" hidden></audio>
        `;
        this.modal.appendContent(this.wrapper);

        this.audio = this.wrapper.querySelector('#fileyMusicAudio');
        this.lyricsRoot = this.wrapper.querySelector('.lyrics');
        this.profileRoot = this.wrapper.querySelector('.profile');
        this.queueRequest = 0;
        this.openAutoplay = false;

        this.editor = new AudioEditor({
            apiFetch: this.apiFetch,
            apiBase: this.apiBase,
            ModalClass,
            onSaved: (file) => this._handleEdited(file)
        });
        this.fullscreenButton = this.wrapper.querySelector('#fileyFullscreen');
        this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
        document.addEventListener('fullscreenchange', () => {
            // Leaving through the browser (Esc) must also leave the player's full-screen layout.
            if (!document.fullscreenElement && this.fullscreen) this.setFullscreen(false);
        });
        this.wrapper.querySelector('#fileyMinimize').addEventListener('click', () => this.minimize());
        this.wrapper.querySelector('#fileyEditTrack').addEventListener('click', () => {
            const track = this.playlist?.current ?? this.currentTrack;
            if (track?.file) this.editor.open(track.file);
        });

        this.lyrics = new Lyrics({
            onSeek: (time) => this.controls?.seek(time),
            emptyMessage: 'No lyrics available'
        });
        this.audio.addEventListener('play', () => {
            this._syncDock();
            window.mediaDock?.pauseOthers(DOCK_ID);
        });
        ['pause', 'ended', 'emptied'].forEach((name) => this.audio.addEventListener(name, () => this._syncDock()));
        this.lyrics.mount(this.lyricsRoot);
        this.lyrics.attach(this.audio);

        this.theme = new Theme({ root: this.wrapper, defaultColor: DEFAULT_THEME_COLOR });
        this.profile = new Profile({ root: this.profileRoot });
        this.playlistView = new PlaylistView({
            panel: this.wrapper.querySelector('#fileyPlaylistPanel'),
            list: this.wrapper.querySelector('#fileyPlaylistList'),
            toggleButton: this.wrapper.querySelector('#fileyTogglePlaylist'),
            closeButton: this.wrapper.querySelector('#fileyClosePlaylist'),
            clearButton: this.wrapper.querySelector('#fileyClearPlaylist'),
            onSelect: (index) => {
                if (!this.playlist) return;
                if (index === this.playlist.currentIndex) this.controls?.play();
                else this.playlist.select(index);
            },
            onRemove: (index) => this.playlist?.remove(index),
            onClear: () => this.playlist?.clear()
        }).init();

        this.playlist = new Playlist({
            repeat: 'off',
            onTrackChange: (track, index, { reason } = {}) => this._handleTrackChange(track, index, reason),
            onQueueChange: (state) => this.playlistView.render(state),
            onRepeatChange: (mode) => this.controls?.setRepeat(mode)
        });

        this.controls = new Controls({
            audio: this.audio,
            playlist: this.playlist,
            root: this.wrapper,
            onError: (error) => {
                console.error('Filey music playback error', error);
                showNotify('Unable to play this track');
            }
        }).init();

        this.playlist.setTracks([]);
    }

    async open(file){
        if (!file || file.type !== 'music') return;
        this.playlistView.close();
        this.modal.open();
        this._registerDock();
        window.mediaDock?.setExpanded(DOCK_ID);

        if (!file.id){
            showNotify('Music playback requires the Filey backend');
            return;
        }

        const request = ++this.queueRequest;
        const tracks = await this._loadQueue(file);
        if (request !== this.queueRequest) return;
        if (!tracks.length) return;

        const targetIndex = Math.max(0, tracks.findIndex((track) => track.id === file.id));
        this.openAutoplay = true;
        try {
            this.playlist.setTracks(tracks, { shuffle: false });
        } finally {
            this.openAutoplay = false;
        }
        if (targetIndex > 0) this.playlist.select(targetIndex);
    }

    // Closing the dialog only minimizes: music keeps playing from the dock.
    close(){
        this.modal.close();
    }

    get fullscreen(){
        return this.modal.dialog.classList.contains('is-fullscreen');
    }

    toggleFullscreen(){
        return this.setFullscreen(!this.fullscreen);
    }

    // Always fills the viewport; also asks the browser for real full screen when it allows it.
    async setFullscreen(on){
        this.modal.dialog.classList.toggle('is-fullscreen', on);
        this.modal.backdrop.classList.toggle('is-fullscreen', on);
        this.fullscreenButton.setAttribute('aria-pressed', String(on));
        this.fullscreenButton.setAttribute('aria-label', on ? 'Exit full screen' : 'Enter full screen');
        this.fullscreenButton.title = on ? 'Exit full screen' : 'Full screen';
        this.fullscreenButton.firstElementChild.className = on ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line';
        try {
            if (on && !document.fullscreenElement) await this.modal.backdrop.requestFullscreen?.();
            else if (!on && document.fullscreenElement) await document.exitFullscreen();
        } catch (error) {
            // The layout still fills the window when the browser refuses real full screen.
        }
    }

    minimize(){
        if (this.fullscreen) this.setFullscreen(false);
        this.playlistView?.close();
        this.modal.minimize();
        window.mediaDock?.setExpanded(null);
    }

    pause(){
        this.controls?.pause();
    }

    shutdown(){
        this.queueRequest += 1;
        this.openAutoplay = false;
        this.playlistView?.close();
        this.controls?.stop();
        this.currentTrack = null;
        if (this.fullscreen) this.setFullscreen(false);
        this.modal.minimize();
        window.mediaDock?.remove(DOCK_ID);
    }

    _registerDock(){
        const dock = window.mediaDock;
        if (!dock || dock.has(DOCK_ID)) return;
        dock.register(DOCK_ID, {
            kind: 'audio',
            icon: 'ri-music-2-line',
            title: 'Music player',
            subtitle: '',
            playing: false,
            onToggle: () => this.controls?.toggle(),
            onPause: () => this.pause(),
            onExpand: () => {
                this.modal.open();
                window.mediaDock?.setExpanded(DOCK_ID);
            },
            onClose: () => this.shutdown()
        });
    }

    _syncDock(){
        const dock = window.mediaDock;
        if (!dock?.has(DOCK_ID)) return;
        const track = this.currentTrack;
        dock.update(DOCK_ID, {
            title: track?.title || 'Music player',
            subtitle: track?.artist || '',
            cover: track?.cover || '',
            playing: Boolean(this.audio) && !this.audio.paused && !this.audio.ended
        });
    }

    async _loadQueue(file){
        const fallback = [toTrack(file, this.apiBase)];
        if (!this.apiFetch) return fallback;

        try {
            const tracks = [];
            let page = 1;
            let total = Infinity;

            while (page <= 5 && tracks.length < MAX_QUEUE_FILES){
                const response = await this.apiFetch(`${this.apiBase}/files?type=music&per_page=100&page=${page}`);
                if (!response.ok) break;
                const data = await response.json();
                const files = Array.isArray(data.files) ? data.files : [];
                files
                    .filter((item) => item.type === 'music')
                    .forEach((item) => tracks.push(toTrack(item, this.apiBase)));
                total = Number(data.total) || tracks.length;
                if (tracks.length >= total || files.length < 100) break;
                page += 1;
            }

            const unique = [];
            const seen = new Set();
            tracks.forEach((track) => {
                if (!track.id || seen.has(track.id)) return;
                seen.add(track.id);
                unique.push(track);
            });
            if (!unique.some((track) => track.id === file.id)) unique.unshift(fallback[0]);
            return unique.length ? unique : fallback;
        } catch (error){
            console.error('Could not load the Filey music queue', error);
            return fallback;
        }
    }

    _handleTrackChange(track, index, reason){
        if (!track){
            this.currentTrack = null;
            this._syncDock();
            this.controls?.stop();
            this.profile?.clear();
            this.theme?.reset();
            this.lyrics?.load({ lines: [] });
            this.playlistView?.setActive(-1);
            return;
        }

        this.currentTrack = track;
        this._syncDock();
        this.profile?.setTrack(track);
        this.theme?.applyTrack(track);
        this.lyrics?.load(track.lyrics ?? { lines: [] });
        this._loadTrackLyrics(track);
        this.playlistView?.setActive(index);
        this.controls?.load(track, { autoplay: reason !== 'init' || this.openAutoplay });
    }

    async _loadTrackLyrics(track){
        if (!track.hasLyrics || !track.id || !this.apiFetch) return;
        try {
            const response = await this.apiFetch(`${this.apiBase}/files/${track.id}/lyrics`);
            if (!response.ok || this.currentTrack !== track) return;
            const { lyrics = [] } = await response.json();
            track.lyrics = fromLyrica(lyrics);
            this.lyrics?.load(track.lyrics);
        } catch (error){
            console.error('Could not load lyrics', error);
        }
    }

    _handleEdited(file){
        const track = this.currentTrack;
        if (!track || track.id !== file.id) return;
        const updated = toTrack(file, this.apiBase);
        Object.assign(track, { artist: updated.artist, genre: updated.genre, cover: updated.cover, file,
            hasLyrics: updated.hasLyrics, lyrics: { lines: [] } });
        if (track.cover) track.cover += `?v=${Date.now()}`;
        this.profile?.setTrack(track);
        this.lyrics?.load(track.lyrics);
        this._loadTrackLyrics(track);
        this._syncDock();
    }

    _handleClose(){
        if (this.fullscreen) this.setFullscreen(false);
        this.playlistView?.close();
        window.mediaDock?.setExpanded(null);
    }
}

export default FileyMusicPlayer;
