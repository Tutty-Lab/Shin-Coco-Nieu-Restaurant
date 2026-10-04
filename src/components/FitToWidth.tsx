import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Zeigt ein Blatt in seiner echten Breite (A4 = 794 px) und verkleinert es
 * auf die verfügbare Breite – so sieht man in der Vorschau die GANZE Seite,
 * auch auf dem Handy, statt seitlich zu scrollen. Nie vergrößert.
 */
export function FitToWidth({ width = 794, children }: { width?: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const s = Math.min(1, outer.current.clientWidth / width);
      setScale(s);
      setHeight(inner.current.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className="overflow-hidden" style={{ height }}>
      <div ref={inner} style={{ width, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}
