class Notify {
    constructor(){
        this.stack = document.createElement('div');
        this.stack.className = 'notify-stack';
        document.body.appendChild(this.stack);
    }

    show(message, opts = {}){
        const { type = 'info', duration = 2200 } = opts;
        const el = document.createElement('div');
        el.className = 'notify';
        if (type !== 'info') el.classList.add(type);

        const msg = document.createElement('span');
        msg.className = 'notify-msg';
        msg.textContent = message;

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'notify-close ri-close-line';
        close.title = 'Dismiss';
        close.addEventListener('click', () => this.dismiss(el));

        el.append(msg, close);
        this.stack.appendChild(el);

        if (duration > 0){
            setTimeout(() => this.dismiss(el), duration);
        }
        return el;
    }

    dismiss(el){
        if (!el || el.classList.contains('hide-out')) return;
        el.classList.add('hide-out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
        el.addEventListener('animationcancel', () => el.remove(), { once: true });
    }
}

const notify = new Notify();