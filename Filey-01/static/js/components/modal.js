class Modal {
    constructor(className = '', onClose = null){
        this.onClose = onClose;
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'modal-backdrop';
        this.backdrop.hidden = true;

        this.dialog = document.createElement('section');
        this.dialog.className = `dialog${className ? ` ${className}` : ''}`;
        this.dialog.setAttribute('role', 'dialog');
        this.dialog.setAttribute('aria-modal', 'true');

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'dialog-close';
        close.setAttribute('aria-label', 'Close dialog');
        close.innerHTML = '<i class="ri-close-line"></i>';
        close.addEventListener('click', () => this.close());

        this.dialog.appendChild(close);
        this.backdrop.appendChild(this.dialog);
        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) this.close();
        });

        document.body.appendChild(this.backdrop);
    }

    appendContent(node){
        this.dialog.appendChild(node);
    }

    open(){
        this.backdrop.hidden = false;
    }

    close(){
        this.backdrop.hidden = true;
        if (typeof this.onClose === 'function') this.onClose();
    }

    isOpen(){
        return !this.backdrop.hidden;
    }
}