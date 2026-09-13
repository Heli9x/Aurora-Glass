class MediaPlayer {
    constructor({ onDownload = null } = {}){
        this.onDownload = onDownload;
        this.modal = new Modal('media-dialog');
        this.dialog = this.modal.dialog;

        this.preview = document.createElement('div');
        this.preview.className = 'media-preview';

        this.actions = document.createElement('div');
        this.actions.className = 'player-actions';
        this.playerToggle = document.createElement('button');
        this.playerToggle.type = 'button';
        this.playerToggle.setAttribute('aria-label', 'Play');
        this.playerToggle.title = 'Play';
        this.playerToggle.innerHTML = '<i class="ri-play-fill"></i>';
        this.muteToggle = document.createElement('button');
        this.muteToggle.type = 'button';
        this.muteToggle.setAttribute('aria-label', 'Unmute');
        this.muteToggle.title = 'Unmute';
        this.muteToggle.innerHTML = '<i class="ri-volume-mute-line"></i>';
        this.actions.append(this.playerToggle, this.muteToggle);

        this.title = document.createElement('h2');
        this.title.textContent = 'Preview';
        this.meta = document.createElement('p');

        this.dialog.append(this.preview, this.actions, this.title, this.meta);

        this.activeHls = null;
        this.hlsConversionActive = false;
        this.activePlaybackFile = null;
        this.playbackRequest = 0;

        this.hlsOptions = {
            startPosition: 0,
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 30,
            manifestLoadingRetryDelay: 2000,
            manifestLoadingMaxRetryTimeout: 1200000,
            levelLoadingTimeOut: 10000,
            fragLoadingTimeOut: 20000,
        };
        this.nativeMimeTypes = [
            'video/mp4', 'video/webm',
            'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav'
        ];
    }

    open(file){
        if (file.type === 'other'){
            if (this.onDownload) this.onDownload(file);
            return;
        }
        const requestId = ++this.playbackRequest;
        this.activePlaybackFile = file;
        this.title.textContent = file.name;
        this.meta.textContent = `${file.type} · ${file.size || 'local file'}`;
        const previewUrl = typeof file.id === 'string'
            ? `${API_BASE}/files/${file.id}/${file.type === 'photos' ? 'view' : 'stream'}`
            : '';

        if (file.type === 'photos'){
            this.dialog.classList.add('photo-dialog');
            this.preview.replaceChildren();
            const img = document.createElement('img');
            img.src = previewUrl;
            img.alt = file.name;
            this.preview.appendChild(img);
            this.modal.open();
            return;
        }

        this.dialog.classList.remove('photo-dialog');
        const tag = file.type === 'movies' ? 'video' : 'audio';
        const probe = document.createElement(tag);
        const canPlayNative = this.nativeMimeTypes.includes(file.mimeType)
            && Boolean(probe.canPlayType(file.mimeType).replace('no', ''));

        const player = document.createElement(tag);
        player.id = 'active-player';
        player.controls = true;
        player.playsinline = true;
        player.preload = 'metadata';
        if (canPlayNative) player.src = previewUrl;
        this.preview.replaceChildren(player);
        this.modal.open();

        this.bindPlayerActions(player);
        if (canPlayNative){
            player.addEventListener('error', () => this.requestHlsPlayback(file, requestId), { once: true });
            player.load();
            player.play().catch(() => {});
            return;
        }
        this.requestHlsPlayback(file, requestId);
    }

    updatePlayerActions(player){
        if (!player) return;
        this.playerToggle.innerHTML = `<i class="ri-${player.paused ? 'play' : 'pause'}-fill"></i>`;
        this.playerToggle.setAttribute('aria-label', player.paused ? 'Play' : 'Pause');
        this.playerToggle.title = player.paused ? 'Play' : 'Pause';
        this.muteToggle.innerHTML = `<i class="ri-volume-${player.muted ? 'mute' : 'up'}-line"></i>`;
        this.muteToggle.setAttribute('aria-label', player.muted ? 'Unmute' : 'Mute');
        this.muteToggle.title = player.muted ? 'Unmute' : 'Mute';
    }

    bindPlayerActions(player){
        ['play', 'pause', 'volumechange'].forEach((eventName) => {
            player.addEventListener(eventName, () => this.updatePlayerActions(player));
        });
        this.playerToggle.onclick = () => {
            if (player.paused){
                if (this.hlsConversionActive && this.activePlaybackFile?.id){
                    fetch(`${API_BASE}/hls/${this.activePlaybackFile.id}/resume`, { method: 'POST' }).catch(() => {});
                }
                player.play().catch(() => {});
            } else {
                if (this.hlsConversionActive && this.activePlaybackFile?.id){
                    fetch(`${API_BASE}/hls/${this.activePlaybackFile.id}/pause`, { method: 'POST' }).catch(() => {});
                }
                player.pause();
            }
        };
        this.muteToggle.onclick = () => {
            player.muted = !player.muted;
            this.updatePlayerActions(player);
        };
        this.updatePlayerActions(player);
    }

    async requestHlsPlayback(file, requestId){
        notify.show('Preparing full playback conversion...');
        try {
            const playlistUrl = `${API_BASE}/hls/${file.id}/stream.m3u8`;
            this.hlsConversionActive = true;
            const start = await fetch(playlistUrl);
            if (!start.ok) throw new Error('HLS conversion request failed');
            if (requestId !== this.playbackRequest || !this.modal.isOpen()) return;

            const player = document.getElementById('active-player');
            if (!player || !window.Hls || !Hls.isSupported()) throw new Error('HLS playback is unavailable');

            this.activeHls = new Hls(this.hlsOptions);
            this.activeHls.loadSource(playlistUrl);
            this.activeHls.attachMedia(player);
            player.play().catch(() => notify.show('Press Play to start playback'));
            this.activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
                player.muted = false;
                this.updatePlayerActions(player);
                notify.show('Live playback ready');
            });
        } catch (error){
            this.hlsConversionActive = false;
            notify.show(error.message || 'Unable to prepare playback');
        }
    }

    stopAll(){
        this.playbackRequest += 1;
        this.activePlaybackFile = null;
        this.hlsConversionActive = false;
        if (this.activeHls){
            this.activeHls.destroy();
            this.activeHls = null;
        }
    }

    close(){
        if (this.activePlaybackFile?.id && this.hlsConversionActive){
            fetch(`${API_BASE}/hls/${this.activePlaybackFile.id}/cancel`, { method: 'POST' }).catch(() => {});
        }
        this.stopAll();
        this.dialog.classList.remove('photo-dialog');
        this.preview.replaceChildren();
        this.modal.close();
    }
}