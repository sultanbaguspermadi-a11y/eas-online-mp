// Cover screen: the title is spelled out in game tiles (standard Scrabble letter values), then Play starts the setup flow.
const TITLE = ['ARABIC', 'SCRABBLE'];
const VALUE = {A: 1, R: 1, B: 3, I: 1, C: 3, S: 1, L: 1, E: 1};

function buildTitle(el) {
  let i = 0;
  el.innerHTML = TITLE.map(w => `<span class="cw" aria-hidden="true">${[...w].map(ch =>
    `<span class="cl" data-v="${VALUE[ch] ?? 1}" style="--i:${i++}">${ch}</span>`).join('')}</span>`).join('');
}

export function hideCover() {
  const cover = document.getElementById('cover');
  cover.classList.add('out'); document.querySelector('.app').inert = false; document.body.classList.remove('coverOn');
  setTimeout(() => { cover.hidden = true; }, 420);
}

export function showCover(onPlay, onOnline) {
  const cover = document.getElementById('cover'), app = document.querySelector('.app'), play = document.getElementById('coverPlay');
  buildTitle(document.getElementById('coverTitle'));
  document.body.classList.add('coverOn'); app.inert = true; cover.hidden = false;

  play.addEventListener('click', () => {
    play.disabled = true; if (online) online.disabled = true; cover.classList.add('out'); app.inert = false; document.body.classList.remove('coverOn');
    onPlay();
    setTimeout(() => { cover.hidden = true; }, 420);
  }, {once: true});
  const online = document.getElementById('coverOnline');
  if (online) online.addEventListener('click', () => { app.inert = true; onOnline && onOnline(); });
  play.focus({preventScroll: true});
}
