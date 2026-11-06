const API_BASE = '/api';

const authState = {
    user: null,
    csrfToken: '',
    setupRequired: false,
    onUnauthorized: null
};

function isAdmin(){
    return Boolean(authState.user && authState.user.role === 'admin');
}

function setAuthUser(user, csrfToken = ''){
    authState.user = user || null;
    authState.csrfToken = csrfToken || '';
    authState.setupRequired = false;
}

function clearAuthUser(){
    authState.user = null;
    authState.csrfToken = '';
}

async function apiFetch(path, options = {}){
    const skipAuthHandling = options.skipAuthHandling === true;
    const opts = { ...options };
    delete opts.skipAuthHandling;
    opts.credentials = opts.credentials || 'same-origin';
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && authState.csrfToken){
        headers.set('X-CSRF-Token', authState.csrfToken);
    }
    opts.headers = headers;
    const response = await fetch(path, opts);
    if (!skipAuthHandling){
        if (response.status === 401){
            if (authState.onUnauthorized) authState.onUnauthorized();
        } else if (response.status === 403){
            if (typeof notify !== 'undefined') notify.show('Not allowed');
        }
    }
    return response;
}
