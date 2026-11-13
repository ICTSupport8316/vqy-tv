/*
    TV-weergave: toont de actieve slides één voor één en schuift door.
    - Haalt elke 20 seconden de inhoud op; wijzigingen verschijnen vanaf de volgende slide.
    - Herlaadt zichzelf na een nieuwe deploy (versie verandert).
    - Blijft de laatst bekende slides tonen als de server even weg is.
    Pijltjestoetsen links/rechts: vorige/volgende slide (handig bij testen).
*/
(function () {
    'use strict';
    const R = window.HallRender;
    const { renderSlide, isActive, fillClock } = R;
    const stage = document.getElementById('stage');

    let content = null;
    let weather = null;
    let version = null;
    let current = null;      // { slide, el }
    let index = -1;
    let timer = null;

    // ---- schalen naar het scherm
    function fit() {
        const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    }
    window.addEventListener('resize', fit);
    fit();

    // ---- gegevens
    function cached(key, value) {
        try {
            if (value === undefined) return JSON.parse(localStorage.getItem(key));
            localStorage.setItem(key, JSON.stringify(value));
        } catch { return null; }
    }

    async function loadContent() {
        try {
            const r = await fetch('/api/content', { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            const data = await r.json();
            if (version && data.version !== version) { location.reload(); return; }
            version = data.version;
            const changed = !content || content.rev !== data.rev;
            content = data;
            cached('halltv-content', data);
            if (changed) preloadImages();
        } catch {
            if (!content) content = cached('halltv-content');
        }
    }

    async function loadWeather() {
        try {
            const r = await fetch('/api/weather', { cache: 'no-store' });
            if (r.ok) { weather = await r.json(); cached('halltv-weather', weather); }
        } catch {
            if (!weather) weather = cached('halltv-weather');
        }
    }

    function preloadImages() {
        const urls = [content.settings.logo];
        for (const s of content.slides) { urls.push(s.image); for (const b of s.blocks || []) urls.push(b.image, ...(b.images || [])); }
        urls.filter(Boolean).forEach(u => { const i = new Image(); i.src = u; });
    }

    // ---- doorschuiven
    function activeSlides() {
        return content ? content.slides.filter(s => isActive(s)) : [];
    }

    function showEmpty() {
        stage.innerHTML = '<div id="empty">Geen slides om te tonen<small>Voeg slides toe of zet ze aan via /beheer</small></div>';
        current = null;
    }

    function show(step) {
        clearTimeout(timer);
        const slides = activeSlides();
        if (!slides.length) {
            showEmpty();
            timer = setTimeout(() => show(1), 10_000);
            return;
        }
        // Volg de huidige slide op id, zodat herordenen of verwijderen geen gekke sprongen geeft
        const n = slides.length;
        const pos = current ? slides.findIndex(s => s.id === current.slide.id) : -1;
        if (pos !== -1) index = (pos + step + n) % n;
        else index = index >= 0 && index < n ? index : 0; // huidige slide is weg: neem die op dezelfde plek
        const slide = slides[index];

        const el = renderSlide(slide, { settings: content.settings, weather });
        const transition = content.settings.transition === 'fade' ? 't-fade' : 't-slide';
        stage.className = transition;
        const empty = document.getElementById('empty');
        if (empty) empty.remove();

        const old = current && current.el;
        if (old && n > 1 && old !== el) {
            if (step < 0 && transition === 't-slide') el.style.transform = 'translateX(-100%)';
            el.classList.add('enter');
            stage.appendChild(el);
            void el.offsetWidth; // start de overgang
            el.classList.remove('enter');
            el.style.transform = '';
            if (step < 0 && transition === 't-slide') old.style.transform = 'translateX(100%)';
            else old.classList.add('leave');
            setTimeout(() => old.remove(), 1100);
        } else {
            stage.innerHTML = '';
            stage.appendChild(el);
        }
        current = { slide, el };
        R.fitText(el);
        R.startGalleries(el);
        // Lettertypes van Google kunnen later binnenkomen dan de eerste slide
        if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => R.fitText(el));

        // Voortgangsbalk in de accentkleur van de slide
        const seconds = R.slideDuration(slide, content.settings);
        let bar = document.getElementById('progress');
        if (bar) bar.remove();
        if (slides.length > 1) {
            bar = document.createElement('div');
            bar.id = 'progress';
            bar.style.background = slide.style.accent;
            stage.appendChild(bar);
            bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: seconds * 1000, easing: 'linear', fill: 'forwards' });
        }
        timer = setTimeout(() => show(1), seconds * 1000);
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') show(1);
        if (e.key === 'ArrowLeft') show(-1);
    });

    // Klok elke seconde bijwerken
    setInterval(() => document.querySelectorAll('#stage .hs-clock').forEach(c => fillClock(c)), 1000);

    // Een slide met maar één item (of geen wissel) toch verversen als de inhoud verandert
    let lastRev = null;
    async function poll() {
        await loadContent();
        if (content && lastRev !== null && content.rev !== lastRev && activeSlides().length <= 1) show(0);
        if (content) lastRev = content.rev;
    }

    (async function start() {
        await Promise.all([loadContent(), loadWeather()]);
        lastRev = content ? content.rev : null;
        if (content) show(0); else showEmpty();
        setInterval(poll, 20_000);
        setInterval(loadWeather, 10 * 60_000);
        // Eens per nacht helemaal herladen, tegen geheugenlekken in TV-browsers
        setInterval(() => { if (new Date().getHours() === 4) location.reload(); }, 60 * 60_000);
    })();
})();
