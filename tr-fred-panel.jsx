// tr-fred-panel.jsx — FRED macro dashboard (10 key series, sparklines).
//
// Exposes:
//   window.TRFREDPanel({ open, onClose })   — full modal grid of 10 tiles.
//   window.openTRFRED()                      — fires 'tr:open-fred' CustomEvent.
//
// Depends on window.FREDData (engine/fred.js). Shows inline "paste API key"
// prompt if TR_SETTINGS.keys.fred is missing / invalid. Does NOT mutate
// TR_DEFAULT_SETTINGS — reads TR_SETTINGS directly and writes back through
// the standard 'tr:settings-changed' event.

(function () {
  if (typeof window === 'undefined') return;

  var T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge:   'rgba(255,255,255,0.06)',
    edgeHi: 'rgba(255,255,255,0.10)',
    text:   '#ffffff',
    textMid:'rgba(180,188,200,0.75)',
    textDim:'rgba(130,138,150,0.55)',
    signal: '#c9a227',
    bull:   '#6FCF8E',
    bear:   '#D96B6B',
    mono:   '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    sans:   '"Inter Tight", system-ui, sans-serif',
  };

  function fmtValue(val, unit) {
    if (val == null || !isFinite(val)) return '—';
    if (unit === 'pct') return val.toFixed(2) + '%';
    if (unit === 'bps') return val.toFixed(0) + 'bps';
    if (unit === 'usd-bn') {
      if (Math.abs(val) >= 1000) return '$' + (val / 1000).toFixed(2) + 'T';
      return '$' + val.toFixed(1) + 'B';
    }
    if (unit === 'usd-tn') return '$' + val.toFixed(2) + 'T';
    if (unit === 'num') {
      if (Math.abs(val) < 10) return val.toFixed(4);
      if (Math.abs(val) < 100) return val.toFixed(2);
      return val.toFixed(1);
    }
    return String(val);
  }

  function fmtDelta(d, unit) {
    if (d == null || !isFinite(d)) return '—';
    var sign = d > 0 ? '+' : d < 0 ? '' : '';
    if (unit === 'pct') return sign + d.toFixed(3);
    if (unit === 'usd-bn') {
      if (Math.abs(d) >= 100) return sign + d.toFixed(0) + 'B';
      return sign + d.toFixed(2) + 'B';
    }
    if (unit === 'num') {
      if (Math.abs(d) < 1) return sign + d.toFixed(4);
      return sign + d.toFixed(2);
    }
    return sign + d.toFixed(2);
  }

  function colorForDelta(d, unit, label) {
    if (d == null || !isFinite(d) || d === 0) return T.textDim;
    // For rates/spreads, "up" is neither good nor bad by itself, but color
    // for readability: up=bull-green, down=bear-red is the standard terminal
    // convention. UNRATE & HY OAS invert (higher is worse).
    var invert = /unemployment|oas|spread/i.test(label || '');
    if (invert) return d > 0 ? T.bear : T.bull;
    return d > 0 ? T.bull : T.bear;
  }

  function fmtAge(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 60_000) return Math.round(d / 1000) + 's ago';
    if (d < 3_600_000) return Math.round(d / 60_000) + 'm ago';
    if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
    return Math.round(d / 86_400_000) + 'd ago';
  }

  // 30-obs sparkline — oldest left, newest right.
  function Sparkline(props) {
    var data = props.data || [];
    var width = props.width || 160;
    var height = props.height || 36;
    var stroke = props.stroke || T.signal;
    // Filter out null values — FRED uses null for holidays.
    var pts = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i] && data[i].value != null) pts.push(data[i].value);
    }
    if (pts.length < 2) {
      return React.createElement('div', {
        style: { width: width, height: height, fontFamily: T.mono, fontSize: 9,
                 color: T.textDim, display: 'flex', alignItems: 'center' },
      }, pts.length === 1 ? pts[0].toFixed(2) : '—');
    }
    var min = Math.min.apply(null, pts);
    var max = Math.max.apply(null, pts);
    var span = max - min || 1;
    var step = width / (pts.length - 1);
    var path = '';
    for (var j = 0; j < pts.length; j++) {
      var x = j * step;
      var y = height - ((pts[j] - min) / span) * (height - 2) - 1;
      path += (j === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    var trend = pts[pts.length - 1] >= pts[0];
    return React.createElement('svg', {
      width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
      style: { display: 'block' },
    },
      React.createElement('path', {
        d: path, fill: 'none',
        stroke: trend ? T.bull : T.bear,
        strokeWidth: 1.2, strokeLinejoin: 'round', strokeLinecap: 'round',
        opacity: 0.9,
      })
    );
  }

  function Tile(props) {
    var id = props.id;
    var def = props.def || {};
    var entry = props.entry;
    var unit = def.unit || 'num';

    var latest = entry ? entry.latest : null;
    var delta  = entry ? entry.delta  : null;
    var hist   = entry ? entry.history : null;

    return React.createElement('div', {
      style: {
        padding: '14px 16px', background: T.ink200, border: '1px solid ' + T.edge,
        borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8,
        minHeight: 128,
      },
    },
      // Header row
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
      },
        React.createElement('div', {
          style: { fontSize: 10, letterSpacing: 0.8, color: T.text, fontWeight: 700,
                   textTransform: 'uppercase' },
        }, def.label || id),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 8.5, letterSpacing: 0.6, color: T.textDim },
        }, id)
      ),
      React.createElement('div', {
        style: { fontSize: 9.5, color: T.textDim, letterSpacing: 0.3 },
      }, def.desc || ''),

      // Value
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 22, fontWeight: 600,
                 color: T.text, letterSpacing: 0.3 },
      }, fmtValue(latest, unit)),

      // Delta chip
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6 },
      },
        React.createElement('div', {
          style: {
            fontFamily: T.mono, fontSize: 10, fontWeight: 600,
            padding: '2px 7px', borderRadius: 4,
            color: colorForDelta(delta, unit, def.label),
            background: delta == null ? T.ink300
                      : delta > 0 ? 'rgba(111,207,142,0.10)'
                      : delta < 0 ? 'rgba(217,107,107,0.10)'
                      : T.ink300,
            border: '0.5px solid ' + T.edge,
          },
        }, fmtDelta(delta, unit)),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 0.4 },
        }, 'Δ prior obs')
      ),

      // Sparkline
      React.createElement('div', { style: { marginTop: 'auto' } },
        React.createElement(Sparkline, { data: hist || [], width: 240, height: 32 })
      )
    );
  }

  // ---------- API-key prompt ----------
  function KeyPrompt(props) {
    var onSave = props.onSave;
    var kState = React.useState('');    var val = kState[0]; var setVal = kState[1];
    var eState = React.useState(null);  var err = eState[0]; var setErr = eState[1];
    function submit() {
      var v = (val || '').trim();
      if (!/^[a-z0-9]{32}$/.test(v)) { setErr('Key must be 32 lowercase alphanumeric chars.'); return; }
      try {
        var cur = window.TR_SETTINGS || {};
        var next = {
          keys:    Object.assign({}, cur.keys || {}, { fred: v }),
          refresh: Object.assign({}, cur.refresh || {}),
          sources: Object.assign({}, cur.sources || {}),
        };
        localStorage.setItem('tr_settings', JSON.stringify(next));
        window.TR_SETTINGS = next;
        try { window.dispatchEvent(new CustomEvent('tr:settings-changed', { detail: next })); } catch (_) {}
        if (typeof onSave === 'function') onSave(v);
      } catch (e) { setErr(e && e.message ? e.message : 'save failed'); }
    }
    return React.createElement('div', {
      style: {
        padding: '18px 20px', marginBottom: 14,
        background: 'rgba(201,162,39,0.06)', border: '1px solid rgba(201,162,39,0.25)',
        borderRadius: 8,
      },
    },
      React.createElement('div', {
        style: { fontSize: 10, letterSpacing: 1, color: T.signal, fontWeight: 700,
                 textTransform: 'uppercase', marginBottom: 6 },
      }, 'FRED API key required'),
      React.createElement('div', {
        style: { fontSize: 11, color: T.textMid, lineHeight: 1.5, marginBottom: 10 },
      },
        'Get a free key at ',
        React.createElement('a', {
          href: 'https://fred.stlouisfed.org/docs/api/api_key.html',
          target: '_blank', rel: 'noopener noreferrer',
          style: { color: T.signal, textDecoration: 'underline' },
        }, 'fred.stlouisfed.org/docs/api/api_key.html'),
        ' — paste the 32-char key below. Stored locally only.'
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('input', {
          type: 'text', value: val, placeholder: '32-char lowercase alphanumeric key',
          onChange: function (e) { setVal(e.target.value); setErr(null); },
          style: {
            flex: 1, padding: '8px 10px', fontFamily: T.mono, fontSize: 11,
            color: T.text, background: T.ink100,
            border: '1px solid ' + T.edge, borderRadius: 5, outline: 'none',
            letterSpacing: 0.4,
          },
        }),
        React.createElement('div', {
          onClick: submit,
          style: {
            padding: '8px 14px', fontFamily: T.mono, fontSize: 11, fontWeight: 700,
            color: T.ink000, background: T.signal,
            borderRadius: 5, cursor: 'pointer', letterSpacing: 0.5,
          },
        }, 'SAVE')
      ),
      err ? React.createElement('div', {
        style: { marginTop: 8, fontFamily: T.mono, fontSize: 10, color: T.bear },
      }, err) : null
    );
  }

  // ---------- main panel ----------
  function TRFREDPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var bState = React.useState(null);          var bundle = bState[0];       var setBundle = bState[1];
    var lState = React.useState(false);          var loading = lState[0];      var setLoading = lState[1];
    var eState = React.useState(null);           var err = eState[0];          var setErr = eState[1];
    var uState = React.useState(null);           var updatedAt = uState[0];    var setUpdatedAt = uState[1];
    var kState = React.useState(function () {
      return !!(window.FREDData && window.FREDData.hasKey && window.FREDData.hasKey());
    });
    var haveKey = kState[0]; var setHaveKey = kState[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.FREDData) { setErr('FREDData engine missing'); return; }
      if (!window.FREDData.hasKey()) { setHaveKey(false); return; }
      setHaveKey(true);
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.FREDData.clearCache(); } catch (_) {} }
        var b = await window.FREDData.getBundle();
        setBundle(b || {});
        setUpdatedAt(Date.now());
        // If every series is null, likely a bad key.
        var allNull = true;
        for (var k in (b || {})) {
          if (Object.prototype.hasOwnProperty.call(b, k) && b[k]) { allNull = false; break; }
        }
        if (allNull) setErr('no data returned — verify API key');
      } catch (e) {
        setErr((e && e.message) ? e.message : 'fetch failed');
      } finally { setLoading(false); }
    }, []);

    React.useEffect(function () {
      if (!open) return;
      if (!window.FREDData) { setErr('FREDData engine missing'); return; }
      if (window.FREDData.hasKey()) {
        setHaveKey(true);
        refresh(false);
      } else {
        setHaveKey(false);
      }
      var iv = setInterval(function () {
        if (window.FREDData && window.FREDData.hasKey()) refresh(false);
      }, 15 * 60 * 1000);
      // Listen for settings changes → re-check key.
      function onSettings() {
        if (window.FREDData && window.FREDData.hasKey()) {
          setHaveKey(true);
          refresh(true);
        }
      }
      window.addEventListener('tr:settings-changed', onSettings);
      return function () {
        clearInterval(iv);
        window.removeEventListener('tr:settings-changed', onSettings);
      };
    }, [open, refresh]);

    if (!open) return null;

    var SERIES = (window.FREDData && window.FREDData.SERIES) || {};
    var ORDER  = (window.FREDData && window.FREDData.SERIES_ORDER) || [];

    var lastUpdated = updatedAt ? fmtAge(updatedAt) : '—';

    return React.createElement('div', {
      onClick: onClose,
      style: {
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      },
    },
      React.createElement('div', {
        onClick: function (e) { e.stopPropagation(); },
        style: {
          width: 1020, maxHeight: '94%', overflow: 'auto',
          background: T.ink100, border: '1px solid ' + T.edgeHi, borderRadius: 14,
          padding: '22px 26px', color: T.text,
          fontFamily: T.sans,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        },
      },
        // Header
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
        },
          React.createElement('div', {
            style: { fontSize: 10, letterSpacing: 1.2, color: T.textDim,
                     textTransform: 'uppercase', fontWeight: 600 },
          }, 'FRED Macro Dashboard · St. Louis Fed'),
          React.createElement('div', {
            style: {
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              letterSpacing: 0.6,
              color: !haveKey ? T.signal : loading ? T.signal : (err ? T.bear : T.bull),
              background: !haveKey ? 'rgba(201,162,39,0.10)'
                        : loading ? 'rgba(201,162,39,0.10)'
                        : err ? 'rgba(217,107,107,0.10)'
                        : 'rgba(111,207,142,0.10)',
              borderRadius: 4,
              border: '0.5px solid ' + (!haveKey ? 'rgba(201,162,39,0.4)'
                                        : loading ? 'rgba(201,162,39,0.4)'
                                        : err ? 'rgba(217,107,107,0.4)'
                                        : 'rgba(111,207,142,0.4)'),
            },
          }, !haveKey ? 'NO KEY' : loading ? 'LOADING' : err ? 'OFFLINE' : 'LIVE'),
          React.createElement('div', {
            style: { fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 },
          }, 'UPDATED · ' + lastUpdated),

          React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
            React.createElement('div', {
              onClick: function () { refresh(true); },
              style: {
                padding: '5px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 600,
                background: T.ink200, color: T.textMid,
                border: '1px solid ' + T.edge, borderRadius: 5,
                cursor: 'pointer', letterSpacing: 0.4,
              },
            }, 'REFRESH'),
            React.createElement('div', {
              onClick: onClose,
              style: {
                width: 28, height: 28, borderRadius: 7,
                background: T.ink200, border: '1px solid ' + T.edge,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: T.textMid, fontSize: 16,
              },
            }, '×')
          )
        ),

        // Key prompt
        !haveKey ? React.createElement(KeyPrompt, {
          onSave: function () { setHaveKey(true); refresh(true); },
        }) : null,

        // Error banner
        err && haveKey ? React.createElement('div', {
          style: {
            padding: '9px 12px', marginBottom: 12,
            background: 'rgba(217,107,107,0.08)', border: '1px solid rgba(217,107,107,0.3)',
            borderRadius: 6, fontFamily: T.mono, fontSize: 10.5, color: T.bear, letterSpacing: 0.4,
          },
        }, 'DATA · ' + err) : null,

        // Grid — 5 cols × 2 rows
        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10,
          },
        },
          ORDER.map(function (id) {
            return React.createElement(Tile, {
              key: id,
              id: id,
              def: SERIES[id] || {},
              entry: bundle ? bundle[id] : null,
            });
          })
        ),

        // Footer
        React.createElement('div', {
          style: {
            marginTop: 16, fontFamily: T.mono, fontSize: 9.5, color: T.textDim,
            letterSpacing: 0.4, textAlign: 'right',
          },
        }, 'Source: FRED · api.stlouisfed.org · sparklines = last 30 observations')
      )
    );
  }

  window.openTRFRED = function openTRFRED() {
    try { window.dispatchEvent(new CustomEvent('tr:open-fred')); } catch (_) {}
  };
  window.TRFREDPanel = TRFREDPanel;
})();
