// tr-starred-signals.jsx — TradeRadar "star-to-curate" helper.
//
// Lets a user star any tile on the Drivers or Signals screens. Starred tiles
// get pinned to a compact "My Radar" strip at the top of Drivers for
// one-glance tracking.
//
// Exposes:
//   window.TRStars.isStarred(tileId)                 -> bool
//   window.TRStars.toggle(tileId, label, meta?)      -> bool (now starred?)
//   window.TRStars.getAll()                          -> array
//   window.TRStars.StarButton({ tileId, label, meta, T, size })
//   window.TRStars.MyRadar({ tiles, T })
//
// Storage:
//   localStorage['tr_stars_v1'] = JSON.stringify([
//     { tileId, label, meta, starredAt }
//   ])
//
// Event:
//   window dispatches 'tr:stars-changed' whenever the set mutates.

(function () {
  const STORAGE_KEY = 'tr_stars_v1';
  const EVENT_NAME = 'tr:stars-changed';
  const MAX_STARS = 10;

  // --------------------------------------------------------------------
  // Default theme (used when the caller doesn't pass one)
  // --------------------------------------------------------------------
  const DEFAULT_T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff',
    textMid: 'rgba(180,188,200,0.75)',
    textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  const TRANSITION = '160ms cubic-bezier(0.2,0.7,0.2,1)';

  // --------------------------------------------------------------------
  // Storage helpers
  // --------------------------------------------------------------------
  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e) => e && typeof e === 'object' && typeof e.tileId === 'string'
      );
    } catch (_) {
      return [];
    }
  }

  function writeAll(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (_) {
      /* quota / private mode — ignore */
    }
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME));
    } catch (_) {}
  }

  function isStarred(tileId) {
    if (!tileId) return false;
    return readAll().some((e) => e.tileId === tileId);
  }

  function remove(tileId) {
    if (!tileId) return false;
    const list = readAll();
    const next = list.filter((e) => e.tileId !== tileId);
    if (next.length === list.length) return false;
    writeAll(next);
    return true;
  }

  function toggle(tileId, label, meta) {
    if (!tileId) return false;
    const list = readAll();
    const idx = list.findIndex((e) => e.tileId === tileId);
    if (idx >= 0) {
      list.splice(idx, 1);
      writeAll(list);
      return false; // now unstarred
    }
    // FIFO eviction with soft warning when at cap
    if (list.length >= MAX_STARS) {
      const evicted = list.shift();
      try {
        console.warn(
          '[TRStars] Max ' + MAX_STARS + ' starred tiles reached. Evicted:',
          evicted && evicted.tileId
        );
      } catch (_) {}
    }
    list.push({
      tileId: tileId,
      label: label || tileId,
      meta: meta || null,
      starredAt: Date.now(),
    });
    writeAll(list);
    return true; // now starred
  }

  function getAll() {
    return readAll();
  }

  // --------------------------------------------------------------------
  // Keyframes injected once (for the star "haptic" pop)
  // --------------------------------------------------------------------
  function ensureKeyframes() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('tr-stars-kf')) return;
    const style = document.createElement('style');
    style.id = 'tr-stars-kf';
    style.textContent =
      '@keyframes tr-star-pop { 0% { transform: scale(1); } ' +
      '50% { transform: scale(1.3); } ' +
      '100% { transform: scale(1); } }';
    try {
      document.head.appendChild(style);
    } catch (_) {}
  }

  // --------------------------------------------------------------------
  // <StarButton />
  // --------------------------------------------------------------------
  function StarButton(props) {
    const tileId = props.tileId;
    const label = props.label;
    const meta = props.meta;
    const T = props.T || DEFAULT_T;
    const size = typeof props.size === 'number' ? props.size : 12;

    const [starred, setStarred] = React.useState(() => isStarred(tileId));
    const [popKey, setPopKey] = React.useState(0);

    React.useEffect(() => {
      ensureKeyframes();
      const onChange = () => setStarred(isStarred(tileId));
      window.addEventListener(EVENT_NAME, onChange);
      return () => window.removeEventListener(EVENT_NAME, onChange);
    }, [tileId]);

    const onClick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      if (e && e.preventDefault) e.preventDefault();
      const nowStarred = toggle(tileId, label, meta);
      setStarred(nowStarred);
      if (nowStarred) setPopKey((k) => k + 1);
    };

    return React.createElement(
      'button',
      {
        type: 'button',
        onClick: onClick,
        'aria-label': starred ? 'Unstar ' + (label || tileId) : 'Star ' + (label || tileId),
        title: starred ? 'Unpin from My Radar' : 'Pin to My Radar',
        style: {
          background: 'transparent',
          border: 'none',
          padding: 2,
          margin: 0,
          cursor: 'pointer',
          fontSize: size,
          lineHeight: 1,
          color: starred ? T.signal : T.textDim,
          transition: 'color ' + TRANSITION + ', transform ' + TRANSITION,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: popKey > 0 ? 'tr-star-pop 200ms ease-out' : 'none',
        },
        key: 'star-' + tileId + '-' + popKey,
      },
      starred ? '\u2605' : '\u2606'
    );
  }

  // --------------------------------------------------------------------
  // <MyRadar />
  // --------------------------------------------------------------------
  function signalGlyph(signal) {
    if (signal === 'bull' || signal === 'up' || signal === 'long') return '\u2191';
    if (signal === 'bear' || signal === 'down' || signal === 'short') return '\u2193';
    return '\u2192';
  }

  function signalColor(signal, T) {
    if (signal === 'bull' || signal === 'up' || signal === 'long') return T.bull;
    if (signal === 'bear' || signal === 'down' || signal === 'short') return T.bear;
    return T.textMid;
  }

  function MyRadar(props) {
    const tiles = Array.isArray(props.tiles) ? props.tiles : [];
    const T = props.T || DEFAULT_T;

    const [stars, setStars] = React.useState(() => readAll());
    const [hoverId, setHoverId] = React.useState(null);

    React.useEffect(() => {
      const onChange = () => setStars(readAll());
      window.addEventListener(EVENT_NAME, onChange);
      return () => window.removeEventListener(EVENT_NAME, onChange);
    }, []);

    // Map stars to their live tile data (fallback to stored label/meta)
    const starredTiles = stars
      .map((s) => {
        const live = tiles.find((t) => t && t.id === s.tileId);
        if (live) return live;
        return {
          id: s.tileId,
          label: s.label || s.tileId,
          value: (s.meta && s.meta.value) || '',
          signal: (s.meta && s.meta.signal) || 'flat',
        };
      })
      .filter(Boolean);

    const stripStyle = {
      background: 'rgba(201,162,39,0.06)',
      border: '0.5px solid rgba(201,162,39,0.28)',
      padding: '10px 14px',
      borderRadius: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      fontFamily: T.mono,
      transition: 'all ' + TRANSITION,
    };

    const headerPill = React.createElement(
      'div',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 8px',
          borderRadius: 999,
          background: 'rgba(201,162,39,0.12)',
          color: T.signal,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        },
      },
      '\u2B50 MY RADAR \u00B7 ' + starredTiles.length + ' signal' +
        (starredTiles.length === 1 ? '' : 's')
    );

    // Empty state
    if (starredTiles.length === 0) {
      return React.createElement(
        'div',
        {
          style: Object.assign({}, stripStyle, {
            border: '0.5px dashed rgba(201,162,39,0.28)',
            justifyContent: 'center',
            textAlign: 'center',
          }),
        },
        React.createElement(
          'span',
          {
            style: {
              fontSize: 11,
              color: T.textDim,
              fontFamily: T.mono,
              letterSpacing: 0.3,
            },
          },
          'Click \u2606 on any tile to pin it here'
        )
      );
    }

    const chips = starredTiles.map((t) => {
      const hovered = hoverId === t.id;
      return React.createElement(
        'div',
        {
          key: 'chip-' + t.id,
          onMouseEnter: () => setHoverId(t.id),
          onMouseLeave: () => setHoverId(null),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 6,
            background: hovered ? 'rgba(201,162,39,0.10)' : 'rgba(255,255,255,0.03)',
            border: '0.5px solid ' + (hovered ? 'rgba(201,162,39,0.35)' : T.edge),
            fontSize: 10,
            fontFamily: T.mono,
            color: T.text,
            transition: 'all ' + TRANSITION,
            cursor: 'default',
            whiteSpace: 'nowrap',
          },
        },
        React.createElement(
          'span',
          {
            style: {
              color: signalColor(t.signal, T),
              fontWeight: 600,
              fontSize: 11,
            },
          },
          signalGlyph(t.signal)
        ),
        t.value
          ? React.createElement(
              'span',
              { style: { color: T.text, fontWeight: 600 } },
              String(t.value)
            )
          : null,
        React.createElement(
          'span',
          { style: { color: T.textMid } },
          String(t.label || t.id)
        ),
        hovered
          ? React.createElement(
              'button',
              {
                type: 'button',
                onClick: (e) => {
                  if (e && e.stopPropagation) e.stopPropagation();
                  remove(t.id);
                },
                'aria-label': 'Remove ' + (t.label || t.id),
                title: 'Remove',
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: T.textDim,
                  cursor: 'pointer',
                  fontSize: 11,
                  lineHeight: 1,
                  padding: 0,
                  marginLeft: 2,
                  transition: 'color ' + TRANSITION,
                },
              },
              '\u00D7'
            )
          : null
      );
    });

    return React.createElement(
      'div',
      { style: stripStyle },
      headerPill,
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          },
        },
        chips
      )
    );
  }

  // --------------------------------------------------------------------
  // Public surface
  // --------------------------------------------------------------------
  window.TRStars = {
    isStarred: isStarred,
    toggle: toggle,
    remove: remove,
    getAll: getAll,
    StarButton: StarButton,
    MyRadar: MyRadar,
    MAX_STARS: MAX_STARS,
    STORAGE_KEY: STORAGE_KEY,
    EVENT_NAME: EVENT_NAME,
  };
})();
