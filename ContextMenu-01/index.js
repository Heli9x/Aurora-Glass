class ContextMenu {
    constructor(items = []) {
        this.items = items;
        this.element = this.#build();
        this.element.addEventListener("mouseleave", () => this.hide());

        document.body.appendChild(this.element);
    }

    #build() {
        const wrapper = document.createElement("div");
        wrapper.className = "context-menu-wrapper";

        this.menu = document.createElement("ul");
        this.menu.className = "context-menu";

        this.items.forEach((item) => this.menu.appendChild(this.#buildItem(item)));

        wrapper.appendChild(this.menu);
        return wrapper;
    }

    #buildItem({ icon = "", label = "", onClick } = {}) {
        const li = document.createElement("li");
        li.className = "context-menu-item";

        if (icon) {
            const i = document.createElement("i");
            i.className = icon;
            li.appendChild(i);
        }

        const span = document.createElement("span");
        span.textContent = label;
        li.appendChild(span);

        if (onClick) {
            li.addEventListener("click", (e) => {
                onClick(e);
                this.hide();
            });
        }

        return li;
    }

    show(x, y) {
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
        this.menu.style.display = "flex";
    }

    hide() {
        this.menu.style.display = "none";
    }

    /**
     * @public
     * @param {string} targetSelector - CSS selector for elements that trigger the menu.
     * Attaches a document-wide left click listener so the menu appears next to any
     * matching target and closes when the mouse leaves it or a click occurs elsewhere.
     */
    init(targetSelector) {
        document.addEventListener("click", (e) => {
            const target = e.target.closest(targetSelector);
            if (target) {
                this.show(e.pageX, e.pageY);
            } else if (!e.target.closest(".context-menu-wrapper")) {
                this.hide();
            }
        });

        return this;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const contextMenu = new ContextMenu([
        { icon: "ri-edit-line", label: "Rename", onClick: () => alert("Rename clicked") },
        { icon: "ri-download-line", label: "Download", onClick: () => alert("Download clicked") },
        { icon: "ri-box-1-line", label: "Open", onClick: () => alert("Open clicked") }
    ]);

    contextMenu.init(".context-target");
});
