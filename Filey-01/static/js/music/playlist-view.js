import { probeDuration } from './duration.js';
function formatTime(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

export class PlaylistView {
    constructor({
        panel = null,
        list = null,
        toggleButton = null,
        closeButton = null,
        clearButton = null,
        onSelect = null,
        onRemove = null,
        onClear = null,
        onClose = null
    } = {}) {
        this.panel = panel || (typeof document !== 'undefined'
            ? document.getElementById('playlistPanel')
            : null);
        this.list = list || (typeof document !== 'undefined'
            ? document.getElementById('playlistList')
            : null);
        this.toggleButton = toggleButton || (typeof document !== 'undefined'
            ? document.getElementById('togglePlaylist')
            : null);
        this.closeButton = closeButton || (typeof document !== 'undefined'
            ? document.getElementById('closePlaylist')
            : null);
        this.clearButton = clearButton || (typeof document !== 'undefined'
            ? document.getElementById('clearPlaylist')
            : null);
        this.onSelect = onSelect;
        this.onRemove = onRemove;
        this.onClear = onClear;
        this.onClose = onClose;
        this.tracks = [];
        this.currentIndex = -1;
        this.isOpen = false;
        this._listeners = [];
        this._onDocumentPointerDown = (event) => this._handleOutsidePointer(event);
        this._onDocumentKeyDown = (event) => {
            if (event.key === 'Escape' && this.isOpen) this.close();
        };
    }

    init() {
        this._add(this.toggleButton, 'click', () => this.toggle());
        this._add(this.closeButton, 'click', () => this.close());
        this._add(this.clearButton, 'click', () => this._clear());
        if (typeof document !== 'undefined') {
            this._add(document, 'pointerdown', this._onDocumentPointerDown);
            this._add(document, 'keydown', this._onDocumentKeyDown);
        }
        this.render({ tracks: this.tracks, currentIndex: this.currentIndex });
        return this;
    }

    render({ tracks = [], currentIndex = -1 } = {}) {
        this.tracks = Array.isArray(tracks) ? tracks.slice() : [];
        this.currentIndex = currentIndex;
        if (!this.list) return this;

        this.list.replaceChildren();
        if (!this.tracks.length) {
            const empty = document.createElement('li');
            empty.className = 'playlist-empty';
            empty.textContent = 'Queue is empty';
            this.list.appendChild(empty);
        } else {
            this.tracks.forEach((track, index) => {
                this.list.appendChild(this._buildRow(track, index));
            });
        }

        if (this.clearButton) this.clearButton.disabled = !this.tracks.length;
        this._syncActive();
        return this;
    }

    setActive(index) {
        this.currentIndex = index;
        this._syncActive();
        return this;
    }

    open() {
        if (!this.panel) return this;
        this.isOpen = true;
        this.panel.classList.add('is-open');
        this.panel.setAttribute('aria-hidden', 'false');
        this.toggleButton?.setAttribute('aria-expanded', 'true');
        const focusTarget = this.closeButton
            || this.list?.querySelector('.playlist-item.active')
            || this.list?.querySelector('.playlist-item');
        if (focusTarget?.focus) focusTarget.focus({ preventScroll: true });
        return this;
    }

    close() {
        if (!this.panel || !this.isOpen) return this;
        this.isOpen = false;
        this.panel.classList.remove('is-open');
        this.panel.setAttribute('aria-hidden', 'true');
        this.toggleButton?.setAttribute('aria-expanded', 'false');
        if (this.onClose) this.onClose();
        if (this.toggleButton?.focus) this.toggleButton.focus({ preventScroll: true });
        return this;
    }

    toggle() {
        return this.isOpen ? this.close() : this.open();
    }

    destroy() {
        this._listeners.forEach(([target, event, handler, options]) => {
            target.removeEventListener(event, handler, options);
        });
        this._listeners = [];
        this.list?.replaceChildren();
        this.panel?.classList.remove('is-open');
        this.panel = null;
        this.list = null;
        this.toggleButton = null;
        this.closeButton = null;
        this.clearButton = null;
    }

    _buildRow(track, index) {
        const item = document.createElement('li');
        item.className = 'playlist-item';
        item.dataset.index = String(index);
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `Play ${track.title || 'track'}`);
        item.addEventListener('click', () => this._select(index));
        item.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this._select(index);
        });

        const cover = document.createElement('div');
        cover.className = 'playlist-cover';
        const coverIcon = document.createElement('i');
        coverIcon.className = 'ri-music-line';
        cover.appendChild(coverIcon);
        if (track.cover) {
            const image = document.createElement('img');
            image.src = track.cover;
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('error', () => image.remove(), { once: true });
            cover.appendChild(image);
        }

        const info = document.createElement('div');
        info.className = 'playlist-info';
        const title = document.createElement('span');
        title.className = 'playlist-title';
        title.textContent = track.title || 'Unknown title';
        const meta = document.createElement('span');
        meta.className = 'playlist-meta';
        meta.textContent = [track.artist, track.genre].filter(Boolean).join(' · ') || 'Unknown artist';
        info.append(title, meta);

        const duration = document.createElement('span');
        duration.className = 'playlist-duration';
        duration.textContent = formatTime(track.duration);
        if (!(track.duration > 0)) {
            probeDuration(track.audio).then((seconds) => {
                if (!seconds) return;
                track.duration = seconds;
                duration.textContent = formatTime(seconds);
            });
        }

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'playlist-remove';
        remove.setAttribute('aria-label', `Remove ${track.title || 'track'}`);
        remove.title = 'Remove';
        const removeIcon = document.createElement('i');
        removeIcon.className = 'ri-close-line';
        remove.appendChild(removeIcon);
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.onRemove) this.onRemove(index);
        });

        item.append(cover, info, duration, remove);
        return item;
    }

    _select(index) {
        if (this.onSelect) this.onSelect(index);
    }

    _clear() {
        if (!this.tracks.length) return;
        if (this.onClear) this.onClear();
        else this.render({ tracks: [], currentIndex: -1 });
    }

    _syncActive() {
        const rows = this.list?.querySelectorAll('.playlist-item');
        rows?.forEach((row, index) => {
            const active = index === this.currentIndex;
            row.classList.toggle('active', active);
            if (active) row.setAttribute('aria-current', 'true');
            else row.removeAttribute('aria-current');
        });
    }

    _handleOutsidePointer(event) {
        if (!this.isOpen) return;
        const target = event.target;
        if (this.panel?.contains(target)) return;
        if (this.toggleButton?.contains(target)) return;
        this.close();
    }

    _add(target, event, handler, options = undefined) {
        if (!target) return;
        target.addEventListener(event, handler, options);
        this._listeners.push([target, event, handler, options]);
    }
}

export default PlaylistView;
