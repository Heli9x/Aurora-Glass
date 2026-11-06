class LoginView {
    constructor({ onSignedIn = null, onRetry = null } = {}){
        this.onSignedIn = onSignedIn;
        this.onRetry = onRetry;

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'login-view';
        this.wrapper.hidden = true;

        this.card = document.createElement('div');
        this.card.className = 'login-card';

        const brand = document.createElement('div');
        brand.className = 'login-brand';
        const brandIcon = document.createElement('i');
        brandIcon.className = 'ri-folder-6-fill';
        const brandName = document.createElement('span');
        brandName.textContent = 'Filey';
        brand.append(brandIcon, brandName);

        this.title = document.createElement('h1');
        this.title.textContent = 'Sign in';
        this.hint = document.createElement('p');
        this.hint.className = 'login-hint';
        this.hint.textContent = 'Use the account an administrator created for you.';

        this.form = document.createElement('form');
        this.form.className = 'login-form';
        this.form.noValidate = true;

        const usernameLabel = document.createElement('label');
        usernameLabel.textContent = 'Username';
        this.username = document.createElement('input');
        this.username.type = 'text';
        this.username.autocomplete = 'username';
        this.username.required = true;
        usernameLabel.appendChild(this.username);

        const passwordLabel = document.createElement('label');
        passwordLabel.textContent = 'Password';
        this.password = document.createElement('input');
        this.password.type = 'password';
        this.password.autocomplete = 'current-password';
        this.password.required = true;
        passwordLabel.appendChild(this.password);

        this.submit = document.createElement('button');
        this.submit.type = 'submit';
        this.submit.className = 'settings-btn login-submit';
        this.submit.textContent = 'Sign in';

        this.message = document.createElement('p');
        this.message.className = 'login-msg';

        this.form.append(usernameLabel, passwordLabel, this.submit, this.message);
        this.form.addEventListener('submit', (event) => this.handleSubmit(event));

        this.setup = document.createElement('div');
        this.setup.className = 'login-setup';
        this.setup.hidden = true;
        const setupTitle = document.createElement('h2');
        setupTitle.textContent = 'Setup required';
        const setupText = document.createElement('p');
        setupText.textContent = 'No administrator account exists yet. Create one on the server, then sign in.';
        const setupCommand = document.createElement('code');
        setupCommand.textContent = 'python3 -m backend.auth create-admin <username>';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'settings-btn';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => {
            if (this.onRetry) this.onRetry();
        });
        this.setup.append(setupTitle, setupText, setupCommand, retry);

        this.card.append(brand, this.title, this.hint, this.setup, this.form);
        this.wrapper.appendChild(this.card);
        document.body.appendChild(this.wrapper);
    }

    show(setupRequired = false){
        this.wrapper.hidden = false;
        this.setup.hidden = !setupRequired;
        this.form.hidden = setupRequired;
        this.message.textContent = '';
        this.message.classList.remove('error');
        if (!setupRequired){
            this.username.focus();
        }
    }

    hide(){
        this.wrapper.hidden = true;
        this.message.textContent = '';
        this.password.value = '';
    }

    setMessage(text, kind = 'error'){
        this.message.textContent = text || '';
        this.message.classList.toggle('error', kind === 'error');
    }

    async handleSubmit(event){
        event.preventDefault();
        const username = this.username.value.trim();
        const password = this.password.value;
        if (!username || !password){
            this.setMessage('Enter your username and password');
            return;
        }
        this.submit.disabled = true;
        this.submit.textContent = 'Signing in...';
        this.setMessage('');
        try {
            const response = await apiFetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                skipAuthHandling: true
            });
            const data = await response.json().catch(() => ({}));
            if (response.status === 429){
                const seconds = Number(data.retry_after) || 0;
                this.setMessage(`Too many attempts. Try again in ${seconds || 'a few'} second${seconds === 1 ? '' : 's'}.`);
                return;
            }
            if (response.status === 503 || data.setup_required){
                this.show(true);
                return;
            }
            if (!response.ok){
                this.setMessage('Invalid username or password');
                return;
            }
            setAuthUser(data.user, data.csrf_token);
            this.hide();
            if (this.onSignedIn) this.onSignedIn(data.user);
        } catch {
            this.setMessage('Could not reach the Filey server');
        } finally {
            this.submit.disabled = false;
            this.submit.textContent = 'Sign in';
        }
    }
}
