class Settings {
    constructor(){
        this.element = document.createElement('div');
        this.element.className = 'settings';
        this.onSaveName = null;
        this.onSaveStorage = null;
        this.onPrefsChange = null;
        this.createNameSection();
        this.createStorageSection();
        this.createPrefsSection();
    }

    createNameSection(){
        const field = document.createElement('section');
        field.className = 'settings-card';

        const h2 = document.createElement('h2');
        h2.textContent = 'Platform';

        const hint = document.createElement('p');
        hint.className = 'settings-hint';
        hint.textContent = 'A display name used across the whole platform, shared by every client.';

        const row = document.createElement('div');
        row.className = 'settings-row';
        const label = document.createElement('label');
        label.htmlFor = 'settings-name';
        label.textContent = 'Platform name';
        this.nameInput = document.createElement('input');
        this.nameInput.id = 'settings-name';
        this.nameInput.type = 'text';
        this.nameInput.maxLength = 40;
        this.nameInput.placeholder = 'Filey';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'settings-btn';
        save.textContent = 'Save name';
        save.addEventListener('click', () => {
            const value = this.nameInput.value.trim();
            if (value && this.onSaveName) this.onSaveName(value);
        });
        row.append(label, this.nameInput, save);

        this.nameMsg = document.createElement('p');
        this.nameMsg.className = 'settings-msg';
        field.append(h2, hint, row, this.nameMsg);
        this.element.appendChild(field);
    }

    createStorageSection(){
        const field = document.createElement('section');
        field.className = 'settings-card';

        const h2 = document.createElement('h2');
        h2.textContent = 'Storage';

        const hint = document.createElement('p');
        hint.className = 'settings-hint';
        hint.textContent = 'Where files live. Changing this requires a server restart to take effect.';

        this.storageList = document.createElement('div');
        this.storageList.className = 'settings-storage-list';

        this.customInput = document.createElement('input');
        this.customInput.type = 'text';
        this.customInput.placeholder = 'Custom path like /mnt/data ...';
        this.customInput.classList.add('settings-custom');

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'settings-btn';
        save.textContent = 'Save storage';
        save.addEventListener('click', () => {
            const selected = this.selectedStorage();
            if (selected && this.onSaveStorage){
                this.onSaveStorage(selected, this.nameInput.value.trim());
            }
        });

        const customRow = document.createElement('div');
        customRow.className = 'settings-row';
        customRow.append(this.customInput, save);

        this.storageMsg = document.createElement('p');
        this.storageMsg.className = 'settings-msg';

        field.append(h2, hint, this.storageList, customRow, this.storageMsg);
        this.element.appendChild(field);
    }

    createPrefsSection(){
        const field = document.createElement('section');
        field.className = 'settings-card';

        const h2 = document.createElement('h2');
        h2.textContent = 'Your defaults (this browser)';

        const hint = document.createElement('p');
        hint.className = 'settings-hint';
        hint.textContent = 'Saved locally and applied next time you open the library.';

        const grid = document.createElement('div');
        grid.className = 'settings-prefs';

        const viewLabel = this.fieldSelect('settings-pref-view', 'View', ['grid', 'list']);
        const pageLabel = this.fieldSelect('settings-pref-page', 'Items per page', ['12', '24', '48', '96']);
        const sortLabel = this.fieldSelect('settings-pref-sort', 'Sort', [
            ['default', 'Recent first'],
            ['oldest', 'Oldest first'],
            ['name_asc', 'Name A-Z'],
            ['name_desc', 'Name Z-A'],
            ['size_desc', 'Largest first'],
            ['size_asc', 'Smallest first'],
            ['type', 'Type'],
        ]);

        this.viewSelect = viewLabel.querySelector('select');
        this.pageSelect = pageLabel.querySelector('select');
        this.sortSelect = sortLabel.querySelector('select');

        for (const select of [this.viewSelect, this.pageSelect, this.sortSelect]){
            select.addEventListener('change', () => {
                if (this.onPrefsChange) this.onPrefsChange(this.collectPrefs());
            });
        }

        grid.append(viewLabel, pageLabel, sortLabel);
        field.append(h2, hint, grid);
        this.element.appendChild(field);
    }

    fieldSelect(id, caption, options){
        const label = document.createElement('label');
        label.className = 'settings-field';
        label.htmlFor = id;
        const span = document.createElement('span');
        span.textContent = caption;
        const select = document.createElement('select');
        select.id = id;
        for (const option of options){
            const opt = document.createElement('option');
            if (Array.isArray(option)){
                opt.value = option[0];
                opt.textContent = option[1];
            } else {
                opt.value = option;
                opt.textContent = option;
            }
            select.appendChild(opt);
        }
        label.append(span, select);
        return label;
    }

    setData({ platform_name, storage_dir, candidates } = {}){
        if (platform_name !== undefined){
            this.nameInput.value = platform_name;
            this.nameMsg.textContent = '';
        }
        this.storageList.textContent = '';
        let matched = false;
        (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
            const label = document.createElement('label');
            label.className = 'settings-radio';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'settings-storage';
            radio.dataset.path = candidate.path;
            label.append(radio);
            const span = document.createElement('span');
            span.textContent = candidate.path;
            label.appendChild(span);
            const meta = document.createElement('small');
            const flags = [];
            if (candidate.exists_schema) flags.push('valid layout');
            flags.push(candidate.writable ? 'writable' : 'read-only');
            meta.textContent = flags.join(' · ');
            label.appendChild(meta);
            if (storage_dir && candidate.path === storage_dir){
                radio.checked = true;
                matched = true;
            }
            this.storageList.appendChild(label);
        });
        if (!matched && storage_dir){
            this.customInput.value = storage_dir;
        }
    }

    selectedStorage(){
        for (const radio of this.storageList.querySelectorAll('input[type=radio]')){
            if (radio.checked) return radio.dataset.path;
        }
        const custom = this.customInput.value.trim();
        return custom || null;
    }

    setPrefs({ sort, perPage, view } = {}){
        if (this.sortSelect.value !== sort) this.sortSelect.value = sort;
        if (this.pageSelect.value !== String(perPage)) this.pageSelect.value = String(perPage);
        if (this.viewSelect.value !== view) this.viewSelect.value = view;
    }

    collectPrefs(){
        return {
            sort: this.sortSelect.value,
            perPage: Number(this.pageSelect.value),
            view: this.viewSelect.value,
        };
    }

    setStatus(message, kind = 'ok'){
        this.storageMsg.textContent = message || '';
        this.storageMsg.classList.toggle('error', kind === 'error');
    }

    setStorageStatus(message, kind = 'ok'){
        this.setStatus(message, kind);
    }

    setNameStatus(message, kind = 'ok'){
        this.nameMsg.textContent = message || '';
        this.nameMsg.classList.toggle('error', kind === 'error');
    }

    render(target = null){
        if (target) target.appendChild(this.element);
        return this;
    }
}