/*
    Tekent één slide op een vast canvas van 1920x1080.
    Wordt gebruikt door de TV (tv.js) én de voorbeeldweergave in de beheerpagina (admin.js),
    zodat het voorbeeld precies laat zien wat op de TV komt.
*/
(function () {
    'use strict';

    const FONTS = {
        montserrat: { label: 'Montserrat (strak)', css: "'Montserrat', 'Segoe UI', Arial, sans-serif" },
        inter: { label: 'Inter (modern)', css: "'Inter', 'Segoe UI', Arial, sans-serif" },
        playfair: { label: 'Playfair Display (klassiek)', css: "'Playfair Display', Georgia, serif" },
        lora: { label: 'Lora (rustig, schreef)', css: "'Lora', Georgia, serif" },
        oswald: { label: 'Oswald (smal, krachtig)', css: "'Oswald', 'Arial Narrow', sans-serif" }
    };

    // WMO-weercodes van Open-Meteo
    const WEATHER_TEXT = {
        0: 'Onbewolkt', 1: 'Overwegend helder', 2: 'Half bewolkt', 3: 'Bewolkt',
        45: 'Mist', 48: 'Mist met rijp',
        51: 'Lichte motregen', 53: 'Motregen', 55: 'Dichte motregen', 56: 'IJzel', 57: 'IJzel',
        61: 'Lichte regen', 63: 'Regen', 65: 'Zware regen', 66: 'IJzel', 67: 'IJzel',
        71: 'Lichte sneeuw', 73: 'Sneeuw', 75: 'Zware sneeuw', 77: 'Sneeuwkorrels',
        80: 'Lichte buien', 81: 'Buien', 82: 'Zware buien', 85: 'Sneeuwbuien', 86: 'Zware sneeuwbuien',
        95: 'Onweer', 96: 'Onweer met hagel', 99: 'Onweer met hagel'
    };
    const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
    const DAYS_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
    const WIND_DIRS = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Eenvoudige opmaak: **vet**, *schuin*, regels met "- " worden een opsomming, lege regel = nieuwe alinea
    function inline(s) {
        return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
    }
    function richText(text) {
        const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
        return blocks.map(block => {
            const lines = block.split('\n');
            let html = '', list = [];
            const flush = () => { if (list.length) { html += '<ul>' + list.map(l => `<li>${inline(l)}</li>`).join('') + '</ul>'; list = []; } };
            let para = [];
            const flushPara = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
            for (const line of lines) {
                const m = line.match(/^\s*[-•]\s+(.*)$/);
                if (m) { flushPara(); list.push(m[1]); } else { flush(); if (line.trim()) para.push(line); }
            }
            flushPara(); flush();
            return html;
        }).join('');
    }

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    function applyStyle(root, st) {
        const f = FONTS[st.font] || FONTS.montserrat;
        const vars = {
            '--bg': st.bg, '--title': st.titleColor, '--text': st.textColor, '--accent': st.accent,
            '--font': f.css, '--title-size': st.titleSize + 'px', '--text-size': st.textSize + 'px',
            '--title-weight': st.titleWeight, '--title-case': st.uppercase ? 'uppercase' : 'none',
            '--overlay': st.overlay / 100, '--split': st.imageSplit + '%', '--fit': st.imageFit
        };
        for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
        if (st.accentLine === false) root.classList.add('hs-rule-off');
    }

    function addChrome(root, slide, ctx) {
        const st = slide.style;
        const logo = ctx.settings && ctx.settings.logo;
        if (logo && st.showLogo) {
            const img = el('img', `hs-logo hs-pos-${st.logoPosition}`);
            img.src = (ctx.base || '') + logo;
            img.alt = '';
            root.appendChild(img);
        }
        if (ctx.settings && ctx.settings.showClock) {
            const pos = st.showLogo && logo && st.logoPosition === 'top-right' ? 'top-left' : 'top-right';
            const clock = el('div', `hs-clock hs-pos-${pos}`);
            fillClock(clock);
            root.appendChild(clock);
        }
    }

    function fillClock(node, now = new Date()) {
        const t = now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
        const d = `${DAYS_LONG[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
        node.innerHTML = `<span class="hs-clock-time">${t}</span><span class="hs-clock-date">${d}</span>`;
    }

    // ------------------------------------------------------------------ nieuws
    function textContent(src) {
        const text = el('div', 'hs-text');
        if (src.kicker) text.appendChild(el('div', 'hs-kicker', esc(src.kicker)));
        if (src.title) text.appendChild(el('h1', 'hs-title', esc(src.title)));
        if (src.text) text.appendChild(el('div', 'hs-body', richText(src.text)));
        return text;
    }

    // ------------------------------------------------------------------ vrije indeling (blokken)
    function renderBlock(b, ctx) {
        const base = ctx.base || '';
        const node = el('div', `hs-block hs-block-${b.type}`);
        node.dataset.blockId = b.id;
        Object.assign(node.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px', borderRadius: (b.radius || 0) + 'px' });

        if (b.type === 'text') {
            const st = b.style;
            node.classList.add(`hs-align-${st.align}`, `hs-valign-${st.valign}`);
            applyStyle(node, st);
            node.style.setProperty('--pad', (b.padding || 0) + 'px');
            if (b.boxOpacity > 0) {
                const box = el('div', 'hs-box');
                box.style.background = b.boxColor;
                box.style.opacity = b.boxOpacity / 100;
                node.appendChild(box);
            }
            node.appendChild(textContent(b));
        } else if (b.type === 'image') {
            if (b.image) {
                const img = el('div', 'hs-gimg on');
                img.style.backgroundImage = `url("${base + b.image}")`;
                img.style.backgroundSize = b.fit;
                node.appendChild(img);
            } else node.appendChild(el('div', 'hs-block-empty', 'Foto'));
        } else {
            const imgs = b.images || [];
            node.dataset.interval = b.interval || 5;
            imgs.forEach((u, i) => {
                const img = el('div', 'hs-gimg' + (i === 0 ? ' on' : ''));
                img.style.backgroundImage = `url("${base + u}")`;
                img.style.backgroundSize = b.fit;
                node.appendChild(img);
            });
            if (!imgs.length) node.appendChild(el('div', 'hs-block-empty', 'Fotoreeks'));
            if (b.dots && imgs.length > 1) {
                node.appendChild(el('div', 'hs-dots', imgs.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')));
            }
        }
        return node;
    }

    function renderFree(slide, ctx) {
        const root = el('div', 'hs-slide hs-news hs-layout-free');
        applyStyle(root, slide.style);
        (slide.blocks || []).forEach(b => root.appendChild(renderBlock(b, ctx)));
        addChrome(root, slide, ctx);
        return root;
    }

    // Fotoreeksen laten wisselen. Stopt vanzelf als de slide uit beeld is.
    function startGalleries(root) {
        root.querySelectorAll('.hs-block-gallery').forEach(g => {
            const imgs = g.querySelectorAll('.hs-gimg');
            const dots = g.querySelectorAll('.hs-dots i');
            if (imgs.length < 2) return;
            let i = 0;
            const timer = setInterval(() => {
                if (!g.isConnected) { clearInterval(timer); return; }
                imgs[i].classList.remove('on'); if (dots[i]) dots[i].classList.remove('on');
                i = (i + 1) % imgs.length;
                imgs[i].classList.add('on'); if (dots[i]) dots[i].classList.add('on');
            }, Number(g.dataset.interval || 5) * 1000);
        });
    }

    // Hoe lang een slide in beeld blijft: minstens lang genoeg om elke fotoreeks één keer rond te laten gaan
    function slideDuration(slide, settings) {
        let d = slide.duration || (settings && settings.defaultDuration) || 15;
        if (slide.type === 'news' && slide.layout === 'free') {
            for (const b of slide.blocks || []) {
                if (b.type === 'gallery' && b.images && b.images.length > 1) d = Math.max(d, b.images.length * b.interval);
            }
        }
        return d;
    }

    function renderNews(slide, ctx) {
        if (slide.layout === 'free') return renderFree(slide, ctx);
        const st = slide.style;
        const hasImage = !!slide.image;
        let layout = slide.layout;
        if (!hasImage && layout !== 'text-only') layout = 'text-only';

        const root = el('div', `hs-slide hs-news hs-layout-${layout} hs-align-${st.align} hs-valign-${st.valign}`);
        applyStyle(root, st);

        if (hasImage) {
            const img = el('div', 'hs-image');
            img.style.backgroundImage = `url("${(ctx.base || '') + slide.image}")`;
            root.appendChild(img);
            if (layout === 'image-full') root.appendChild(el('div', 'hs-overlay'));
        }
        if (layout !== 'image-only') root.appendChild(textContent(slide));
        addChrome(root, slide, ctx);
        return root;
    }

    // ------------------------------------------------------------------ weer
    function icon(code, isDay = true) {
        const sun = `<g class="wi-sun"><circle cx="32" cy="32" r="11"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a =>
            `<line x1="32" y1="9" x2="32" y2="14" transform="rotate(${a} 32 32)"/>`).join('')}</g>`;
        const moon = '<path class="wi-moon" d="M40 14a17 17 0 1 0 10 28 14 14 0 0 1-10-28z"/>';
        const cloud = (dx = 0, dy = 0) => `<path class="wi-cloud" transform="translate(${dx} ${dy})" d="M20 50h26a10 10 0 0 0 1.5-19.9A14 14 0 0 0 20.6 27 11.5 11.5 0 0 0 20 50z"/>`;
        const small = s => `<g transform="translate(-4 -6) scale(.7)">${s}</g>`;
        const drops = n => `<g class="wi-rain">${[18, 30, 42].slice(0, n).map(x => `<line x1="${x + 4}" y1="54" x2="${x}" y2="62"/>`).join('')}</g>`;
        const flakes = '<g class="wi-snow">' + [20, 32, 44].map(x => `<circle cx="${x}" cy="58" r="2.3"/>`).join('') + '</g>';
        const bolt = '<path class="wi-bolt" d="M33 46l-6 10h6l-3 8 9-12h-6l4-6z"/>';
        const fog = '<g class="wi-fog"><line x1="12" y1="54" x2="52" y2="54"/><line x1="16" y1="60" x2="48" y2="60"/></g>';
        const sky = isDay ? sun : moon;

        let body;
        if (code === 0) body = sky;
        else if (code === 1 || code === 2) body = small(sky) + cloud(4, 0);
        else if (code === 3) body = cloud(-6, -6) + cloud(4, 0);
        else if (code === 45 || code === 48) body = cloud(0, -6) + fog;
        else if (code >= 51 && code <= 57) body = cloud(0, -6) + drops(2);
        else if (code >= 61 && code <= 67) body = cloud(0, -6) + drops(3);
        else if (code >= 80 && code <= 82) body = small(sky) + cloud(4, -6) + drops(3);
        else if (code >= 71 && code <= 77 || code === 85 || code === 86) body = cloud(0, -6) + flakes;
        else if (code >= 95) body = cloud(0, -8) + bolt;
        else body = cloud(0, 0);
        return `<svg class="wi" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
    }

    const deg = v => `${Math.round(v)}°`;
    function beaufort(kmh) {
        const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
        const b = limits.findIndex(l => kmh < l);
        return b === -1 ? 12 : b;
    }

    function renderWeather(slide, ctx) {
        const st = slide.style;
        const w = ctx.weather;
        const root = el('div', `hs-slide hs-weather hs-align-${st.align}`);
        applyStyle(root, st);

        const place = (ctx.settings && ctx.settings.location && ctx.settings.location.name) || '';
        const head = el('div', 'hs-w-head');
        if (slide.kicker) head.appendChild(el('div', 'hs-kicker', esc(slide.kicker)));
        head.appendChild(el('h1', 'hs-title', esc(slide.title || place)));
        root.appendChild(head);

        if (!w || !w.current) {
            root.appendChild(el('div', 'hs-w-empty', 'Weergegevens worden geladen…'));
            addChrome(root, slide, ctx);
            return root;
        }
        const c = w.current;
        const now = el('div', 'hs-w-now');
        now.innerHTML = `
            <div class="hs-w-now-main">
                ${icon(c.code, c.isDay)}
                <div class="hs-w-temp">${deg(c.temp)}</div>
            </div>
            <div class="hs-w-desc">${esc(WEATHER_TEXT[c.code] || '')}</div>
            <div class="hs-w-facts">
                <div><span>Voelt als</span><b>${deg(c.feels)}</b></div>
                <div><span>Wind</span><b>${beaufort(c.wind)} Bft ${WIND_DIRS[Math.round(c.windDir / 45) % 8]}</b></div>
                <div><span>Luchtvochtigheid</span><b>${Math.round(c.humidity)}%</b></div>
                <div><span>Zon op / onder</span><b>${esc(w.sunrise)} – ${esc(w.sunset)}</b></div>
            </div>`;
        root.appendChild(now);

        const hours = el('div', 'hs-w-hours');
        hours.innerHTML = `<div class="hs-w-label">Komende uren</div><div class="hs-w-row">${w.hours.map(h => `
            <div class="hs-w-cell">
                <div class="hs-w-cell-top">${esc(h.time)}</div>
                ${icon(h.code, h.isDay)}
                <div class="hs-w-cell-temp">${deg(h.temp)}</div>
                <div class="hs-w-cell-pop">${h.pop >= 10 ? `${h.pop}% regen` : '&nbsp;'}</div>
            </div>`).join('')}</div>`;
        root.appendChild(hours);

        const days = el('div', 'hs-w-days');
        days.innerHTML = w.days.slice(1, 6).map(d => {
            const dt = new Date(d.date + 'T12:00:00');
            return `<div class="hs-w-day">
                <div class="hs-w-cell-top">${DAYS[dt.getDay()]} ${dt.getDate()}</div>
                ${icon(d.code, true)}
                <div class="hs-w-day-temp"><b>${deg(d.max)}</b><span>${deg(d.min)}</span></div>
                <div class="hs-w-cell-pop">${d.pop >= 10 ? `${d.pop}% regen` : '&nbsp;'}</div>
            </div>`;
        }).join('');
        root.appendChild(days);

        addChrome(root, slide, ctx);
        return root;
    }

    function renderSlide(slide, ctx = {}) {
        return slide.type === 'weather' ? renderWeather(slide, ctx) : renderNews(slide, ctx);
    }

    // Staat de slide nu ingepland? (aan + binnen de datums, beide inclusief)
    function isActive(slide, now = new Date()) {
        if (!slide.enabled) return false;
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (slide.showFrom && today < slide.showFrom) return false;
        if (slide.showUntil && today > slide.showUntil) return false;
        return true;
    }

    // Te veel tekst? Dan alles in stapjes kleiner maken tot het past (minimaal 40%).
    // Werkt alleen als de slide al in de pagina staat. Geeft de gebruikte schaal terug.
    // Elk tekstblok apart; geeft de kleinste gebruikte schaal terug.
    function fitText(root) {
        let min = 1;
        root.querySelectorAll('.hs-text').forEach(box => {
            box.style.setProperty('--k', 1);
            if (!box.children.length) return;
            const cs = getComputedStyle(box);
            const avail = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
            const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const first = box.firstElementChild, last = box.lastElementChild;
            const fits = () => last.offsetTop + last.offsetHeight - first.offsetTop <= avail + 1
                && [...box.children].every(c => c.scrollWidth <= availW + 1);
            let k = 1;
            while (!fits() && k > 0.3) {
                k = Math.round((k - 0.04) * 100) / 100;
                box.style.setProperty('--k', k);
            }
            min = Math.min(min, k);
        });
        return min;
    }

    window.HallRender = { renderSlide, renderBlock, fitText, startGalleries, slideDuration, isActive, fillClock, richText, FONTS, WEATHER_TEXT };
})();
