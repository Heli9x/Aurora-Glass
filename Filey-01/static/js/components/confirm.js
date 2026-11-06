class ConfirmDialog {
    constructor(){
        this.modal = new Modal('confirm-dialog');
        this.dialog = this.modal.dialog;
        this.resolve = null;

        this.title = document.createElement('h2');
        this.body = document.createElement('p');
        this.body.className = 'confirm-body';
        this.actions = document.createElement('div');
        this.actions.className = 'confirm-actions';

        this.dialog.append(this.title, this.body, this.actions);
        this.modal.onClose = () => this.settle(null);
    }

    ask({ title, body, options } = {}){
        this.title.textContent = title || 'Confirm';
        this.body.textContent = body || '';
        this.actions.textContent = '';

        (Array.isArray(options) ? options : []).forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `settings-btn${option.danger ? ' danger' : ''}`;
            button.textContent = option.label;
            button.addEventListener('click', () => {
                this.settle(option.value);
                this.modal.close();
            });
            this.actions.appendChild(button);
        });

        this.modal.open();
        return new Promise((resolve) => {
            this.resolve = resolve;
        });
    }

    settle(value){
        if (!this.resolve) return;
        const resolve = this.resolve;
        this.resolve = null;
        resolve(value);
    }
}
