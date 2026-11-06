const PLAY_ICON = 'ri-play-line';
const PAUSE_ICON = 'ri-pause-line';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function formatTime(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

export class Controls {
    constructor({ audio, playlist, root = null, onError = null } = {}) {
        if (!audio) throw new Error('Controls requires an audio element');
        if (!playlist) throw new Error('Controls requires a playlist');

        this.audio = audio;
        this.playlist = playlist;
        this.root = root || (typeof document !== 'undefined' ? document : null);
        this.onError = onError;
        this.toggleButton = this._query('#togglePlay');
        this.playIcon = this.toggleButton?.querySelector('i') || null;
        this.nextButton = this._query('#playNext');
        this.previousButton = this._query('#playPrevious');
        this.repeatButton = this._query('#repeatSong');
        this.progressBar = this._query('.progress-bar');
        this.progress = this._query('.progress-bar .progress');
        this.timeTaken = this._query('.time-taken');
        this.totalTime = this._query('.total-time');
        this.track = null;
        this.duration = 0;
        this.repeatMode = 'off';
        this._listeners = [];
        this._loadToken = 0;
        this._dragging = false;
        this._destroyed = false;
    }

    init() {
        this._add(this.audio, 'play', () => this._syncPlayState(true));
        this._add(this.audio, 'pause', () => this._syncPlayState(false));
        this._add(this.audio, 'ended', () => this._handleEnded());
        this._add(this.audio, 'timeupdate', () => this._syncTime());
        this._add(this.audio, 'seeked', () => this._syncTime());
        this._add(this.audio, 'seeking', () => this._syncTime());
        this._add(this.audio, 'loadedmetadata', () => this._syncTime());
        this._add(this.audio, 'durationchange', () => this._syncTime());
        this._add(this.audio, 'error', () => this._handleError(this.audio.error));

        this._add(this.toggleButton, 'click', () => this.toggle());
        this._add(this.nextButton, 'click', () => this.playlist.next());
        this._add(this.previousButton, 'click', () => this._handlePrevious());
        this._add(this.repeatButton, 'click', () => {
            this.setRepeat(this.playlist.cycleRepeat());
        });

        this._add(this.progressBar, 'pointerdown', (event) => this._handlePointerDown(event));
        this._add(this.progressBar, 'pointermove', (event) => this._handlePointerMove(event));
        this._add(this.progressBar, 'pointerup', (event) => this._handlePointerUp(event));
        this._add(this.progressBar, 'pointercancel', (event) => this._handlePointerUp(event));
        this._add(this.progressBar, 'keydown', (event) => this._handleProgressKey(event));

        this.setRepeat(this.playlist.repeat);
        this._syncTime();
        this._syncPlayState(false);
        return this;
    }

    load(track, { autoplay = false } = {}) {
        this._loadToken += 1;
        const token = this._loadToken;
        this.track = track || null;
        this.duration = Number(track?.duration) || 0;

        if (!track?.audio) {
            this.stop();
            return;
        }

        this.audio.pause();
        this.audio.src = track.audio;
        this.audio.load();
        this._syncTime();
        this._syncPlayState(false);

        if (autoplay) {
            const result = this.audio.play();
            if (result?.catch) {
                result.catch((error) => {
                    if (token === this._loadToken) this._handleError(error);
                });
            }
        }
    }

    play() {
        if (!this.track) {
            const current = this.playlist.current;
            if (current) this.load(current, { autoplay: true });
            return;
        }

        const result = this.audio.play();
        if (result?.catch) result.catch((error) => this._handleError(error));
    }

    pause() {
        this.audio.pause();
    }

    toggle() {
        if (this.audio.paused || this.audio.ended) this.play();
        else this.pause();
    }

    seek(seconds) {
        const duration = this._getDuration();
        if (!duration) return;
        const value = clamp(Number(seconds) || 0, 0, duration);
        try {
            this.audio.currentTime = value;
        } catch {
            return;
        }
        this._syncTime();
    }

    stop() {
        this._loadToken += 1;
        this.track = null;
        this.duration = 0;
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this._syncTime();
        this._syncPlayState(false);
    }

    setRepeat(mode) {
        this.repeatMode = mode;
        if (!this.repeatButton) return;
        const icon = this.repeatButton.querySelector('i');
        if (icon) icon.className = mode === 'one' ? 'ri-repeat-one-line' : 'ri-repeat-2-line';
        this.repeatButton.classList.toggle('active', mode !== 'off');
        this.repeatButton.classList.toggle('one', mode === 'one');
        this.repeatButton.setAttribute('aria-label', `Repeat ${mode}`);
        this.repeatButton.setAttribute('title', `Repeat: ${mode}`);
        this.repeatButton.setAttribute('aria-pressed', String(mode !== 'off'));
    }

    destroy() {
        this._destroyed = true;
        this._listeners.forEach(([target, event, handler, options]) => {
            target.removeEventListener(event, handler, options);
        });
        this._listeners = [];
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.track = null;
    }

    _query(selector) {
        if (!this.root || !selector) return null;
        return this.root.querySelector(selector) || (typeof document !== 'undefined'
            ? document.querySelector(selector)
            : null);
    }

    _add(target, event, handler, options = undefined) {
        if (!target) return;
        target.addEventListener(event, handler, options);
        this._listeners.push([target, event, handler, options]);
    }

    _getDuration() {
        const mediaDuration = Number(this.audio.duration);
        return Number.isFinite(mediaDuration) && mediaDuration > 0
            ? mediaDuration
            : this.duration;
    }

    _syncTime() {
        const duration = this._getDuration();
        const current = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
        const ratio = duration > 0 ? clamp(current / duration, 0, 1) : 0;

        if (this.progress) this.progress.style.width = `${(ratio * 100).toFixed(2)}%`;
        if (this.timeTaken) this.timeTaken.textContent = formatTime(current);
        if (this.totalTime) this.totalTime.textContent = formatTime(duration);
        if (this.progressBar) {
            this.progressBar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
            this.progressBar.setAttribute('aria-valuetext', `${formatTime(current)} of ${formatTime(duration)}`);
        }
    }

    _syncPlayState(playing) {
        if (this.playIcon) this.playIcon.className = playing ? PAUSE_ICON : PLAY_ICON;
        this.toggleButton?.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        this.toggleButton?.setAttribute('title', playing ? 'Pause' : 'Play');
    }

    _handlePrevious() {
        const current = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
        if (current > 3) {
            this.seek(0);
            return;
        }
        this.playlist.previous();
    }

    _handleEnded() {
        const next = this.playlist.next({ auto: true });
        if (!next) {
            this._syncPlayState(false);
            this._syncTime();
        }
    }

    _handleError(error) {
        if (this._destroyed || !this.track) return;
        if (error?.name === 'AbortError') return;
        this._syncPlayState(false);
        if (this.onError) this.onError(error);
    }

    _handlePointerDown(event) {
        if (!this._getDuration()) return;
        event.preventDefault();
        this._dragging = true;
        if (this.progressBar?.setPointerCapture) {
            this.progressBar.setPointerCapture(event.pointerId);
        }
        this._seekFromPointer(event);
    }

    _handlePointerMove(event) {
        if (!this._dragging) return;
        event.preventDefault();
        this._seekFromPointer(event);
    }

    _handlePointerUp(event) {
        if (!this._dragging) return;
        this._dragging = false;
        if (this.progressBar?.releasePointerCapture) {
            try {
                this.progressBar.releasePointerCapture(event.pointerId);
            } catch {
                return;
            }
        }
    }

    _seekFromPointer(event) {
        if (!this.progressBar) return;
        const rect = this.progressBar.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        this.seek(ratio * this._getDuration());
    }

    _handleProgressKey(event) {
        const duration = this._getDuration();
        if (!duration) return;
        let next = this.audio.currentTime;
        switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                next -= 5;
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                next += 5;
                break;
            case 'PageDown':
                next -= 10;
                break;
            case 'PageUp':
                next += 10;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = duration;
                break;
            default:
                return;
        }
        event.preventDefault();
        this.seek(next);
    }
}

export default Controls;
