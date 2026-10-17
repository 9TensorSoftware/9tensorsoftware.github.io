# 9tensor.com

The website of 9Tensor: open-source software and data.

It's one page of plain HTML and CSS. There's no build step and no JavaScript, and nothing loads from anywhere else.

```
index.html          the page
styles.css          its styles (light and dark follow the system)
404.html            what GitHub Pages serves for a missing page
favicon.svg/.ico    icons: a 3 × 3 grid of dots whose lit ones draw a 9
apple-touch-icon.png
og.png              the preview shown when the site is linked (1200 × 630)
CNAME               the custom domain, 9tensor.com
.nojekyll           tells GitHub Pages to serve the files as they are
```

## Preview it

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Add a project

The page has a section per kind of work, Software and Data, and the menu at the top links to
them. Each project is one `<li class="project">` in its section's list. Copy the Rétouch block and
change:

- the name, and its link to the live version;
- one line on what it is;
- the links: Open (the live version) first, then Source;
- `--tint` (and `--tint-dark` for dark mode) to the project's own color.

A section with nothing in it yet says Coming soon. When its first project arrives, drop the
`<span class="label__note">` and add a `<ul class="list">` under the label, as in Software.

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
