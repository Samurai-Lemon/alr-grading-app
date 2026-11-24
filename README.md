# ALR Grading

The Grading Terminal from [alrinitiative.com/label-creator](https://alrinitiative.com/label-creator) as a desktop app for Mac and Windows. Make ALR grading labels at exact slab size (2.65 × 0.78 in) and save them as Cricut-ready SVG files straight into a folder you choose.

## Updating the label design

The editor, styles and label script are copied from the website so both stay identical:

```sh
cd ../alr-archive && npx quartz build     # build the site
cd ../alr-grading-app && npm run sync     # copy the Grading Terminal into src/
```

App-only parts: `src/shell.html` (window layout and Save To bar), `src/app.js` (saving), `src-tauri/` (native app).

## Building

```sh
npm install
npm run dev      # run the app locally
npm run build    # make ALR Grading.app / .dmg (or the Windows installer on Windows)
```

Releases: push a tag like `v0.1.0` and GitHub Actions builds the Mac (Apple Silicon and Intel) and Windows downloads and publishes them as a GitHub Release.

## First launch (unsigned builds)

- **Mac:** open the app once, click **Done** on the warning, then System Settings › Privacy & Security › **Open Anyway**. Builds are ad-hoc signed (`signingIdentity: "-"`); without that, macOS reports a downloaded app as "damaged".
- **Windows:** More info › Run anyway.
