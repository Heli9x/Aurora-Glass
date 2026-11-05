/*
 * Floating dock in the bottom-right corner that keeps media viewers alive while
 * the user browses. Each viewer registers an entry (music player, video viewer,
 * future managers) and the dock offers play/pause, expand and close for it.
 *
 * entry: { kind, icon, title, subtitle, cover, playing,
 *          onToggle, onExpand, onClose, onPause }
 */
class MediaDock {
    constructor(){
        this.entries = new Map();
        this.collapsed = false;
        this.expandedId = null;

        this.root = document.createElement('aside');
        this.root.className = 'media-dock';
        this.root.setAttribute('aria-label', 'Media dock');
        this.root.hidden = true;

        this.panel = document.createElement('div');
        this.panel.className = 'media-dock-panel';

        this.launcher = document.createElement('button');
        this.launcher.type = 'button';
        this.launcher.className = 'media-dock-launcher';
        this.launcher.addEventListener('click', () => this.setCollapsed(!this.collapsed));
        this.launcherIcon = document.createElement('i');
        this.badge = document.createElement('span');
        this.badge.className = 'media-dock-badge';
        this.launcher.append(this.launcherIcon, this.badge);

        this.root.append(this.panel, this.launcher);
        document.body.appendChild(this.root);
    }

    has(id){
        return this.entries.has(id);
    }

    register(id, entry){
        const isNew = !this.entries.has(id);
        this.entries.set(id, { kind: 'media', icon: 'ri-play-circle-line', title: '', subtitle: '', ...entry });
        if (isNew) this.collapsed = false;
        this.render();
    }

    update(id, patch){
        const entry = this.entries.get(id);
        if (!entry) return;
        Object.assign(entry, patch);
        this.render();
    }

    remove(id){
        if (!this.entries.delete(id)) return;
        if (this.expandedId === id) this.expandedId = null;
        this.render();
    }

    closeAll(){
        [...this.entries.keys()].forEach((id) => this.close(id));
    }

    close(id){
        const entry = this.entries.get(id);
        if (!entry) return;
        this.remove(id);
        if (typeof entry.onClose === 'function') entry.onClose();
    }

    // The entry whose full viewer is open is hidden from the dock.
    setExpanded(id){
        this.expandedId = id;
        this.render();
    }

    pauseOthers(id){
        this.entries.forEach((entry, key) => {
            if (key !== id && entry.playing && typeof entry.onPause === 'function') entry.onPause();
        });
    }

    setCollapsed(value){
        this.collapsed = Boolean(value);
        this.render();
    }

    button(icon, label, handler){
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = `<i class="${icon}"></i>`;
        button.addEventListener('click', handler);
        return button;
    }

    card(id, entry){
        const card = document.createElement('div');
        card.className = 'media-dock-card';
        card.dataset.kind = entry.kind;

        const art = document.createElement('button');
        art.type = 'button';
        art.className = 'media-dock-art';
        art.title = 'Open';
        art.setAttribute('aria-label', `Open ${entry.title || 'viewer'}`);
        if (entry.cover){
            const image = document.createElement('img');
            image.src = entry.cover;
            image.alt = '';
            image.addEventListener('error', () => image.replaceWith(Object.assign(document.createElement('i'), { className: entry.icon })));
            art.appendChild(image);
        } else {
            art.innerHTML = `<i class="${entry.icon}"></i>`;
        }
        art.addEventListener('click', () => entry.onExpand?.());

        const text = document.createElement('div');
        text.className = 'media-dock-text';
        const title = document.createElement('strong');
        title.textContent = entry.title || 'Untitled';
        const subtitle = document.createElement('span');
        subtitle.textContent = entry.subtitle || '';
        text.append(title, subtitle);

        const actions = document.createElement('div');
        actions.className = 'media-dock-actions';
        if (typeof entry.onToggle === 'function'){
            actions.appendChild(this.button(entry.playing ? 'ri-pause-fill' : 'ri-play-fill',
                entry.playing ? 'Pause' : 'Play', () => entry.onToggle()));
        }
        actions.appendChild(this.button('ri-fullscreen-line', 'Expand', () => entry.onExpand?.()));
        actions.appendChild(this.button('ri-close-line', 'Close', () => this.close(id)));

        card.append(art, text, actions);
        return card;
    }

    render(){
        const visible = [...this.entries].filter(([id]) => id !== this.expandedId);
        this.root.hidden = this.entries.size === 0;
        this.root.classList.toggle('is-collapsed', this.collapsed);
        this.panel.hidden = this.collapsed || visible.length === 0;
        this.panel.replaceChildren(...visible.map(([id, entry]) => this.card(id, entry)));

        const playing = [...this.entries.values()].some((entry) => entry.playing);
        const lead = (visible[0] || [...this.entries][0] || [null, null])[1];
        this.launcherIcon.className = this.entries.size > 1 ? 'ri-apps-2-line' : (lead?.icon || 'ri-apps-2-line');
        this.launcher.classList.toggle('is-playing', playing);
        this.badge.textContent = String(this.entries.size);
        this.badge.hidden = this.entries.size < 2;
        const label = this.collapsed ? 'Show media dock' : 'Minimize media dock';
        this.launcher.setAttribute('aria-label', label);
        this.launcher.setAttribute('aria-expanded', String(!this.collapsed));
        this.launcher.title = label;
    }
}

window.mediaDock = new MediaDock();
