import re, sys, itertools, math
import os
css = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'css', 'themes.css'), encoding='utf8').read()
blocks = re.findall(r'(\[data-theme="(\w+)"\]|:root,\s*\n\[data-theme="classic"\])\s*\{(.*?)\n\}', css, re.S)
themes = {}
for sel, name, body in blocks:
    key = name or 'classic'
    themes[key] = dict(re.findall(r'(--[\w-]+):\s*(#[0-9a-fA-F]+)', body))
def rgba(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c*2 for c in h)
    if len(h) == 4: h = ''.join(c*2 for c in h)
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4)); a = int(h[6:8], 16)/255 if len(h) == 8 else 1
    return r, g, b, a
def over(fg, bg):
    r, g, b, a = fg; return tuple(a*x + (1-a)*y for x, y in zip((r, g, b), bg[:3]))
def lum(c):
    f = lambda v: (v/255)/12.92 if v/255 <= .03928 else (((v/255)+.055)/1.055)**2.4
    return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2])
def cr(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb); return (hi+.05)/(lo+.05)
def lab(c):
    f = lambda v: ((v/255)/12.92 if v/255 <= .04045 else (((v/255)+.055)/1.055)**2.4)
    r, g, b = f(c[0]), f(c[1]), f(c[2])
    x = (.4124*r+.3576*g+.1805*b)/.95047; y = .2126*r+.7152*g+.0722*b; z = (.0193*r+.1192*g+.9505*b)/1.089
    t = lambda v: v**(1/3) if v > .008856 else 7.787*v+16/116
    return 116*t(y)-16, 500*(t(x)-t(y)), 200*(t(y)-t(z))
def de(a, b): return math.dist(lab(a), lab(b))
bad = 0
for name, t in themes.items():
    def col(k, backdrop=None):
        c = rgba(t[k]); return over(c, backdrop) if backdrop and c[3] < 1 else c[:3]
    pages = [col('--bg-page-1'), col('--bg-page-2')]
    panels = [col('--panel-bg', p) for p in pages]
    chips = [over(rgba(t['--chip-bg']), p) if rgba(t['--chip-bg'])[3] < 1 else rgba(t['--chip-bg'])[:3] for p in panels]
    pairs = []  # (label, fg, [bgs], min)
    pairs += [('text on page', col('--text-main'), pages, 4.5), ('text on panel', col('--text-main'), panels, 4.5),
              ('text on dialog', col('--text-main'), [col('--dialog-bg')], 4.5), ('text on chip', col('--text-main'), chips, 4.5),
              ('accent-text on panel', col('--accent-text'), panels, 4.5), ('accent-text on dialog', col('--accent-text'), [col('--dialog-bg')], 4.5),
              ('btn', col('--btn-text'), [col('--btn-1'), col('--btn-2')], 4.5), ('btn main', col('--btn-main-text'), [col('--btn-main-1'), col('--btn-main-2')], 4.5),
              ('btn danger', col('--btn-danger-text'), [col('--btn-danger-1'), col('--btn-danger-2')], 4.5)]
    for k in ('dl', 'tl', 'dw', 'tw'): pairs.append((f'premium {k}', col('--premium-text'), [col(f'--premium-{k}')], 4.5))
    pairs.append(('premium star', col('--premium-star-text'), [col('--premium-star')], 4.5))
    tb = [col('--tile-1'), col('--tile-2')]
    pairs += [('tile letter', col('--tile-text'), tb, 4.5), ('tile blank letter', col('--tile-blank-text'), tb, 4.5),
              ('tile current', col('--tile-text'), [col('--tile-cur-1'), col('--tile-cur-2')], 4.5),
              ('tile swap', col('--tile-swap-text'), [col('--tile-swap-1'), col('--tile-swap-2')], 4.5),
              ('toast ok', col('--ok-text'), [over(rgba(t['--ok-bg']), p) for p in panels], 4.5),
              ('toast bad', col('--bad-text'), [over(rgba(t['--bad-bg']), p) for p in panels], 4.5)]
    for k in ('turn-dot', 'time-low', 'time-crit', 'verdict-ok', 'verdict-bad'): pairs.append((k + ' on panel', col('--' + k), panels, 3.0 if k == 'turn-dot' else 4.5))
    # non-text: state rings must be visible against the tile / dialog
    pairs += [('cur ring vs tile', col('--tile-cur-ring'), [col('--tile-cur-1')], 2.0), ('swap ring vs panel/rack', col('--tile-swap-ring'), [col('--rack-1'), col('--rack-2')], 1.5),
              ('focus vs dialog', col('--focus'), [col('--dialog-bg')], 3.0), ('focus vs page', col('--focus'), pages, 3.0)]
    for lab_, fg, bgs, mn in pairs:
        worst = min(cr(fg, b) for b in bgs)
        if worst < mn: bad += 1; print(f'  FAIL [{name}] {lab_}: {worst:.2f} < {mn}')
    # hierarchy: premium squares + empty square pairwise distinct (CIE76 dE)
    sq = {k: col('--' + k) for k in ('sq-empty', 'premium-dl', 'premium-tl', 'premium-dw', 'premium-tw', 'premium-star')}
    for (a, ca), (b, cb) in itertools.combinations(sq.items(), 2):
        d = de(ca, cb)
        if d < 18: bad += 1; print(f'  FAIL [{name}] squares {a} vs {b}: dE {d:.1f} < 18')
    # tile must stand out from an empty square and from the board frame
    for k in ('--sq-empty',):
        d = de(col('--tile-1'), col(k))
        if d < 15: bad += 1; print(f'  FAIL [{name}] tile vs empty square dE {d:.1f}')
    print(f'[{name}] checked')
print('FAILURES:', bad)
