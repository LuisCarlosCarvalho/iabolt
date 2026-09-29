import { useLayoutEffect, useRef, useState } from 'react';
import { deviceById, type DeviceId } from '../engine/styles';

/**
 * Pré-visualização à largura REAL do dispositivo (as media queries do site aplicam-se como no
 * canvas), reduzida só por escala para caber no espaço disponível. O iframe tem sempre a largura e
 * a altura do dispositivo; a escala muda apenas o aspeto, nunca o layout.
 */
const HEIGHT: Record<DeviceId, number> = { desktop: 800, tablet: 1024, mobile: 720 };

export function previewSize(device: DeviceId): { width: number; height: number } {
  return { width: parseInt(deviceById(device).width, 10) || 1280, height: HEIGHT[device] };
}

export function ScaledPreview({ html, device, title, testId, maxHeight }: { html: string; device: DeviceId; title: string; testId: string; maxHeight?: number }) {
  const { width, height } = previewSize(device);
  const box = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const byWidth = available > 0 ? Math.min(1, available / width) : 0;
  const scale = maxHeight && byWidth * height > maxHeight ? maxHeight / height : byWidth;
  return (
    <div ref={box} className="scaled-preview" style={{ height: scale ? Math.round(height * scale) : 0 }} data-testid={`${testId}-box`} data-scale={scale.toFixed(3)}>
      {scale > 0 && (
        <iframe
          className="scaled-preview-frame"
          title={title}
          sandbox="allow-scripts"
          srcDoc={html}
          style={{ width, height, transform: `scale(${scale})`, left: Math.max(0, Math.round((available - width * scale) / 2)) }}
          data-testid={testId}
          data-device={device}
          data-width={width}
          data-height={height}
        />
      )}
    </div>
  );
}
