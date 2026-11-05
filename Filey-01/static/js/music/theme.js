export const DEFAULT_THEME_COLOR = '#575757';

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 17, g: 17, b: 17 };
const THEME_VARS = [
    '--theme-color',
    '--theme-color-strong',
    '--theme-color-soft',
    '--theme-on-color',
    '--theme-on-color-muted',
    '--theme-on-accent'
];
const colorCache = new Map();

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;
    const hex = match[1].length === 3
        ? match[1].split('').map((part) => part + part).join('')
        : match[1];
    return `#${hex.toLowerCase()}`;
}

export function hexToRgb(value) {
    const hex = normalizeHex(value) || DEFAULT_THEME_COLOR;
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
}

function rgbToHex({ r, g, b }) {
    const part = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsl({ r, g, b }) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if (delta !== 0) {
        if (max === red) hue = ((green - blue) / delta) % 6;
        else if (max === green) hue = (blue - red) / delta + 2;
        else hue = (red - green) / delta + 4;
        hue *= 60;
        if (hue < 0) hue += 360;
    }

    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    return { h: hue, s: saturation, l: lightness };
}

function hslToRgb(h, s, l) {
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const segment = h / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    let red = 0;
    let green = 0;
    let blue = 0;

    if (segment >= 0 && segment < 1) [red, green, blue] = [chroma, x, 0];
    else if (segment < 2) [red, green, blue] = [x, chroma, 0];
    else if (segment < 3) [red, green, blue] = [0, chroma, x];
    else if (segment < 4) [red, green, blue] = [0, x, chroma];
    else if (segment < 5) [red, green, blue] = [x, 0, chroma];
    else [red, green, blue] = [chroma, 0, x];

    const match = l - chroma / 2;
    return {
        r: Math.round((red + match) * 255),
        g: Math.round((green + match) * 255),
        b: Math.round((blue + match) * 255)
    };
}

function relativeLuminance({ r, g, b }) {
    const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function asRgb(value) {
    return typeof value === 'string' ? hexToRgb(value) : value;
}

export function contrastRatio(first, second) {
    const firstLum = relativeLuminance(asRgb(first));
    const secondLum = relativeLuminance(asRgb(second));
    const lighter = Math.max(firstLum, secondLum);
    const darker = Math.min(firstLum, secondLum);
    return (lighter + 0.05) / (darker + 0.05);
}

function mixRgb(first, second, amount) {
    const ratio = clamp(amount, 0, 1);
    return {
        r: first.r + (second.r - first.r) * ratio,
        g: first.g + (second.g - first.g) * ratio,
        b: first.b + (second.b - first.b) * ratio
    };
}

function minContrast(color, surfaces) {
    return Math.min(...surfaces.map((surface) => contrastRatio(color, surface)));
}

export function buildPalette(input) {
    const base = hexToRgb(input);
    const { h, s, l } = rgbToHsl(base);
    const useWhite = contrastRatio(base, WHITE) >= contrastRatio(base, BLACK);
    const onColor = useWhite ? WHITE : BLACK;
    let colorLightness = useWhite ? clamp(l, 0.14, 0.38) : clamp(l, 0.56, 0.86);
    let strongLightness = useWhite
        ? clamp(colorLightness - 0.1, 0.06, 0.94)
        : clamp(colorLightness + 0.1, 0.06, 0.94);
    let softLightness = useWhite
        ? clamp(colorLightness + 0.08, 0.06, 0.94)
        : clamp(colorLightness - 0.08, 0.06, 0.94);

    const surfaces = () => [
        hslToRgb(h, s, colorLightness),
        hslToRgb(h, s, strongLightness),
        hslToRgb(h, s, softLightness)
    ];

    let attempts = 0;
    while (minContrast(onColor, surfaces()) < 4.6 && attempts < 60) {
        const step = useWhite ? -0.01 : 0.01;
        colorLightness = clamp(colorLightness + step, 0.03, 0.97);
        strongLightness = clamp(strongLightness + step, 0.03, 0.97);
        softLightness = clamp(softLightness + step, 0.03, 0.97);
        attempts += 1;
    }

    const color = hslToRgb(h, s, colorLightness);
    const strong = hslToRgb(h, s, strongLightness);
    const soft = hslToRgb(h, s, softLightness);
    const colorHex = rgbToHex(color);
    const strongHex = rgbToHex(strong);
    const softHex = rgbToHex(soft);
    const onColorHex = rgbToHex(onColor);
    const surfaceHexes = [colorHex, strongHex, softHex];
    let mutedHex = rgbToHex(mixRgb(onColor, color, 0.12));
    if (minContrast(mutedHex, surfaceHexes) < 4.5) {
        mutedHex = rgbToHex(mixRgb(onColor, color, 0.06));
    }
    if (minContrast(mutedHex, surfaceHexes) < 4.5) mutedHex = onColorHex;

    return {
        color: colorHex,
        strong: strongHex,
        soft: softHex,
        onColor: onColorHex,
        onColorMuted: mutedHex,
        onAccent: onColorHex,
        vars: {
            '--theme-color': colorHex,
            '--theme-color-strong': strongHex,
            '--theme-color-soft': softHex,
            '--theme-on-color': onColorHex,
            '--theme-on-color-muted': mutedHex,
            '--theme-on-accent': onColorHex
        }
    };
}

export async function extractDominantColor(url) {
    if (!url) return null;
    const key = String(url);
    if (colorCache.has(key)) return colorCache.get(key);
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

    try {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.src = key;
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
        });

        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas is unavailable');
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const buckets = new Map();

        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 128) continue;
            const r = pixels[index];
            const g = pixels[index + 1];
            const b = pixels[index + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            if (luminance < 0.05 || luminance > 0.95) continue;

            const saturation = max === 0 ? 0 : (max - min) / max;
            const bucketKey = `${r >> 4},${g >> 4},${b >> 4}`;
            const bucket = buckets.get(bucketKey) || { r: 0, g: 0, b: 0, weight: 0 };
            const weight = 1 + saturation * 3;
            bucket.r += r * weight;
            bucket.g += g * weight;
            bucket.b += b * weight;
            bucket.weight += weight;
            buckets.set(bucketKey, bucket);
        }

        let best = null;
        let bestScore = -1;
        buckets.forEach((bucket) => {
            const r = bucket.r / bucket.weight;
            const g = bucket.g / bucket.weight;
            const b = bucket.b / bucket.weight;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max === 0 ? 0 : (max - min) / max;
            const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            const score = bucket.weight * (0.4 + saturation) * (1 - Math.abs(luminance - 0.5) * 0.6);
            if (score > bestScore) {
                bestScore = score;
                best = { r, g, b };
            }
        });

        const result = best ? rgbToHex(best) : null;
        colorCache.set(key, result);
        return result;
    } catch {
        colorCache.set(key, null);
        return null;
    }
}

export class Theme {
    constructor({ root = null, defaultColor = DEFAULT_THEME_COLOR } = {}) {
        this.root = root || (typeof document !== 'undefined'
            ? document.querySelector('.music-player-wrapper')
            : null);
        this.defaultColor = normalizeHex(defaultColor) || DEFAULT_THEME_COLOR;
        this._palette = null;
        this._token = 0;
        this.setColor(this.defaultColor);
    }

    get palette() {
        return this._palette;
    }

    applyTrack(track = {}) {
        const token = ++this._token;
        const fallback = normalizeHex(track.themeColor) || this.defaultColor;
        if (!track.cover) {
            this.setColor(fallback);
            return Promise.resolve(fallback);
        }

        return extractDominantColor(track.cover)
            .then((color) => {
                if (token !== this._token) return this._palette?.color || this.defaultColor;
                return this.setColor(color || fallback);
            })
            .catch(() => {
                if (token === this._token) this.setColor(fallback);
                return this._palette?.color || fallback;
            });
    }

    setColor(color) {
        const palette = buildPalette(color || this.defaultColor);
        this._palette = palette;
        if (this.root) {
            Object.entries(palette.vars).forEach(([name, value]) => {
                this.root.style.setProperty(name, value);
            });
        }
        return palette.color;
    }

    reset() {
        this._token += 1;
        return this.setColor(this.defaultColor);
    }

    destroy() {
        this._token += 1;
        if (this.root) {
            THEME_VARS.forEach((name) => this.root.style.removeProperty(name));
        }
        this.root = null;
        this._palette = null;
    }
}

export default Theme;
