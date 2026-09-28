/** Ilustrações SVG embutidas nos templates. Sem pedidos externos nem direitos de terceiros. */

export const svgUri = (svg: string): string => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);

/** Painel de métricas estilizado (template Nimbus). */
export const NIMBUS_DASHBOARD = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#f5f3ff"/></linearGradient>
<linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient>
<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".35"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></linearGradient>
</defs>
<rect width="960" height="640" rx="28" fill="url(#bg)"/>
<rect x="40" y="40" width="880" height="560" rx="20" fill="#fff" stroke="#e0e7ff"/>
<rect x="40" y="40" width="880" height="56" rx="20" fill="#f8fafc"/>
<circle cx="76" cy="68" r="7" fill="#fca5a5"/><circle cx="100" cy="68" r="7" fill="#fcd34d"/><circle cx="124" cy="68" r="7" fill="#86efac"/>
<rect x="72" y="124" width="190" height="96" rx="14" fill="#eef2ff"/><rect x="92" y="146" width="90" height="10" rx="5" fill="#a5b4fc"/><rect x="92" y="170" width="130" height="26" rx="8" fill="#4f46e5"/>
<rect x="286" y="124" width="190" height="96" rx="14" fill="#f5f3ff"/><rect x="306" y="146" width="90" height="10" rx="5" fill="#c4b5fd"/><rect x="306" y="170" width="110" height="26" rx="8" fill="#7c3aed"/>
<rect x="500" y="124" width="388" height="96" rx="14" fill="#f8fafc"/><path d="M520 196 C 580 150, 620 190, 680 160 S 800 140, 868 150" fill="none" stroke="#6366f1" stroke-width="5" stroke-linecap="round"/>
<rect x="72" y="248" width="520" height="320" rx="16" fill="#f8fafc"/>
<path d="M100 520 L 160 470 L 220 490 L 290 420 L 360 440 L 430 370 L 500 390 L 560 330 L 560 540 L 100 540 Z" fill="url(#area)"/>
<path d="M100 520 L 160 470 L 220 490 L 290 420 L 360 440 L 430 370 L 500 390 L 560 330" fill="none" stroke="#4f46e5" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
<rect x="616" y="248" width="272" height="320" rx="16" fill="#f8fafc"/>
<rect x="648" y="440" width="36" height="100" rx="8" fill="url(#bar)"/><rect x="700" y="380" width="36" height="160" rx="8" fill="url(#bar)"/><rect x="752" y="410" width="36" height="130" rx="8" fill="url(#bar)"/><rect x="804" y="330" width="36" height="210" rx="8" fill="url(#bar)"/>
<rect x="648" y="280" width="150" height="12" rx="6" fill="#c7d2fe"/><rect x="648" y="304" width="100" height="12" rx="6" fill="#e0e7ff"/>
</svg>`);

/** Equipa a trabalhar sobre um relatório (template Nimbus, secção de conteúdo). */
export const NIMBUS_TEAM = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="880" height="660" viewBox="0 0 880 660">
<rect width="880" height="660" rx="28" fill="#1e1b4b"/>
<circle cx="700" cy="140" r="180" fill="#312e81"/><circle cx="160" cy="560" r="220" fill="#312e81"/>
<rect x="140" y="150" width="600" height="380" rx="22" fill="#fff"/>
<rect x="180" y="190" width="220" height="16" rx="8" fill="#c7d2fe"/><rect x="180" y="222" width="150" height="12" rx="6" fill="#e0e7ff"/>
<rect x="180" y="270" width="250" height="210" rx="14" fill="#eef2ff"/>
<circle cx="305" cy="375" r="72" fill="none" stroke="#e0e7ff" stroke-width="28"/>
<path d="M305 303 A 72 72 0 1 1 239 404" fill="none" stroke="#6366f1" stroke-width="28" stroke-linecap="round"/>
<rect x="460" y="270" width="240" height="60" rx="12" fill="#f5f3ff"/><rect x="480" y="290" width="120" height="20" rx="6" fill="#8b5cf6"/>
<rect x="460" y="345" width="240" height="60" rx="12" fill="#f5f3ff"/><rect x="480" y="365" width="160" height="20" rx="6" fill="#a78bfa"/>
<rect x="460" y="420" width="240" height="60" rx="12" fill="#f5f3ff"/><rect x="480" y="440" width="90" height="20" rx="6" fill="#c4b5fd"/>
<circle cx="760" cy="520" r="46" fill="#fbbf24"/><path d="M742 520 l12 12 24-26" fill="none" stroke="#1e1b4b" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);

/** Logótipo em imagem (template Vértice): símbolo + marca. */
export const VERTICE_LOGO = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="176" height="40" viewBox="0 0 176 40">
<path d="M4 34 L20 6 L36 34 Z" fill="#0f766e"/><path d="M14 34 L24 16 L34 34 Z" fill="#f59e0b"/>
<text x="46" y="28" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="700" letter-spacing="2" fill="#0f172a">VÉRTICE</text>
</svg>`);

/** Versão clara do logótipo para o rodapé escuro. */
export const VERTICE_LOGO_LIGHT = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="176" height="40" viewBox="0 0 176 40">
<path d="M4 34 L20 6 L36 34 Z" fill="#5eead4"/><path d="M14 34 L24 16 L34 34 Z" fill="#fbbf24"/>
<text x="46" y="28" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="700" letter-spacing="2" fill="#f8fafc">VÉRTICE</text>
</svg>`);

/** Composição arquitetónica abstrata (template Vértice, hero). */
export const VERTICE_HERO = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700">
<rect width="900" height="700" rx="24" fill="#ecfdf5"/>
<path d="M0 520 L 260 250 L 480 470 L 640 320 L 900 560 L 900 700 L 0 700 Z" fill="#99f6e4"/>
<path d="M0 600 L 220 420 L 420 580 L 620 440 L 900 640 L 900 700 L 0 700 Z" fill="#0f766e"/>
<circle cx="680" cy="170" r="84" fill="#fbbf24"/>
<rect x="120" y="120" width="220" height="140" rx="16" fill="#fff" opacity=".95"/>
<rect x="144" y="146" width="120" height="14" rx="7" fill="#0f766e"/><rect x="144" y="174" width="170" height="10" rx="5" fill="#99f6e4"/>
<rect x="144" y="196" width="150" height="10" rx="5" fill="#ccfbf1"/><rect x="144" y="222" width="80" height="18" rx="9" fill="#f59e0b"/>
</svg>`);

/** Reunião de trabalho abstrata (template Vértice, secção sobre nós). */
export const VERTICE_MEETING = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="880" height="620" viewBox="0 0 880 620">
<rect width="880" height="620" rx="24" fill="#0f766e"/>
<rect x="120" y="330" width="640" height="40" rx="20" fill="#115e59"/>
<circle cx="230" cy="230" r="54" fill="#fde68a"/><rect x="170" y="290" width="120" height="120" rx="40" fill="#f59e0b"/>
<circle cx="440" cy="210" r="58" fill="#ccfbf1"/><rect x="376" y="276" width="128" height="134" rx="44" fill="#5eead4"/>
<circle cx="650" cy="230" r="54" fill="#fecaca"/><rect x="590" y="290" width="120" height="120" rx="40" fill="#fb7185"/>
<rect x="330" y="80" width="220" height="70" rx="14" fill="#fff"/><rect x="352" y="102" width="120" height="10" rx="5" fill="#0f766e"/><rect x="352" y="122" width="170" height="8" rx="4" fill="#99f6e4"/>
</svg>`);
