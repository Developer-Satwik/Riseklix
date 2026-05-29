# Riseklix Website — Production Build

A static, deployment-ready site for Riseklix Media / Riseklix Agency.

## Deploy

Upload the full folder to Netlify, Vercel, Cloudflare Pages, or any static host. `netlify.toml`, `robots.txt`, `sitemap.xml`, `404.html`, legal pages, and responsive CSS are included.

## Calendly

The Contact page uses the inline Calendly widget:

`https://calendly.com/riseklix/30min?hide_event_type_details=1&hide_gdpr_banner=1`

## Reel Vault

The Work page uses `portfolio-videos.js`.

Current setup:
- The player first tries each Google Drive file as a native HTML video source.
- When the native stream works, the deck moves to the next reel only on the real `ended` event.
- If Google Drive blocks direct streaming, the site falls back to a Drive preview iframe and stays manual so it never cuts early.

Best production setup:
1. Compress your strongest reels to web-friendly MP4s.
2. Put them in `assets/reels/`.
3. Replace each Drive item with:

```js
{
  title: 'Your reel title',
  label: 'Short-form reel',
  src: 'assets/reels/your-reel.mp4',
  poster: 'assets/reels/your-poster.jpg',
  note: 'Short description.'
}
```

Local MP4s give the cleanest autoplay, progress bar, end-detection, and loop experience.

## Final checks before launch

- Point the domain to the static host.
- Confirm all Google Drive reel files are set to “Anyone with the link can view.”
- Replace placeholder proof metrics only with numbers you can back up.
- Test the Contact page once after deployment to confirm Calendly loads under the production domain.
