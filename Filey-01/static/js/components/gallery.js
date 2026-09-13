class Gallery {
    constructor({ title = 'Library', eyebrow = '', empty = 'Library is empty' } = {}){
        this.listView = false;
        this.main = document.createElement('div');
        this.main.className = 'gallery-wrapper';
        this.createHeader(title, eyebrow);

        this.content = document.createElement('div');
        this.content.className = 'gallery-content';

        this.empty = document.createElement('div');
        this.empty.className = 'gallery-empty';
        this.empty.hidden = true;
        const emptyIcon = document.createElement('i');
        emptyIcon.className = 'ri-folder-open-line';
        this.emptyMsg = document.createElement('p');
        this.emptyMsg.textContent = empty;
        this.empty.append(emptyIcon, this.emptyMsg);

        this.footer = document.createElement('div');
        this.footer.className = 'gallery-footer';

        this.main.append(this.content, this.empty, this.footer);
    }

    createHeader(title, eyebrow){
        const header = document.createElement('div');
        header.className = 'gallery-header';

        const heading = document.createElement('div');
        this.eyebrow = document.createElement('p');
        this.eyebrow.className = 'gallery-eyebrow';
        this.eyebrow.textContent = eyebrow;
        this.title = document.createElement('h1');
        this.title.className = 'gallery-title';
        this.title.textContent = title;
        heading.append(this.eyebrow, this.title);

        this.actions = document.createElement('div');
        this.actions.className = 'gallery-actions';
        this.createSort();
        this.createViewButton();

        header.append(heading, this.actions);
        this.main.appendChild(header);
    }

    createSort(){
        const label = document.createElement('label');
        label.className = 'sort-control';
        label.htmlFor = 'sort-select';

        const icon = document.createElement('i');
        icon.className = 'ri-sort-desc';

        const select = document.createElement('select');
        select.id = 'sort-select';
        select.setAttribute('aria-label', 'Sort files');
        const options = [
            ['default', 'Recent'], ['oldest', 'Oldest'],
            ['name_asc', 'Name A-Z'], ['name_desc', 'Name Z-A'],
            ['size_desc', 'Largest'], ['size_asc', 'Smallest'],
            ['type', 'Media type']
        ];
        options.forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        });

        label.append(icon, select);
        this.sortSelect = select;
        this.actions.appendChild(label);
    }

    createViewButton(){
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'view-button';
        button.setAttribute('aria-label', 'Switch view');
        button.title = 'Switch view';
        button.innerHTML = '<i class="ri-layout-grid-line"></i>';
        this.viewButton = button;
        this.actions.appendChild(button);
    }

    setMeta({ title, eyebrow, empty } = {}){
        if (title !== undefined) this.title.textContent = title;
        if (eyebrow !== undefined) this.eyebrow.textContent = eyebrow;
        if (empty !== undefined) this.emptyMsg.textContent = empty;
    }

    setSortValue(value){
        this.sortSelect.value = value;
        this.sortValue = value;
    }

    setSortHandler(fn){
        this.sortSelect.addEventListener('change', (e) => fn(e.target.value));
    }

    setViewHandler(fn){
        this.viewButton.addEventListener('click', () => {
            this.toggleView();
            fn(this.listView);
        });
    }

    setActionsHidden(hidden){
        this.actions.hidden = hidden;
    }

    setFooterHidden(hidden){
        this.footer.hidden = hidden;
    }

    toggleView(){
        this.listView = !this.listView;
        this.content.classList.toggle('list-view', this.listView);
        this.viewButton.innerHTML = `<i class="ri-${!this.listView ? 'list-check' : 'layout-grid-line'}"></i>`;
        return this.listView;
    }

    addCard(cardData){
        const card = new Card(cardData);
        card.mount(this.content);
        return card;
    }

    clear(){
        this.content.innerHTML = '';
    }

    showEmpty(visible, message){
        this.empty.hidden = !visible;
        if (message !== undefined) this.emptyMsg.textContent = message;
    }

    resetGrid(){
        this.content.className = 'gallery-content';
        if (this.listView) this.content.classList.add('list-view');
    }

    renderInfo(panels){
        this.clear();
        this.content.className = 'gallery-content info-grid';
        panels.forEach((panel) => {
            const div = document.createElement('div');
            div.className = 'info-panel';
            const icon = document.createElement('i');
            icon.className = panel.icon;
            const strong = document.createElement('strong');
            strong.textContent = panel.title;
            const span = document.createElement('span');
            span.textContent = panel.text;
            div.append(icon, strong, span);
            this.content.appendChild(div);
        });
        this.showEmpty(false);
    }

    render(targetId){
        const targetElement = document.getElementById(targetId);
        if (targetElement){
            targetElement.appendChild(this.main);
        } else {
            console.error(`Gallery: target "${targetId}" not found.`);
        }
    }
}