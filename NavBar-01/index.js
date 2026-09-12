class InfoModal{
    constructor(data){
        /*
        example data:
        {
            'title': 'Modal Title',
            'content': 'Modal Content'
        }
         */
        this.wrapper = document.createElement('div');
        this.wrapper.classList.add('nav-info-modal');

        this.title = document.createElement('div');
        this.title.innerText = data.title;

        this.content = document.createElement('small');
        this.content.innerText = data.content;

        this.wrapper.appendChild(this.title);
        this.wrapper.appendChild(this.content);

        document.body.appendChild(this.wrapper);
    }

    show(target, onlyIcons){
        if (!onlyIcons) return;

        const rect = target.getBoundingClientRect();
        const x = rect.left + window.scrollX;
        const y = rect.bottom + window.scrollY + 5; // 5px offset
        this.wrapper.style.left = `${x}px`;
        this.wrapper.style.top = `${y}px`;
        this.wrapper.style.display = 'block';

        this.title.innerText = target.querySelector('span').innerText;
    }

    hide(){
        this.wrapper.style.display = 'none';
    }
}

class NavBar{
    constructor(data, onlyIcon = false){
        /* 
        data example:
        {
            'logo':[Brand, Image url],
            'links':{
                'page-name': ['dedicated library icon for <i> tag class', 'url']
            },
            'actions':{
                'button-name': [<click driven function>, 'dedicated library icon for <i> tag class']
            }
        }
        */

        this.data = data? data : {};
        this.main = document.createElement('nav');
        this.main.classList.add('navbar');

        this.infoModal = new InfoModal({
            'title': 'Hello!',
            'content': ''
        });

        if(onlyIcon) this.main.classList.add('only-icons');
        if(this.data.logo) this.createLogo(this.data.logo);
        if(this.data.links) this.createLinks(this.data.links);
        if(this.data.actions) this.createActions(this.data.actions);
    }

    createLogo(data){
        /*
        example data:
        ['Brand Name', 'Image URL']
         */
        const logoWrapper = document.createElement('div');
        const logoImage = document.createElement('img');
        const logoBrand = document.createElement('div');

        logoWrapper.classList.add('nav-logo');
        logoImage.classList.add('nav-img');
        logoBrand.classList.add('nav-brand');

        logoImage.setAttribute('src', data[1]);
        logoBrand.innerText = data[0];

        logoWrapper.appendChild(logoImage);
        logoWrapper.appendChild(logoBrand);

        this.main.appendChild(logoWrapper);
    }

    createLinks(data){
        /*
        example data:
        {
            'page-name': ['dedicated library icon for <i> tag class', 'url']
        }
         */
        const linksWrapper = document.createElement('div');
        linksWrapper.classList.add('nav-links');

        for (const [name, [iconClass, url, classList]] of Object.entries(data)) {
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.classList.add('nav-link');
            if (classList) {
                link.classList.add(...classList);
            }
                
            const icon = document.createElement('i');
            icon.className = iconClass;

            link.appendChild(icon);
            const textNode = document.createTextNode(name);
            const textNodeWrapper = document.createElement('span');
            textNodeWrapper.appendChild(textNode);

            link.appendChild(textNodeWrapper);

            link.addEventListener('mouseover', (e)=>{
                this.infoModal.show(e.currentTarget, this.main.classList.contains('only-icons'));
            });
            link.addEventListener('mouseleave', ()=>{
                this.infoModal.hide();
            });

            linksWrapper.appendChild(link);
        }

        this.main.appendChild(linksWrapper);
    }

    createActions(data){
        /*
        example data:
        {
            'button-name': [<click driven function>, 'dedicated library icon for <i> tag class']
        }
         */
        const actionsWrapper = document.createElement('div');
        actionsWrapper.classList.add('nav-actions');

        for (const [name, [actionFunction, iconClass]] of Object.entries(data)) {
            const button = document.createElement('button');
            button.classList.add('nav-action-button');

            const icon = document.createElement('i');
            icon.className = iconClass;

            const textNode = document.createTextNode(name);
            const textNodeWrapper = document.createElement('span');
            textNodeWrapper.appendChild(textNode);

            button.appendChild(icon);
            button.appendChild(textNodeWrapper);

            button.addEventListener('click', actionFunction);

            button.addEventListener('mouseover', (e) => {
                this.infoModal.show(e.currentTarget, this.main.classList.contains('only-icons'));
            });
            button.addEventListener('mouseleave', () => {
                this.infoModal.hide();
            });

            actionsWrapper.appendChild(button);
        }

        this.main.appendChild(actionsWrapper);
    }

    render(targetId){
        const targetElement = document.getElementById(targetId);
        if(targetElement instanceof HTMLElement){
            targetElement.appendChild(this.main);
        } else {
            console.error('Provided targetId does not correspond to a valid HTML element.');
        }
    }
}

const data = {
    'links' : {
        'home' : ['ri-home-line', '/', ['active']],
        'Movies' : ['ri-movie-line', '/', ],
        'Music' : ['ri-music-line', '/',],
        'Pictures' : ['ri-image-line', '/', ],
        'about' : ['ri-information-line', '/about']
    },
    'actions' : {
        'login' : [() => alert('Login clicked'), 'ri-login-box-line'],
        'settings' : [() => alert('Settings clicked'), 'ri-settings-line']
    }
}

const navbar = new NavBar(data, true);
navbar.render('navbar'); // Replace 'navbar' with the actual ID of the HTML element where you want to render the navbar
