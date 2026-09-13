class DnD {
    constructor(input, dropZone){
        this.main = input;
        this.dropZone = dropZone;

        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());

        this.dropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('over');
        });
        this.dropZone.addEventListener('dragover', (e) => e.preventDefault());
        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('over');
        });
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('over');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
                this.getFile(e.dataTransfer.files);
            }
        });
        this.dropZone.addEventListener('click', () => this.main.click());
    }

    getFile(files){
        this.main.files = files;
        this.main.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

class Upload {
    constructor({ onUploaded = null } = {}){
        this.onUploaded = onUploaded;
        this.modal = new Modal();
        this.dialog = this.modal.dialog;
        this.createHeader();
        this.createForm();
        this.dnd = new DnD(this.input, this.dropZone);
        this.input.addEventListener('change', () => this.handleFileChange());
    }

    createHeader(){
        const eyebrow = document.createElement('p');
        eyebrow.className = 'gallery-eyebrow';
        eyebrow.textContent = 'Library action';
        const title = document.createElement('h2');
        title.textContent = 'Upload a file';
        this.dialog.append(eyebrow, title);
    }

    createForm(){
        const drop = document.createElement('label');
        drop.className = 'drop-zone';
        drop.htmlFor = 'file-input';
        const dropIcon = document.createElement('i');
        dropIcon.className = 'ri-upload-cloud-2-line';
        const dropText = document.createElement('span');
        dropText.textContent = 'Choose a file to add to your library';
        const dropHint = document.createElement('small');
        dropHint.textContent = 'Files are stored on the connected Filey volume';
        drop.append(dropIcon, dropText, dropHint);
        this.dropZone = drop;

        this.input = document.createElement('input');
        this.input.id = 'file-input';
        this.input.type = 'file';
        this.input.hidden = true;

        const form = document.createElement('form');
        form.id = 'upload-form';
        form.className = 'upload-form';

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Custom name';
        this.customName = document.createElement('input');
        this.customName.id = 'custom-name';
        this.customName.type = 'text';
        this.customName.placeholder = 'Use original filename';
        nameLabel.appendChild(this.customName);

        const catLabel = document.createElement('label');
        catLabel.textContent = 'Category';
        this.category = document.createElement('select');
        this.category.id = 'file-category';
        const cats = [
            ['auto', 'Detect automatically'],
            ['movies', 'Movies'],
            ['music', 'Music'],
            ['photos', 'Photos'],
            ['other', 'Other']
        ];
        cats.forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            this.category.appendChild(option);
        });
        catLabel.appendChild(this.category);

        const fieldset = document.createElement('fieldset');
        fieldset.className = 'icon-picker';
        const legend = document.createElement('legend');
        legend.textContent = 'Custom icon';
        fieldset.appendChild(legend);
        const icons = [
            'ri-file-3-line', 'ri-play-fill', 'ri-music-2-fill',
            'ri-image-2-line', 'ri-folder-6-fill'
        ];
        icons.forEach((iconClass, index) => {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'file-icon';
            radio.value = iconClass;
            radio.checked = index === 0;
            const icon = document.createElement('i');
            icon.className = iconClass;
            label.append(radio, icon);
            fieldset.appendChild(label);
        });

        this.progress = document.createElement('div');
        this.progress.className = 'upload-progress';
        this.progress.hidden = true;
        const track = document.createElement('div');
        track.className = 'upload-progress-track';
        this.progressBar = document.createElement('span');
        track.appendChild(this.progressBar);
        const meta = document.createElement('div');
        meta.className = 'upload-progress-meta';
        this.progressLabel = document.createElement('span');
        this.progressLabel.textContent = 'Ready';
        this.progressPercent = document.createElement('span');
        this.progressPercent.textContent = '0%';
        meta.append(this.progressLabel, this.progressPercent);
        this.progress.append(track, meta);

        this.submitButton = document.createElement('button');
        this.submitButton.type = 'submit';
        this.submitButton.className = 'submit-button';
        this.submitButton.innerHTML = '<i class="ri-upload-2-line"></i> Add to library';

        form.append(drop, this.input, nameLabel, catLabel, fieldset, this.progress, this.submitButton);
        form.addEventListener('submit', (e) => this.handleSubmit(e));
        this.form = form;
        this.dialog.appendChild(form);
    }

    handleFileChange(){
        const file = this.input.files[0];
        if (!file) return;
        this.customName.placeholder = file.name;
        if (this.category.value === 'auto'){
            this.category.value = file.type.startsWith('video') ? 'movies'
                : file.type.startsWith('audio') ? 'music'
                : file.type.startsWith('image') ? 'photos' : 'other';
        }
    }

    open(){
        this.modal.open();
    }

    close(){
        this.modal.close();
        this.form.reset();
        this.input.value = '';
        this.customName.placeholder = 'Use original filename';
        this.category.value = 'auto';
        this.progressBar.style.width = '0';
        this.progress.hidden = true;
        this.submitButton.disabled = false;
        this.submitButton.innerHTML = '<i class="ri-upload-2-line"></i> Add to library';
    }

    async handleSubmit(event){
        event.preventDefault();
        const file = this.input.files[0];
        if (!file){
            notify.show('Choose a file first');
            return;
        }
        const type = file.type.startsWith('video') ? 'movies'
            : file.type.startsWith('audio') ? 'music'
            : file.type.startsWith('image') ? 'photos' : 'other';
        const selectedType = this.category.value === 'auto' ? type : this.category.value;
        const selectedIcon = this.dialog.querySelector('input[name="file-icon"]:checked').value;
        const displayName = this.customName.value.trim() || file.name;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', displayName);
        formData.append('category', selectedType);
        formData.append('icon', selectedIcon);

        this.progress.hidden = false;
        this.submitButton.disabled = true;
        this.submitButton.textContent = 'Uploading...';
        try {
            const result = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${API_BASE}/upload`);
                xhr.upload.onprogress = (uploadEvent) => {
                    if (!uploadEvent.lengthComputable) return;
                    const percent = Math.round((uploadEvent.loaded / uploadEvent.total) * 100);
                    this.progressBar.style.width = `${percent}%`;
                    this.progressLabel.textContent = `Uploading ${file.name}`;
                    this.progressPercent.textContent = `${percent}%`;
                };
                xhr.onload = () => xhr.status >= 200 && xhr.status < 300
                    ? resolve(JSON.parse(xhr.responseText))
                    : reject(new Error('Filey rejected the upload'));
                xhr.onerror = () => reject(new Error('Upload connection failed'));
                xhr.send(formData);
            });
            if (this.onUploaded){
                this.onUploaded(result.file);
                this.close();
            }
        } catch (error){
            this.progressLabel.textContent = 'Upload failed';
            notify.show(error.message || 'Upload failed');
            this.submitButton.disabled = false;
            this.submitButton.textContent = 'Add to library';
        }
    }
}