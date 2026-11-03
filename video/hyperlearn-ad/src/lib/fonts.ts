import { continueRender, delayRender, staticFile } from 'remotion';

// Local OFL fonts (public/fonts, from github.com/google/fonts) so renders never depend on the network.
let loaded: Promise<void> | null = null;
export function loadFonts() {
  if (loaded) return loaded;
  const handle = delayRender('fonts');
  const faces = [
    new FontFace('Figtree', `url(${staticFile('fonts/Figtree.ttf')})`, { weight: '300 900' }),
    new FontFace('Source Serif 4', `url(${staticFile('fonts/SourceSerif4.ttf')})`, { weight: '200 900' }),
  ];
  loaded = Promise.all(faces.map((f) => f.load())).then((fs) => {
    fs.forEach((f) => document.fonts.add(f));
    continueRender(handle);
  });
  return loaded;
}
