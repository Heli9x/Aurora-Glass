class Card {
    constructor({
        imgSrc = "",
        imgAlt = "",
        title = "Title",
        tags = [],
        btnText = "Action",
        btnHref = "#"
    } = {}) {
        this.imgSrc = imgSrc;
        this.imgAlt = imgAlt;
        this.title = title;
        this.tags = tags;
        this.btnText = btnText;
        this.btnHref = btnHref;

        this.element = this.#build();
    }

    #build() {
        const wrapper = document.createElement("div");
        wrapper.className = "card-wrapper";

        wrapper.append(this.#buildImage(), this.#buildContent(), this.#buildButton());

        return wrapper;
    }

    #buildImage() {
        const imgWrapper = document.createElement("div");
        imgWrapper.className = "img-wrapper";

        const img = document.createElement("img");
        img.className = "card-img";
        img.alt = this.imgAlt;

        const icon = document.createElement("i");
        icon.className = "ri-image-line";

        // only show the real image once a source is provided, otherwise fall back to the placeholder icon
        if (this.imgSrc) {
            img.src = this.imgSrc;
            img.style.display = "block";
            icon.style.display = "none";
        }

        imgWrapper.append(img, icon);
        return imgWrapper;
    }

    #buildContent() {
        const content = document.createElement("div");
        content.className = "card-content";

        const title = document.createElement("h3");
        title.className = "card-title";
        title.textContent = this.title;

        const tagList = document.createElement("ul");
        tagList.className = "card-tags";

        this.tags.forEach((tag) => {
            const li = document.createElement("li");
            li.className = "card-tag";

            const small = document.createElement("small");
            small.className = "small-text";
            small.textContent = tag;

            li.appendChild(small);
            tagList.appendChild(li);
        });

        content.append(title, tagList);
        return content;
    }

    #buildButton() {
        const btnWrapper = document.createElement("div");
        btnWrapper.className = "btn-wrapper";

        const btn = document.createElement("a");
        btn.className = "card-btn";
        btn.href = this.btnHref;
        btn.textContent = this.btnText;

        btnWrapper.appendChild(btn);
        return btnWrapper;
    }

    mount(parent) {
        parent.appendChild(this.element);
        return this;
    }
}


class Gallery {
    constructor(data = {}) {
        this.data = data;
        this.main = document.createElement('div');
        this.main.className = 'gallery-wrapper';

        if (this.data.title || this.data.actions) {
            this.createHeader(this.data.title, this.data.actions);
        }

        this.galleryContent = document.createElement('div');
        this.galleryContent.className = 'gallery-content';
        this.main.appendChild(this.galleryContent);
    }

    createHeader(title, actionsData) {
        const header = document.createElement('div');
        header.className = 'gallery-header';

        if (title) {
            const titleDiv = document.createElement('div');
            titleDiv.className = 'title';
            titleDiv.textContent = title;
            header.appendChild(titleDiv);
        }

        if (actionsData) {
            this.createActions(actionsData, header);
        }

        this.main.appendChild(header);
    }

    createActions(actions, parent) {
        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'actions';

        for (const actionName in actions) {
            const action = actions[actionName];
            const button = document.createElement('button');
            if (action.class) {
                button.className = action.class;
            }
            if (action.icon) {
                button.classList.add(action.icon);
            }
            if (action.onClick) {
                button.addEventListener('click', action.onClick);
            }
            actionsWrapper.appendChild(button);
        }
        parent.appendChild(actionsWrapper);
    }

    /**
     * @public
     * @param {object} data - The data for the card component.
     * This method accepts data to be added to the card component, 
     * which will be appended into the grid of the gallery content.
     */
    addCard(data) {
        if (!this.galleryContent) {
            console.error('Cannot add card, gallery content area not found.');
            return;
        }
        const card = new Card(data);
        card.mount(this.galleryContent);
    }

    render(targetId) {
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
            targetElement.appendChild(this.main);
        } else {
            console.error(`Target element with id "${targetId}" not found.`);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const galleryData = {
        title: 'Gallery',
        actions: {
            'upload': {
                icon: 'ri-upload-cloud-line',
                class: 'upload-button',
                onClick: () => alert('Upload clicked')
            },
            'sort': {
                icon: 'ri-sort-asc',
                class: 'edit-button',
                onClick: () => alert('Sort clicked')
            }
        }
    };

    const gallery = new Gallery(galleryData);
    gallery.render('gallery-container');

    const sampleData = [
        {
            imgSrc: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=870&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
            imgAlt: 'A mountain landscape',
            title: 'Mountain View',
            tags: ['mountain', 'landscape', 'nature'],
            btnText: 'Explore',
            btnHref: '#'
        },
        {
            imgSrc: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTF8fG5hdHVyZXxlbnwwfHwwfHx8MA%3D%3D',
            imgAlt: 'A beautiful sunrise',
            title: 'Morning Sunrise',
            tags: ['sunrise', 'nature', 'morning'],
            btnText: 'Discover',
            btnHref: '#'
        },
        {
            imgSrc: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Nnx8bmF0dXJlfGVufDB8fHwwfHx8MA%3D%3D',
            imgAlt: 'A forest path',
            title: 'Forest Path',
            tags: ['forest', 'path', 'trees'],
            btnText: 'Learn More',
            btnHref: '#'
        },
    ];

    sampleData.forEach(data => {
        gallery.addCard(data);
    });
});