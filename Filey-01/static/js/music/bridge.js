import { FileyMusicPlayer } from './player.js';

const INSTALL_KEY = '__fileyMusicBridgeInstalled';

function install(){
    if (window[INSTALL_KEY]) return;
    if (typeof MediaPlayer !== 'function') return;

    try {
        const player = new FileyMusicPlayer();
        const prototype = MediaPlayer.prototype;
        const originalOpen = prototype.open;

        prototype.open = function(file){
            if (file && file.type === 'music'){
                player.open(file).catch((error) => {
                    console.error('Filey music player failed', error);
                    if (typeof notify !== 'undefined' && notify?.show) notify.show('Could not open the music player');
                    originalOpen.call(this, file);
                });
                return;
            }
            return originalOpen.call(this, file);
        };

        window[INSTALL_KEY] = { player, originalOpen };
        window.fileyMusicPlayer = player;
    } catch (error){
        console.error('Could not install the Filey music bridge', error);
    }
}

function whenReady(callback){
    if (document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
        callback();
    }
}

whenReady(install);
