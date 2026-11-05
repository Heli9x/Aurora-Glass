class ActionDrawer {
    constructor(){
        this.modal = new Modal('action-drawer');
        this.dialog = this.modal.dialog;
        this.dialog.setAttribute('aria-label', 'Actions');

        this.title = document.createElement('h2');
        this.title.textContent = 'Actions';

        this.grid = document.createElement('div');
        this.grid.className = 'action-grid';

        this.dialog.append(this.title, this.grid);
        this.actions = [];
    }

    setActions(actions){
        this.actions = Array.isArray(actions) ? actions : [];
        this.grid.textContent = '';
        this.actions.forEach((action) => this.grid.appendChild(this.tile(action)));
    }

    open(){
        this.modal.open();
        const first = this.grid.querySelector('.action-tile');
        if (first) first.focus();
    }

    close(){
        this.modal.close();
    }

    isOpen(){
        return this.modal.isOpen();
    }

    tile(action){
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'action-tile';
        if (action.danger) tile.classList.add('danger-action');

        const badge = document.createElement('span');
        badge.className = 'action-icon';
        const icon = document.createElement('i');
        icon.className = action.icon;
        badge.appendChild(icon);

        const name = document.createElement('strong');
        name.className = 'action-name';
        name.textContent = action.label;

        tile.append(badge, name);
        tile.addEventListener('click', () => {
            this.close();
            if (action.run) action.run();
        });
        return tile;
    }
}
