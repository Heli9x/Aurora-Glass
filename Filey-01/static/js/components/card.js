class Card {
    constructor({ id = null, kind = 'other', imgSrc = '', imgAlt = '', icon = 'ri-file-3-line', title = 'Title', tags = [], btnText = 'Action', onOpen = null, onContext = null } = {}){
        this.id = id;
        this.kind = kind;
        this.onOpen = onOpen;
        this.onContext = onContext;
        this.element = this.#build(imgSrc, imgAlt, icon, title, tags, btnText);
    }

    #build(imgSrc, imgAlt, icon, title, tags, btnText){
        const wrapper = document.createElement('article');
        wrapper.className = 'card-wrapper';
        if (this.id !== null) wrapper.dataset.id = String(this.id);
        wrapper.dataset.kind = this.kind;
        wrapper.tabIndex = 0;

        wrapper.append(
            this.#buildImage(imgSrc, imgAlt, icon),
            this.#buildMore(),
            this.#buildContent(title, tags),
            this.#buildButton(btnText)
        );

        wrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.onContext) this.onContext(e);
        });
        wrapper.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && this.onOpen){
                e.preventDefault();
                this.onOpen();
            }
        });

        return wrapper;
    }

    #buildImage(imgSrc, imgAlt, icon){
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'img-wrapper';

        const iconEl = document.createElement('i');
        iconEl.className = icon;
        imgWrapper.appendChild(iconEl);

        if (imgSrc){
            const img = document.createElement('img');
            img.className = 'card-img';
            img.alt = imgAlt;
            img.loading = 'lazy';
            img.src = imgSrc;
            img.addEventListener('error', () => img.remove());
            imgWrapper.prepend(img);
        }
        return imgWrapper;
    }

    #buildMore(){
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card-more';
        button.setAttribute('aria-label', 'More actions');
        button.title = 'More actions';
        const icon = document.createElement('i');
        icon.className = 'ri-more-2-fill';
        button.appendChild(icon);
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.onContext) this.onContext(e);
        });
        return button;
    }

    #buildContent(title, tags){
        const content = document.createElement('div');
        content.className = 'card-content';

        const titleEl = document.createElement('h3');
        titleEl.className = 'card-title';
        titleEl.textContent = title;
        content.appendChild(titleEl);

        if (tags && tags.length){
            const tagList = document.createElement('ul');
            tagList.className = 'card-tags';
            tags.forEach((tag) => {
                const li = document.createElement('li');
                li.className = 'card-tag';
                const small = document.createElement('small');
                small.className = 'small-text';
                small.textContent = tag;
                li.appendChild(small);
                tagList.appendChild(li);
            });
            content.appendChild(tagList);
        }
        return content;
    }

    #buildButton(btnText){
        const btnWrapper = document.createElement('div');
        btnWrapper.className = 'btn-wrapper';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'card-btn';
        btn.textContent = btnText;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.onOpen) this.onOpen();
        });
        btnWrapper.appendChild(btn);
        return btnWrapper;
    }

    mount(parent){
        parent.appendChild(this.element);
        return this;
    }
}