class RenameDialog {
    constructor({ onRenamed = null } = {}){
        this.onRenamed = onRenamed;
        this.current = null;

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'rename-wrapper hide';

        const form = document.createElement('form');
        form.className = 'rename-content';

        const title = document.createElement('h3');
        title.className = 'rename-title';
        title.textContent = 'Rename';

        const field = document.createElement('div');
        field.className = 'input-wrapper';
        const label = document.createElement('label');
        label.htmlFor = 'rename-input';
        label.textContent = 'New title';
        this.input = document.createElement('input');
        this.input.id = 'rename-input';
        this.input.className = 'rename-input';
        this.input.type = 'text';
        this.input.name = 'new_name';
        this.input.maxLength = 120;
        const hint = document.createElement('small');
        hint.className = 'rename-hint';
        hint.textContent = 'Only the display title changes — the file keeps its original name and extension.';
        field.append(label, this.input, hint);

        const actions = document.createElement('div');
        actions.className = 'rename-actions';
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'rename-save';
        save.textContent = 'Save';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'rename-cancel';
        cancel.textContent = 'Cancel';
        actions.append(save, cancel);

        this.msg = document.createElement('div');
        this.msg.className = 'rename-msg';

        form.append(title, field, actions, this.msg);
        this.wrapper.appendChild(form);
        document.body.appendChild(this.wrapper);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submit();
        });
        cancel.addEventListener('click', () => this.close());
        this.wrapper.addEventListener('click', (e) => {
            if (e.target === this.wrapper) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.wrapper.classList.contains('hide')) this.close();
        });
    }

    open(file){
        this.current = file;
        this.input.value = file.name || '';
        this.msg.textContent = '';
        this.wrapper.classList.remove('hide');
        this.input.focus();
        this.input.select();
    }

    close(){
        this.wrapper.classList.add('hide');
        this.current = null;
    }

    async submit(){
        const name = this.input.value.trim();
        if (!name){
            this.msg.textContent = 'Name cannot be empty.';
            return;
        }
        const id = typeof this.current?.id === 'string' ? this.current.id : null;
        let failed = false;
        if (id){
            try {
                const response = await fetch(`${API_BASE}/files/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                if (!response.ok){
                    this.msg.textContent = 'Rename failed on the backend.';
                    failed = true;
                }
            } catch { /* Keep local state usable when offline. */ }
        }
        if (!failed){
            if (this.onRenamed) this.onRenamed(this.current, name);
            this.close();
        }
    }
}