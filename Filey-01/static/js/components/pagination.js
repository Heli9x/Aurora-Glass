class Pagination {
    constructor(){
        this.element = document.createElement('div');
        this.element.className = 'pagination';
        this.element.hidden = true;

        this.prev = document.createElement('button');
        this.prev.type = 'button';
        this.prev.className = 'pager-btn';
        this.prev.setAttribute('aria-label', 'Previous page');
        this.prev.title = 'Previous page';
        const prevIcon = document.createElement('i');
        prevIcon.className = 'ri-arrow-left-s-line';
        this.prev.appendChild(prevIcon);

        this.label = document.createElement('span');
        this.label.className = 'pager-label';

        this.next = document.createElement('button');
        this.next.type = 'button';
        this.next.className = 'pager-btn';
        this.next.setAttribute('aria-label', 'Next page');
        this.next.title = 'Next page';
        const nextIcon = document.createElement('i');
        nextIcon.className = 'ri-arrow-right-s-line';
        this.next.appendChild(nextIcon);

        this.element.append(this.prev, this.label, this.next);
    }

    setPage(current, totalPages){
        this.label.textContent = `${current} / ${totalPages}`;
        this.prev.disabled = current <= 1;
        this.next.disabled = current >= totalPages;
        this.element.hidden = totalPages <= 1;
        return this;
    }

    onNavigate(fn){
        this.prev.addEventListener('click', () => fn(-1));
        this.next.addEventListener('click', () => fn(1));
        return this;
    }

    mount(parent){
        if (parent) parent.appendChild(this.element);
        return this;
    }

    render(targetId){
        const target = document.getElementById(targetId);
        if (target){
            target.appendChild(this.element);
        } else {
            console.error(`Pagination: target "${targetId}" not found.`);
        }
        return this;
    }
}