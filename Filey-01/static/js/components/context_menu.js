class ContextMenu {
    constructor(){
        this.element = document.createElement('div');
        this.element.className = 'context-menu-wrapper hide';
        this.menu = document.createElement('ul');
        this.menu.className = 'context-menu';
        this.element.appendChild(this.menu);
        document.body.appendChild(this.element);

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu-wrapper')) this.hide();
        });
        document.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.context-menu-wrapper')) this.hide();
        });
        this.element.addEventListener('mouseleave', () => this.hide());
        this.element.addEventListener('click', () => this.hide());
    }

    #buildItem({ icon = '', label = '', onClick } = {}){
        const li = document.createElement('li');
        li.className = 'context-menu-item';

        if (icon){
            const i = document.createElement('i');
            i.className = icon;
            li.appendChild(i);
        }

        const span = document.createElement('span');
        span.textContent = label;
        li.appendChild(span);

        if (onClick) li.addEventListener('click', () => onClick());
        return li;
    }

    open(x, y, items = []){
        this.menu.innerHTML = '';
        items.forEach((item) => this.menu.appendChild(this.#buildItem(item)));
        this.element.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
        this.element.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
        this.element.classList.remove('hide');
    }

    hide(){
        this.element.classList.add('hide');
    }
}