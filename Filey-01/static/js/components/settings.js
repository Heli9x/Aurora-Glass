class Settings {
    constructor(){
        this.element = document.createElement('div');
        this.element.className = 'settings';
        this.onSaveName = null;
        this.onSaveStorage = null;
        this.onPrefsChange = null;
        this.onSaveHls = null;
        this.onSaveCategories = null;
        this.onAddCategory = null;
        this.onDeleteCategory = null;
        this.onScanCategory = null;
        this.onCreateUser = null;
        this.onUpdateUser = null;
        this.onDeleteUser = null;
        this.categories = [];
        this.nativeRoots = {};
        this.users = [];
        this.currentUserId = null;
        this.createNameSection();
        this.createStorageSection();
        this.createCategoriesSection();
        this.createUsersSection();
        this.createHlsSection();
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

    createCategoriesSection(){
        const field = document.createElement('section');
        field.className = 'settings-card';

        const h2 = document.createElement('h2');
        h2.textContent = 'Libraries';

        const hint = document.createElement('p');
        hint.className = 'settings-hint';
        hint.textContent = 'Each library maps a media type to a storage folder. Managed roots keep copies inside Filey; linked roots index existing files in place.';

        this.categoryList = document.createElement('div');
        this.categoryList.className = 'settings-category-list';

        this.nativeList = document.createElement('datalist');
        this.nativeList.id = 'settings-native-roots';

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'settings-btn';
        save.textContent = 'Save libraries';
        save.addEventListener('click', () => {
            if (this.onSaveCategories) this.onSaveCategories(this.collectCategories());
        });

        this.categoryMsg = document.createElement('p');
        this.categoryMsg.className = 'settings-msg';

        field.append(h2, hint, this.categoryList, this.createCategoryForm(), save, this.categoryMsg, this.nativeList);
        this.element.appendChild(field);
    }

    createCategoryForm(){
        const grid = document.createElement('div');
        grid.className = 'settings-category-add';

        this.newLabel = this.fieldInput('settings-cat-label', 'New library name', 'text');
        this.newExtensions = this.fieldInput('settings-cat-ext', 'Extensions (space separated)', 'text');
        this.newRoot = this.fieldInput('settings-cat-root', 'Storage folder (optional)', 'text');
        this.newRoot.querySelector('input').setAttribute('list', 'settings-native-roots');
        this.newIcon = this.fieldInput('settings-cat-icon', 'Icon class', 'text');
        const iconInput = this.newIcon.querySelector('input');
        iconInput.placeholder = 'ri-folder-6-fill';
        iconInput.value = 'ri-folder-6-fill';
        iconInput.setAttribute('aria-describedby', 'settings-cat-icon-help');
        const iconControl = document.createElement('div');
        iconControl.className = 'settings-icon-control';
        const iconHelp = document.createElement('small');
        iconHelp.id = 'settings-cat-icon-help';
        iconHelp.className = 'settings-field-help';
        iconHelp.textContent = 'Use a Remix Icon class, e.g. ri-brain-line';
        this.newIconPreview = document.createElement('i');
        this.newIconPreview.className = 'ri-folder-6-fill';
        this.newIconPreview.setAttribute('aria-hidden', 'true');
        iconControl.append(this.newIconPreview, iconInput);
        this.newIcon.append(iconControl, iconHelp);
        iconInput.addEventListener('input', () => {
            this.newIconPreview.className = iconInput.value.trim() || 'ri-folder-6-fill';
        });

        const modeLabel = document.createElement('label');
        modeLabel.className = 'settings-field';
        modeLabel.htmlFor = 'settings-cat-mode';
        const modeSpan = document.createElement('span');
        modeSpan.textContent = 'Mode';
        this.newMode = document.createElement('select');
        this.newMode.id = 'settings-cat-mode';
        [['managed', 'Managed (copy into root)'], ['linked', 'Linked (index in place)']].forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            this.newMode.appendChild(option);
        });
        modeLabel.append(modeSpan, this.newMode);

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'settings-btn';
        add.textContent = 'Add library';
        add.addEventListener('click', () => this.submitCategory());

        grid.append(this.newLabel, this.newExtensions, this.newRoot, this.newIcon, modeLabel, add);
        return grid;
    }

    async submitCategory(){
        if (!this.onAddCategory) return;
        const label = this.newLabel.querySelector('input').value.trim();
        if (!label){
            this.setCategoryStatus('Enter a library name', 'error');
            return;
        }
        const added = await this.onAddCategory({
            label,
            extensions: this.newExtensions.querySelector('input').value.split(/[\s,]+/).filter(Boolean),
            mode: this.newMode.value,
            root: this.newRoot.querySelector('input').value.trim() || null,
            icon: this.newIcon.querySelector('input').value.trim() || 'ri-folder-6-fill'
        });
        if (!added) return;
        this.newLabel.querySelector('input').value = '';
        this.newExtensions.querySelector('input').value = '';
        this.newRoot.querySelector('input').value = '';
        this.newIcon.querySelector('input').value = 'ri-folder-6-fill';
        this.newIconPreview.className = 'ri-folder-6-fill';
    }

    categoryRow(category){
        const row = document.createElement('div');
        row.className = 'settings-category';
        row.dataset.category = category.id;

        const name = document.createElement('span');
        name.className = 'settings-category-name';
        const icon = document.createElement('i');
        icon.className = category.icon || 'ri-folder-6-fill';
        const strong = document.createElement('strong');
        strong.textContent = category.label || category.id;
        name.append(icon, strong);
        if (!category.builtin){
            const count = document.createElement('small');
            count.textContent = `${category.count || 0} file${category.count === 1 ? '' : 's'}`;
            name.appendChild(count);
        }

        const labelInput = document.createElement('input');
        labelInput.className = 'cat-label';
        labelInput.type = 'text';
        labelInput.value = category.label || category.id;
        labelInput.maxLength = 40;
        labelInput.setAttribute('aria-label', 'Library name');

        const extInput = document.createElement('input');
        extInput.className = 'cat-ext';
        extInput.type = 'text';
        extInput.value = (category.extensions || []).join(' ');
        extInput.placeholder = '.ext .ext';
        extInput.setAttribute('aria-label', 'Extensions');

        const rootInput = document.createElement('input');
        rootInput.className = 'cat-root';
        rootInput.type = 'text';
        rootInput.value = category.root || '';
        rootInput.placeholder = 'Filey storage (default)';
        rootInput.setAttribute('list', 'settings-native-roots');
        rootInput.setAttribute('aria-label', 'Storage folder');

        const mode = document.createElement('select');
        mode.className = 'cat-mode';
        mode.setAttribute('aria-label', 'Mode');
        [['managed', 'Managed'], ['linked', 'Linked']].forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            mode.appendChild(option);
        });
        mode.value = category.mode || 'managed';

        const scan = document.createElement('button');
        scan.type = 'button';
        scan.className = 'settings-btn small';
        scan.textContent = 'Scan';
        scan.title = 'Index existing files in this folder';
        scan.addEventListener('click', () => {
            if (this.onScanCategory) this.onScanCategory(category.id);
        });

        row.append(name, labelInput, extInput, rootInput, mode, scan);

        if (!category.builtin){
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'settings-btn small danger';
            remove.textContent = 'Remove';
            remove.addEventListener('click', () => {
                if (this.onDeleteCategory) this.onDeleteCategory(category.id);
            });
            row.appendChild(remove);
        }
        return row;
    }

    setCategories({ categories, native_roots } = {}){
        if (!this.categoryList) return;
        if (Array.isArray(categories)) this.categories = categories;
        if (native_roots && typeof native_roots === 'object') this.nativeRoots = native_roots;

        this.nativeList.textContent = '';
        Object.values(this.nativeRoots).forEach((path) => {
            const option = document.createElement('option');
            option.value = path;
            this.nativeList.appendChild(option);
        });

        this.categoryList.textContent = '';
        this.categories.forEach((category) => {
            this.categoryList.appendChild(this.categoryRow(category));
        });
        this.setCategoryStatus('');
    }

    collectCategories(){
        const result = {};
        this.categoryList.querySelectorAll('[data-category]').forEach((row) => {
            const id = row.dataset.category;
            result[id] = {
                label: row.querySelector('.cat-label').value.trim() || id,
                root: row.querySelector('.cat-root').value.trim() || null,
                mode: row.querySelector('.cat-mode').value,
                extensions: row.querySelector('.cat-ext').value.split(/[\s,]+/).filter(Boolean)
            };
        });
        return result;
    }

    setCategoryStatus(message, kind = 'ok'){
        if (!this.categoryMsg) return;
        this.categoryMsg.textContent = message || '';
        this.categoryMsg.classList.toggle('error', kind === 'error');
    }

    createUsersSection(){
        const field = document.createElement('section');
        field.className = 'settings-card users-section';

        const h2 = document.createElement('h2');
        h2.textContent = 'Users';

        const hint = document.createElement('p');
        hint.className = 'settings-hint';
        hint.textContent = 'Admins manage the library. Clients can browse, search, stream, and download.';

        this.userList = document.createElement('div');
        this.userList.className = 'settings-user-list';

        const grid = document.createElement('div');
        grid.className = 'settings-user-add';

        this.newUsername = this.fieldInput('settings-user-name', 'Username', 'text');
        this.newPassword = this.fieldInput('settings-user-password', 'Password (min 8)', 'password');
        const roleLabel = document.createElement('label');
        roleLabel.className = 'settings-field';
        roleLabel.htmlFor = 'settings-user-role';
        const roleSpan = document.createElement('span');
        roleSpan.textContent = 'Role';
        this.newRole = document.createElement('select');
        this.newRole.id = 'settings-user-role';
        [['client', 'Client'], ['admin', 'Admin']].forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            this.newRole.appendChild(option);
        });
        roleLabel.append(roleSpan, this.newRole);

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'settings-btn';
        add.textContent = 'Add user';
        add.addEventListener('click', () => this.submitUser());

        grid.append(this.newUsername, this.newPassword, roleLabel, add);
        this.usersMsg = document.createElement('p');
        this.usersMsg.className = 'settings-msg';

        field.append(h2, hint, this.userList, grid, this.usersMsg);
        this.usersSection = field;
        this.element.appendChild(field);
    }

    async submitUser(){
        if (!this.onCreateUser) return;
        const username = this.newUsername.querySelector('input').value.trim();
        const password = this.newPassword.querySelector('input').value;
        if (!username || !password){
            this.setUsersStatus('Enter a username and password', 'error');
            return;
        }
        const created = await this.onCreateUser({
            username,
            password,
            role: this.newRole.value
        });
        if (!created) return;
        this.newUsername.querySelector('input').value = '';
        this.newPassword.querySelector('input').value = '';
        this.newRole.value = 'client';
        this.setUsersStatus('User added');
    }

    userRow(user){
        const row = document.createElement('div');
        row.className = 'settings-user';
        row.dataset.userId = user.id;

        const name = document.createElement('span');
        name.className = 'settings-user-name';
        const icon = document.createElement('i');
        icon.className = user.disabled ? 'ri-user-forbid-line' : 'ri-user-line';
        const strong = document.createElement('strong');
        strong.textContent = user.username;
        name.append(icon, strong);
        if (user.id === this.currentUserId){
            const self = document.createElement('small');
            self.textContent = 'you';
            name.appendChild(self);
        }
        if (user.disabled){
            const off = document.createElement('small');
            off.textContent = 'disabled';
            name.appendChild(off);
        }

        const role = document.createElement('select');
        role.className = 'user-role';
        role.setAttribute('aria-label', 'Role');
        [['client', 'Client'], ['admin', 'Admin']].forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            role.appendChild(option);
        });
        role.value = user.role || 'client';
        role.addEventListener('change', async () => {
            const ok = this.onUpdateUser
                ? await this.onUpdateUser(user.id, { role: role.value })
                : false;
            if (!ok) role.value = user.role || 'client';
        });

        const password = document.createElement('input');
        password.className = 'user-password';
        password.type = 'password';
        password.placeholder = 'New password (min 8)';
        password.setAttribute('aria-label', 'New password');

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'settings-btn small';
        reset.textContent = 'Reset password';
        reset.addEventListener('click', async () => {
            const value = password.value;
            if (value.length < 8){
                this.setUsersStatus('Password must be at least 8 characters', 'error');
                return;
            }
            const ok = this.onUpdateUser
                ? await this.onUpdateUser(user.id, { password: value })
                : false;
            if (ok){
                password.value = '';
                this.setUsersStatus('Password updated');
            }
        });

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'settings-btn small';
        toggle.textContent = user.disabled ? 'Enable' : 'Disable';
        toggle.disabled = user.id === this.currentUserId;
        toggle.addEventListener('click', async () => {
            if (this.onUpdateUser) await this.onUpdateUser(user.id, { disabled: !user.disabled });
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'settings-btn small danger';
        remove.textContent = 'Delete';
        remove.disabled = user.id === this.currentUserId;
        remove.addEventListener('click', async () => {
            if (this.onDeleteUser) await this.onDeleteUser(user.id);
        });

        row.append(name, role, password, reset, toggle, remove);
        return row;
    }

    setUsers(users, currentUserId = null){
        if (!this.userList) return;
        this.users = Array.isArray(users) ? users : this.users;
        if (currentUserId !== null) this.currentUserId = currentUserId;
        this.userList.textContent = '';
        this.users.forEach((user) => {
            this.userList.appendChild(this.userRow(user));
        });
        this.setUsersStatus('');
    }

    setUsersVisible(visible){
        if (this.usersSection) this.usersSection.hidden = !visible;
    }

    setUsersStatus(message, kind = 'ok'){
        if (!this.usersMsg) return;
        this.usersMsg.textContent = message || '';
        this.usersMsg.classList.toggle('error', kind === 'error');
    }

    createHlsSection(){
        const field = document.createElement('section');
        field.className = 'settings-card';

        const h2 = document.createElement('h2');
        h2.textContent = 'Transcoding / HLS';

        const hint = document.createElement('p');
        hint.className = 'settings-hint';
        hint.textContent = 'Caps on the on-demand conversion workers. Changes apply to the next conversion — no server restart needed.';

        const grid = document.createElement('div');
        grid.className = 'settings-prefs';

        this.hlsConcurrency = this.fieldInput('settings-hls-concurrency', 'Max concurrent conversions', 'number');
        this.hlsRlimit = this.fieldInput('settings-hls-rlimit', 'Memory cap per conversion (MB, 0 = off)', 'number');
        this.hlsThreads = this.fieldInput('settings-hls-threads', 'x264 threads (CPU fallback)', 'number');
        this.hlsLookahead = this.fieldInput('settings-hls-lookahead', 'x264 lookahead (frames)', 'number');

        const presetLabel = document.createElement('label');
        presetLabel.className = 'settings-field';
        presetLabel.htmlFor = 'settings-hls-preset';
        const presetSpan = document.createElement('span');
        presetSpan.textContent = 'x264 preset';
        this.hlsPreset = document.createElement('select');
        this.hlsPreset.id = 'settings-hls-preset';
        presetLabel.append(presetSpan, this.hlsPreset);

        grid.append(this.hlsConcurrency, this.hlsRlimit, this.hlsThreads, this.hlsLookahead, presetLabel);

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'settings-btn';
        save.textContent = 'Save transcoding';
        save.addEventListener('click', () => {
            if (this.onSaveHls) this.onSaveHls(this.collectHls());
        });

        this.hlsMsg = document.createElement('p');
        this.hlsMsg.className = 'settings-msg';

        field.append(h2, hint, grid, save, this.hlsMsg);
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

    fieldInput(id, caption, type = 'text'){
        const label = document.createElement('label');
        label.className = 'settings-field';
        label.htmlFor = id;
        const span = document.createElement('span');
        span.textContent = caption;
        const input = document.createElement('input');
        input.type = type;
        input.id = id;
        if (type === 'number'){
            input.step = '1';
            input.inputMode = 'numeric';
        }
        label.append(span, input);
        return label;
    }

    setData({ platform_name, storage_dir, candidates, hls } = {}){
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
        if (hls) this.setHls(hls);
    }

    setHls({ values, defaults, limits, presets } = {}){
        limits = limits || {};
        this.hlsPreset.textContent = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = `Default (${(defaults && defaults.preset) || 'current'})`;
        this.hlsPreset.appendChild(defaultOption);
        (Array.isArray(presets) ? presets : []).forEach((preset) => {
            const option = document.createElement('option');
            option.value = preset;
            option.textContent = preset;
            this.hlsPreset.appendChild(option);
        });

        this.hlsConcurrencyInput = this.hlsConcurrency.querySelector('input');
        this.hlsRlimitInput = this.hlsRlimit.querySelector('input');
        this.hlsThreadsInput = this.hlsThreads.querySelector('input');
        this.hlsLookaheadInput = this.hlsLookahead.querySelector('input');

        const apply = (input, key) => {
            if (!input) return;
            const range = limits[key];
            if (Array.isArray(range) && range.length === 2){
                input.min = String(range[0]);
                input.max = String(range[1]);
            }
            if (values && Number.isFinite(values[key])){
                input.value = String(values[key]);
            }
        };
        apply(this.hlsConcurrencyInput, 'concurrency');
        apply(this.hlsRlimitInput, 'rlimit_mb');
        apply(this.hlsThreadsInput, 'x264_threads');
        apply(this.hlsLookaheadInput, 'rc_lookahead');
        if (values && typeof values.preset === 'string'){
            this.hlsPreset.value = values.preset;
        }
        this.setHlsStatus('');
    }

    collectHls(){
        const valueOf = (label, fallback) => {
            const input = label && label.querySelector('input');
            const value = input ? Number(input.value) : NaN;
            return Number.isFinite(value) ? value : fallback;
        };
        return {
            concurrency: valueOf(this.hlsConcurrency, 2),
            rlimit_mb: valueOf(this.hlsRlimit, 4096),
            x264_threads: valueOf(this.hlsThreads, 4),
            rc_lookahead: valueOf(this.hlsLookahead, 24),
            preset: this.hlsPreset ? this.hlsPreset.value : ''
        };
    }

    setHlsStatus(message, kind = 'ok'){
        this.hlsMsg.textContent = message || '';
        this.hlsMsg.classList.toggle('error', kind === 'error');
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