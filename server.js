'use strict';
/*
    VQY Hal-TV: diavoorstelling voor de TV in de hal (weer + intern nieuws).

    /         de TV-weergave (wisselt automatisch tussen de slides)
    /admin    beheerpagina om slides te maken en op te maken (met wachtwoord)

    Alle inhoud staat in DATA_DIR (standaard ./data): content.json, auth.json en uploads/.
    Die map valt buiten git en wordt bij een deploy niet overschreven.
*/
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Optionele instellingen uit .env (PORT, DATA_DIR). Zonder .env werkt alles met standaardwaarden.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* geen .env */ }

const PORT = Number(process.env.PORT) || 8800;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Versie van de frontend: verandert na een deploy, zodat de TV zichzelf herlaadt
const VERSION = (() => {
    const h = crypto.createHash('sha1');
    for (const f of fs.readdirSync(PUBLIC_DIR).sort()) h.update(f).update(fs.readFileSync(path.join(PUBLIC_DIR, f)));
    return h.digest('hex').slice(0, 12);
})();

// =========================================================================
// OPSLAG
// =========================================================================
function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
// Eerst naar een tijdelijk bestand, dan hernoemen: nooit een half geschreven bestand
function writeJson(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

const DEFAULT_STYLE = {
    bg: '#ffffff', titleColor: '#111111', textColor: '#3a3a3a', accent: '#c8102e',
    font: 'montserrat', titleSize: 104, textSize: 40, titleWeight: 700, uppercase: false,
    align: 'left', valign: 'center', overlay: 45, imageFit: 'cover', imageSplit: 50,
    accentLine: true, showLogo: true, logoPosition: 'top-left'
};

function defaultContent() {
    return {
        rev: 1,
        settings: {
            location: { name: 'Marknesse', lat: 52.7092, lon: 5.8650 },
            defaultDuration: 15,
            transition: 'slide',
            showClock: true,
            logo: ''
        },
        slides: [
            {
                id: crypto.randomUUID(), type: 'weather', enabled: true, duration: 15,
                kicker: 'Weer', title: '', showFrom: '', showUntil: '',
                style: { ...DEFAULT_STYLE }
            },
            {
                id: crypto.randomUUID(), type: 'news', enabled: true, duration: 15,
                kicker: 'Nieuws', title: 'Welkom op de nieuwe hal-TV',
                text: 'Deze slides zijn helemaal zelf aan te passen via **/admin**:\n- titels, teksten en foto\'s\n- kleuren, lettertype en groottes\n- hoe lang een slide in beeld blijft',
                image: '', layout: 'text-only', showFrom: '', showUntil: '',
                style: { ...DEFAULT_STYLE }
            }
        ]
    };
}

let content = readJson(CONTENT_FILE, null);
if (!content || !Array.isArray(content.slides)) {
    content = defaultContent();
    writeJson(CONTENT_FILE, content);
}

// =========================================================================
// INVOER CONTROLEREN (alleen bekende velden, met grenzen)
// =========================================================================
const str = (v, max, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);
const num = (v, min, max, def) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(max, Math.max(min, Number(v))) : def);
const color = (v, def) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def);
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const upload = v => (typeof v === 'string' && /^\/uploads\/[a-z0-9-]+\.(jpg|png|webp|gif)$/.test(v) ? v : '');

const FONTS = ['montserrat', 'inter', 'playfair', 'oswald', 'lora'];
const LAYOUTS = ['image-left', 'image-right', 'image-full', 'text-only', 'image-only', 'free'];
const LOGO_POS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function cleanStyle(s = {}) {
    const d = DEFAULT_STYLE;
    return {
        bg: color(s.bg, d.bg),
        titleColor: color(s.titleColor, d.titleColor),
        textColor: color(s.textColor, d.textColor),
        accent: color(s.accent, d.accent),
        font: oneOf(s.font, FONTS, d.font),
        titleSize: num(s.titleSize, 30, 260, d.titleSize),
        textSize: num(s.textSize, 16, 120, d.textSize),
        titleWeight: oneOf(Number(s.titleWeight), [300, 400, 600, 700, 800], d.titleWeight),
        uppercase: s.uppercase === true,
        align: oneOf(s.align, ['left', 'center', 'right'], d.align),
        valign: oneOf(s.valign, ['top', 'center', 'bottom'], d.valign),
        overlay: num(s.overlay, 0, 95, d.overlay),
        imageFit: oneOf(s.imageFit, ['cover', 'contain'], d.imageFit),
        imageSplit: num(s.imageSplit, 25, 75, d.imageSplit),
        accentLine: s.accentLine !== false,
        showLogo: s.showLogo !== false,
        logoPosition: oneOf(s.logoPosition, LOGO_POS, d.logoPosition)
    };
}

function cleanSlide(s = {}) {
    const base = {
        id: typeof s.id === 'string' && /^[a-z0-9-]{8,40}$/i.test(s.id) ? s.id : crypto.randomUUID(),
        type: oneOf(s.type, ['news', 'weather'], 'news'),
        enabled: s.enabled !== false,
        duration: num(s.duration, 3, 600, 15),
        kicker: str(s.kicker, 80),
        title: str(s.title, 300),
        showFrom: date(s.showFrom),
        showUntil: date(s.showUntil),
        style: cleanStyle(s.style)
    };
    if (base.type === 'news') {
        base.text = str(s.text, 5000);
        base.image = upload(s.image);
        base.layout = oneOf(s.layout, LAYOUTS, 'image-left');
        base.blocks = Array.isArray(s.blocks) ? s.blocks.slice(0, 30).map(cleanBlock) : [];
    }
    return base;
}

// Blokken voor de vrije indeling. Positie en grootte in pixels op het 1920x1080-canvas.
// Volgorde in de lijst = stapelvolgorde (laatste ligt bovenop).
function cleanBlock(b = {}) {
    const block = {
        id: typeof b.id === 'string' && /^[a-z0-9-]{4,40}$/i.test(b.id) ? b.id : crypto.randomUUID(),
        type: oneOf(b.type, ['text', 'image', 'gallery', 'weather'], 'text'),
        x: Math.round(num(b.x, -1900, 3800, 0)),
        y: Math.round(num(b.y, -1060, 2140, 0)),
        w: Math.round(num(b.w, 20, 3840, 600)),
        h: Math.round(num(b.h, 20, 2160, 400)),
        radius: num(b.radius, 0, 200, 0)
    };
    if (block.type === 'text') {
        block.kicker = str(b.kicker, 80);
        block.title = str(b.title, 300);
        block.text = str(b.text, 5000);
        block.style = cleanStyle(b.style);
        block.boxColor = color(b.boxColor, '#ffffff');
        block.boxOpacity = num(b.boxOpacity, 0, 100, 0);
        block.padding = num(b.padding, 0, 300, 40);
    } else if (block.type === 'weather') {
        // Live weer als los blok: één onderdeel per blok, inhoud schaalt mee met het blok
        block.part = oneOf(b.part, ['now', 'compact', 'details', 'hours', 'days'], 'now');
        block.showLabel = b.showLabel !== false;
        block.showPlace = b.showPlace === true;
        block.style = cleanStyle(b.style);
        block.boxColor = color(b.boxColor, '#ffffff');
        block.boxOpacity = num(b.boxOpacity, 0, 100, 0);
        block.padding = num(b.padding, 0, 300, 20);
    } else if (block.type === 'image') {
        block.image = upload(b.image);
        block.fit = oneOf(b.fit, ['cover', 'contain'], 'cover');
    } else {
        block.images = Array.isArray(b.images) ? b.images.map(upload).filter(Boolean).slice(0, 40) : [];
        block.fit = oneOf(b.fit, ['cover', 'contain'], 'cover');
        block.interval = num(b.interval, 2, 60, 5);
        block.dots = b.dots !== false;
    }
    return block;
}

// De oude vaste weerslide (type "weather") wordt omgezet naar een gewone slide met weerblokken:
// zelfde uiterlijk, maar helemaal aan te passen. Plek in de volgorde, aan/uit en planning blijven.
// Dezelfde opzet als "+ Weerslide" in de beheerpagina (admin.js, newWeatherSlide).
function weatherSlideFromFixed(s) {
    const style = { ...DEFAULT_STYLE };
    const left = { ...style, align: 'left' };
    const wb = (part, x, y, w, h, extra = {}) => ({
        id: crypto.randomUUID(), type: 'weather', part, x, y, w, h, radius: 0,
        showLabel: true, showPlace: false, style: { ...left }, boxColor: '#ffffff', boxOpacity: 0, padding: 0, ...extra
    });
    return {
        id: s.id, type: 'news', enabled: s.enabled, duration: s.duration,
        kicker: 'Weer', title: 'Weer {plaats}', text: '', image: '', layout: 'free',
        showFrom: s.showFrom, showUntil: s.showUntil, style,
        blocks: [
            {
                id: crypto.randomUUID(), type: 'text', x: 150, y: 110, w: 900, h: 240, radius: 0,
                kicker: 'Weer', title: '{plaats}', text: '', style: { ...style, valign: 'top' },
                boxColor: '#ffffff', boxOpacity: 0, padding: 0
            },
            wb('now', 150, 380, 760, 330),
            wb('details', 150, 760, 760, 220, { showLabel: false }),
            wb('hours', 1020, 380, 750, 300),
            wb('days', 1020, 720, 750, 300)
        ]
    };
}
function normalizeSlides(slides) {
    return slides.map(raw => {
        const s = cleanSlide(raw);
        return s.type === 'weather' ? cleanSlide(weatherSlideFromFixed(s)) : s;
    });
}

function cleanSettings(s = {}) {
    const loc = s.location || {};
    return {
        location: {
            name: str(loc.name, 80, 'Marknesse') || 'Marknesse',
            lat: num(loc.lat, -90, 90, 52.7092),
            lon: num(loc.lon, -180, 180, 5.8650)
        },
        defaultDuration: num(s.defaultDuration, 3, 600, 15),
        transition: oneOf(s.transition, ['slide', 'fade'], 'slide'),
        showClock: s.showClock !== false,
        logo: upload(s.logo)
    };
}

// Geüploade afbeeldingen die nergens meer gebruikt worden opruimen.
// Alleen bestanden ouder dan een uur: een net geüploade foto is misschien nog niet opgeslagen.
function removeUnusedUploads() {
    const urls = [content.settings.logo];
    for (const s of content.slides) {
        urls.push(s.image);
        for (const b of s.blocks || []) urls.push(b.image, ...(b.images || []));
    }
    const used = new Set(urls.filter(Boolean).map(u => path.basename(u)));
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
        const file = path.join(UPLOAD_DIR, f);
        try {
            if (!used.has(f) && Date.now() - fs.statSync(file).mtimeMs > 3600_000) fs.unlinkSync(file);
        } catch { /* volgende keer opnieuw */ }
    }
}

// =========================================================================
// INLOGGEN (wachtwoord als scrypt-hash in auth.json, sessie als ondertekende cookie)
// =========================================================================
let auth = readJson(AUTH_FILE, {});
if (!auth.secret) { auth.secret = crypto.randomBytes(32).toString('hex'); writeJson(AUTH_FILE, auth); }

const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function checkPassword(pw) {
    if (!auth.hash || typeof pw !== 'string') return false;
    const a = Buffer.from(hashPassword(pw, auth.salt), 'hex');
    const b = Buffer.from(auth.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setPassword(pw) {
    auth.salt = crypto.randomBytes(16).toString('hex');
    auth.hash = hashPassword(pw, auth.salt);
    auth.secret = crypto.randomBytes(32).toString('hex'); // logt alle andere sessies uit
    writeJson(AUTH_FILE, auth);
}

const SESSION_DAYS = 30;
const sign = v => crypto.createHmac('sha256', auth.secret).update(v).digest('hex');
function makeToken() {
    const exp = String(Date.now() + SESSION_DAYS * 86400_000);
    return `${exp}.${sign(exp)}`;
}
function validToken(token) {
    if (typeof token !== 'string') return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const a = Buffer.from(sig), b = Buffer.from(sign(exp));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function getCookie(req, name) {
    const m = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setSession(res) {
    res.cookie('halltv', makeToken(), { httpOnly: true, sameSite: 'strict', maxAge: SESSION_DAYS * 86400_000, path: '/' });
}
const loggedIn = req => validToken(getCookie(req, 'halltv'));
function requireAuth(req, res, next) {
    if (!loggedIn(req)) return res.status(401).json({ error: 'Niet ingelogd' });
    next();
}

// Te veel foute pogingen vanaf één adres: 5 minuten blokkeren
const failures = new Map();
function tooManyFailures(ip) {
    const f = failures.get(ip);
    return f && f.count >= 8 && Date.now() - f.last < 5 * 60_000;
}
function noteFailure(ip) {
    const f = failures.get(ip) || { count: 0, last: 0 };
    if (Date.now() - f.last > 5 * 60_000) f.count = 0;
    f.count++; f.last = Date.now();
    failures.set(ip, f);
}

// =========================================================================
// WEER (Open-Meteo, geen API-key nodig; 10 minuten gecachet)
// =========================================================================
let weatherCache = { key: '', at: 0, data: null };

async function getWeather() {
    const { lat, lon, name } = content.settings.location;
    const key = `${lat},${lon}`;
    if (weatherCache.key === key && Date.now() - weatherCache.at < 10 * 60_000) return weatherCache.data;

    const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${lat}&longitude=${lon}&timezone=Europe%2FAmsterdam&forecast_days=7&wind_speed_unit=kmh`
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day'
        + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset';
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    const w = await r.json();

    // Komende uren vanaf het huidige uur (lokale tijd, zoals Open-Meteo hem teruggeeft)
    const nowHour = w.current.time.slice(0, 13);
    const start = Math.max(0, w.hourly.time.findIndex(t => t.slice(0, 13) === nowHour));
    const hours = [];
    for (let i = start + 1; i < w.hourly.time.length && hours.length < 6; i += 2) {
        hours.push({
            time: w.hourly.time[i].slice(11, 16),
            temp: w.hourly.temperature_2m[i],
            code: w.hourly.weather_code[i],
            pop: w.hourly.precipitation_probability[i],
            isDay: w.hourly.is_day[i] === 1
        });
    }
    const data = {
        location: name,
        fetched: new Date().toISOString(),
        current: {
            temp: w.current.temperature_2m,
            feels: w.current.apparent_temperature,
            humidity: w.current.relative_humidity_2m,
            code: w.current.weather_code,
            wind: w.current.wind_speed_10m,
            windDir: w.current.wind_direction_10m,
            isDay: w.current.is_day === 1
        },
        sunrise: w.daily.sunrise[0].slice(11, 16),
        sunset: w.daily.sunset[0].slice(11, 16),
        hours,
        days: w.daily.time.slice(0, 6).map((d, i) => ({
            date: d,
            code: w.daily.weather_code[i],
            max: w.daily.temperature_2m_max[i],
            min: w.daily.temperature_2m_min[i],
            pop: w.daily.precipitation_probability_max[i]
        }))
    };
    weatherCache = { key, at: Date.now(), data };
    return data;
}

// =========================================================================
// ROUTES
// =========================================================================
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

const noCache = { setHeaders: res => res.set('Cache-Control', 'no-cache') };
app.get('/', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, 'tv.html')));
app.get('/admin', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use('/static', express.static(PUBLIC_DIR, noCache));
// Bestandsnamen zijn uniek, dus deze mogen lang in de cache
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

// Inhoud voor de TV (en de beheerpagina)
app.get('/api/content', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ...content, version: VERSION });
});

app.get('/api/weather', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store').json(await getWeather());
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Weer ophalen mislukt: ${err.message}`);
        // Liever oude gegevens dan niets
        if (weatherCache.data) return res.json({ ...weatherCache.data, stale: true });
        res.status(502).json({ error: 'Weer niet beschikbaar' });
    }
});

app.get('/api/me', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ setup: !auth.hash, loggedIn: loggedIn(req) });
});

app.use('/api', express.json({ limit: '1mb' }));

// Eerste keer: wachtwoord kiezen (alleen zolang er nog geen wachtwoord is)
app.post('/api/setup', (req, res) => {
    if (auth.hash) return res.status(409).json({ error: 'Er is al een wachtwoord ingesteld' });
    const pw = req.body?.password;
    if (typeof pw !== 'string' || pw.length < 8) return res.status(400).json({ error: 'Kies een wachtwoord van minstens 8 tekens' });
    setPassword(pw);
    setSession(res);
    console.log(`[${new Date().toISOString()}] Beheerwachtwoord ingesteld`);
    res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
    const ip = req.socket.remoteAddress;
    if (tooManyFailures(ip)) return res.status(429).json({ error: 'Te veel pogingen, probeer het over 5 minuten opnieuw' });
    if (!checkPassword(req.body?.password)) {
        noteFailure(ip);
        return res.status(401).json({ error: 'Wachtwoord klopt niet' });
    }
    failures.delete(ip);
    setSession(res);
    res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('halltv', { path: '/' }).json({ ok: true });
});

app.post('/api/password', requireAuth, (req, res) => {
    const { current, password } = req.body || {};
    if (!checkPassword(current)) return res.status(401).json({ error: 'Huidig wachtwoord klopt niet' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Kies een wachtwoord van minstens 8 tekens' });
    setPassword(password);
    setSession(res);
    res.json({ ok: true });
});

// Alles opslaan. rev voorkomt dat twee mensen tegelijk elkaars werk overschrijven.
app.put('/api/content', requireAuth, (req, res) => {
    const body = req.body || {};
    if (body.rev !== content.rev) {
        return res.status(409).json({ error: 'Iemand anders heeft intussen iets gewijzigd', content: { ...content, version: VERSION } });
    }
    if (!Array.isArray(body.slides) || body.slides.length > 100) return res.status(400).json({ error: 'Ongeldige slides' });
    content = {
        rev: content.rev + 1,
        settings: cleanSettings(body.settings),
        slides: []
    };
    content.slides = normalizeSlides(body.slides);
    writeJson(CONTENT_FILE, content);
    removeUnusedUploads();
    res.json({ ...content, version: VERSION });
});

// Afbeelding uploaden: het bestand zelf is de body (geen formulier), max. 25 MB
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
app.post('/api/upload', requireAuth, express.raw({ type: Object.keys(IMAGE_TYPES), limit: '25mb' }), (req, res) => {
    const ext = IMAGE_TYPES[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Alleen JPG, PNG, WebP of GIF' });
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
    res.json({ url: `/uploads/${name}` });
});

// Plaats zoeken voor het weer
app.get('/api/geocode', requireAuth, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json([]);
    try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=nl&format=json`,
            { signal: AbortSignal.timeout(8000) });
        const data = await r.json();
        res.json((data.results || []).map(p => ({
            name: p.name, region: [p.admin1, p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude
        })));
    } catch (err) {
        res.status(502).json({ error: 'Zoeken lukt nu niet' });
    }
});

app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Bestand is te groot (max. 25 MB)' });
    console.error(`[${new Date().toISOString()}]`, err);
    res.status(500).json({ error: 'Er ging iets mis op de server' });
});

// Oude vaste weerslide omzetten naar blokken (en de rest controleren), ook bij een met de hand aangepaste content.json
content.settings = cleanSettings(content.settings);
content.slides = normalizeSlides(content.slides);
writeJson(CONTENT_FILE, content);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n[${new Date().toISOString()}] VQY Hal-TV gestart (versie ${VERSION})`);
    console.log(`  TV:      http://localhost:${PORT}/`);
    console.log(`  Beheer:  http://localhost:${PORT}/admin`);
    console.log(`  Naam:    http://hall-tv:${PORT}/  (DNS-alias, zie README)`);
    Object.values(os.networkInterfaces()).flat()
        .filter(i => i && i.family === 'IPv4' && !i.internal)
        .forEach(i => console.log(`  Netwerk: http://${i.address}:${PORT}/`));
    console.log(`  Data:    ${DATA_DIR}\n`);
});
