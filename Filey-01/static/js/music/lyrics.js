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

const LEAD_RATIO = 0.06;
const TAIL_RATIO = 0.05;
const MAX_LEAD = 15;
const LINE_PAUSE = 12;
const STANZA_PAUSE = 40;
const HEADER_WEIGHT = 2;
const MIN_SPEED = 0.02;
const MAX_SPEED = 0.4;

export function textLines(source) {
    const lines = [];
    let gap = false;
    String(source).split(/\r?\n/).forEach((raw) => {
        const text = raw.trim();
        if (!text) {
            gap = lines.length > 0;
            return;
        }
        lines.push({ text, gap });
        gap = false;
    });
    return lines;
}

// Mirrors backend/audio/lyrics.py estimate(): untimed lines are spread over the
// song by length, with extra room at blank lines.
export function estimateRows(lines, duration) {
    const lead = Math.min(MAX_LEAD, duration * LEAD_RATIO);
    const span = Math.max(duration - lead - Math.min(MAX_LEAD, duration * TAIL_RATIO), duration * 0.5);
    const weights = lines.map(({ text, gap }) => [
        /^[\[(][^\]\d)][^\])]*[\])]$/.test(text) ? HEADER_WEIGHT : text.length + LINE_PAUSE,
        gap ? STANZA_PAUSE : 0
    ]);
    const unit = span / weights.reduce((sum, [weight, pause]) => sum + weight + pause, 0);
    const speed = Math.round(clamp(unit, MIN_SPEED, MAX_SPEED) * 1000) / 1000;
    let clock = 0;
    return lines.map(({ text }, index) => {
        const [weight, pause] = weights[index];
        clock += pause;
        const row = [text, speed, Math.round((lead + clock * unit) * 1000) / 1000];
        clock += weight;
        return row;
    });
}

export function fromText(source, { start = 0, gap = 4, duration = 0 } = {}) {
    const lines = textLines(source);
    if (duration > 0 && lines.length) return fromLyrica(estimateRows(lines, duration));
    let time = Number(start) || 0;
    const entries = lines.map(({ text }) => {
        const entry = { text, start: time };
        time += Math.max(gap, text.length * 0.12);
        return entry;
    });
    return normalizeLines(entries);
}

// Pulls ["text", speed, delay] rows out of JSON-ish text. Tolerates what
// hand-written or Python-exported files contain: missing outer brackets, trailing
// commas, rows without commas between them, single quotes, tuples, `lyrics = [...]`
// assignments, comments, smart quotes, unescaped inner quotes and numbers like .6.
// Mirrors backend/audio/lyrics.py so both sides read a file the same way.
const NUMBER = '["\']?([-+]?(?:\\d+\\.?\\d*|\\.\\d+))["\']?';
const ROW_PATTERN = `[\\[(]\\s*(?:"([^\\n]*?)"|'([^\\n]*?)')\\s*,\\s*${NUMBER}\\s*,\\s*${NUMBER}\\s*[\\])]`;

function extractRows(source) {
    const text = source.replace(/[\u201c\u201d]/g, '"');
    return [...text.matchAll(new RegExp(ROW_PATTERN, 'g'))].map((match) => [
        (match[1] ?? match[2]).replace(/\\(["'\\])/g, '$1').replace(/\\n/g, ' '),
        Number(match[3]),
        Number(match[4])
    ]);
}

function strictRows(text) {
    try {
        let value = JSON.parse(text);
        if (value && !Array.isArray(value) && typeof value === 'object') value = value.lyrics ?? value.lines;
        if (Array.isArray(value) && value.length
            && value.every((row) => Array.isArray(row) && typeof row[0] === 'string')) return value;
    } catch {
        // not standards-compliant JSON; fall through to the tolerant reader
    }
    return null;
}

export function parseJsonRows(source) {
    const text = String(source).replace(/^\ufeff/, '').trim();
    if (!text) return null;
    const rows = (/^[\[{]/.test(text) ? strictRows(text) : null) || extractRows(text);
    return rows.length ? rows : null;
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

export function normalizeSource(source, format = 'auto', { duration = 0 } = {}) {
    const resolved = format === 'auto' ? detectFormat(source) : format;
    switch (resolved) {
        case 'json':
            return fromLyrica(parseJsonRows(source) || []);
        case 'lyrica':
            return fromLyrica(source);
        case 'lrc':
            return parseLRC(source);
        case 'text':
            return fromText(source, { duration });
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
