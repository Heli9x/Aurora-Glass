class Guide {
    constructor(){
        this.element = document.createElement('div');
        this.element.className = 'guide';
        this.statEls = new Map();
    }

    render(sections = [], target = null){
        this.element.textContent = '';
        this.statEls.clear();
        sections.forEach((section) => {
            const details = document.createElement('details');
            details.className = 'guide-section';

            const summary = document.createElement('summary');
            summary.className = 'guide-summary';
            const icon = document.createElement('i');
            icon.className = section.icon || 'ri-information-line';
            const title = document.createElement('span');
            title.textContent = section.title || '';
            const chevron = document.createElement('i');
            chevron.className = 'ri-arrow-right-s-line guide-chevron';
            summary.append(icon, title, chevron);

            const body = document.createElement('div');
            body.className = 'guide-body';
            (section.body || []).forEach((row) => {
                const item = document.createElement('div');
                item.className = 'guide-row';
                const rowIcon = document.createElement('i');
                rowIcon.className = row.icon || 'ri-check-line';
                const text = document.createElement('p');
                text.className = 'guide-text';
                if (row.stat){
                    text.dataset.stat = row.stat;
                    text.textContent = '…';
                    this.statEls.set(row.stat, text);
                } else {
                    text.textContent = row.text || '';
                }
                if (row.title){
                    const rowTitle = document.createElement('strong');
                    rowTitle.className = 'guide-row-title';
                    rowTitle.textContent = row.title;
                    text.prepend(rowTitle);
                }
                item.append(rowIcon, text);
                body.appendChild(item);
            });

            details.append(summary, body);
            this.element.appendChild(details);
        });
        if (target) target.appendChild(this.element);
        return this;
    }

    applyStats(values = {}, formatter = (value) => String(value)){
        for (const [key, element] of this.statEls){
            const value = values[key];
            if (value !== undefined){
                element.textContent = formatter(value, key);
            }
        }
        return this;
    }
}