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

const card = new Card({
    title: "Title",
    tags: ["lorem", "Ipsum"],
    btnText: "Action",
    btnHref: "#"
});

card.mount(document.querySelector(".card-container"));