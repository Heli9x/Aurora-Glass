const cache = new Map();

// Reads a track's length from the browser itself (metadata only), so timing
// features and playlist times work even when the server cannot report it.
export function probeDuration(url) {
    if (!url) return Promise.resolve(0);
    if (!cache.has(url)) {
        cache.set(url, new Promise((resolve) => {
            const audio = new Audio();
            const finish = (value) => {
                audio.removeAttribute('src');
                audio.load();
                resolve(Number.isFinite(value) && value > 0 ? value : 0);
            };
            audio.preload = 'metadata';
            audio.addEventListener('loadedmetadata', () => finish(audio.duration), { once: true });
            audio.addEventListener('error', () => finish(0), { once: true });
            audio.src = url;
        }).then((value) => {
            if (!value) cache.delete(url);
            return value;
        }));
    }
    return cache.get(url);
}
