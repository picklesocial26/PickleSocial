Project: Pickle Social (structured)

What I changed
- Extracted inline CSS into `css/styles.css`.
- Extracted inline JS into `js/app.js`.
- Added a small Node/Express backend in `server.js` for static hosting and receipt upload support.
- Fixed the hero image tag in `index.html`.

How to use
- Run `npm install` in the project root.
- Start the server with `npm start` for local testing.
- Open `http://localhost:3000` in the browser.
- The booking flow now uses receipt upload and verification instead of Payrex.

### Deploying to Vercel
- The frontend is static and can be deployed directly.
- Remove `server.js` from the deployment target if you only want the static site.
- The old `api/create-payment.js` endpoint is kept as a stub and is no longer used by the booking flow.

### Important
- Payments are verified by uploading the GCash receipt image.
- The receipt verification modal extracts the booking reference, date/time, and total amount.
- When the receipt matches the booking total and reference, the booking is marked paid.

Logo
- A placeholder base64-encoded logo was added as `logo.jpeg.b64`.
- To create the actual `logo.jpeg` file from the base64, run the provided Node script:

```powershell
node tools\decode-logo.js
```

This writes `logo.jpeg` in the project root. Replace it with your real logo if you have one.

Notes
- I left small inline `style` attributes in place (e.g., status indicators) to minimize markup changes.
- If you want the JS module-scoped or to bundle with a toolchain, I can convert `js/app.js` to ES module syntax.
