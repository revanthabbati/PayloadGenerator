# DispatchTrack Payload Extractor

A Chrome extension that scrapes the currently open DispatchTrack order page and generates a
JSON or XML test payload from it.

**JSON** output matches the official add-order API schema (`order_number`, `account_name`,
`customer{name,...}`, `items[]`, `notes[{body}]`) and is wrapped in `service_orders: [...]` so
it can be pasted directly into Payload Studio as a source payload.

**XML** output matches the `<service_orders><service_order>` import format instead - different
tag names than the JSON schema (`number`/`account` instead of `order_number`/`account_name`,
split `first_name`/`last_name`, `item_id` instead of `sku_number`, `location` instead of
`location_code`), and notes are rendered as `<note author="..." created_at="...">text</note>`
(attributes, not a `<body>` sub-element), per the real XML import format.

Because the customer name only appears on the page as one combined display string (e.g.
"JORGE DONADO-1359224"), `first_name`/`last_name` is a naive split on the first space - tune
`splitName()` in `popup.js` if the real page exposes them separately.

The note's `author`/`created_at` attributes are extracted from a trailing "by AUTHOR On DATE"
pattern in the note text, but only when there's a clear match - on this page the author link
and following text are sometimes glued together with no space in `.textContent` (e.g.
`"...YAHERby eldoradofurnitureOn Fri Jul 24, 2026..."`), so a low-confidence match is left as
empty attributes with the full text kept in the note body, rather than risk silently truncating
real note content.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Open a DispatchTrack order detail page, then click the extension icon.
5. Pick JSON or XML and click **Generate Payload**.

## How it works

`popup.js` reads visible label text on the page ("Order Number", "Email", "Phone 1", ...) and
takes the next element's text as the value - it does not depend on CSS class names, so it
should survive minor DispatchTrack UI changes. The items table is found by looking for a
`<table>` whose header row mentions "Description", then mapping columns by header name rather
than a fixed position.

## This is a v1 built from screenshots, not the live DOM

It has **not** been tested against the real DispatchTrack page - only against a hand-built mock
page matching the screenshots. If a field comes back empty:

1. Open the extension popup, expand **Debug: raw scraped fields** - it shows exactly what was
   found (or not found) for every label.
2. Open DevTools on the DispatchTrack page and check the actual visible label text for that
   field - it may be worded slightly differently than expected.
3. Adjust the corresponding label string in the `valueForLabel(...)` calls inside
   `scrapeDispatchTrackOrder()` in `popup.js` to match.

Common things that can differ from the screenshots this was built against:
- Label wording/punctuation (e.g. "Zip/Postal Code" vs "Zip Code").
- Whether a label and its value are true DOM siblings, or nested one level differently -
  `valueForLabel` tries the element's own next sibling, then falls back to the parent's next
  sibling, but deeper nesting may need another fallback added.
- The Items table may have extra/missing columns, or use `<th>` instead of `<td>` in body rows.
