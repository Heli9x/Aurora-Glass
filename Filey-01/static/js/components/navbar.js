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

        if (data.logo) this.createLogo(data.logo);
        if (data.links) this.createLinks(data.links);
        if (data.actions) this.createActions(data.actions);
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

        for (const [name, [iconClass, url, classList]] of Object.entries(data)){
            const link = document.createElement('a');
            link.href = url;
            link.className = 'nav-link';
            link.dataset.page = name.toLowerCase();
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
        this.main.appendChild(linksWrapper);
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
        this.main.appendChild(actionsWrapper);
    }

    setActive(page){
        this.main.querySelectorAll('.nav-link').forEach((link) => {
            link.classList.toggle('active', link.dataset.page === page);
        });
    }

    setBrand(text){
        const brand = this.main.querySelector('.nav-brand');
        if (brand) brand.textContent = text;
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