class LibraryDrawer {
    constructor({ onNavigate = null } = {}){
        this.onNavigate = onNavigate;
        this.libraries = [];
        this.activeId = '';
        this.modal = new Modal('library-drawer');
        this.dialog = this.modal.dialog;
        this.dialog.setAttribute('aria-label', 'Libraries');

        this.title = document.createElement('h2');
        this.title.textContent = 'Libraries';

        this.filter = document.createElement('input');
        this.filter.type = 'search';
        this.filter.className = 'library-filter';
        this.filter.placeholder = 'Filter libraries';
        this.filter.setAttribute('aria-label', 'Filter libraries');
        this.filter.hidden = true;
        this.filter.addEventListener('input', () => this.renderTiles());

        this.grid = document.createElement('div');
        this.grid.className = 'library-grid';

        this.empty = document.createElement('p');
        this.empty.className = 'library-empty';
        this.empty.textContent = 'No libraries match your filter.';
        this.empty.hidden = true;

        this.dialog.append(this.title, this.filter, this.grid, this.empty);
    }

    open(libraries, activeId = ''){
        this.setLibraries(libraries, activeId);
        this.modal.open();
        const first = this.grid.querySelector('.library-tile');
        if (!this.filter.hidden) this.filter.focus();
        else if (first) first.focus();
    }

    close(){
        this.modal.close();
    }

    isOpen(){
        return this.modal.isOpen();
    }

    setLibraries(libraries, activeId = this.activeId){
        this.libraries = Array.isArray(libraries) ? libraries : [];
        this.activeId = activeId;
        this.filter.hidden = this.libraries.length <= 8;
        if (this.filter.hidden) this.filter.value = '';
        this.renderTiles();
    }

    renderTiles(){
        const terms = this.filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const visible = this.libraries.filter((library) => {
            const label = String(library.label || library.id).toLowerCase();
            return terms.every((term) => label.includes(term));
        });
        this.grid.textContent = '';
        visible.forEach((library) => this.grid.appendChild(this.tile(library)));
        this.empty.hidden = visible.length > 0;
    }

    tile(library){
        const tile = document.createElement('a');
        tile.className = 'library-tile';
        tile.href = `#${library.id}`;
        if (library.id === this.activeId){
            tile.classList.add('active');
            tile.setAttribute('aria-current', 'page');
        }

        const badge = document.createElement('span');
        badge.className = 'library-icon';
        const icon = document.createElement('i');
        icon.className = library.icon || 'ri-folder-6-fill';
        badge.appendChild(icon);

        const name = document.createElement('strong');
        name.className = 'library-name';
        name.textContent = library.label || library.id;

        const count = document.createElement('small');
        count.className = 'library-count';
        const total = Number(library.count) || 0;
        count.textContent = `${total} file${total === 1 ? '' : 's'}`;

        tile.append(badge, name, count);
        tile.addEventListener('click', () => {
            this.close();
            if (this.onNavigate) this.onNavigate(library);
        });
        return tile;
    }
}
