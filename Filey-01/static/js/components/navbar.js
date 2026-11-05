class InfoModal {
    constructor(){
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'nav-info-modal';
        this.title = document.createElement('span');
        this.content = document.createElement('small');
        this.wrapper.append(this.title, this.content);
        document.body.appendChild(this.wrapper);
    }

    show(target){
        const rect = target.getBoundingClientRect();
        this.wrapper.style.left = `${rect.left + rect.width / 2 - 20}px`;
        this.wrapper.style.top = `${rect.bottom + 6}px`;
        const label = target.querySelector('span');
        this.title.textContent = label ? label.textContent : (target.getAttribute('aria-label') || '');
        this.wrapper.style.display = 'block';
    }

    hide(){
        this.wrapper.style.display = 'none';
    }
}

class NavBar {
    constructor(data = {}, onlyIcon = false){
        this.main = document.createElement('nav');
        this.main.className = 'navbar';
        if (onlyIcon) this.main.classList.add('only-icons');
        this.infoModal = new InfoModal();
        this.onSearch = null;
        this.searchTerm = '';

        if (data.logo) this.createLogo(data.logo);
        if (data.links) this.createLinks(data.links);
        if (data.actions) this.createActions(data.actions);
        if (data.search !== false) this.createSearch();
    }

    createSearch(){
        const wrapper = document.createElement('div');
        wrapper.className = 'nav-search';

        const icon = document.createElement('i');
        icon.className = 'ri-search-line';

        const input = document.createElement('input');
        input.type = 'search';
        input.className = 'nav-search-input';
        input.placeholder = 'Search library';
        input.setAttribute('aria-label', 'Search library');

        wrapper.append(icon, input);
        this.searchWrapper = wrapper;
        this.searchInput = input;

        wrapper.addEventListener('click', (event) => {
            if (event.target === input) return;
            event.preventDefault();
            input.focus();
            if (typeof input.setSelectionRange === 'function'){
                const end = input.value.length;
                input.setSelectionRange(end, end);
            }
        });
        icon.addEventListener('mousedown', (event) => event.preventDefault());

        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => this.emitSearch(input.value), 200);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape'){
                input.value = '';
                this.emitSearch('');
                input.blur();
            }
        });
        document.addEventListener('keydown', (event) => {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)){
                event.preventDefault();
                input.focus();
            }
        });

        const actions = this.main.querySelector('.nav-actions');
        this.ensureEnd().insertBefore(wrapper, actions || null);
    }

    ensureEnd(){
        if (!this.endWrapper){
            this.endWrapper = document.createElement('div');
            this.endWrapper.className = 'nav-end';
            this.main.appendChild(this.endWrapper);
        }
        return this.endWrapper;
    }

    emitSearch(value){
        this.searchTerm = value.trim();
        if (this.onSearch) this.onSearch(this.searchTerm);
    }

    setQuery(value){
        this.searchTerm = value || '';
        if (this.searchInput && this.searchInput.value !== this.searchTerm){
            this.searchInput.value = this.searchTerm;
        }
    }

    createLogo([brand, icon, href]){
        const logoWrapper = document.createElement('a');
        logoWrapper.className = 'nav-logo';
        logoWrapper.href = href || '#';
        logoWrapper.setAttribute('aria-label', brand);

        const logoImage = document.createElement('span');
        logoImage.className = 'nav-img';
        const iconEl = document.createElement('i');
        iconEl.className = icon;
        logoImage.appendChild(iconEl);

        const logoBrand = document.createElement('span');
        logoBrand.className = 'nav-brand';
        logoBrand.textContent = brand;

        logoWrapper.append(logoImage, logoBrand);
        this.main.appendChild(logoWrapper);
    }

    createLinks(data){
        const linksWrapper = document.createElement('div');
        linksWrapper.className = 'nav-links';
        this.linksWrapper = linksWrapper;

        for (const [name, [iconClass, url, classList, handler]] of Object.entries(data)){
            const link = document.createElement(handler ? 'button' : 'a');
            if (handler){
                link.type = 'button';
                link.dataset.group = url;
                link.setAttribute('aria-haspopup', 'dialog');
                link.addEventListener('click', handler);
            } else {
                link.href = url;
            }
            link.className = 'nav-link';
            link.dataset.page = handler ? '' : url.replace(/^#/, '').toLowerCase();
            link.setAttribute('aria-label', name);
            link.setAttribute('title', name);
            if (classList) link.classList.add(...classList);

            const icon = document.createElement('i');
            icon.className = iconClass;
            const label = document.createElement('span');
            label.textContent = name;

            link.append(icon, label);
            link.addEventListener('mouseover', (e) => {
                if (this.main.classList.contains('only-icons')) this.infoModal.show(e.currentTarget);
            });
            link.addEventListener('mouseleave', () => this.infoModal.hide());

            linksWrapper.appendChild(link);
        }
        this.main.insertBefore(linksWrapper, this.endWrapper || null);
    }

    setLinks(data){
        if (this.linksWrapper) this.linksWrapper.remove();
        this.createLinks(data);
    }

    createActions(data){
        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'nav-actions';

        for (const [name, [actionFunction, iconClass, classList]] of Object.entries(data)){
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'nav-action-button';
            button.setAttribute('aria-label', name);
            button.setAttribute('title', name);
            if (classList) button.classList.add(...classList);

            const icon = document.createElement('i');
            icon.className = iconClass;
            const label = document.createElement('span');
            label.textContent = name;

            button.append(icon, label);
            button.addEventListener('click', actionFunction);
            button.addEventListener('mouseover', (e) => {
                if (this.main.classList.contains('only-icons')) this.infoModal.show(e.currentTarget);
            });
            button.addEventListener('mouseleave', () => this.infoModal.hide());

            actionsWrapper.appendChild(button);
        }
        this.ensureEnd().appendChild(actionsWrapper);
    }

    setActive(page, group = ''){
        this.main.querySelectorAll('.nav-link').forEach((link) => {
            const active = link.dataset.group
                ? link.dataset.group === group
                : link.dataset.page === page;
            link.classList.toggle('active', active);
        });
    }

    setBrand(text){
        const brand = this.main.querySelector('.nav-brand');
        if (brand) brand.textContent = text;
    }

    setAdminVisible(visible){
        const actions = this.main.querySelector('.nav-actions');
        if (actions) actions.hidden = !visible;
    }

    setAccount(user, onSignOut){
        if (this.accountWrapper){
            this.accountWrapper.remove();
            this.accountWrapper = null;
        }
        if (!user) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'nav-account';
        const icon = document.createElement('i');
        icon.className = 'ri-user-line';
        const name = document.createElement('span');
        name.textContent = user.username;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nav-signout';
        button.title = 'Sign out';
        button.setAttribute('aria-label', 'Sign out');
        button.innerHTML = '<i class="ri-logout-box-r-line"></i>';
        button.addEventListener('click', () => {
            if (onSignOut) onSignOut();
        });
        wrapper.append(icon, name, button);
        this.ensureEnd().appendChild(wrapper);
        this.accountWrapper = wrapper;
    }

    render(targetId){
        const targetElement = document.getElementById(targetId);
        if (targetElement){
            targetElement.appendChild(this.main);
        } else {
            console.error(`NavBar: target "${targetId}" not found.`);
        }
    }
}