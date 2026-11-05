export class Profile {
    constructor({ root = null } = {}) {
        this.root = root || (typeof document !== 'undefined'
            ? document.querySelector('.profile')
            : null);
        this.cover = this.root?.querySelector('.cover-image') || this.root?.querySelector('.cover') || null;
        this.icon = this.cover?.querySelector('i') || null;
        this.genre = this.root?.querySelector('.genre') || null;
        this.title = this.root?.querySelector('.title') || null;
        this.artist = this.root?.querySelector('.artist') || null;
        this.image = null;
        this.objectUrl = null;
    }

    setTrack(track = {}) {
        if (this.genre) this.genre.textContent = track.genre || 'Unknown genre';
        if (this.title) this.title.textContent = track.title || 'Unknown title';
        if (this.artist) this.artist.textContent = track.artist || 'Unknown artist';
        this.setCover(track.cover, track.title);
        return this;
    }

    setCover(source, title = '') {
        this._clearObjectUrl();
        this._removeImage();

        if (!source) {
            this._showIcon(true);
            return this;
        }

        const image = document.createElement('img');
        image.className = 'cover-art';
        image.alt = title ? `${title} cover` : 'Cover';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
            if (this.image !== image) return;
            image.remove();
            this.image = null;
            this.cover?.classList.remove('has-image');
            this._showIcon(true);
        }, { once: true });

        if (typeof Blob !== 'undefined' && source instanceof Blob) {
            this.objectUrl = URL.createObjectURL(source);
            image.src = this.objectUrl;
        } else {
            image.src = String(source);
        }

        this.cover?.prepend(image);
        this.cover?.classList.add('has-image');
        this.image = image;
        this._showIcon(false);
        return this;
    }

    clear() {
        if (this.genre) this.genre.textContent = 'Genre';
        if (this.title) this.title.textContent = 'Title';
        if (this.artist) this.artist.textContent = 'Artist';
        this._clearObjectUrl();
        this._removeImage();
        this._showIcon(true);
        return this;
    }

    destroy() {
        this._clearObjectUrl();
        this._removeImage();
        this.root = null;
        this.cover = null;
        this.icon = null;
        this.genre = null;
        this.title = null;
        this.artist = null;
    }

    _showIcon(visible) {
        if (this.icon) this.icon.hidden = !visible;
    }

    _removeImage() {
        if (this.image) this.image.remove();
        this.image = null;
        this.cover?.classList.remove('has-image');
    }

    _clearObjectUrl() {
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
    }
}

export default Profile;
