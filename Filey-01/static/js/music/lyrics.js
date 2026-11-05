const DEFAULT_META = { title: '', artist: '', offset: 0 };

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeLines(lines, meta = {}) {
    const normalized = lines
        .map((line) => {
            const text = String(line.text ?? '').replace(/\r/g, '').trim();
            const start = Number(line.start ?? line.time ?? line.t);
            const end = Number(line.end);
            const charDuration = Number(line.charDuration ?? line.speed);
            return { text, start, end, charDuration };
        })
        .filter((line) => line.text && Number.isFinite(line.start))
        .sort((a, b) => a.start - b.start);

    normalized.forEach((line, index) => {
        const next = normalized[index + 1];
        if (next) {
            line.end = next.start;
        } else if (!Number.isFinite(line.end) || line.end <= line.start) {
            line.end = line.start + Math.max(2, line.text.length * 0.12);
        }
    });

    return { ...DEFAULT_META, ...meta, lines: normalized };
}

export function fromLyrica(rows) {
    return normalizeLines(rows.map((row) => {
        const [text, speed, delay] = row;
        const charDuration = Number(speed);
        const start = Number(delay);
        const end = Number.isFinite(charDuration)
            ? start + String(text ?? '').trim().length * charDuration
            : undefined;
        return { text, start, end, charDuration };
    }));
}

export function parseLRC(source) {
    const meta = { ...DEFAULT_META };
    const entries = [];
    const text = String(source);

    const offsetMatch = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offsetMatch) meta.offset = Number(offsetMatch[1]) / 1000;

    text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();
        if (!line) return;

        const tag = line.match(/^\[(ti|ar|al|by|offset):(.*)\]$/i);
        if (tag) {
            const key = tag[1].toLowerCase();
            if (key === 'ti') meta.title = tag[2].trim();
            else if (key === 'ar') meta.artist = tag[2].trim();
            return;
        }

        const stamps = [];
        const stampPattern = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
        let rest = line;
        let match;
        while ((match = rest.match(stampPattern))) {
            const minutes = Number(match[1]);
            const seconds = Number(match[2]);
            const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0')}`) : 0;
            stamps.push(minutes * 60 + seconds + fraction);
            rest = rest.slice(match[0].length);
        }

        if (!stamps.length) return;

        const lyric = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
        if (!lyric) return;

        stamps.forEach((start) => entries.push({ start, text: lyric }));
    });

    return normalizeLines(entries, meta);
}

export function fromText(source, { start = 0, gap = 4 } = {}) {
    let time = Number(start) || 0;
    const entries = String(source)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text) => {
            const entry = { text, start: time };
            time += Math.max(gap, text.length * 0.12);
            return entry;
        });
    return normalizeLines(entries);
}

// Reads ["text", speed, delay] rows leniently: missing outer brackets, trailing
// commas, rows on separate lines. Returns the rows, or null if it is not JSON rows.
export function parseJsonRows(source) {
    const body = String(source).trim();
    if (!/^[\[{]/.test(body)) return null;
    const glued = body.replace(/\]\s*,?\s*\[/g, '],[');
    const candidates = [body];
    for (const variant of [body, glued]) {
        const trimmed = variant.replace(/,\s*$/, '');
        candidates.push(`[${trimmed}]`, trimmed.replace(/,(\s*[\]}])/g, '$1'));
    }
    for (const candidate of candidates) {
        let value;
        try {
            value = JSON.parse(candidate);
        } catch {
            continue;
        }
        if (value && !Array.isArray(value) && typeof value === 'object') value = value.lyrics ?? value.lines;
        if (!Array.isArray(value)) continue;
        if (value.length && !value.some((item) => item && typeof item === 'object')) value = [value];
        if (value.every(Array.isArray)) return value;
    }
    return null;
}

export function detectFormat(source) {
    if (typeof source === 'string') {
        if (parseJsonRows(source)) return 'json';
        return /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(source) ? 'lrc' : 'text';
    }
    if (Array.isArray(source)) {
        return source.some((item) => Array.isArray(item)) ? 'lyrica' : 'canonical';
    }
    return 'canonical';
}

export function normalizeSource(source, format = 'auto') {
    const resolved = format === 'auto' ? detectFormat(source) : format;
    switch (resolved) {
        case 'json':
            return fromLyrica(parseJsonRows(source) || []);
        case 'lyrica':
            return fromLyrica(source);
        case 'lrc':
            return parseLRC(source);
        case 'text':
            return fromText(source);
        case 'canonical':
        default:
            if (Array.isArray(source)) return normalizeLines(source);
            return normalizeLines(source.lines || [], source.meta || {});
    }
}

export function findActiveLine(lines, time) {
    let low = 0;
    let high = lines.length - 1;
    let result = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (lines[middle].start <= time) {
            result = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return result;
}

export class Lyrics {
    constructor({ autoScroll = true, onSeek = null, onLineChange = null, emptyMessage = 'No lyrics available' } = {}) {
        this.autoScroll = autoScroll;
        this.onSeek = onSeek;
        this.onLineChange = onLineChange;
        this.emptyMessage = emptyMessage;
        this.container = null;
        this.list = null;
        this.media = null;
        this.data = { ...DEFAULT_META, lines: [] };
        this.activeIndex = -1;
        this._lineElements = [];
        this._listeners = [];
        this._raf = null;
        this._lastProgress = null;
        this._onFrame = this._onFrame.bind(this);
    }

    mount(container) {
        if (!container) throw new Error('Lyrics.mount requires a container element');
        this.container = container;
        container.classList.add('lyrics');
        container.replaceChildren();

        this.list = document.createElement('ul');
        this.list.className = 'lyrics-list';
        container.appendChild(this.list);

        this._renderLines();
        return this;
    }

    load(source, { format = 'auto' } = {}) {
        this.data = normalizeSource(source, format);
        this.activeIndex = -1;
        this._lastProgress = null;
        if (this.list) this._renderLines();
        if (this.media) this.setTime(this.media.currentTime);
        return this;
    }

    async loadFromURL(url, options = {}) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load lyrics (${response.status})`);
        const format = options.format || (/\.lrc(\?|$)/i.test(url) ? 'lrc' : 'auto');
        return this.load(await response.text(), { format });
    }

    attach(media) {
        this.detach();
        if (!media) return this;
        this.media = media;

        const add = (event, handler) => {
            media.addEventListener(event, handler);
            this._listeners.push([event, handler]);
        };

        add('play', () => this._startLoop());
        add('pause', () => this._stopLoop());
        add('ended', () => {
            this._stopLoop();
            this.setTime(media.currentTime);
        });
        add('seeked', () => this.setTime(media.currentTime));
        add('seeking', () => this.setTime(media.currentTime));
        add('ratechange', () => this.setTime(media.currentTime));

        this.setTime(media.currentTime);
        if (!media.paused && !media.ended) this._startLoop();
        return this;
    }

    detach() {
        this._stopLoop();
        if (this.media) {
            this._listeners.forEach(([event, handler]) => this.media.removeEventListener(event, handler));
        }
        this._listeners = [];
        this.media = null;
        return this;
    }

    setTime(seconds) {
        if (!this.data.lines.length) return this;

        const time = Number(seconds) + (Number(this.data.offset) || 0);
        const index = findActiveLine(this.data.lines, time);
        if (index !== this.activeIndex) this._setActive(index);

        if (index >= 0) {
            const line = this.data.lines[index];
            const span = this._lineElements[index]?.span;
            if (!span) return this;
            const duration = Math.max(0.001, line.end - line.start);
            const progress = clamp((time - line.start) / duration, 0, 1);
            const percent = `${(progress * 100).toFixed(2)}%`;
            if (percent !== this._lastProgress) {
                span.style.setProperty('--progress', percent);
                this._lastProgress = percent;
            }
        }

        return this;
    }

    destroy() {
        this.detach();
        if (this.container) {
            this.container.classList.remove('lyrics');
            this.container.replaceChildren();
        }
        this.container = null;
        this.list = null;
        this._lineElements = [];
        this.data = { ...DEFAULT_META, lines: [] };
        this.activeIndex = -1;
    }

    _renderLines() {
        if (!this.list) return;
        this.list.replaceChildren();

        if (!this.data.lines.length) {
            const empty = document.createElement('li');
            empty.className = 'lyrics-empty';
            empty.textContent = this.emptyMessage;
            this.list.appendChild(empty);
            this._lineElements = [];
            this.activeIndex = -1;
            return;
        }

        this._lineElements = this.data.lines.map((line, index) => {
            const item = document.createElement('li');
            item.className = 'lyric-line';
            item.dataset.index = String(index);

            const span = document.createElement('span');
            span.className = 'lyric-text';
            span.textContent = line.text;

            item.appendChild(span);
            item.addEventListener('click', () => this._seekTo(index));
            this.list.appendChild(item);
            return { item, span };
        });
        this.activeIndex = -1;
    }

    _seekTo(index) {
        const line = this.data.lines[index];
        if (!line) return;
        if (this.onSeek) this.onSeek(line.start, line, index);
        else if (this.media) this.media.currentTime = line.start;
        this.setTime(line.start);
    }

    _setActive(index) {
        const previous = this._lineElements[this.activeIndex];
        if (previous) {
            previous.item.classList.remove('active');
            previous.span.style.setProperty('--progress', '0%');
        }

        this.activeIndex = index;
        this._lastProgress = null;

        const current = this._lineElements[index];
        if (current) {
            current.item.classList.add('active');
            current.span.style.setProperty('--progress', '0%');
            if (this.autoScroll) this._scrollTo(index);
            if (this.onLineChange) this.onLineChange(this.data.lines[index], index);
        }
    }

    _scrollTo(index) {
        const item = this._lineElements[index]?.item;
        if (!item || !this.container) return;

        const reduced = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const itemRect = item.getBoundingClientRect();
        const boxRect = this.container.getBoundingClientRect();
        const delta = (itemRect.top + itemRect.height / 2) - (boxRect.top + boxRect.height / 2);
        this.container.scrollBy({ top: delta, behavior: reduced ? 'auto' : 'smooth' });
    }

    _startLoop() {
        if (this._raf || !this.media) return;
        this._raf = requestAnimationFrame(this._onFrame);
    }

    _stopLoop() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    _onFrame() {
        if (!this.media) {
            this._raf = null;
            return;
        }
        this.setTime(this.media.currentTime);
        if (this.media.paused || this.media.ended) {
            this._raf = null;
            return;
        }
        this._raf = requestAnimationFrame(this._onFrame);
    }
}

export default Lyrics;
