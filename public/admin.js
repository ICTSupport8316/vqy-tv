/*
    Beheerpagina van de hal-TV. Alles wordt automatisch opgeslagen; de TV neemt wijzigingen
    binnen ongeveer 20 seconden over.
*/
(function () {
    'use strict';
    const R = window.HallRender;
    const $ = (s, root = document) => root.querySelector(s);

    let content = null;      // { rev, settings, slides }
    let weather = null;
    let selectedId = null;
    let selectedBlockId = null;  // geselecteerd blok bij vrije indeling
    let saveTimer = null, saving = false, pending = false, dirty = false;

    const DEFAULT_STYLE = {
        bg: '#ffffff', titleColor: '#111111', textColor: '#3a3a3a', accent: '#c8102e',
        font: 'montserrat', titleSize: 104, textSize: 40, titleWeight: 700, uppercase: false,
        align: 'left', valign: 'center', overlay: 45, imageFit: 'cover', imageSplit: 50,
        accentLine: true, showLogo: true, logoPosition: 'top-left'
    };
    const THEMES = [
        { name: 'Wit', bg: '#ffffff', titleColor: '#111111', textColor: '#3a3a3a', accent: '#c8102e' },
        { name: 'Wit / zwart', bg: '#ffffff', titleColor: '#111111', textColor: '#3a3a3a', accent: '#111111' },
        { name: 'Lichtgrijs', bg: '#f2f2f0', titleColor: '#111111', textColor: '#444444', accent: '#c8102e' },
        { name: 'Zwart', bg: '#111111', titleColor: '#ffffff', textColor: '#d4d4d4', accent: '#c8102e' },
        { name: 'Rood', bg: '#c8102e', titleColor: '#ffffff', textColor: '#fbe7ea', accent: '#111111' }
    ];
    const SWATCHES = ['#ffffff', '#111111', '#c8102e', '#7a7a7a', '#f2f2f0'];

    // ================================================================ server
    async function api(method, url, body, type) {
        const opts = { method, headers: {} };
        if (body !== undefined) {
            if (type) { opts.headers['Content-Type'] = type; opts.body = body; }
            else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        }
        const r = await fetch(url, opts);
        let data = null;
        try { data = await r.json(); } catch { /* geen json */ }
        if (r.status === 401 && url !== '/api/login' && url !== '/api/password') { showAuth('login'); throw new Error('Niet ingelogd'); }
        if (!r.ok) { const e = new Error((data && data.error) || `Fout ${r.status}`); e.status = r.status; e.data = data; throw e; }
        return data;
    }

    // ================================================================ inloggen
    async function boot() {
        const me = await api('GET', '/api/me');
        if (me.setup) showAuth('setup');
        else if (!me.loggedIn) showAuth('login');
        else startApp();
    }

    function showAuth(mode) {
        $('#app').hidden = true;
        $('#auth').hidden = false;
        const setup = mode === 'setup';
        $('#authTitle').textContent = setup ? 'Wachtwoord kiezen' : 'Inloggen';
        $('#authIntro').textContent = setup
            ? 'Eerste keer hier. Kies een wachtwoord voor de beheerpagina (minstens 8 tekens). Deel het alleen met wie de slides mag aanpassen.'
            : 'Log in om de slides op de TV in de hal aan te passen.';
        $('#authPw2Wrap').hidden = !setup;
        $('#authPw').autocomplete = setup ? 'new-password' : 'current-password';
        $('#authBtn').textContent = setup ? 'Wachtwoord opslaan' : 'Inloggen';
        $('#authError').hidden = true;
        $('#authForm').onsubmit = async e => {
            e.preventDefault();
            const pw = $('#authPw').value;
            const err = msg => { $('#authError').textContent = msg; $('#authError').hidden = false; };
            if (setup && pw !== $('#authPw2').value) return err('De wachtwoorden zijn niet hetzelfde');
            try {
                await api('POST', setup ? '/api/setup' : '/api/login', { password: pw });
                $('#authPw').value = $('#authPw2').value = '';
                startApp();
            } catch (ex) { err(ex.message); }
        };
        $('#authPw').focus();
    }

    async function startApp() {
        $('#auth').hidden = true;
        $('#app').hidden = false;
        content = await api('GET', '/api/content');
        if (!content.slides.some(s => s.id === selectedId)) selectedId = content.slides[0] ? content.slides[0].id : null;
        renderAll();
        setStatus('ok');
        loadWeather();
    }

    async function loadWeather() {
        try { weather = await api('GET', '/api/weather'); renderPreview(); renderList(); } catch { /* voorbeeld toont "laden" */ }
    }

    // ================================================================ opslaan
    function setStatus(state, msg) {
        const el = $('#status');
        el.className = 'status ' + ({ ok: 'ok', busy: 'busy', dirty: 'busy', err: 'err' }[state]);
        el.textContent = msg || ({ ok: '✓ Opgeslagen, staat op de TV', busy: 'Opslaan…', dirty: 'Wijzigingen…', err: 'Opslaan mislukt' }[state]);
    }

    function changed() {
        dirty = true;
        setStatus('dirty');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 700);
    }

    async function save() {
        if (saving) { pending = true; return; }
        saving = true; pending = false;
        setStatus('busy');
        try {
            const res = await api('PUT', '/api/content', { rev: content.rev, settings: content.settings, slides: content.slides });
            content.rev = res.rev;
            dirty = pending;
            if (!pending) setStatus('ok');
        } catch (e) {
            if (e.status === 409) {
                alert('Iemand anders heeft intussen ook iets aangepast. De nieuwste versie wordt geladen; je laatste wijziging moet je opnieuw doen.');
                content = e.data.content;
                if (!content.slides.some(s => s.id === selectedId)) selectedId = content.slides[0] ? content.slides[0].id : null;
                dirty = false; pending = false;
                renderAll();
                setStatus('ok');
            } else {
                setStatus('err', 'Opslaan mislukt: ' + e.message);
                saveTimer = setTimeout(save, 5000);
            }
        } finally {
            saving = false;
            if (pending) save();
        }
    }
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    // ================================================================ helpers
    const selected = () => content.slides.find(s => s.id === selectedId);
    const getPath = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
    function setPath(obj, path, value) {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce((o, k) => (o[k] = o[k] || {}), obj)[last] = value;
    }
    function h(tag, attrs = {}, ...children) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') e.className = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
            else if (k === 'html') e.innerHTML = v;
            else if (v === true) e.setAttribute(k, '');
            else if (v !== false && v != null) e.setAttribute(k, v);
        }
        for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(c));
        return e;
    }
    const ctx = () => ({ settings: content.settings, weather });

    function slideName(s) {
        if (s.type === 'weather') return `Weer ${content.settings.location.name}`;
        return s.title || s.kicker || 'Zonder titel';
    }
    function slideState(s) {
        if (!s.enabled) return { text: 'Uit', off: true };
        const today = new Date().toISOString().slice(0, 10);
        if (s.showFrom && today < s.showFrom) return { text: 'Vanaf ' + fmtDate(s.showFrom), off: true };
        if (s.showUntil && today > s.showUntil) return { text: 'Verlopen', off: true };
        if (s.showUntil) return { text: 't/m ' + fmtDate(s.showUntil) };
        return null;
    }
    const fmtDate = d => new Date(d + 'T12:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });

    // ================================================================ weergave
    function renderAll() { renderList(); renderPreview(); renderEditor(); }

    function renderList() {
        const list = $('#slideList');
        list.innerHTML = '';
        content.slides.forEach(s => {
            const st = slideState(s);
            const thumb = h('div', { class: 'thumb' }, R.renderSlide(s, ctx()));
            const item = h('li', {
                class: 'slide-item' + (s.id === selectedId ? ' active' : '') + (st && st.off ? ' off' : ''),
                draggable: 'true', 'data-id': s.id,
                onclick: () => { if (selectedId !== s.id) selectedBlockId = null; selectedId = s.id; renderAll(); }
            },
                thumb,
                h('div', { class: 'slide-meta' },
                    h('b', {}, slideName(s)),
                    h('span', {}, `${s.type === 'weather' ? 'Weer' : s.layout === 'free' ? 'Vrij' : 'Nieuws'} · ${R.slideDuration(s, content.settings)} s `, st ? h('span', { class: 'badge' + (st.off ? ' off' : '') }, st.text) : null)
                ),
                h('button', {
                    class: 'eye', title: s.enabled ? 'Verbergen op de TV' : 'Tonen op de TV',
                    onclick: e => { e.stopPropagation(); s.enabled = !s.enabled; renderAll(); changed(); }
                }, s.enabled ? '👁' : '🚫')
            );
            addDrag(item);
            list.appendChild(item);
            R.fitText(thumb.firstChild);
        });
        if (!content.slides.length) list.appendChild(h('li', { class: 'muted small' }, 'Nog geen slides. Voeg er hieronder een toe.'));
    }

    // Slepen om te herordenen
    let dragId = null;
    function addDrag(item) {
        item.addEventListener('dragstart', e => { dragId = item.dataset.id; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        item.addEventListener('dragend', () => { dragId = null; renderList(); });
        item.addEventListener('dragover', e => {
            if (!dragId || dragId === item.dataset.id) return;
            e.preventDefault();
            const after = e.offsetY > item.offsetHeight / 2;
            item.classList.toggle('drop-after', after);
            item.classList.toggle('drop-before', !after);
        });
        item.addEventListener('dragleave', () => item.classList.remove('drop-after', 'drop-before'));
        item.addEventListener('drop', e => {
            e.preventDefault();
            if (!dragId || dragId === item.dataset.id) return;
            const after = item.classList.contains('drop-after');
            const from = content.slides.findIndex(s => s.id === dragId);
            const [moved] = content.slides.splice(from, 1);
            let to = content.slides.findIndex(s => s.id === item.dataset.id);
            content.slides.splice(after ? to + 1 : to, 0, moved);
            renderList();
            changed();
        });
    }

    let previewObs = null;
    function renderPreview() {
        const frame = $('#preview');
        frame.innerHTML = '';
        const s = selected();
        // Weerslide: er is er altijd precies één, dus niet dupliceren of verwijderen
        $('#dupBtn').hidden = $('#delBtn').hidden = !s || s.type === 'weather';
        if (!s) return;
        const slide = R.renderSlide(s, ctx());
        frame.appendChild(slide);
        const fit = () => {
            const k = R.fitText(slide);
            const note = $('#fitNote');
            note.hidden = k >= 1;
            note.textContent = `Let op: de tekst past niet op de slide en wordt automatisch verkleind tot ${Math.round(k * 100)}%. Maak de tekst korter of kies kleinere letters.`;
        };
        fit();
        if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(fit);
        R.startGalleries(slide);
        const place = s.type === 'news' && s.layout === 'free' ? buildEditLayer(frame, slide, s) : null;
        const scale = () => { slide.style.transform = `scale(${frame.clientWidth / 1920})`; if (place) place(); };
        scale();
        if (previewObs) previewObs.disconnect();
        previewObs = new ResizeObserver(scale);
        previewObs.observe(frame);
    }

    // Na een wijziging: voorbeeld en het miniatuur van deze slide bijwerken
    let refreshTimer = null;
    function refresh() {
        renderPreview();
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(renderList, 250);
        changed();
    }

    // ================================================================ formulier-onderdelen
    function field(label, input, hint) {
        return h('label', { class: 'fld' }, h('span', {}, label), input, hint ? h('div', { class: 'hint', html: hint }) : null);
    }
    function textInput(obj, path, opts = {}) {
        const tag = opts.rows ? 'textarea' : 'input';
        const input = h(tag, { type: opts.rows ? null : 'text', rows: opts.rows, placeholder: opts.placeholder || '', maxlength: opts.max });
        input.value = getPath(obj, path) || '';
        input.addEventListener('input', () => { setPath(obj, path, input.value); refresh(); });
        return input;
    }
    function seg(obj, path, options, opts = {}) {
        const wrap = h('div', { class: 'seg' });
        options.forEach(o => {
            const b = h('button', {
                type: 'button', class: getPath(obj, path) === o.value ? 'on' : '', title: o.title || '',
                onclick: () => { if (opts.before) opts.before(o.value); setPath(obj, path, o.value); if (opts.rerender) renderEditor(); else [...wrap.children].forEach(c => c.classList.toggle('on', c === b)); refresh(); }
            }, o.icon ? h('span', { class: 'lay', html: o.icon }) : null, o.label);
            wrap.appendChild(b);
        });
        return wrap;
    }
    function range(obj, path, min, max, step = 1, unit = '') {
        const r = h('input', { type: 'range', min, max, step });
        const n = h('input', { type: 'number', min, max, step });
        r.value = n.value = getPath(obj, path);
        const set = v => { v = Math.min(max, Math.max(min, Number(v))); if (!Number.isFinite(v)) return; setPath(obj, path, v); refresh(); };
        r.addEventListener('input', () => { n.value = r.value; set(r.value); });
        n.addEventListener('change', () => { set(n.value); r.value = n.value = getPath(obj, path); });
        return h('div', { class: 'range' }, r, n);
    }
    function select(obj, path, options, cast = v => v) {
        const s = h('select', {}, options.map(o => h('option', { value: o.value }, o.label)));
        s.value = getPath(obj, path);
        s.addEventListener('change', () => { setPath(obj, path, cast(s.value)); refresh(); });
        return s;
    }
    function toggle(obj, path, label, opts = {}) {
        const c = h('input', { type: 'checkbox' });
        c.checked = !!getPath(obj, path);
        c.addEventListener('change', () => { setPath(obj, path, c.checked); if (opts.rerender) renderEditor(); refresh(); if (opts.list) renderList(); });
        return h('label', { class: 'toggle' }, c, label);
    }
    function colorField(obj, path, label) {
        const picker = h('input', { type: 'color' });
        const hex = h('input', { type: 'text', maxlength: 7, spellcheck: 'false' });
        const set = v => {
            if (!/^#[0-9a-f]{6}$/i.test(v)) return;
            setPath(obj, path, v.toLowerCase());
            picker.value = hex.value = v.toLowerCase();
            refresh();
        };
        picker.value = hex.value = getPath(obj, path);
        picker.addEventListener('input', () => set(picker.value));
        hex.addEventListener('input', () => set(hex.value.startsWith('#') ? hex.value : '#' + hex.value));
        const sw = h('div', { class: 'swatches' }, SWATCHES.map(c => h('button', { type: 'button', title: c, style: `background:${c}`, onclick: () => set(c) })));
        return h('div', { class: 'fld' }, h('span', { class: 'fld-label' }, label), h('div', { class: 'color' }, picker, hex, sw));
    }

    // Afbeelding kiezen, slepen of plakken; grote foto's eerst verkleinen
    async function prepareImage(file) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
        const img = await createImageBitmap(file).catch(() => null);
        if (!img) return file;
        const max = 2560;
        if (img.width <= max && img.height <= max && file.size < 3e6) return file;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        return new Promise(res => canvas.toBlob(b => res(b || file), type, 0.88));
    }
    async function uploadFile(file) {
        if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Kies een JPG, PNG, WebP of GIF');
        const blob = await prepareImage(file);
        const res = await api('POST', '/api/upload', blob, blob.type || file.type);
        return res.url;
    }
    function imageField(obj, path, opts = {}) {
        const wrap = h('div', { class: 'drop' });
        const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
        const draw = (msg) => {
            const url = getPath(obj, path);
            wrap.innerHTML = '';
            if (url) wrap.appendChild(h('img', { src: url, alt: '' }));
            else wrap.appendChild(h('div', {}, msg || 'Sleep een afbeelding hierheen of kies een bestand'));
            wrap.appendChild(h('div', { class: 'drop-actions' },
                h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, url ? 'Andere afbeelding' : 'Bestand kiezen'),
                url ? h('button', { type: 'button', class: 'btn danger', onclick: () => { setPath(obj, path, ''); draw(); after(); } }, 'Weghalen') : null
            ));
            wrap.appendChild(fileInput);
        };
        const after = () => { if (opts.onChange) opts.onChange(); else { refresh(); renderEditor(); } };
        const handle = async file => {
            if (!file) return;
            draw('Uploaden…');
            try { setPath(obj, path, await uploadFile(file)); draw(); after(); }
            catch (e) { draw(); alert('Uploaden mislukt: ' + e.message); }
        };
        fileInput.addEventListener('change', () => handle(fileInput.files[0]));
        wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('over'); });
        wrap.addEventListener('dragleave', () => wrap.classList.remove('over'));
        wrap.addEventListener('drop', e => { e.preventDefault(); wrap.classList.remove('over'); handle(e.dataTransfer.files[0]); });
        draw();
        return wrap;
    }

    // Kleine plaatjes voor de indelingsknoppen
    const LAYOUT_ICONS = {
        'image-left': '<i style="left:0;top:0;bottom:0;width:45%"></i><b style="left:55%;top:8px;width:35%"></b><b style="left:55%;top:14px;width:25%"></b>',
        'image-right': '<i style="right:0;top:0;bottom:0;width:45%"></i><b style="left:10%;top:8px;width:35%"></b><b style="left:10%;top:14px;width:25%"></b>',
        'image-full': '<i style="inset:0"></i><b style="left:10%;top:14px;width:50%;opacity:1"></b>',
        'text-only': '<b style="left:12%;top:8px;width:60%"></b><b style="left:12%;top:14px;width:40%"></b>',
        'image-only': '<i style="inset:0;opacity:.8"></i>',
        free: '<i style="left:3px;top:3px;width:16px;height:11px"></i><i style="right:3px;top:6px;width:14px;height:15px;opacity:.35"></i><b style="left:4px;top:18px;width:14px"></b>'
    };

    // ================================================================ editor
    function section(title, ...children) {
        return h('div', { class: 'sec' }, h('h2', {}, title), ...children);
    }

    function colorsSection(st, opts = {}) {
        return section(opts.title || 'Kleuren',
            h('div', { class: 'themes' }, THEMES.map(t => h('button', {
                type: 'button', class: 'theme', title: `Thema ${t.name}`,
                onclick: () => {
                    Object.assign(st, { titleColor: t.titleColor, textColor: t.textColor, accent: t.accent });
                    if (opts.noBg) { if (opts.box) { opts.box.boxColor = t.bg; if (!opts.box.boxOpacity) opts.box.boxOpacity = 100; } }
                    else st.bg = t.bg;
                    renderEditor(); refresh();
                }
            }, h('span', { class: 'sw', style: `background:${t.bg};--t:${t.titleColor};--a:${t.accent}` }), t.name))),
            h('div', { class: 'colors' },
                opts.noBg ? null : colorField(st, 'bg', 'Achtergrond'),
                colorField(st, 'titleColor', 'Titel'),
                colorField(st, 'textColor', 'Tekst'),
                colorField(st, 'accent', 'Accent (label, streep)')
            ),
            toggle(st, 'accentLine', 'Streep onder de titel')
        );
    }

    function fontSection(st) {
        return section('Lettertype en grootte',
            field('Lettertype', select(st, 'font', Object.entries(R.FONTS).map(([value, f]) => ({ value, label: f.label })))),
            field('Grootte titel (px)', range(st, 'titleSize', 30, 260)),
            h('div', { class: 'row2' },
                field('Dikte titel', select(st, 'titleWeight', [
                    { value: 300, label: 'Dun' }, { value: 400, label: 'Normaal' }, { value: 600, label: 'Halfvet' },
                    { value: 700, label: 'Vet' }, { value: 800, label: 'Extra vet' }], Number)),
                h('div', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Hoofdletters'), toggle(st, 'uppercase', 'TITEL IN HOOFDLETTERS'))
            ),
            field('Grootte tekst (px)', range(st, 'textSize', 16, 120), 'Ook het label boven de titel schaalt mee.')
        );
    }

    function alignRow(st) {
        return h('div', { class: 'row2' },
            field('Uitlijning', seg(st, 'align', [{ value: 'left', label: 'Links' }, { value: 'center', label: 'Midden' }, { value: 'right', label: 'Rechts' }])),
            field('Verticaal', seg(st, 'valign', [{ value: 'top', label: 'Boven' }, { value: 'center', label: 'Midden' }, { value: 'bottom', label: 'Onder' }]))
        );
    }

    const TEXT_HINT = '<b>**vet**</b>, <i>*schuin*</i>, een regel die begint met <b>- </b> wordt een opsomming, een lege regel begint een nieuwe alinea.';

    function renderEditor() {
        const ed = $('#editor');
        const scroll = ed.scrollTop;
        ed.innerHTML = '';
        const s = selected();
        renderBlockBar();
        if (!s) { ed.appendChild(h('div', { class: 'sec muted' }, 'Kies links een slide of voeg er een toe.')); return; }
        // De weerslide heeft een vaste opmaak: alleen aan/uit
        if (s.type === 'weather') {
            ed.appendChild(section('Weer',
                toggle(s, 'enabled', 'Tonen op de TV', { list: true }),
                h('div', { class: 'hint', html:
                    `Live weer voor <b>${escapeHtml(content.settings.location.name)}</b>, elke 10 minuten bijgewerkt. ` +
                    'De opmaak van deze slide ligt vast. Sleep hem in de lijst om zijn plek in de volgorde te kiezen.<br><br>' +
                    'Zelf opmaken? Maak met <b>+ Weerslide</b> een weerslide van blokken die je helemaal kunt aanpassen, of zet met <b>+ Weer</b> een weerblok op een slide met vrije indeling (bijv. klein in een hoek).' })
            ));
            return;
        }
        const st = s.style;
        const free = s.layout === 'free';
        const hasImg = !!s.image;

        // Indeling: vaste opzet of vrij met blokken
        ed.appendChild(section('Indeling',
            seg(s, 'layout', [
                { value: 'image-left', label: 'Foto links', icon: LAYOUT_ICONS['image-left'] },
                { value: 'image-right', label: 'Foto rechts', icon: LAYOUT_ICONS['image-right'] },
                { value: 'image-full', label: 'Foto achter', icon: LAYOUT_ICONS['image-full'] },
                { value: 'text-only', label: 'Alleen tekst', icon: LAYOUT_ICONS['text-only'] },
                { value: 'image-only', label: 'Alleen foto', icon: LAYOUT_ICONS['image-only'] },
                { value: 'free', label: 'Vrij (blokken)', icon: LAYOUT_ICONS.free }
            ], {
                rerender: true,
                before: v => {
                    if (v === 'free' && !(s.blocks && s.blocks.length)) { s.blocks = blocksFromPreset(s); selectedBlockId = null; }
                }
            }),
            h('div', {
                class: 'hint', html: free
                    ? 'Zet tekst, foto\'s en fotoreeksen waar je wilt: sleep een blok in het voorbeeld, sleep een hoek om de grootte te wijzigen.'
                    : 'Kies <b>Vrij</b> om zelf blokken te plaatsen, bijvoorbeeld meerdere foto\'s of een fotoreeks. Deze opzet wordt dan je startpunt.'
            })
        ));

        if (free) {
            renderFreeEditor(ed, s);
        } else {
            ed.appendChild(section('Inhoud',
                field('Label boven de titel', textInput(s, 'kicker', { placeholder: 'bijv. Nieuws, Personeel, Veiligheid', max: 80 }), 'Leeg laten = geen label.'),
                field('Titel', textInput(s, 'title', { rows: 2, max: 300 })),
                field('Tekst', textInput(s, 'text', { rows: 7, max: 5000 }), TEXT_HINT),
                field('Afbeelding', imageField(s, 'image'), hasImg ? null : 'Zonder afbeelding wordt elke indeling "Alleen tekst".')
            ));
            const opts = [
                hasImg && (s.layout === 'image-left' || s.layout === 'image-right') ? field('Breedte van de foto (%)', range(st, 'imageSplit', 25, 75)) : null,
                hasImg && s.layout === 'image-full' ? field('Kleurlaag over de foto (%)', range(st, 'overlay', 0, 95), 'In de achtergrondkleur. Hoger = tekst beter leesbaar.') : null,
                hasImg ? field('Foto', seg(st, 'imageFit', [{ value: 'cover', label: 'Vlak vullen (bijsnijden)' }, { value: 'contain', label: 'Hele foto tonen' }])) : null,
                s.layout !== 'image-only' || !hasImg ? alignRow(st) : null
            ].filter(Boolean);
            if (opts.length) ed.appendChild(section('Plaatsing', ...opts));
            ed.appendChild(colorsSection(st));
            ed.appendChild(fontSection(st));
        }

        // Logo
        ed.appendChild(section('Logo',
            content.settings.logo
                ? h('div', { class: 'row2' },
                    toggle(st, 'showLogo', 'Logo tonen', { rerender: true }),
                    st.showLogo ? select(st, 'logoPosition', [
                        { value: 'top-left', label: 'Linksboven' }, { value: 'top-right', label: 'Rechtsboven' },
                        { value: 'bottom-left', label: 'Linksonder' }, { value: 'bottom-right', label: 'Rechtsonder' }]) : h('span'))
                : h('div', { class: 'hint' }, 'Nog geen logo. Upload het bij Instellingen; daarna kun je het per slide aan- of uitzetten.')
        ));

        // Planning
        const minDur = R.slideDuration(s, content.settings);
        ed.appendChild(section('Planning',
            toggle(s, 'enabled', 'Tonen op de TV', { list: true }),
            field('Hoe lang in beeld (seconden)', range(s, 'duration', 3, 120),
                minDur > s.duration ? `Door de fotoreeks blijft deze slide <b>${minDur} seconden</b> in beeld, zodat elke foto één keer langskomt.` : null),
            h('div', { class: 'row2' },
                field('Tonen vanaf', dateInput(s, 'showFrom')),
                field('Tonen tot en met', dateInput(s, 'showUntil'))
            ),
            h('div', { class: 'hint' }, 'Datums leeg laten = altijd tonen. Handig voor nieuws dat vanzelf moet verdwijnen.')
        ));
        ed.scrollTop = scroll;
    }

    // ================================================================ vrije indeling
    const W = 1920, H = 1080;
    const BLOCK_NAMES = { text: 'Tekst', image: 'Foto', gallery: 'Fotoreeks', weather: 'Weer' };

    function blockLabel(b) {
        if (b.type === 'text') return b.title || b.kicker || (b.text || '').split('\n')[0] || 'Tekst';
        if (b.type === 'gallery') return `Fotoreeks (${(b.images || []).length} foto's)`;
        if (b.type === 'weather') return 'Weer: ' + (R.WEATHER_PARTS[b.part] || '');
        return b.image ? 'Foto' : 'Foto (leeg)';
    }

    function textBlock(s, x, y, w, hgt, extra = {}) {
        return {
            id: newId(), type: 'text', x, y, w, h: hgt, radius: 0,
            kicker: s.kicker || '', title: s.title || '', text: s.text || '',
            style: { ...s.style }, boxColor: s.style.bg, boxOpacity: 0, padding: 60, ...extra
        };
    }
    const imageBlock = (s, x, y, w, hgt) => ({ id: newId(), type: 'image', x, y, w, h: hgt, radius: 0, image: s.image, fit: s.style.imageFit });

    // Huidige vaste opzet omzetten naar blokken, zodat "Vrij" niet met een leeg vel begint
    function blocksFromPreset(s) {
        const st = s.style;
        const split = Math.round(W * st.imageSplit / 100);
        const layout = s.image ? s.layout : 'text-only';
        switch (layout) {
            case 'image-left': return [imageBlock(s, 0, 0, split, H), textBlock(s, split, 0, W - split, H, { padding: 120 })];
            case 'image-right': return [imageBlock(s, W - split, 0, split, H), textBlock(s, 0, 0, W - split, H, { padding: 120 })];
            case 'image-full': return [imageBlock(s, 0, 0, W, H), textBlock(s, 0, 0, W, H, { padding: 150, boxColor: st.bg, boxOpacity: st.overlay })];
            case 'image-only': return [imageBlock(s, 0, 0, W, H)];
            default: return [textBlock(s, 0, 0, W, H, { padding: 150 })];
        }
    }

    function selectedBlock() {
        const s = selected();
        return s && s.blocks ? s.blocks.find(b => b.id === selectedBlockId) : null;
    }

    function addBlock(type) {
        const s = selected();
        s.blocks = s.blocks || [];
        const n = s.blocks.length;
        const off = (n % 6) * 40;
        let b;
        if (type === 'text') {
            b = textBlock({ kicker: '', title: 'Nieuwe tekst', text: '', style: { ...s.style } }, 160 + off, 160 + off, 820, 420, { boxColor: '#ffffff' });
        } else if (type === 'image') {
            b = { id: newId(), type: 'image', x: 1000 - off, y: 140 + off, w: 760, h: 800, radius: 0, image: '', fit: 'cover' };
        } else if (type === 'weather') {
            // Wit vlak met ronde hoeken: leesbaar op elke achtergrond, ook op een foto
            b = weatherBlock('compact', 1100 - off, 120 + off, 680, 200, { style: { ...DEFAULT_STYLE, align: 'left' }, boxOpacity: 92, radius: 18, padding: 28 });
        } else {
            b = { id: newId(), type: 'gallery', x: 1000 - off, y: 140 + off, w: 760, h: 800, radius: 0, images: [], fit: 'cover', interval: 5, dots: true };
        }
        s.blocks.push(b);
        selectedBlockId = b.id;
        renderEditor();
        refresh();
        // Bij een foto of fotoreeks meteen de bestandskiezer openen
        if (type === 'image' || type === 'gallery') setTimeout(() => { const f = $('#editor .block-sec input[type=file]'); if (f) f.click(); }, 50);
        else if (type === 'text') setTimeout(() => { const t = $('#editor .block-sec textarea'); if (t) { t.focus(); t.select(); } }, 50);
    }

    function weatherBlock(part, x, y, w, hgt, extra = {}) {
        return {
            id: newId(), type: 'weather', part, x, y, w, h: hgt, radius: 0,
            showLabel: true, showPlace: false, style: { ...DEFAULT_STYLE },
            boxColor: '#ffffff', boxOpacity: 0, padding: 20, ...extra
        };
    }

    // Complete weerslide opgebouwd uit blokken: zelfde opzet als de vaste weerslide, maar alles aanpasbaar
    function newWeatherSlide() {
        const style = { ...DEFAULT_STYLE };
        const left = { style: { ...style, align: 'left' } };
        return {
            id: newId(), type: 'news', enabled: true, duration: content.settings.defaultDuration,
            kicker: 'Weer', title: content.settings.location.name, text: '', image: '', layout: 'free',
            showFrom: '', showUntil: '', style,
            blocks: [
                { ...textBlock({ kicker: 'Weer', title: content.settings.location.name, text: '', style: { ...style, valign: 'top' } }, 150, 110, 900, 240), padding: 0 },
                weatherBlock('now', 150, 380, 760, 330, { ...left, padding: 0 }),
                weatherBlock('details', 150, 760, 760, 220, { ...left, padding: 0, showLabel: false }),
                weatherBlock('hours', 1020, 380, 750, 300, { ...left, padding: 0 }),
                weatherBlock('days', 1020, 720, 750, 300, { ...left, padding: 0 })
            ]
        };
    }

    function moveBlockZ(b, dir) {
        const list = selected().blocks;
        const i = list.indexOf(b);
        const j = dir === 'top' ? list.length - 1 : dir === 'bottom' ? 0 : i + dir;
        if (j < 0 || j >= list.length || j === i) return;
        list.splice(i, 1);
        list.splice(j, 0, b);
        renderEditor(); refresh();
    }
    function deleteBlock(b) {
        const list = selected().blocks;
        list.splice(list.indexOf(b), 1);
        if (selectedBlockId === b.id) selectedBlockId = null;
        renderEditor(); refresh();
    }
    function duplicateBlock(b) {
        const copy = JSON.parse(JSON.stringify(b));
        copy.id = newId();
        copy.x += 40; copy.y += 40;
        selected().blocks.push(copy);
        selectedBlockId = copy.id;
        renderEditor(); refresh();
    }

    // Knoppenbalk boven het voorbeeld (alleen bij vrije indeling)
    function renderBlockBar() {
        const bar = $('#blockBar');
        const s = selected();
        bar.innerHTML = '';
        bar.hidden = !(s && s.type === 'news' && s.layout === 'free');
        if (bar.hidden) return;
        bar.append(
            h('button', { type: 'button', class: 'btn', onclick: () => addBlock('text') }, '+ Tekst'),
            h('button', { type: 'button', class: 'btn', onclick: () => addBlock('image') }, '+ Foto'),
            h('button', { type: 'button', class: 'btn', onclick: () => addBlock('gallery') }, '+ Fotoreeks'),
            h('button', { type: 'button', class: 'btn', onclick: () => addBlock('weather') }, '+ Weer'),
            h('span', { class: 'muted small bar-hint' }, 'Sleep om te verplaatsen, sleep een hoek voor de grootte (Shift = verhouding houden). Pijltjes = 10 px, Alt = vrij zonder uitlijnen.')
        );
    }

    function renderFreeEditor(ed, s) {
        const blocks = s.blocks || [];
        // Lijst met blokken (bovenste eerst)
        ed.appendChild(section('Blokken',
            blocks.length ? h('ul', { class: 'block-list' }, [...blocks].reverse().map(b => h('li', {
                class: b.id === selectedBlockId ? 'on' : '',
                onclick: () => { selectedBlockId = b.id; renderEditor(); renderPreview(); }
            },
                h('span', { class: 'bl-type' }, BLOCK_NAMES[b.type]),
                h('span', { class: 'bl-name' }, blockLabel(b)),
                h('button', { type: 'button', class: 'icon-btn', title: 'Naar voren', onclick: e => { e.stopPropagation(); moveBlockZ(b, 1); } }, '↑'),
                h('button', { type: 'button', class: 'icon-btn', title: 'Naar achteren', onclick: e => { e.stopPropagation(); moveBlockZ(b, -1); } }, '↓'),
                h('button', { type: 'button', class: 'icon-btn danger', title: 'Verwijderen', onclick: e => { e.stopPropagation(); deleteBlock(b); } }, '✕')
            ))) : h('div', { class: 'hint' }, 'Nog geen blokken. Voeg ze toe met de knoppen boven het voorbeeld.'),
            h('div', { class: 'hint' }, 'Bovenaan de lijst = bovenop in beeld.')
        ));

        const b = selectedBlock();
        if (b) {
            const sec = section(`Blok: ${BLOCK_NAMES[b.type]}`);
            sec.classList.add('block-sec');
            // append() zou null als tekst "null" tonen: lege onderdelen eerst weglaten
            const add = (...items) => sec.append(...items.filter(x => x != null && x !== false));
            if (b.type === 'text') {
                add(
                    field('Label boven de titel', textInput(b, 'kicker', { max: 80 })),
                    field('Titel', textInput(b, 'title', { rows: 2, max: 300 })),
                    field('Tekst', textInput(b, 'text', { rows: 5, max: 5000 }), TEXT_HINT),
                    alignRow(b.style),
                    h('div', { class: 'row2' },
                        field('Vlak achter de tekst (%)', range(b, 'boxOpacity', 0, 100), '0 = doorzichtig.'),
                        field('Binnenmarge (px)', range(b, 'padding', 0, 300))
                    ),
                    b.boxOpacity > 0 ? colorField(b, 'boxColor', 'Kleur van het vlak') : null
                );
            } else if (b.type === 'image') {
                add(
                    field('Foto', imageField(b, 'image')),
                    field('Passen', seg(b, 'fit', [{ value: 'cover', label: 'Vlak vullen (bijsnijden)' }, { value: 'contain', label: 'Hele foto tonen' }]))
                );
            } else if (b.type === 'weather') {
                const part = b.part;
                add(
                    field('Onderdeel', seg(b, 'part', Object.entries(R.WEATHER_PARTS).map(([value, label]) => ({ value, label })), { rerender: true }),
                        'Live weer, elke 10 minuten bijgewerkt. De inhoud wordt zo groot als het blok: sleep een hoek om hem groter of kleiner te maken.'),
                    part === 'now' || part === 'compact' ? toggle(b, 'showPlace', `Plaatsnaam tonen (${content.settings.location.name})`) : null,
                    part === 'details' || part === 'hours' || part === 'days' ? toggle(b, 'showLabel', 'Kopje tonen (bijv. "Komende uren")') : null,
                    field('Uitlijning', seg(b.style, 'align', [{ value: 'left', label: 'Links' }, { value: 'center', label: 'Midden' }, { value: 'right', label: 'Rechts' }])),
                    h('div', { class: 'row2' },
                        field('Vlak achter het weer (%)', range(b, 'boxOpacity', 0, 100), '0 = doorzichtig.'),
                        field('Binnenmarge (px)', range(b, 'padding', 0, 300))
                    ),
                    b.boxOpacity > 0 ? colorField(b, 'boxColor', 'Kleur van het vlak') : null
                );
            } else {
                add(
                    field("Foto's", galleryField(b), 'Ze wisselen elkaar af in deze volgorde. Meerdere tegelijk kiezen of slepen kan.'),
                    h('div', { class: 'row2' },
                        field('Wisselen na (seconden)', range(b, 'interval', 2, 60)),
                        h('div', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Bolletjes'), toggle(b, 'dots', 'Bolletjes onderin'))
                    ),
                    field('Passen', seg(b, 'fit', [{ value: 'cover', label: 'Vlak vullen (bijsnijden)' }, { value: 'contain', label: 'Hele foto tonen' }]))
                );
            }
            add(
                h('div', { class: 'pos-row' },
                    posInput(b, 'x', 'X'), posInput(b, 'y', 'Y'), posInput(b, 'w', 'Breedte'), posInput(b, 'h', 'Hoogte')),
                field('Ronde hoeken (px)', range(b, 'radius', 0, 200)),
                h('div', { class: 'btn-row' },
                    h('button', { type: 'button', class: 'btn', onclick: () => { Object.assign(b, { x: 0, y: 0, w: W, h: H }); renderEditor(); refresh(); } }, 'Volledig scherm'),
                    h('button', { type: 'button', class: 'btn', onclick: () => { b.x = Math.round((W - b.w) / 2); b.y = Math.round((H - b.h) / 2); renderEditor(); refresh(); } }, 'Centreren'),
                    h('button', { type: 'button', class: 'btn', onclick: () => moveBlockZ(b, 'top') }, 'Bovenop'),
                    h('button', { type: 'button', class: 'btn', onclick: () => moveBlockZ(b, 'bottom') }, 'Onderop'),
                    h('button', { type: 'button', class: 'btn', onclick: () => duplicateBlock(b) }, 'Dupliceren'),
                    h('button', { type: 'button', class: 'btn danger', onclick: () => deleteBlock(b) }, 'Verwijderen')
                )
            );
            ed.appendChild(sec);
            if (b.type === 'text') {
                ed.appendChild(colorsSection(b.style, { title: 'Kleuren van dit blok', noBg: true, box: b }));
                ed.appendChild(fontSection(b.style));
            } else if (b.type === 'weather') {
                ed.appendChild(section('Kleuren en lettertype',
                    h('div', { class: 'colors' },
                        colorField(b.style, 'titleColor', 'Temperatuur en waarden'),
                        colorField(b.style, 'textColor', 'Tekst'),
                        colorField(b.style, 'accent', 'Accent (kopjes, plaats)')
                    ),
                    field('Lettertype', select(b.style, 'font', Object.entries(R.FONTS).map(([value, f]) => ({ value, label: f.label }))))
                ));
            }
        } else if (blocks.length) {
            ed.appendChild(section('Blok', h('div', { class: 'hint' }, 'Klik op een blok in het voorbeeld of in de lijst hierboven om het aan te passen.')));
        }

        ed.appendChild(section('Achtergrond', colorField(s.style, 'bg', 'Achtergrondkleur van de slide')));
    }

    function posInput(b, key, label) {
        const n = h('input', { type: 'number', step: 10, 'data-pos': key });
        n.value = b[key];
        n.addEventListener('change', () => {
            const v = Math.round(Number(n.value));
            if (!Number.isFinite(v)) return;
            b[key] = key === 'w' || key === 'h' ? Math.max(20, v) : v;
            refresh();
        });
        return h('label', { class: 'fld' }, h('span', {}, label), n);
    }
    function updatePosFields(b) {
        document.querySelectorAll('#editor [data-pos]').forEach(n => { if (document.activeElement !== n) n.value = b[n.dataset.pos]; });
    }

    // Meerdere foto's voor een fotoreeks
    function galleryField(b) {
        const wrap = h('div', { class: 'drop gallery-drop' });
        const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, hidden: true });
        let busy = '';
        const draw = () => {
            wrap.innerHTML = '';
            const grid = h('div', { class: 'gal-grid' }, b.images.map((u, i) => h('div', { class: 'gal-item' },
                h('img', { src: u, alt: '' }),
                h('div', { class: 'gal-actions' },
                    h('button', { type: 'button', title: 'Eerder', disabled: i === 0, onclick: () => { b.images.splice(i - 1, 0, b.images.splice(i, 1)[0]); draw(); refresh(); } }, '←'),
                    h('button', { type: 'button', title: 'Later', disabled: i === b.images.length - 1, onclick: () => { b.images.splice(i + 1, 0, b.images.splice(i, 1)[0]); draw(); refresh(); } }, '→'),
                    h('button', { type: 'button', title: 'Weghalen', onclick: () => { b.images.splice(i, 1); draw(); refresh(); renderEditor(); } }, '✕')
                ))));
            if (b.images.length) wrap.appendChild(grid);
            wrap.appendChild(h('div', {}, busy || (b.images.length ? '' : "Sleep foto's hierheen of kies bestanden")));
            wrap.appendChild(h('div', { class: 'drop-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, "Foto's toevoegen")));
            wrap.appendChild(fileInput);
        };
        const handle = async files => {
            files = [...files].filter(f => /^image\//.test(f.type));
            for (let i = 0; i < files.length; i++) {
                busy = `Uploaden ${i + 1} van ${files.length}…`; draw();
                try { b.images.push(await uploadFile(files[i])); refresh(); }
                catch (e) { alert(`Uploaden van ${files[i].name} mislukt: ${e.message}`); }
            }
            busy = ''; draw(); renderEditor();
        };
        fileInput.addEventListener('change', () => handle(fileInput.files));
        wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('over'); });
        wrap.addEventListener('dragleave', () => wrap.classList.remove('over'));
        wrap.addEventListener('drop', e => { e.preventDefault(); wrap.classList.remove('over'); handle(e.dataTransfer.files); });
        draw();
        return wrap;
    }

    // ---- slepen en schalen in het voorbeeld
    const SNAP = 12; // canvas-pixels
    function snapPos(pos, size, max, free) {
        if (free) return Math.round(pos);
        for (const [edge, target] of [[pos, 0], [pos + size, max], [pos + size / 2, max / 2]]) {
            if (Math.abs(edge - target) <= SNAP) return Math.round(pos + target - edge);
        }
        return Math.round(pos / 10) * 10;
    }
    function snapEdge(v, max, free) {
        if (free) return Math.round(v);
        for (const t of [0, max / 2, max]) if (Math.abs(v - t) <= SNAP) return t;
        return Math.round(v / 10) * 10;
    }

    function buildEditLayer(frame, slideEl, s) {
        const layer = h('div', { class: 'edit-layer' });
        const boxes = [];
        const place = () => {
            const sc = frame.clientWidth / W;
            boxes.forEach(([box, b]) => Object.assign(box.style, { left: b.x * sc + 'px', top: b.y * sc + 'px', width: b.w * sc + 'px', height: b.h * sc + 'px' }));
        };
        layer.addEventListener('pointerdown', e => {
            if (e.target !== layer) return;
            selectedBlockId = null;
            boxes.forEach(([box]) => box.classList.remove('sel'));
            renderEditor();
        });
        (s.blocks || []).forEach(b => {
            const box = h('div', { class: 'eb' + (b.id === selectedBlockId ? ' sel' : ''), title: `${BLOCK_NAMES[b.type]}: ${blockLabel(b)}` },
                ['nw', 'ne', 'sw', 'se'].map(c => h('span', { class: 'eh eh-' + c, 'data-h': c })),
                h('span', { class: 'eb-label' }, BLOCK_NAMES[b.type]));
            box.addEventListener('pointerdown', e => startDrag(e, b, box, boxes, frame, slideEl));
            box.addEventListener('dblclick', () => {
                const t = $('#editor .block-sec textarea, #editor .block-sec input[type=text]');
                if (t) t.focus();
                else { const f = $('#editor .block-sec input[type=file]'); if (f) f.click(); }
            });
            boxes.push([box, b]);
            layer.appendChild(box);
        });
        place();
        frame.appendChild(layer);
        return place;
    }

    function startDrag(e, b, box, boxes, frame, slideEl) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (selectedBlockId !== b.id) {
            selectedBlockId = b.id;
            boxes.forEach(([x]) => x.classList.toggle('sel', x === box));
            renderEditor();
        }
        const handle = e.target.dataset.h || null;
        const sc = frame.clientWidth / W;
        const start = { cx: e.clientX, cy: e.clientY, x: b.x, y: b.y, w: b.w, h: b.h };
        const blockEl = slideEl.querySelector(`[data-block-id="${b.id}"]`);
        let moved = false;
        try { box.setPointerCapture(e.pointerId); } catch { /* sommige apparaten ondersteunen dit niet */ }

        const move = ev => {
            const dx = (ev.clientX - start.cx) / sc, dy = (ev.clientY - start.cy) / sc;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
            moved = true;
            const free = ev.altKey;
            let { x, y, w, h: hh } = start;
            if (!handle) {
                x = snapPos(x + dx, w, W, free);
                y = snapPos(y + dy, hh, H, free);
            } else {
                let right = x + w, bottom = y + hh;
                if (handle.includes('e')) right = snapEdge(right + dx, W, free);
                if (handle.includes('w')) x = snapEdge(x + dx, W, free);
                if (handle.includes('s')) bottom = snapEdge(bottom + dy, H, free);
                if (handle.includes('n')) y = snapEdge(y + dy, H, free);
                w = Math.max(40, right - x);
                hh = Math.max(40, bottom - y);
                if (handle.includes('w')) x = right - w;
                if (handle.includes('n')) y = bottom - hh;
                // Shift: verhouding behouden (handig voor foto's)
                if (ev.shiftKey) {
                    const ratio = start.w / start.h;
                    if (w / hh > ratio) w = Math.round(hh * ratio); else hh = Math.round(w / ratio);
                    if (handle.includes('w')) x = right - w;
                    if (handle.includes('n')) y = bottom - hh;
                }
            }
            Object.assign(b, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) });
            if (blockEl) {
                Object.assign(blockEl.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
                if (b.type === 'text' && handle) R.fitText(blockEl);
            }
            Object.assign(box.style, { left: b.x * sc + 'px', top: b.y * sc + 'px', width: b.w * sc + 'px', height: b.h * sc + 'px' });
            updatePosFields(b);
        };
        const up = () => {
            box.removeEventListener('pointermove', move);
            box.removeEventListener('pointerup', up);
            box.removeEventListener('pointercancel', up);
            if (moved) refresh();
        };
        box.addEventListener('pointermove', move);
        box.addEventListener('pointerup', up);
        box.addEventListener('pointercancel', up);
    }

    // Pijltjestoetsen en Delete voor het geselecteerde blok
    document.addEventListener('keydown', e => {
        const b = selectedBlock();
        if (!b || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || $('#settings').open) return;
        const step = e.altKey ? 1 : 10;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            b.x += moves[e.key][0]; b.y += moves[e.key][1];
            renderPreview(); updatePosFields(b); changed();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            deleteBlock(b);
        } else if (e.key === 'Escape') {
            selectedBlockId = null; renderEditor(); renderPreview();
        }
    });

    function dateInput(obj, path) {
        const d = h('input', { type: 'date' });
        d.value = getPath(obj, path) || '';
        d.addEventListener('change', () => { setPath(obj, path, d.value); refresh(); renderList(); });
        return d;
    }

    // ================================================================ slides toevoegen / verwijderen
    function insertSlide(slide) {
        const i = content.slides.findIndex(s => s.id === selectedId);
        content.slides.splice(i === -1 ? content.slides.length : i + 1, 0, slide);
        selectedId = slide.id;
        renderAll();
        changed();
    }
    const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

    $('#addWeatherSlide').onclick = () => { selectedBlockId = null; insertSlide(newWeatherSlide()); };
    $('#addNews').onclick = () => {
        // Neem de opmaak over van de geselecteerde nieuwsslide, zodat een serie er hetzelfde uitziet
        const cur = selected();
        const style = cur && cur.type === 'news' ? { ...cur.style } : { ...DEFAULT_STYLE };
        insertSlide({ id: newId(), type: 'news', enabled: true, duration: content.settings.defaultDuration, kicker: 'Nieuws', title: 'Nieuwe slide', text: '', image: '', layout: 'image-left', showFrom: '', showUntil: '', style });
        setTimeout(() => { const t = $('#editor textarea'); if (t) { t.focus(); t.select(); } }, 0);
    };
    $('#dupBtn').onclick = () => {
        const s = selected();
        if (!s) return;
        const copy = JSON.parse(JSON.stringify(s));
        copy.id = newId();
        if (copy.title) copy.title += ' (kopie)';
        insertSlide(copy);
    };
    $('#delBtn').onclick = () => {
        const s = selected();
        if (!s || !confirm(`Slide "${slideName(s)}" verwijderen?`)) return;
        const i = content.slides.indexOf(s);
        content.slides.splice(i, 1);
        const next = content.slides[Math.min(i, content.slides.length - 1)];
        selectedId = next ? next.id : null;
        renderAll();
        changed();
    };

    // ================================================================ instellingen
    $('#settingsBtn').onclick = () => { renderSettings(); $('#settings').showModal(); };
    $('#logoutBtn').onclick = async () => {
        if (dirty) await save();
        await api('POST', '/api/logout');
        location.reload();
    };

    function renderSettings() {
        const body = $('#settingsBody');
        body.innerHTML = '';
        const set = content.settings;
        const afterSettings = () => { renderAll(); changed(); };

        // Plaats voor het weer
        const search = h('input', { type: 'search', placeholder: 'Zoek een plaats…', onkeydown: e => { if (e.key === 'Enter') e.preventDefault(); } });
        const results = h('ul', { class: 'results', hidden: true });
        const current = h('div', { class: 'hint', html: `Nu: <b>${escapeHtml(set.location.name)}</b> (${set.location.lat.toFixed(3)}, ${set.location.lon.toFixed(3)})` });
        let t = null;
        search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                const q = search.value.trim();
                if (q.length < 2) { results.hidden = true; return; }
                try {
                    const list = await api('GET', '/api/geocode?q=' + encodeURIComponent(q));
                    results.innerHTML = '';
                    list.forEach(p => results.appendChild(h('li', {
                        onclick: () => {
                            set.location = { name: p.name, lat: p.lat, lon: p.lon };
                            weather = null;
                            changed();
                            // Na het opslaan het nieuwe weer ophalen
                            setTimeout(loadWeather, 1500);
                            renderSettings(); renderAll();
                        }
                    }, p.name, ' ', h('small', {}, p.region))));
                    if (!list.length) results.appendChild(h('li', {}, 'Niets gevonden'));
                    results.hidden = false;
                } catch (e) { results.innerHTML = ''; results.appendChild(h('li', {}, e.message)); results.hidden = false; }
            }, 300);
        });

        // Logo
        const logoField = imageField(set, 'logo', { onChange: () => { renderSettings(); afterSettings(); } });
        const logoPrev = set.logo ? h('div', { class: 'logo-prev' },
            h('div', { style: 'background:#fff' }, h('img', { src: set.logo, alt: '' })),
            h('div', { style: 'background:#111' }, h('img', { src: set.logo, alt: '' })),
            h('div', { style: 'background:#c8102e' }, h('img', { src: set.logo, alt: '' }))) : null;

        // Wachtwoord
        const pwCur = h('input', { type: 'password', autocomplete: 'current-password' });
        const pwNew = h('input', { type: 'password', autocomplete: 'new-password' });
        const pwMsg = h('div', { class: 'hint' });
        const pwBtn = h('button', {
            type: 'button', class: 'btn', onclick: async () => {
                try {
                    await api('POST', '/api/password', { current: pwCur.value, password: pwNew.value });
                    pwCur.value = pwNew.value = '';
                    pwMsg.textContent = '✓ Wachtwoord gewijzigd. Andere ingelogde apparaten zijn uitgelogd.';
                } catch (e) { pwMsg.textContent = e.message; }
            }
        }, 'Wachtwoord wijzigen');

        body.append(
            section('Weer',
                field('Plaats', search), results, current),
            section('Logo',
                h('div', { class: 'hint' }, 'Wordt op elke slide getoond waar "Logo tonen" aan staat. Een PNG met transparante achtergrond werkt het mooist.'),
                logoField, logoPrev),
            section('Afspelen',
                field('Standaardduur nieuwe slides (seconden)', range(set, 'defaultDuration', 3, 120)),
                field('Overgang', seg(set, 'transition', [{ value: 'slide', label: 'Schuiven' }, { value: 'fade', label: 'Vervagen' }])),
                toggle(set, 'showClock', 'Klok en datum tonen')),
            section('Wachtwoord beheerpagina',
                h('div', { class: 'row2' }, field('Huidig wachtwoord', pwCur), field('Nieuw wachtwoord', pwNew)),
                h('div', {}, pwBtn), pwMsg)
        );
        // range/seg/toggle roepen refresh() aan; dat werkt het voorbeeld bij en slaat op
    }
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    boot().catch(e => { document.body.textContent = 'Kan de server niet bereiken: ' + e.message; });
})();
