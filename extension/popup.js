// Runs inside the DispatchTrack order page (via chrome.scripting.executeScript), not the
// popup - must be fully self-contained (no references to outer-scope variables).
//
// Best-effort v1 built from screenshots of the Order Details page, not the live DOM. It works
// by matching visible LABEL TEXT ("Order Number", "Email", "Phone 1", ...) and reading the
// next element's text as the value - resilient to class-name changes, but may need the LABELS
// map below tuned once run against the real page. Use the "Debug: raw scraped fields" panel in
// the popup to see exactly what was found for each label.
function scrapeDispatchTrackOrder() {
    function textOf(el) {
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function isLeaf(el) {
        return el && el.children.length === 0;
    }

    // Finds a leaf element whose own text matches `label` (case-insensitive), then returns the
    // text of the next sibling (or the parent's next sibling, as a fallback for nested layouts).
    // Some labels appear more than once on the page with different meanings (e.g. "Scheduled" is
    // both the status badge value and a Date & Time section label) - if a match's value looks
    // implausible (empty, or far longer than any real field value), keep scanning for a better
    // occurrence instead of stopping at the first hit.
    function valueForLabel(label, maxLen) {
        maxLen = maxLen || 120;
        const target = label.trim().toLowerCase();
        const all = document.querySelectorAll('body *');
        for (const el of all) {
            if (!isLeaf(el)) continue;
            const own = textOf(el).toLowerCase().replace(/:$/, '');
            if (own !== target) continue;
            let val = el.nextElementSibling ? textOf(el.nextElementSibling) : '';
            if (!val && el.parentElement && el.parentElement.nextElementSibling) {
                val = textOf(el.parentElement.nextElementSibling);
            }
            if (val && val.length <= maxLen) return val;
        }
        return '';
    }

    // Finds the Items table by locating a <table> whose header row mentions "description",
    // then maps each row's cells by header name instead of a hardcoded column index.
    function scrapeItems() {
        const items = [];
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
            const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
            if (!headerRow) continue;
            const headers = Array.from(headerRow.querySelectorAll('th,td')).map(th => textOf(th).toLowerCase());
            if (!headers.some(h => h.includes('description'))) continue;

            const bodyRows = table.querySelectorAll('tbody tr');
            bodyRows.forEach(tr => {
                const cells = Array.from(tr.querySelectorAll('td')).map(td => textOf(td));
                if (!cells.length) return;
                const row = {};
                headers.forEach((h, i) => {
                    const val = cells[i] || '';
                    if (h.includes('description')) row.description = val;
                    else if (h.includes('sku')) row.sku_number = val;
                    else if (h.includes('location')) row.location_code = val;
                    else if (h === 'qty') row.quantity = val;
                    else if (h === 'amt') row.price = val;
                    else if (h === 'vol') row.cube = val;
                    else if (h === 'len') row.length = val;
                    else if (h.includes('service time')) row.service_time = val;
                    else if (h.includes('delivered')) row.delivered = val;
                });
                if (row.description) items.push(row);
            });
            break; // use the first table that looks like the items table
        }
        return items;
    }

    // Finds the "Notes" heading, then reads the surrounding panel's text minus the heading
    // and the "Add Note" button label. Tries to split off a trailing "by AUTHOR On DATE ..."
    // signature into separate author/date fields, but falls back to leaving the full text in
    // `body` untouched if the pattern doesn't confidently match - on this page the author link
    // and the following "On ..." text are often glued together with no space in .textContent,
    // so a wrong match risks silently truncating real note content, which would be worse than
    // just leaving body as one whole blob.
    function scrapeNotes() {
        const all = document.querySelectorAll('body *');
        let heading = null;
        for (const el of all) {
            if (isLeaf(el) && textOf(el).toLowerCase() === 'notes') { heading = el; break; }
        }
        if (!heading) return [];
        let container = heading.parentElement;
        for (let i = 0; i < 4 && container; i++) {
            if (textOf(container).length > textOf(heading).length + 15) break;
            container = container.parentElement;
        }
        if (!container) return [];
        const full = textOf(container)
            .replace(/^Notes\s*/i, '')
            .replace(/Add Note\s*/i, '')
            .trim();
        if (!full) return [];

        // Only trust the split if the "author" token looks like a single word (no spaces) -
        // real author handles/usernames on this page look like "eldoradofurniture" or "YAHER".
        const m = full.match(/^(.*)\bby\s*([A-Za-z0-9_.-]+)\s*On\s+(.+)$/);
        if (m && m[1].trim()) {
            return [{ body: m[1].trim(), author: m[2].trim(), date: m[3].trim() }];
        }
        return [{ body: full, author: '', date: '' }];
    }

    function splitWindow(text) {
        if (!text) return { start: '', end: '' };
        const parts = text.split(' - ');
        return { start: (parts[0] || '').trim(), end: (parts[1] || '').trim() };
    }

    // "JORGE DONADO-1359224" -> first="JORGE" last="DONADO-1359224". This is a guess - the page
    // only shows one combined display name, so there's no reliable way to know the true
    // first/last split; tune this if the real customer record page exposes them separately.
    function splitName(full) {
        if (!full) return { first: '', last: '' };
        const parts = full.trim().split(/\s+/);
        if (parts.length === 1) return { first: parts[0], last: '' };
        return { first: parts[0], last: parts.slice(1).join(' ') };
    }

    const raw = {
        order_number: valueForLabel('Order Number'),
        account: valueForLabel('Account'),
        service_type: valueForLabel('Service type'),
        service_unit: valueForLabel('Service Unit'),
        service_time: valueForLabel('Service Time (min)'),
        driver: valueForLabel('Driver'),
        status: valueForLabel('Status'),
        name: valueForLabel('Name'),
        email: valueForLabel('Email'),
        phone1: valueForLabel('Phone 1'),
        phone2: valueForLabel('Phone 2'),
        phone3: valueForLabel('Phone 3'),
        address1: valueForLabel('Address 1'),
        address2: valueForLabel('Address 2'),
        city: valueForLabel('City'),
        state: valueForLabel('State/Region'),
        zip: valueForLabel('Zip/Postal Code'),
        request: valueForLabel('Request'),
        window: valueForLabel('Window'),
        scheduled: valueForLabel('Scheduled'),
        delivery_charge: valueForLabel('Delivery Charge'),
        salesperson: valueForLabel('Salesperson'),
        store_code: valueForLabel('Store Code'),
        route_label: valueForLabel('Route Label'),
        transfer_document: valueForLabel('Transfer Document'),
        contact_free: valueForLabel('Contact-free')
    };

    const win = splitWindow(raw.window);
    const sched = splitWindow(raw.scheduled);
    const items = scrapeItems();
    const notes = scrapeNotes();

    return { raw, win, sched, items, notes };
}

// --- XML serialization (self-contained; no external library, per Manifest V3 CSP) ---
// Convention: a key starting with "_" becomes an XML attribute on the current element; the
// special key "__text" supplies the element's own text content when it also needs attributes
// (e.g. a <note author="..." created_at="...">the text</note>).
function escapeXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeXmlAttr(str) {
    return escapeXml(str).replace(/"/g, '&quot;');
}

function toXmlNode(node, tag) {
    if (Array.isArray(node)) {
        return node.map(item => toXmlNode(item, tag)).join('');
    }
    if (node && typeof node === 'object') {
        let attrs = '';
        let children = '';
        const hasText = Object.prototype.hasOwnProperty.call(node, '__text');
        for (const k in node) {
            if (k === '__text') continue;
            if (k.charAt(0) === '_') { attrs += ` ${k.slice(1)}="${escapeXmlAttr(node[k])}"`; continue; }
            children += toXmlNode(node[k], k);
        }
        if (hasText) return `<${tag}${attrs}>${escapeXml(node.__text)}</${tag}>`;
        if (!children && !attrs) return `<${tag}/>`;
        return `<${tag}${attrs}>${children}</${tag}>`;
    }
    if (node === null || node === undefined || node === '') return `<${tag}/>`;
    return `<${tag}>${escapeXml(node)}</${tag}>`;
}

function prettyXml(xml) {
    return xml.replace(/(>)(<)(\/*)/g, '$1\n$2$3');
}

// --- Build the two output shapes from the scraped raw/items/notes data ---

// JSON: matches the official add-order API schema (order_number, account_name, ...), wrapped
// in service_orders[] so it can be pasted directly into Payload Studio as a source payload.
function buildJsonPayload(scraped) {
    const { raw, win, sched, items, notes } = scraped;
    const order = {
        order_number: raw.order_number,
        account_name: raw.account,
        service_type: raw.service_type,
        status: raw.status,
        delivery_date: raw.request,
        delivery_time_window_start: win.start,
        delivery_time_window_end: win.end,
        customer: {
            name: raw.name, email: raw.email, phone1: raw.phone1, phone2: raw.phone2, phone3: raw.phone3,
            address1: raw.address1, address2: raw.address2, city: raw.city, state: raw.state, zip: raw.zip
        },
        items: items.map(i => ({
            description: i.description, sku_number: i.sku_number, location_code: i.location_code,
            quantity: i.quantity, price: i.price, cube: i.cube, service_time: i.service_time
        })),
        notes: notes.map(n => ({ body: n.body })),
        additional_fields: {
            delivery_charge: raw.delivery_charge, salesperson: raw.salesperson, store_code: raw.store_code,
            route_label: raw.route_label, transfer_document: raw.transfer_document
        },
        custom_fields: { contact_free: raw.contact_free },
        extra: { service_unit: raw.service_unit, driver: raw.driver, schedule_start_time: sched.start, schedule_end_time: sched.end }
    };
    return { service_orders: [order] };
}

// XML: matches the <service_orders><service_order> import format (number/account, split
// first_name/last_name, item_id instead of sku_number, notes as <note author= created_at=>text).
function buildXmlPayload(scraped) {
    const { raw, win, sched, items, notes } = scraped;
    const splitFn = (full) => {
        if (!full) return { first: '', last: '' };
        const parts = full.trim().split(/\s+/);
        return parts.length === 1 ? { first: parts[0], last: '' } : { first: parts[0], last: parts.slice(1).join(' ') };
    };
    const name = splitFn(raw.name);

    const serviceOrder = {
        number: raw.order_number,
        account: raw.account,
        delivery_date: raw.request,
        service_type: raw.service_type,
        service_unit: raw.service_unit,
        service_time: raw.service_time,
        status: raw.status,
        delivery_time_window_start: win.start,
        delivery_time_window_end: win.end,
        customer: {
            first_name: name.first,
            last_name: name.last,
            email: raw.email,
            phone1: raw.phone1,
            phone2: raw.phone2,
            phone3: raw.phone3,
            address1: raw.address1,
            address2: raw.address2,
            city: raw.city,
            state: raw.state,
            zip: raw.zip
        },
        additional_fields: {
            delivery_charge: raw.delivery_charge,
            salesperson: raw.salesperson,
            store_code: raw.store_code,
            route_label: raw.route_label,
            transfer_document: raw.transfer_document
        },
        notes: {
            _count: String(notes.length),
            note: notes.map(n => ({ _created_at: n.date, _author: n.author, __text: n.body }))
        },
        items: {
            item: items.map((it, i) => ({
                sale_sequence: String(i + 1),
                item_id: it.sku_number,
                description: it.description,
                line_item_notes: '',
                quantity: it.quantity,
                cube: it.cube,
                weight: '',
                price: it.price,
                setup_time: it.service_time,
                location: it.location_code,
                countable: 'true'
            }))
        },
        extra: {
            driver: raw.driver,
            schedule_start_time: sched.start,
            schedule_end_time: sched.end
        }
    };

    return prettyXml(toXmlNode({ service_order: serviceOrder }, 'service_orders'));
}

// --- Popup wiring ---
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const debugEl = document.getElementById('debugOut');

function setStatus(msg) { statusEl.textContent = msg || ''; }

document.getElementById('generateBtn').addEventListener('click', async () => {
    setStatus('');
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !/dispatchtrack\.com/i.test(tab.url)) {
            setStatus('Open a DispatchTrack order page first.');
            return;
        }

        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapeDispatchTrackOrder
        });

        debugEl.textContent = JSON.stringify(result.raw, null, 2);

        const format = document.getElementById('format').value;
        outputEl.value = format === 'xml' ? buildXmlPayload(result) : JSON.stringify(buildJsonPayload(result), null, 2);

        if (!result.raw.order_number && !result.raw.name) {
            setStatus('Scraped mostly empty - open Debug below and tune the LABELS in popup.js to match this page.');
        }
    } catch (err) {
        setStatus('Error: ' + err.message);
    }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
    if (!outputEl.value) return;
    await navigator.clipboard.writeText(outputEl.value);
    setStatus('Copied to clipboard.');
});

document.getElementById('downloadBtn').addEventListener('click', () => {
    if (!outputEl.value) return;
    const format = document.getElementById('format').value;
    const mime = format === 'xml' ? 'application/xml' : 'application/json';
    const blob = new Blob([outputEl.value], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DTOrderPayload_${Date.now()}.${format}`;
    a.click();
});
