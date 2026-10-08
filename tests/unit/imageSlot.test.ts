import { describe, expect, it } from 'vitest';
import { centerCrop, nearestAspect, slotBox } from '../../src/ai/imageSlot';

/** Elemento com uma caixa fixa (o jsdom não calcula layout). */
function boxed(tag: string, width: number, height: number): HTMLElement {
  const el = document.createElement(tag);
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
  return el;
}

describe('formato da imagem pelo espaço onde fica (08/10/2026)', () => {
  it('proporção suportada mais próxima', () => {
    expect(nearestAspect(546, 700)).toBe('3:4'); // widget de imagem do Elementor no projeto do print
    expect(nearestAspect(1200, 500)).toBe('16:9');
    expect(nearestAspect(400, 400)).toBe('1:1');
    expect(nearestAspect(800, 610)).toBe('4:3');
    expect(nearestAspect(360, 700)).toBe('9:16');
    expect(nearestAspect(0, 100)).toBeNull();
  });

  it('imagem sozinha num contentor maior: o espaço é o contentor (widget de imagem); com mais conteúdo, a própria imagem', () => {
    const widget = boxed('div', 546, 700);
    const img = boxed('img', 435, 435);
    widget.append(img);
    expect(slotBox(img, 'image')).toEqual({ width: 546, height: 700 });
    const card = boxed('div', 546, 900);
    const img2 = boxed('img', 400, 300);
    card.append(img2, boxed('p', 400, 100));
    expect(slotBox(img2, 'image')).toEqual({ width: 400, height: 300 });
    // Fundo: o próprio elemento.
    const section = boxed('section', 1280, 640);
    section.append(boxed('div', 10, 10));
    expect(slotBox(section, 'background')).toEqual({ width: 1280, height: 640 });
  });

  it('corte central: quadrado 1024 → 3:4 (768×1024) e → 16:9 (1024×576)', () => {
    expect(centerCrop(1024, 1024, '3:4')).toEqual({ sx: 128, sy: 0, sw: 768, sh: 1024 });
    expect(centerCrop(1024, 1024, '16:9')).toEqual({ sx: 0, sy: 224, sw: 1024, sh: 576 });
    expect(centerCrop(1024, 1024, '1:1')).toEqual({ sx: 0, sy: 0, sw: 1024, sh: 1024 });
  });
});
