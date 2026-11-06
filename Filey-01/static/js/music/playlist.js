const REPEAT_MODES = ['off', 'all', 'one'];

export class Playlist {
    constructor({
        tracks = [],
        repeat = 'off',
        rng = Math.random,
        onTrackChange = null,
        onQueueChange = null,
        onRepeatChange = null
    } = {}) {
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.onTrackChange = onTrackChange;
        this.onQueueChange = onQueueChange;
        this.onRepeatChange = onRepeatChange;
        this.tracks = [];
        this.currentIndex = -1;
        this.repeat = REPEAT_MODES.includes(repeat) ? repeat : 'off';
        if (tracks.length) this.setTracks(tracks);
    }

    get current() {
        return this.tracks[this.currentIndex] || null;
    }

    get length() {
        return this.tracks.length;
    }

    setTracks(tracks = [], { shuffle = false, reason = 'init' } = {}) {
        this.tracks = Array.isArray(tracks) ? tracks.slice() : [];
        if (shuffle) this._shuffleInPlace();
        this.currentIndex = this.tracks.length ? 0 : -1;
        this._emitQueue();
        this._emitTrack(reason);
        return this;
    }

    shuffle() {
        if (this.tracks.length < 2) return this;
        this._shuffleInPlace();
        this.currentIndex = 0;
        this._emitQueue();
        this._emitTrack('shuffle');
        return this;
    }

    select(index, { reason = 'select' } = {}) {
        if (!this._isValidIndex(index) || index === this.currentIndex) return this.current;
        this.currentIndex = index;
        this._emitQueue();
        this._emitTrack(reason);
        return this.current;
    }

    add(track, { next = false, reason = 'add' } = {}) {
        if (!track) return this;
        if (!this.tracks.length) {
            this.tracks.push(track);
            this.currentIndex = 0;
            this._emitQueue();
            this._emitTrack(reason);
            return this;
        }
        if (next) this.tracks.splice(this.currentIndex + 1, 0, track);
        else this.tracks.push(track);
        this._emitQueue();
        return this;
    }

    remove(index) {
        if (!this._isValidIndex(index)) return this.current;
        const removingCurrent = index === this.currentIndex;
        this.tracks.splice(index, 1);

        if (!this.tracks.length) {
            this.currentIndex = -1;
            this._emitQueue();
            this._emitTrack('remove');
            return null;
        }

        if (removingCurrent) {
            this.currentIndex = Math.min(index, this.tracks.length - 1);
            this._emitQueue();
            this._emitTrack('remove');
            return this.current;
        }

        if (index < this.currentIndex) this.currentIndex -= 1;
        this._emitQueue();
        return this.current;
    }

    clear() {
        this.tracks = [];
        this.currentIndex = -1;
        this._emitQueue();
        this._emitTrack('clear');
        return this;
    }

    next({ auto = false } = {}) {
        if (!this.tracks.length) return null;
        if (auto && this.repeat === 'one') {
            this._emitTrack('ended');
            return this.current;
        }

        let index = this.currentIndex + 1;
        if (index >= this.tracks.length) {
            if (this.repeat === 'all' || !auto) index = 0;
            else return null;
        }

        this.currentIndex = index;
        this._emitQueue();
        this._emitTrack('next');
        return this.current;
    }

    previous() {
        if (!this.tracks.length) return null;
        const index = this.currentIndex <= 0 ? this.tracks.length - 1 : this.currentIndex - 1;
        this.currentIndex = index;
        this._emitQueue();
        this._emitTrack('previous');
        return this.current;
    }

    setRepeat(mode) {
        if (!REPEAT_MODES.includes(mode) || mode === this.repeat) return this.repeat;
        this.repeat = mode;
        if (this.onRepeatChange) this.onRepeatChange(this.repeat);
        return this.repeat;
    }

    cycleRepeat() {
        const index = REPEAT_MODES.indexOf(this.repeat);
        return this.setRepeat(REPEAT_MODES[(index + 1) % REPEAT_MODES.length]);
    }

    destroy() {
        this.tracks = [];
        this.currentIndex = -1;
        this.onTrackChange = null;
        this.onQueueChange = null;
        this.onRepeatChange = null;
    }

    _shuffleInPlace() {
        for (let index = this.tracks.length - 1; index > 0; index -= 1) {
            const target = Math.floor(this.rng() * (index + 1));
            [this.tracks[index], this.tracks[target]] = [this.tracks[target], this.tracks[index]];
        }
    }

    _isValidIndex(index) {
        return Number.isInteger(index) && index >= 0 && index < this.tracks.length;
    }

    _emitQueue() {
        if (this.onQueueChange) {
            this.onQueueChange({
                tracks: this.tracks.slice(),
                currentIndex: this.currentIndex
            });
        }
    }

    _emitTrack(reason) {
        if (this.onTrackChange) {
            this.onTrackChange(this.current, this.currentIndex, { reason });
        }
    }
}

export default Playlist;
