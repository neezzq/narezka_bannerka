// WebGL chroma key — same maths as ffmpeg `chromakey` + `despill`
// (backend/app/render/graph.py: chroma_filters):
//  * U/V of the pixel and of the key colour with full-range BT.601 coefficients
//    (ffmpeg vf_chromakey RGB_TO_U / RGB_TO_V, 10-bit fixed point), 0..255 scale;
//  * diff = mean over the 3×3 neighbourhood of sqrt((du²+dv²) / (255²·2));
//  * alpha = clamp((diff − similarity) / blend) (hard threshold if blend ≈ 0);
//  * despill (mix 0.5, expand 0): spill = max(g − (r+b)/2, 0); g −= amount·spill.
import type { ChromaSettings } from "@/lib/types";

export const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_keyUV;
uniform float u_sim;
uniform float u_blend;
uniform float u_spill;
uniform float u_blue;
varying vec2 v_uv;

vec2 uv255(vec3 c) {
  vec3 p = c * 255.0;
  return vec2(
    128.0 + (-0.168736 * p.r - 0.331264 * p.g + 0.5 * p.b),
    128.0 + (0.5 * p.r - 0.418688 * p.g - 0.081312 * p.b)
  );
}

void main() {
  vec4 src = texture2D(u_tex, v_uv);
  float diff = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec3 c = texture2D(u_tex, v_uv + vec2(float(dx), float(dy)) * u_texel).rgb;
      vec2 d = floor(uv255(c) + 0.5) - u_keyUV;
      diff += sqrt((d.x * d.x + d.y * d.y) / (255.0 * 255.0 * 2.0));
    }
  }
  diff /= 9.0;
  float a = u_blend > 0.0001 ? clamp((diff - u_sim) / u_blend, 0.0, 1.0) : (diff > u_sim ? 1.0 : 0.0);
  a *= src.a;
  vec3 col = src.rgb;
  if (u_spill > 0.001) {
    if (u_blue > 0.5) {
      float spill = max(col.b - (col.r * 0.5 + col.g * 0.5), 0.0);
      col.b = max(col.b - u_spill * spill, 0.0);
    } else {
      float spill = max(col.g - (col.r * 0.5 + col.b * 0.5), 0.0);
      col.g = max(col.g - u_spill * spill, 0.0);
    }
  }
  gl_FragColor = vec4(col * a, a);
}`;

const FIX = (x: number) => Math.round(x * 1024);

/** U/V of a hex colour — the exact integer maths of ffmpeg's vf_chromakey. */
export function keyUV(hex: string): [number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const u = ((-FIX(0.16874) * r - FIX(0.33126) * g + FIX(0.5) * b + 511) >> 10) + 128;
  const v = ((FIX(0.5) * r - FIX(0.41869) * g - FIX(0.08131) * b + 511) >> 10) + 128;
  return [u, v];
}

export function isBlueKey(hex: string): boolean {
  const h = hex.replace("#", "");
  return parseInt(h.slice(4, 6), 16) > parseInt(h.slice(2, 4), 16);
}

export type ChromaSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

export class ChromaRenderer {
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  tex: WebGLTexture;
  loc: Record<string, WebGLUniformLocation | null> = {};

  static create(canvas: HTMLCanvasElement): ChromaRenderer | null {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    try {
      return new ChromaRenderer(gl);
    } catch {
      return null;
    }
  }

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const n of ["u_tex", "u_texel", "u_keyUV", "u_sim", "u_blend", "u_spill", "u_blue"]) {
      this.loc[n] = gl.getUniformLocation(prog, n);
    }
  }

  /** Draw `source` keyed with `c`. Returns false if the frame is not ready. */
  draw(source: ChromaSource, c: ChromaSettings): boolean {
    const gl = this.gl;
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!sw || !sh) return false;
    if (source instanceof HTMLVideoElement && source.readyState < 2) return false;
    const canvas = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.prog);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return false;
    }
    const [u, v] = keyUV(c.color);
    gl.uniform1i(this.loc.u_tex, 0);
    gl.uniform2f(this.loc.u_texel, 1 / sw, 1 / sh);
    gl.uniform2f(this.loc.u_keyUV, u, v);
    gl.uniform1f(this.loc.u_sim, Math.max(0.00001, c.similarity));
    gl.uniform1f(this.loc.u_blend, c.blend);
    gl.uniform1f(this.loc.u_spill, c.spill);
    gl.uniform1f(this.loc.u_blue, isBlueKey(c.color) ? 1 : 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
