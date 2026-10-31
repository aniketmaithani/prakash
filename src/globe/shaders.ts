export const earthVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const earthFragment = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D specMap;
uniform sampler2D bumpMap;
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float cloudShift;
uniform float cloudsOn;
uniform vec2 bumpTexel;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(sunDir);

  float water = texture2D(specMap, vUv).r;

  // Relief from the height map, built on a local east/north frame so it works anywhere but the exact poles.
  float h0 = texture2D(bumpMap, vUv).r;
  float hu = texture2D(bumpMap, vUv + vec2(bumpTexel.x, 0.0)).r;
  float hv = texture2D(bumpMap, vUv + vec2(0.0, bumpTexel.y)).r;
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(N, east);
  vec3 Nb = normalize(N - (east * (hu - h0) + north * (hv - h0)) * 9.0 * (1.0 - water));

  vec3 day = texture2D(dayMap, vUv).rgb;
  vec3 night = texture2D(nightMap, vUv).rgb;

  float cosS = dot(N, L);
  float diff = max(dot(Nb, L), 0.0);
  float dayMix = smoothstep(-0.16, 0.24, cosS);

  // Cloud shadows: sample the cloud layer a little toward the sun.
  float cloud = texture2D(cloudMap, vec2(vUv.x - cloudShift + L.x * 0.0015, vUv.y + 0.0015)).r * cloudsOn;
  float shadow = 1.0 - smoothstep(0.15, 0.9, cloud) * 0.5;

  // Oceans read darker and bluer than the raw texture, as they do from orbit.
  vec3 base = mix(day, day * vec3(0.62, 0.78, 1.0) * 0.85, water * 0.55);
  vec3 col = base * (0.035 + 1.22 * diff) * shadow;

  // Sun glint on water: tight hot spot plus a broad sheen.
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float spec = (pow(nh, 260.0) * 0.32 + pow(nh, 40.0) * 0.045) * water;
  col += vec3(1.0, 0.9, 0.74) * spec * dayMix * (1.0 - cloud * 0.85);

  // Warm band along the terminator.
  float twilight = smoothstep(-0.28, 0.0, cosS) * (1.0 - smoothstep(0.0, 0.32, cosS));
  col = mix(col, col * vec3(1.35, 0.72, 0.48), twilight * 0.55);

  // City lights on the night side, dimmed under cloud.
  vec3 lights = pow(night, vec3(1.45)) * vec3(1.0, 0.78, 0.48) * 3.2 * (1.0 - smoothstep(0.1, 0.8, cloud) * 0.7);
  float nightMix = 1.0 - smoothstep(-0.22, 0.06, cosS);
  col += lights * nightMix;
  col += base * vec3(0.25, 0.35, 0.6) * 0.022 * nightMix;

  // Rayleigh haze toward the limb on the sunlit side.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  float hazeLit = smoothstep(-0.25, 0.55, cosS);
  col = mix(col, vec3(0.34, 0.6, 1.0) * 1.15, fres * hazeLit * 0.72);
  col += vec3(1.0, 0.45, 0.2) * fres * twilight * 0.35;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const cloudVertex = earthVertex;

export const cloudFragment = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float opacity;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float c = texture2D(cloudMap, vUv).r;
  float a = smoothstep(0.12, 0.95, c);
  float cosS = dot(N, normalize(sunDir));
  float lit = smoothstep(-0.18, 0.35, cosS);
  float twilight = smoothstep(-0.3, 0.0, cosS) * (1.0 - smoothstep(0.0, 0.3, cosS));
  vec3 color = mix(vec3(0.03, 0.04, 0.07), vec3(1.0), lit);
  color = mix(color, vec3(1.0, 0.62, 0.38), twilight * 0.7);
  // Clouds thin out at the limb so the atmosphere glow can show through.
  float limb = smoothstep(0.0, 0.35, dot(N, V));
  gl_FragColor = vec4(color, a * mix(0.08, 0.95, lit) * limb * opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const atmosphereVertex = /* glsl */ `
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Halo outside the planet: brightness from how close the view ray passes to the surface.
export const atmosphereFragment = /* glsl */ `
uniform vec3 sunDir;
uniform float shellRadius;
varying vec3 vPosW;
void main() {
  vec3 dir = normalize(vPosW - cameraPosition);
  float t = dot(-cameraPosition, dir);
  vec3 closest = cameraPosition + dir * t;
  float d = length(closest);
  float h = clamp((d - 1.0) / (shellRadius - 1.0), 0.0, 1.0);
  float glow = exp(-h * 5.5) * (1.0 - smoothstep(0.85, 1.0, h));
  float s = dot(normalize(closest), normalize(sunDir));
  float lit = smoothstep(-0.45, 0.35, s);
  vec3 dayCol = vec3(0.3, 0.58, 1.0);
  vec3 duskCol = vec3(1.0, 0.48, 0.22);
  vec3 col = mix(duskCol, dayCol, smoothstep(-0.1, 0.45, s));
  float a = glow * (0.06 + lit * 1.05);
  gl_FragColor = vec4(col * a * 1.25, a);
}`;

export const pillarVertex = /* glsl */ `
attribute vec3 instanceTint;
attribute float instanceGlow;
varying float vH;
varying vec3 vColor;
varying float vGlow;
void main() {
  vH = position.y;
  vColor = instanceTint;
  vGlow = instanceGlow;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

export const pillarFragment = /* glsl */ `
varying float vH;
varying vec3 vColor;
varying float vGlow;
void main() {
  float a = pow(1.0 - vH, 1.6) * (0.55 + vGlow * 0.45);
  gl_FragColor = vec4(vColor * a * (1.2 + vGlow), a);
}`;

export const markerVertex = /* glsl */ `
attribute vec3 instanceTint;
attribute float instancePhase;
attribute float instanceGlow;
varying vec2 vUv;
varying vec3 vColor;
varying float vPhase;
varying float vGlow;
void main() {
  vUv = uv;
  vColor = instanceTint;
  vPhase = instancePhase;
  vGlow = instanceGlow;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

export const markerFragment = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying vec3 vColor;
varying float vPhase;
varying float vGlow;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = (1.0 - smoothstep(0.1, 0.2, r));
  float halo = exp(-r * 4.0) * 0.55;
  float speed = 0.45 + vGlow * 0.5;
  float p = fract(time * speed + vPhase);
  float ring = (1.0 - smoothstep(0.0, 0.06, abs(r - p))) * (1.0 - p) * (0.35 + vGlow * 0.65);
  float a = clamp(core + halo + ring, 0.0, 1.0) * (1.0 - smoothstep(0.92, 1.0, r));
  vec3 c = mix(vColor, vec3(1.0), core * 0.55);
  gl_FragColor = vec4(c * a, a);
}`;

export const arcVertex = /* glsl */ `
attribute float aT;
attribute float aOffset;
attribute vec3 aColor;
varying float vT;
varying float vOffset;
varying vec3 vColor;
void main() {
  vT = aT;
  vOffset = aOffset;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const arcFragment = /* glsl */ `
uniform float time;
varying float vT;
varying float vOffset;
varying vec3 vColor;
void main() {
  float head = fract(time * 0.28 + vOffset);
  float d = head - vT;
  if (d < 0.0) d += 1.0;
  float trail = exp(-d * 9.0);
  float ends = smoothstep(0.0, 0.04, vT) * (1.0 - smoothstep(0.96, 1.0, vT));
  float a = (0.16 + trail * 0.95) * ends;
  gl_FragColor = vec4(vColor * a * 1.3, a);
}`;

export const focusFragment = /* glsl */ `
uniform float time;
uniform vec3 color;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float p = fract(time * 0.6);
  float ring1 = (1.0 - smoothstep(0.0, 0.035, abs(r - 0.55)));
  float ring2 = (1.0 - smoothstep(0.0, 0.05, abs(r - p))) * (1.0 - p);
  float center = (1.0 - smoothstep(0.05, 0.1, r));
  float a = clamp(ring1 * 0.9 + ring2 * 0.8 + center, 0.0, 1.0) * (1.0 - smoothstep(0.95, 1.0, r));
  gl_FragColor = vec4(color * a * 1.4, a);
}`;
