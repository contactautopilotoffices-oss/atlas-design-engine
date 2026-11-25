/** Colour utilities. Pure functions, no I/O. Distances use CIE76 Delta E in Lab space. */
export type RGB = [number, number, number];
export type Lab = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const rgbToHex = ([r, g, b]: RGB) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

export function rgbToLab([r, g, b]: RGB): Lab {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export function labToRgb([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047;
  const Y = inv(fy);
  const Z = inv(fz) * 1.08883;
  const gam = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return [gam(X * 3.2406 + Y * -1.5372 + Z * -0.4986), gam(X * -0.9689 + Y * 1.8758 + Z * 0.0415), gam(X * 0.0557 + Y * -0.204 + Z * 1.057)];
}

export const deltaE = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
export const hexDeltaE = (a: string, b: string) => deltaE(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)));

/**
 * Deterministic k-means in Lab space over RGB pixels. Returns clusters sorted by share.
 * Seeds are spread over the luminance-sorted pixel list, so results are reproducible.
 */
export function dominantColours(pixels: RGB[], k = 5, iterations = 12): Array<{ hex: string; share: number }> {
  if (pixels.length === 0) return [];
  const labs = pixels.map(rgbToLab);
  const sorted = [...labs].sort((x, y) => x[0] - y[0]);
  const kk = Math.min(k, labs.length);
  let centres: Lab[] = Array.from({ length: kk }, (_, i) => sorted[Math.floor(((i + 0.5) * sorted.length) / kk)]);
  let assign = new Array<number>(labs.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    assign = labs.map((p) => {
      let best = 0;
      let bd = Infinity;
      centres.forEach((c, ci) => {
        const d = deltaE(p, c);
        if (d < bd) {
          bd = d;
          best = ci;
        }
      });
      return best;
    });
    centres = centres.map((c, ci) => {
      const members = labs.filter((_, i) => assign[i] === ci);
      if (!members.length) return c;
      return [0, 1, 2].map((d) => members.reduce((s, m) => s + m[d], 0) / members.length) as Lab;
    });
  }
  const counts = centres.map((_, ci) => assign.filter((a) => a === ci).length);
  const out = centres
    .map((c, ci) => ({ lab: c, share: counts[ci] / labs.length }))
    .filter((c) => c.share > 0);
  // merge near-identical clusters
  const merged: typeof out = [];
  for (const c of out.sort((a, b) => b.share - a.share)) {
    const near = merged.find((m) => deltaE(m.lab, c.lab) < 6);
    if (near) near.share += c.share;
    else merged.push({ ...c });
  }
  return merged
    .sort((a, b) => b.share - a.share)
    .map((c) => ({ hex: rgbToHex(labToRgb(c.lab)), share: Math.round(c.share * 1000) / 1000 }));
}

/** Rough warm/cool reading of a colour (b* axis). Observational helper, not a design judgement. */
export const warmth = (hex: string) => rgbToLab(hexToRgb(hex))[2];
