# 9tensor.com

The website of 9Tensor: open-source software and data.

It's plain HTML, CSS and a little JavaScript. There's no build step, and nothing loads from other
servers except the background map in Carte.

```
index.html              the landing page, always dark: a tile per tool with a live preview, one for all data
lien/ carte/            a page for Lien and for Carte (Rétouch has its own site)
lien/app/ carte/app/    the free apps: a network canvas and a map
data/                   the list of every dataset
data/<name>/            a page for each dataset, with its free sample next to it
styles.css              the site's styles: one dark palette for every page
app.css                 the frame shared by the two apps
site.js                 makes the menus close on an outside click or Escape
vendor/                 Leaflet, Cytoscape.js, JSZip and toGeoJSON (see vendor/README.md)
404.html                what GitHub Pages serves for a missing page
favicon.svg/.ico        icons: a disc cut on the diagonal, its halves slid apart
apple-touch-icon.png
og.png                  the preview shown when the site is linked (1200 × 630)
CNAME                   the custom domain, 9tensor.com
.nojekyll               tells GitHub Pages to serve the files as they are
```

## Preview it

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. Links start with `/`, so serve the site from its root rather than
opening the files directly.

## The menu

Every page has the same header, with Software and Data menus. Each menu is a `<details>`, so it
opens even without JavaScript. To add or rename an item, change the header in **every** page,
including `404.html` (search for `menu__panel`).

## Add a page

Copy the nearest page (`lien/` for software, `data/health-records/` for data) into a new folder,
then change its title, description, `canonical` and `og:url`, and its text. Add it to the menu on
every page and to `sitemap.xml`. A tool also gets a tile in `index.html`; a dataset goes on the
list in `data/index.html` instead, so the landing page stays the same size.

Every page offers something free:

- **Software** links to the app itself: Rétouch at retouch.9tensor.com, Lien and Carte in
  `lien/app/` and `carte/app/`.
- **Data** shows a free sample on the page and lets people download it. The synthetic document
  samples sit in `data/<name>/samples/`: each document has a PNG, a scanned-looking JPG, a JSON
  file of labels and two thumbnails, plus one zip of everything. The media-outlet sample is
  `data/media-outlets/media-outlets-sample.csv` (and `.json`, which the page's table reads).

## Deploy

GitHub Pages serves the site from this repository. The repository has to be named
`9tensorsoftware.github.io` under the `9tensorsoftware` account. That name makes it the account's
main site, and other repositories' Pages (like Rétouch at retouch.9tensor.com) sit alongside it.

1. **Create the repository and push.** Create the public repository
   `9tensorsoftware/9tensorsoftware.github.io` on GitHub, then:

   ```sh
   git remote add origin https://github.com/9tensorsoftware/9tensorsoftware.github.io.git
   git push -u origin main
   ```

2. **Turn on Pages.** In the repository, go to **Settings → Pages → Build and deployment**. Set the
   source to **Deploy from a branch**, with branch `main` and folder `/ (root)`.

3. **Verify the domain** (recommended, so no other account can claim it). Go to your account's
   **Settings → Pages → Add a domain** and enter `9tensor.com`. Add the TXT record GitHub shows you
   (`_github-pages-challenge-9tensorsoftware`) at Squarespace, as in step 4, then click **Verify**.

4. **Point the DNS at GitHub.** The domain's DNS is at Squarespace, under
   **Domains → 9tensor.com → DNS**.

   - Delete the **Squarespace Defaults** records (the four A records for `@` and the `www` CNAME to
     `ext-sq.squarespace.com`). Squarespace's "Coming soon" page is served from those.
   - Add these records:

     | Type  | Host      | Value                                                                       |
     |-------|-----------|-----------------------------------------------------------------------------|
     | A     | `@`       | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (one record each) |
     | AAAA  | `@`       | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` (one each) |
     | CNAME | `www`     | `9tensorsoftware.github.io`                                                 |
     | CNAME | `retouch` | `9tensorsoftware.github.io`, for Rétouch once its repository is here        |

5. **Finish in Pages settings.** Back in **Settings → Pages**, the custom domain reads `9tensor.com`
   (the `CNAME` file sets it). Once GitHub's DNS check passes and the certificate is issued
   (minutes to an hour), tick **Enforce HTTPS**.

Every push to `main` then publishes within a minute or two.

## License

MIT, © 2026 9Tensor LLC.
