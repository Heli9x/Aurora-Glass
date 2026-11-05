import { normalizeSource } from './lyrics.js';

const DEFAULT_SPEED = 0.08;

function el(tag, props = {}, children = []){
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value);
    });
    node.append(...children);
    return node;
}

function field(label, input, hint){
    const children = [el('span', { text: label }), input];
    if (hint) children.push(el('small', { text: hint }));
    return el('label', { class: 'wiz-field' }, children);
}

const STEPS = [
    { id: 'song', title: 'The song', text: 'Who made it, and where does it belong?' },
    { id: 'style', title: 'Style', text: 'Describe the sound and mood so you can sort and find it later.' },
    { id: 'cover', title: 'Cover', text: 'Add artwork for the player. You can skip this and add it later.' },
    { id: 'lyrics', title: 'Lyrics', text: 'Paste or load lyrics, or write them line by line. Skip if you have none yet.' },
    { id: 'review', title: 'Review', text: 'Check the summary, then save.' }
];

export class AudioEditor {
    constructor({ apiFetch, apiBase = '/api', ModalClass, onSaved = () => {} }){
        this.apiFetch = apiFetch;
        this.apiBase = apiBase;
        this.onSaved = onSaved;
        this.modal = new ModalClass('audio-editor-dialog', () => this.revokePreview());
        this.file = null;
        this.step = 0;
        this.build();
    }

    build(){
        this.heading = el('p', { class: 'gallery-eyebrow', text: 'Audio setup' });
        this.fileName = el('h2');
        this.dots = el('ol', { class: 'wiz-steps', 'aria-label': 'Progress' });
        this.stepTitle = el('h3', { class: 'wiz-title' });
        this.stepText = el('p', { class: 'wiz-text' });
        this.body = el('div', { class: 'wiz-body' });
        this.status = el('p', { class: 'wiz-status', role: 'status' });

        this.backButton = el('button', { type: 'button', class: 'wiz-back', text: 'Back' });
        this.skipButton = el('button', { type: 'button', class: 'wiz-skip', text: 'Skip' });
        this.nextButton = el('button', { type: 'submit', class: 'submit-button wiz-next' });
        this.backButton.addEventListener('click', () => this.go(this.step - 1));
        this.skipButton.addEventListener('click', () => this.go(this.step + 1));
        const nav = el('div', { class: 'wiz-nav' }, [this.backButton, this.skipButton, this.nextButton]);

        this.form = el('form', { class: 'wiz' }, [
            this.dots, this.stepTitle, this.stepText, this.body, this.status, nav
        ]);
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (this.step === STEPS.length - 1) this.save();
            else this.go(this.step + 1);
        });
        STEPS.forEach((step, index) => {
            this.dots.append(el('li', { class: 'wiz-dot', title: step.title }, [
                el('span', { text: String(index + 1) }), el('em', { text: step.title })
            ]));
        });

        this.buildPanels();
        this.modal.appendContent(this.heading);
        this.modal.appendContent(this.fileName);
        this.modal.appendContent(this.form);
    }

    buildPanels(){
        this.inputs = {};
        const text = (key, label, hint, type = 'text') => {
            const input = el('input', { type, maxLength: 200 });
            if (type === 'number'){ input.min = '1000'; input.max = '9999'; input.placeholder = 'e.g. 2019'; }
            this.inputs[key] = input;
            return field(label, input, hint);
        };
        const panels = {};
        panels.song = el('div', { class: 'wiz-panel' }, [
            text('artist', 'Artist'), text('album', 'Album'), text('year', 'Release year', '', 'number')
        ]);
        panels.style = el('div', { class: 'wiz-panel' }, [
            text('genre', 'Genre', 'For example Pop, Rock, Lo-fi'),
            text('theme', 'Theme', 'For example Road trip, Focus, Love')
        ]);

        this.coverPreview = el('img', { class: 'wiz-cover', alt: 'Cover preview', hidden: true });
        this.coverPlaceholder = el('div', { class: 'wiz-cover wiz-cover-empty' }, [el('i', { class: 'ri-image-add-line' })]);
        this.coverInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
        this.coverInput.addEventListener('change', () => this.pickCover());
        const choose = el('button', { type: 'button', text: 'Choose image' });
        choose.addEventListener('click', () => this.coverInput.click());
        this.coverClear = el('button', { type: 'button', class: 'wiz-link', text: 'Remove cover' });
        this.coverClear.addEventListener('click', () => this.clearCover());
        panels.cover = el('div', { class: 'wiz-panel wiz-cover-row' }, [
            this.coverPlaceholder, this.coverPreview,
            el('div', { class: 'wiz-cover-actions' }, [choose, this.coverClear, this.coverInput])
        ]);

        this.importText = el('textarea', {
            rows: 5,
            placeholder: 'Paste plain lyrics, LRC, or [["line", speed, delay], ...] JSON'
        });
        const convert = el('button', { type: 'button', text: 'Convert pasted lyrics' });
        convert.addEventListener('click', () => this.importPasted());
        this.lyricsFile = el('input', { type: 'file', accept: '.lrc,.txt,.json,text/plain,application/json', hidden: true });
        this.lyricsFile.addEventListener('change', () => this.readLyricsFile());
        const loadFile = el('button', { type: 'button', text: 'Load a lyrics file' });
        loadFile.addEventListener('click', () => this.lyricsFile.click());
        this.rowsBody = el('div', { class: 'wiz-rows' });
        const addRow = el('button', { type: 'button', text: '+ Add line' });
        addRow.addEventListener('click', () => this.addRow(['', DEFAULT_SPEED, this.nextStart()], true));
        this.rowCount = el('p', { class: 'wiz-hint' });
        panels.lyrics = el('div', { class: 'wiz-panel' }, [
            this.importText,
            el('div', { class: 'wiz-inline' }, [convert, loadFile, this.lyricsFile]),
            el('p', { class: 'wiz-hint', text: 'Each line has text, a speed (seconds per character) and the second it starts.' }),
            this.rowsBody, addRow, this.rowCount
        ]);

        this.summary = el('dl', { class: 'wiz-summary' });
        panels.review = el('div', { class: 'wiz-panel' }, [this.summary]);
        this.panels = panels;
    }

    // -- navigation ---------------------------------------------------------

    go(index){
        this.step = Math.max(0, Math.min(STEPS.length - 1, index));
        this.render();
    }

    render(){
        const step = STEPS[this.step];
        const last = this.step === STEPS.length - 1;
        this.stepTitle.textContent = step.title;
        this.stepText.textContent = step.text;
        this.body.replaceChildren(this.panels[step.id]);
        [...this.dots.children].forEach((dot, index) => {
            dot.classList.toggle('active', index === this.step);
            dot.classList.toggle('done', index < this.step);
            if (index === this.step) dot.setAttribute('aria-current', 'step');
            else dot.removeAttribute('aria-current');
        });
        this.backButton.hidden = this.step === 0;
        this.skipButton.hidden = last || !['cover', 'lyrics'].includes(step.id);
        this.nextButton.textContent = last ? 'Save' : 'Next';
        this.setStatus('');
        if (step.id === 'review') this.renderSummary();
        if (step.id === 'lyrics') this.updateRowCount();
        const first = this.body.querySelector('input:not([hidden]), textarea');
        if (first && step.id !== 'lyrics') first.focus();
    }

    renderSummary(){
        const rows = this.readRows();
        const items = [
            ['Artist', this.inputs.artist.value], ['Album', this.inputs.album.value],
            ['Year', this.inputs.year.value], ['Genre', this.inputs.genre.value],
            ['Theme', this.inputs.theme.value],
            ['Cover', this.coverState === 'new' ? 'New image' : this.coverState === 'keep' ? 'Current image' : 'None'],
            ['Lyrics', rows.length ? `${rows.length} lines` : 'None']
        ];
        this.summary.replaceChildren(...items.flatMap(([label, value]) => [
            el('dt', { text: label }), el('dd', { text: value || 'Not set' })
        ]));
    }

    setStatus(message){
        this.status.textContent = message || '';
    }

    // -- cover --------------------------------------------------------------

    revokePreview(){
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = null;
    }

    pickCover(){
        const image = this.coverInput.files[0];
        this.coverInput.value = '';
        if (!image) return;
        if (image.size > 8 * 1024 * 1024){
            this.setStatus('Cover image must be under 8 MB.');
            return;
        }
        this.revokePreview();
        this.pendingCover = image;
        this.previewUrl = URL.createObjectURL(image);
        this.coverState = 'new';
        this.syncCover(this.previewUrl);
        this.setStatus('');
    }

    clearCover(){
        this.revokePreview();
        this.pendingCover = null;
        this.coverState = 'none';
        this.syncCover('');
    }

    syncCover(src){
        this.coverPreview.hidden = !src;
        this.coverPlaceholder.hidden = Boolean(src);
        this.coverClear.hidden = !src;
        if (src) this.coverPreview.src = src;
    }

    // -- lyrics -------------------------------------------------------------

    nextStart(){
        const last = this.rowsBody.lastElementChild;
        if (!last) return 0;
        const [text, speed, start] = [...last.querySelectorAll('input')].map((input) => input.value);
        return Math.round((Number(start) + text.length * Number(speed) + 1.5) * 100) / 100;
    }

    addRow([text, speed, start], focus = false){
        const textInput = el('input', { type: 'text', value: text, maxLength: 500, placeholder: 'Lyric line', 'aria-label': 'Lyric line' });
        const speedInput = el('input', { type: 'number', value: speed, min: '0.01', step: '0.01', 'aria-label': 'Speed (seconds per character)', title: 'Speed (s/char)' });
        const startInput = el('input', { type: 'number', value: start, min: '0', step: '0.1', 'aria-label': 'Start (seconds)', title: 'Start (s)' });
        const remove = el('button', { type: 'button', class: 'wiz-link', text: '×', 'aria-label': 'Remove line' });
        const row = el('div', { class: 'wiz-row' }, [textInput, speedInput, startInput, remove]);
        remove.addEventListener('click', () => { row.remove(); this.updateRowCount(); });
        this.rowsBody.append(row);
        this.updateRowCount();
        if (focus) textInput.focus();
    }

    setRows(rows){
        this.rowsBody.replaceChildren();
        rows.forEach((row) => this.addRow(row));
        this.updateRowCount();
    }

    updateRowCount(){
        const count = this.rowsBody.children.length;
        this.rowCount.textContent = count ? `${count} line${count === 1 ? '' : 's'}` : 'No lines yet.';
    }

    readRows(){
        const rows = [];
        for (const row of this.rowsBody.children){
            const [text, speed, start] = [...row.querySelectorAll('input')].map((input) => input.value);
            if (!text.trim()) continue;
            rows.push([text.trim(), Number(speed), Number(start)]);
        }
        return rows.sort((a, b) => a[2] - b[2]);
    }

    convert(source){
        const { lines } = normalizeSource(source, 'auto');
        return lines.map((line) => [
            line.text,
            Number.isFinite(line.charDuration) ? line.charDuration : DEFAULT_SPEED,
            Math.round(line.start * 1000) / 1000
        ]);
    }

    importPasted(){
        const source = this.importText.value.trim();
        if (!source) return;
        try {
            this.setRows(this.convert(source));
            this.importText.value = '';
            this.setStatus('Lyrics converted. Adjust the timing if needed.');
        } catch (error){
            this.setStatus('Could not read those lyrics.');
        }
    }

    async readLyricsFile(){
        const file = this.lyricsFile.files[0];
        this.lyricsFile.value = '';
        if (!file) return;
        this.importText.value = await file.text();
        this.importPasted();
    }

    // -- data ---------------------------------------------------------------

    async open(file, { setup = false } = {}){
        this.file = file;
        this.heading.textContent = setup ? 'Finish setting up your song' : 'Edit audio details';
        this.fileName.textContent = file.name;
        Object.entries(this.inputs).forEach(([key, input]) => { input.value = file[key] ?? ''; });
        this.importText.value = '';
        this.pendingCover = null;
        this.revokePreview();
        this.coverState = file.hasCover ? 'keep' : 'none';
        this.syncCover(file.hasCover ? `${this.apiBase}/files/${file.id}/cover?v=${Date.now()}` : '');
        this.setRows([]);
        this.lyricsReady = Promise.resolve();
        this.lyricsLoaded = !file.hasLyrics;
        this.go(0);
        this.modal.open();
        if (file.hasLyrics){
            this.lyricsReady = this.apiFetch(`${this.apiBase}/files/${file.id}/lyrics`)
                .then(async (response) => {
                    if (!response.ok || this.file !== file) return;
                    this.setRows((await response.json()).lyrics || []);
                    this.lyricsLoaded = true;
                })
                .catch(() => {});
        }
    }

    async request(path, options){
        const response = await this.apiFetch(`${this.apiBase}/files/${this.file.id}${path}`, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Request failed');
        if (data.file) this.file = data.file;
        return data;
    }

    async save(){
        this.nextButton.disabled = true;
        this.setStatus('Saving…');
        const json = (payload) => ({
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        try {
            await this.lyricsReady;
            const details = {};
            Object.entries(this.inputs).forEach(([key, input]) => { details[key] = input.value; });
            await this.request('', { method: 'PATCH', ...json(details) });
            if (this.coverState === 'new' && this.pendingCover){
                const body = new FormData();
                body.append('cover', this.pendingCover);
                await this.request('/cover', { method: 'PUT', body });
            } else if (this.coverState === 'none' && this.file.hasCover){
                await this.request('/cover', { method: 'DELETE' });
            }
            if (this.lyricsLoaded) await this.request('/lyrics', { method: 'PUT', ...json({ lyrics: this.readRows() }) });
            this.onSaved(this.file);
            this.modal.close();
        } catch (error){
            this.setStatus(error.message);
        } finally {
            this.nextButton.disabled = false;
        }
    }
}
