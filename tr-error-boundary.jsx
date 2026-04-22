// tr-error-boundary.jsx — per-screen React Error Boundary
// Exports: window.TRErrorBoundary
// Usage:  <TRErrorBoundary onReset={() => ...}> <Screen/> </TRErrorBoundary>

(function () {
  'use strict';

  var React = window.React;
  if (!React) {
    console.error('[TRErrorBoundary] React not found on window.');
    return;
  }

  var PALETTE = {
    ink000: '#07090C',
    ink200: '#10141B',
    ink300: '#1A2130',
    gold:   '#c9a227',
    bear:   '#D96B6B',
    text:   '#E6E8EC',
    muted:  '#8A92A6'
  };

  var TRErrorBoundary = class extends React.Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false, error: null, info: null, stackOpen: false };
      this._onReset = this._onReset.bind(this);
      this._toggleStack = this._toggleStack.bind(this);
    }

    static getDerivedStateFromError(error) {
      return { hasError: true, error: error };
    }

    componentDidCatch(error, info) {
      this.setState({ info: info });
      try {
        console.error('[TRErrorBoundary] caught error:', error, info);
      } catch (e) { /* no-op */ }
    }

    _onReset() {
      this.setState({ hasError: false, error: null, info: null, stackOpen: false });
      if (typeof this.props.onReset === 'function') {
        try { this.props.onReset(); } catch (e) { console.error('[TRErrorBoundary] onReset threw:', e); }
      }
    }

    _toggleStack() {
      this.setState(function (s) { return { stackOpen: !s.stackOpen }; });
    }

    render() {
      if (!this.state.hasError) return this.props.children;

      var err = this.state.error || {};
      var msg = (err && (err.message || String(err))) || 'Unknown error';
      var stack = (err && err.stack) || '';
      var compStack = (this.state.info && this.state.info.componentStack) || '';
      var open = this.state.stackOpen;

      return React.createElement(
        'div',
        {
          style: {
            minHeight: 240,
            margin: 16,
            padding: 20,
            background: PALETTE.ink200,
            border: '1px solid ' + PALETTE.ink300,
            borderLeft: '3px solid ' + PALETTE.bear,
            borderRadius: 8,
            color: PALETTE.text,
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
          }
        },
        React.createElement('div', {
          style: {
            fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase',
            color: PALETTE.bear, marginBottom: 6, fontWeight: 600
          }
        }, 'Error'),
        React.createElement('div', {
          style: { fontSize: 18, fontWeight: 700, color: PALETTE.text, marginBottom: 10 }
        }, 'Screen crashed'),
        React.createElement('div', {
          style: {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13, color: PALETTE.text, background: PALETTE.ink000,
            padding: '10px 12px', borderRadius: 6, border: '1px solid ' + PALETTE.ink300,
            marginBottom: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }
        }, msg),
        React.createElement(
          'button',
          {
            onClick: this._toggleStack,
            style: {
              background: 'transparent', color: PALETTE.muted,
              border: '1px solid ' + PALETTE.ink300, borderRadius: 4,
              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              marginBottom: 10
            }
          },
          open ? 'Hide stack trace' : 'Show stack trace'
        ),
        open && React.createElement('pre', {
          style: {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11, lineHeight: 1.45, color: PALETTE.muted,
            background: PALETTE.ink000, border: '1px solid ' + PALETTE.ink300,
            borderRadius: 6, padding: 10, maxHeight: 260, overflow: 'auto',
            marginTop: 0, marginBottom: 12, whiteSpace: 'pre-wrap'
          }
        }, (stack || '(no stack)') + (compStack ? ('\n\n--- component stack ---' + compStack) : '')),
        React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
          React.createElement(
            'button',
            {
              onClick: this._onReset,
              style: {
                background: PALETTE.gold, color: PALETTE.ink000,
                border: '1px solid ' + PALETTE.gold, borderRadius: 4,
                padding: '8px 14px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', letterSpacing: 0.3
              }
            },
            'Reload screen'
          )
        )
      );
    }
  };

  window.TRErrorBoundary = TRErrorBoundary;
})();
