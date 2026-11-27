import { describe, expect, it } from 'vitest';
import { renderSafeCopilotMarkdown } from './copilot-markdown';

describe('renderSafeCopilotMarkdown (XSS-safe https links)', () => {
  it('renders https Binance deep-links as safe noopener anchors alongside formatting', () => {
    const html = renderSafeCopilotMarkdown(
      '**Oportunidad:** [Abrir Compra](https://c2c.binance.com/es-LA/adv?code=11218246497340923904&side=BUY) y [Perfil](https://p2p.binance.com/es-LA/advertiserDetail?advertiserNo=s8415f1)',
    );

    expect(html).toContain('<strong>Oportunidad:</strong>');
    expect(html).toContain(
      '<a href="https://c2c.binance.com/es-LA/adv?code=11218246497340923904&amp;side=BUY" target="_blank" rel="noopener noreferrer" class="copilot-md-link">Abrir Compra</a>',
    );
    expect(html).toContain(
      '<a href="https://p2p.binance.com/es-LA/advertiserDetail?advertiserNo=s8415f1" target="_blank" rel="noopener noreferrer" class="copilot-md-link">Perfil</a>',
    );
  });

  it('rejects javascript:, data:, file:, http:, and attribute-breakout XSS payloads', () => {
    const samples = [
      '[click](javascript:alert(1))',
      '[img](data:text/html,<script>alert(1)</script>)',
      '[local](file:///C:/Windows/System32)',
      '[insecure](http://c2c.binance.com/es-LA/adv?code=123)',
      '[break](https://c2c.binance.com/"onclick="alert(1))',
      '<script>alert(1)</script>',
    ];

    for (const s of samples) {
      const out = renderSafeCopilotMarkdown(s);
      expect(out).not.toContain('<a ');
      expect(out).not.toContain('<script>');
      expect(out).not.toContain('"onclick=');
      expect(out).not.toMatch(/href\s*=/i);
    }
  });
});
