import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { geoBounds, geoContains, geoEquirectangular, geoPath } from "d3-geo";
import type { Feature, Geometry, MultiLineString } from "geojson";
import * as S from "./shaders";
import { subsolarPoint } from "../lib/sun";

export interface BeaconDatum {
  code: string;
  lat: number;
  lng: number;
  count: number;
  /** Drives pillar height: the country's own stories plus mentions in other countries' headlines. */
  weight: number;
  color: string;
  breaking: boolean;
}

export interface ArcDatum {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  color: string;
  weight: number;
}

export interface LabelDatum {
  code: string;
  lat: number;
  lng: number;
  name: string;
  count: number;
  priority: number;
}

export interface GlobeOptions {
  clouds: boolean;
  borders: boolean;
  beacons: boolean;
  arcs: boolean;
  realSun: boolean;
  autoRotate: boolean;
  labels: boolean;
  ultra: boolean;
}

export interface GlobeEvents {
  onHover: (code: string | null, x: number, y: number) => void;
  onClick: (code: string | null) => void;
  onProgress: (p: number) => void;
  onReady: () => void;
  onUserInteract: () => void;
}

const R = 1;
const DEG = Math.PI / 180;

export function latLngToVec3(lat: number, lng: number, r = R, out = new THREE.Vector3()) {
  const phi = (90 - lat) * DEG;
  const theta = (lng + 180) * DEG;
  return out.set(-Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r);
}

export function vec3ToLatLng(v: THREE.Vector3) {
  const n = v.clone().normalize();
  const lat = 90 - Math.acos(n.y) / DEG;
  let lng = Math.atan2(n.z, -n.x) / DEG - 180;
  if (lng < -180) lng += 360;
  return { lat, lng };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

interface CountryShape {
  code: string;
  feature: Feature<Geometry>;
  bounds: [[number, number], [number, number]];
}

interface BeaconState extends BeaconDatum {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  height: number;
  target: number;
  born: number;
}

export class GlobeEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private earth!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private clouds!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private atmosphere!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sunSprite!: THREE.Sprite;
  private borders?: THREE.LineSegments;
  private overlayCanvas = document.createElement("canvas");
  private overlayTex: THREE.CanvasTexture;
  private overlay: THREE.Mesh;
  private hoverOutline?: LineSegments2;
  private selectOutline?: LineSegments2;
  private outlineMats: LineMaterial[] = [];

  private pillars?: THREE.InstancedMesh;
  private markers?: THREE.InstancedMesh;
  private markerMat: THREE.ShaderMaterial;
  private pillarMat: THREE.ShaderMaterial;
  private beacons: BeaconState[] = [];
  private beaconsAnimating = false;
  private beaconScale = 1;

  private arcs?: THREE.LineSegments;
  private arcMat: THREE.ShaderMaterial;
  private focus: THREE.Mesh;
  private focusMat: THREE.ShaderMaterial;

  private shapes: CountryShape[] = [];
  private shapeByCode = new Map<string, CountryShape[]>();
  private heat: Record<string, number> | null = null;
  private heatColor = "#FFB45E";

  private labelLayer: HTMLElement;
  private labels = new Map<string, { el: HTMLDivElement; datum: LabelDatum; vis: number }>();

  private opts: GlobeOptions;
  private events: GlobeEvents;
  private hovered: string | null = null;
  private selected: string | null = null;
  private flight: null | { start: number; dur: number; fromDir: THREE.Vector3; q: THREE.Quaternion; fromDist: number; toDist: number; hop: number; done?: () => void } = null;
  private lastInteraction = 0;
  private sunDir = new THREE.Vector3(1, 0, 0);
  private sunUpdated = 0;
  private insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private offsetX = 0;
  private offsetY = 0;
  private pointer = { x: 0, y: 0, inside: false, downX: 0, downY: 0, downT: 0, dragging: false };
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private size = { w: 1, h: 1 };
  private resizeObs: ResizeObserver;
  private ultraLoaded = false;
  private texLoader: THREE.TextureLoader;
  private maxAniso: number;

  constructor(private container: HTMLElement, labelLayer: HTMLElement, opts: GlobeOptions, events: GlobeEvents) {
    this.opts = opts;
    this.events = events;
    this.labelLayer = labelLayer;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 2000);
    // Open on the visitor's side of the world, guessed from their timezone.
    const guessLng = -new Date().getTimezoneOffset() / 4;
    latLngToVec3(18, guessLng - 25, 8.5, this.camera.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 1.16;
    this.controls.maxDistance = 9;
    this.controls.zoomSpeed = 0.7;
    this.controls.rotateSpeed = 0.5;
    this.controls.autoRotateSpeed = 0.28;
    this.controls.enabled = false;
    this.controls.addEventListener("start", () => {
      this.lastInteraction = performance.now();
      this.flight = null;
      this.events.onUserInteract();
    });

    const manager = new THREE.LoadingManager();
    manager.onProgress = (_u, loaded, total) => this.events.onProgress(loaded / total);
    manager.onLoad = () => this.intro();
    this.texLoader = new THREE.TextureLoader(manager);

    this.overlayCanvas.width = 4096;
    this.overlayCanvas.height = 2048;
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.overlayTex.anisotropy = this.maxAniso;
    this.overlay = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.0009, 128, 64),
      new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false, toneMapped: false })
    );
    this.overlay.renderOrder = 2;

    this.markerMat = new THREE.ShaderMaterial({
      vertexShader: S.markerVertex, fragmentShader: S.markerFragment, uniforms: { time: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.pillarMat = new THREE.ShaderMaterial({
      vertexShader: S.pillarVertex, fragmentShader: S.pillarFragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.arcMat = new THREE.ShaderMaterial({
      vertexShader: S.arcVertex, fragmentShader: S.arcFragment, uniforms: { time: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.focusMat = new THREE.ShaderMaterial({
      vertexShader: S.earthVertex, fragmentShader: S.focusFragment,
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color("#FFB45E") } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.focus = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), this.focusMat);
    this.focus.visible = false;
    this.focus.renderOrder = 6;
    this.scene.add(this.focus);

    this.buildScene();
    this.loadGeo();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.bindPointer();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.loop();
  }

  // ------------------------------------------------------------------ scene
  private tex(url: string, srgb = true) {
    const t = this.texLoader.load(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.maxAniso;
    return t;
  }

  private buildScene() {
    const day = this.tex("/textures/earth-day-4k.jpg");
    const night = this.tex("/textures/earth-night-4k.jpg");
    const clouds = this.tex("/textures/earth-clouds-4k.jpg", false);
    const spec = this.tex("/textures/earth-specular-2k.jpg", false);
    const bump = this.tex("/textures/earth-bump-2k.png", false);
    const stars = this.tex("/textures/stars-4k.jpg");

    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(R, 192, 96),
      new THREE.ShaderMaterial({
        vertexShader: S.earthVertex,
        fragmentShader: S.earthFragment,
        uniforms: {
          dayMap: { value: day }, nightMap: { value: night }, specMap: { value: spec }, bumpMap: { value: bump }, cloudMap: { value: clouds },
          sunDir: { value: this.sunDir }, cloudShift: { value: 0 }, cloudsOn: { value: 1 }, bumpTexel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) },
        },
      })
    );
    this.scene.add(this.earth);
    this.scene.add(this.overlay);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.006, 160, 80),
      new THREE.ShaderMaterial({
        vertexShader: S.cloudVertex, fragmentShader: S.cloudFragment,
        uniforms: { cloudMap: { value: clouds }, sunDir: { value: this.sunDir }, opacity: { value: 1 } },
        transparent: true, depthWrite: false,
      })
    );
    this.clouds.renderOrder = 5;
    this.scene.add(this.clouds);

    const shellRadius = R * 1.075;
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(shellRadius, 96, 48),
      new THREE.ShaderMaterial({
        vertexShader: S.atmosphereVertex, fragmentShader: S.atmosphereFragment,
        uniforms: { sunDir: { value: this.sunDir }, shellRadius: { value: shellRadius } },
        side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    this.atmosphere.renderOrder = 7;
    this.scene.add(this.atmosphere);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 64, 32),
      new THREE.MeshBasicMaterial({ map: stars, side: THREE.BackSide, color: new THREE.Color(0.42, 0.44, 0.5), toneMapped: false, depthWrite: false })
    );
    sky.rotation.set(0.5, 0, 0.3);
    this.scene.add(sky);

    // Soft sun disc; the planet occludes it naturally through the depth buffer.
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(255,250,240,1)");
    grad.addColorStop(0.06, "rgba(255,240,215,0.95)");
    grad.addColorStop(0.18, "rgba(255,200,140,0.28)");
    grad.addColorStop(0.5, "rgba(255,170,100,0.06)");
    grad.addColorStop(1, "rgba(255,160,90,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const sunTex = new THREE.CanvasTexture(c);
    sunTex.colorSpace = THREE.SRGBColorSpace;
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true }));
    this.sunSprite.scale.setScalar(60);
    this.scene.add(this.sunSprite);
  }

  private async loadGeo() {
    const topo = (await fetch("/geo/countries-50m.json").then((r) => r.json())) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    const { COUNTRY_CODE_BY_NUMERIC } = await import("./numeric");
    const fc = feature(topo, topo.objects.countries);
    for (const f of fc.features) {
      const code = (f.id && COUNTRY_CODE_BY_NUMERIC[String(f.id)]) || COUNTRY_CODE_BY_NUMERIC[(f.properties as { name: string }).name];
      if (!code) continue;
      const shape = { code, feature: f as Feature<Geometry>, bounds: geoBounds(f) as [[number, number], [number, number]] };
      this.shapes.push(shape);
      const list = this.shapeByCode.get(code) || [];
      list.push(shape);
      this.shapeByCode.set(code, list);
    }

    const borderMesh = mesh(topo, topo.objects.countries) as MultiLineString;
    const pos: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const line of borderMesh.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        latLngToVec3(line[i][1], line[i][0], R * 1.0012, a);
        latLngToVec3(line[i + 1][1], line[i + 1][0], R * 1.0012, b);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.borders = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.16, depthWrite: false }));
    this.borders.renderOrder = 3;
    this.borders.visible = this.opts.borders;
    this.scene.add(this.borders);
    this.drawOverlay();
    if (this.selected) this.setSelected(this.selected);
  }

  // ------------------------------------------------------------------ intro & loop
  private intro() {
    this.events.onReady();
    const target = this.camera.position.clone().normalize();
    this.flyToDir(target, this.fitDistance(), 3200);
    if (this.opts.ultra) setTimeout(() => this.loadUltra(), 2500);
  }

  private loadUltra() {
    if (this.ultraLoaded || this.disposed || this.renderer.capabilities.maxTextureSize < 8192) return;
    this.ultraLoaded = true;
    const loader = new THREE.TextureLoader();
    const u = this.earth.material.uniforms;
    for (const [key, url] of [["dayMap", "/textures/earth-day-8k.jpg"], ["nightMap", "/textures/earth-night-8k.jpg"]] as const) {
      loader.load(url, (t) => {
        if (this.disposed) return t.dispose();
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = this.maxAniso;
        const old = u[key].value as THREE.Texture;
        u[key].value = t;
        old.dispose();
      });
    }
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else { this.clock.getDelta(); this.loop(); }
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.tick(dt, t);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  };

  private tick(dt: number, t: number) {
    const now = performance.now();

    if (this.flight) {
      const f = this.flight;
      const p = Math.min(1, (now - f.start) / f.dur);
      const e = easeInOut(p);
      const q = new THREE.Quaternion().slerp(f.q, e);
      const dir = f.fromDir.clone().applyQuaternion(q);
      const dist = THREE.MathUtils.lerp(f.fromDist, f.toDist, e) + Math.sin(Math.PI * p) * f.hop;
      this.camera.position.copy(dir.multiplyScalar(dist));
      this.camera.lookAt(0, 0, 0);
      if (p >= 1) {
        const done = f.done;
        this.flight = null;
        this.controls.enabled = true;
        this.controls.update();
        done?.();
      }
    } else {
      const dist = this.camera.position.length();
      // Slow the drag as the camera gets close so the surface does not whip past.
      this.controls.rotateSpeed = THREE.MathUtils.clamp((dist - 1) * 0.42, 0.04, 0.6);
      this.controls.autoRotate = this.opts.autoRotate && !this.selected && now - this.lastInteraction > 9000 && !this.pointer.dragging;
      this.controls.update();
    }

    // Sun: real position updated each second, or a fixed key light over the viewer's shoulder.
    if (this.opts.realSun) {
      if (now - this.sunUpdated > 1000) {
        const s = subsolarPoint();
        latLngToVec3(s.lat, s.lng, 1, this.sunDir);
        this.sunUpdated = now;
      }
    } else {
      const camDir = this.camera.position.clone().normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camDir).normalize();
      this.sunDir.copy(camDir).addScaledVector(right, -0.75).addScaledVector(new THREE.Vector3(0, 1, 0), 0.45).normalize();
    }
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(220);

    this.clouds.rotation.y += dt * 0.0045;
    const eu = this.earth.material.uniforms;
    eu.cloudShift.value = this.clouds.rotation.y / (2 * Math.PI);
    const cu = this.clouds.material.uniforms;
    const targetOpacity = this.opts.clouds ? Math.min(1, (this.camera.position.length() - 1.1) * 1.4) : 0;
    cu.opacity.value += (targetOpacity - cu.opacity.value) * Math.min(1, dt * 4);
    eu.cloudsOn.value = cu.opacity.value;
    this.clouds.visible = cu.opacity.value > 0.01;

    this.markerMat.uniforms.time.value = t;
    this.arcMat.uniforms.time.value = t;
    this.focusMat.uniforms.time.value = t;

    // Panels slide in and out; ease the globe's optical centre to match.
    const tx = (this.insets.left - this.insets.right) / 2;
    const ty = (this.insets.top - this.insets.bottom) / 2;
    if (Math.abs(tx - this.offsetX) > 0.3 || Math.abs(ty - this.offsetY) > 0.3) {
      this.offsetX += (tx - this.offsetX) * Math.min(1, dt * 6);
      this.offsetY += (ty - this.offsetY) * Math.min(1, dt * 6);
      this.applyViewOffset();
    }

    // Beacons keep a steady on-screen size: larger when zoomed out, finer when close to the surface.
    const bs = THREE.MathUtils.clamp(this.camera.position.length() / 2.1, 0.45, 2.6);
    if (Math.abs(bs - this.beaconScale) > 0.004) { this.beaconScale = bs; this.beaconsAnimating = true; }
    if (this.beaconsAnimating) this.updateBeaconMatrices(now);
  }

  // ------------------------------------------------------------------ camera
  private applyViewOffset() {
    const { w, h } = this.size;
    this.camera.setViewOffset(w, h, -this.offsetX, -this.offsetY, w, h);
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.applyViewOffset();
    this.camera.updateProjectionMatrix();
    for (const m of this.outlineMats) m.resolution.set(w, h);
  }

  /** Camera distance at which the globe fills the space the panels leave free. */
  fitDistance(fill = 0.84) {
    const { w, h } = this.size;
    const availW = Math.max(220, w - this.insets.left - this.insets.right);
    const availH = Math.max(220, h - this.insets.top - this.insets.bottom);
    const pxPerUnit = h / (2 * Math.tan((this.camera.fov / 2) * DEG));
    const k = pxPerUnit / ((fill / 2) * Math.min(availW, availH));
    return THREE.MathUtils.clamp(Math.sqrt(k * k + 1), 1.2, this.controls.maxDistance);
  }

  /** Distance that frames a country of the given size (sqrt of area, as in countries.json). */
  focusDistance(size: number) {
    const { w, h } = this.size;
    const avail = Math.max(220, Math.min(w - this.insets.left - this.insets.right, h - this.insets.top - this.insets.bottom));
    const pxPerUnit = h / (2 * Math.tan((this.camera.fov / 2) * DEG));
    // Seen from straight above, a country of angular radius r spans about pxPerUnit * r / altitude pixels.
    const r = Math.max(0.03, size * 0.0178);
    const d = 1 + (pxPerUnit * r) / (0.28 * avail);
    return THREE.MathUtils.clamp(d, 1.3, Math.min(3, this.fitDistance()));
  }

  setInsets(insets: Partial<typeof this.insets>) {
    this.insets = { ...this.insets, ...insets };
  }

  private flyToDir(toDir: THREE.Vector3, toDist: number, dur?: number, done?: () => void) {
    const fromDist = this.camera.position.length();
    const fromDir = this.camera.position.clone().normalize();
    const angle = fromDir.angleTo(toDir);
    const q = new THREE.Quaternion().setFromUnitVectors(fromDir, toDir.clone().normalize());
    const duration = dur ?? THREE.MathUtils.clamp(900 + angle * 750, 900, 2400);
    const hop = Math.max(0, angle / Math.PI) * Math.min(1.4, Math.max(fromDist, toDist) * 0.45);
    this.controls.enabled = false;
    this.flight = { start: performance.now(), dur: duration, fromDir, q, fromDist, toDist, hop, done };
  }

  flyTo(lat: number, lng: number, dist?: number, done?: () => void) {
    const dir = latLngToVec3(lat, lng, 1);
    const target = dist ?? Math.min(this.camera.position.length(), 2.4);
    this.lastInteraction = performance.now();
    this.flyToDir(dir, target, undefined, done);
  }

  zoomBy(factor: number) {
    const dir = this.camera.position.clone().normalize();
    const d = THREE.MathUtils.clamp(this.camera.position.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.flyToDir(dir, d, 450);
  }

  resetView() {
    const dir = this.camera.position.clone().setY(0.35).normalize();
    this.flyToDir(dir, this.fitDistance(), 1400);
  }

  getView() {
    const ll = vec3ToLatLng(this.camera.position);
    return { ...ll, distance: this.camera.position.length() };
  }

  // ------------------------------------------------------------------ options
  setOptions(o: Partial<GlobeOptions>) {
    this.opts = { ...this.opts, ...o };
    if (this.borders) this.borders.visible = this.opts.borders;
    if (this.pillars) this.pillars.visible = this.opts.beacons;
    if (this.markers) this.markers.visible = this.opts.beacons;
    if (this.arcs) this.arcs.visible = this.opts.arcs;
    if (o.realSun !== undefined) this.sunUpdated = 0;
    if (o.ultra) this.loadUltra();
    if (o.labels === false) for (const l of this.labels.values()) l.el.style.opacity = "0";
  }

  // ------------------------------------------------------------------ beacons
  setBeacons(list: BeaconDatum[]) {
    const now = performance.now();
    const prev = new Map(this.beacons.map((b) => [b.code, b]));
    // Scale against the 90th percentile so one dominant country doesn't flatten the rest.
    const sortedW = list.map((b) => b.weight).sort((a, b) => a - b);
    const max = Math.max(1, sortedW[Math.floor(sortedW.length * 0.9)] || 1);
    this.beacons = list.map((d) => {
      const old = prev.get(d.code);
      const target = 0.018 + 0.085 * Math.min(1.6, Math.pow(d.weight / max, 0.7));
      return {
        ...d,
        pos: latLngToVec3(d.lat, d.lng, R * 1.001),
        normal: latLngToVec3(d.lat, d.lng, 1),
        height: old ? old.height : 0,
        target,
        born: old ? old.born : now + Math.random() * 500,
      };
    });

    const n = this.beacons.length;
    if (!this.pillars || this.pillars.count < n || (this.pillars.instanceMatrix.count as number) < n) {
      this.pillars?.removeFromParent();
      this.markers?.removeFromParent();
      const cap = Math.max(256, n);
      const pg = new THREE.CylinderGeometry(0.0014, 0.0042, 1, 10, 1, true).translate(0, 0.5, 0);
      pg.setAttribute("instanceTint", new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
      pg.setAttribute("instanceGlow", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      this.pillars = new THREE.InstancedMesh(pg, this.pillarMat, cap);
      this.pillars.renderOrder = 8;
      this.pillars.frustumCulled = false;
      const mg = new THREE.PlaneGeometry(1, 1);
      mg.setAttribute("instanceTint", new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
      mg.setAttribute("instancePhase", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      mg.setAttribute("instanceGlow", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      this.markers = new THREE.InstancedMesh(mg, this.markerMat, cap);
      this.markers.renderOrder = 4;
      this.markers.frustumCulled = false;
      this.scene.add(this.pillars, this.markers);
    }
    this.pillars.count = n;
    this.markers!.count = n;
    this.pillars.visible = this.markers!.visible = this.opts.beacons;

    const col = new THREE.Color();
    const pt = this.pillars.geometry.getAttribute("instanceTint") as THREE.InstancedBufferAttribute;
    const mt = this.markers!.geometry.getAttribute("instanceTint") as THREE.InstancedBufferAttribute;
    const ph = this.markers!.geometry.getAttribute("instancePhase") as THREE.InstancedBufferAttribute;
    this.beacons.forEach((b, i) => {
      col.set(b.color);
      pt.setXYZ(i, col.r, col.g, col.b);
      mt.setXYZ(i, col.r, col.g, col.b);
      ph.setX(i, (i * 0.618) % 1);
    });
    pt.needsUpdate = mt.needsUpdate = ph.needsUpdate = true;
    this.refreshGlow();
    this.beaconsAnimating = true;
  }

  private refreshGlow() {
    if (!this.pillars || !this.markers) return;
    const pg = this.pillars.geometry.getAttribute("instanceGlow") as THREE.InstancedBufferAttribute;
    const mg = this.markers.geometry.getAttribute("instanceGlow") as THREE.InstancedBufferAttribute;
    this.beacons.forEach((b, i) => {
      const g = b.code === this.selected ? 1 : b.code === this.hovered ? 0.8 : b.breaking ? 0.45 : 0;
      pg.setX(i, g);
      mg.setX(i, g);
    });
    pg.needsUpdate = mg.needsUpdate = true;
    this.beaconsAnimating = true;
  }

  private updateBeaconMatrices(now: number) {
    if (!this.pillars || !this.markers) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1);
    let animating = false;
    this.beacons.forEach((b, i) => {
      const p = THREE.MathUtils.clamp((now - b.born) / 900, 0, 1);
      const grow = p <= 0 ? 0 : easeOutBack(p);
      const desired = b.target * grow;
      if (Math.abs(b.height - desired) > 0.0005 || p < 1) animating = true;
      b.height += (desired - b.height) * 0.2;
      const boost = b.code === this.selected ? 1.35 : b.code === this.hovered ? 1.2 : 1;
      q.setFromUnitVectors(up, b.normal);
      const k = this.beaconScale;
      s.set(boost * k, Math.max(0.0001, b.height * boost * Math.sqrt(k)), boost * k);
      m.compose(b.pos, q, s);
      this.pillars!.setMatrixAt(i, m);
      q.setFromUnitVectors(fwd, b.normal);
      const ms = (0.03 + b.target * 0.22) * boost * k * Math.min(1, grow + 0.001);
      s.set(ms, ms, ms);
      m.compose(b.pos, q, s);
      this.markers!.setMatrixAt(i, m);
    });
    this.pillars.instanceMatrix.needsUpdate = true;
    this.markers.instanceMatrix.needsUpdate = true;
    this.beaconsAnimating = animating;
  }

  // ------------------------------------------------------------------ arcs
  setArcs(list: ArcDatum[]) {
    this.arcs?.removeFromParent();
    this.arcs?.geometry.dispose();
    this.arcs = undefined;
    if (!list.length) return;
    const pos: number[] = [], ts: number[] = [], offs: number[] = [], cols: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), prev = new THREE.Vector3();
    const col = new THREE.Color();
    const SEG = 64;
    list.forEach((arc, idx) => {
      latLngToVec3(arc.from.lat, arc.from.lng, 1, a);
      latLngToVec3(arc.to.lat, arc.to.lng, 1, b);
      const angle = a.angleTo(b);
      const lift = 0.025 + 0.17 * (angle / Math.PI);
      const q = new THREE.Quaternion().setFromUnitVectors(a, b);
      const off = (idx * 0.37) % 1;
      col.set(arc.color);
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        p.copy(a).applyQuaternion(new THREE.Quaternion().slerp(q, t)).multiplyScalar(R * 1.002 + Math.sin(Math.PI * t) * lift);
        if (i > 0) {
          pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
          ts.push((i - 1) / SEG, t);
          offs.push(off, off);
          cols.push(col.r, col.g, col.b, col.r, col.g, col.b);
        }
        prev.copy(p);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    geo.setAttribute("aOffset", new THREE.Float32BufferAttribute(offs, 1));
    geo.setAttribute("aColor", new THREE.Float32BufferAttribute(cols, 3));
    this.arcs = new THREE.LineSegments(geo, this.arcMat);
    this.arcs.renderOrder = 9;
    this.arcs.visible = this.opts.arcs;
    this.scene.add(this.arcs);
  }

  // ------------------------------------------------------------------ highlight / overlay
  private outlineFor(code: string, color: string, width: number, opacity: number) {
    const shapes = this.shapeByCode.get(code);
    if (!shapes) return undefined;
    const pos: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const s of shapes) {
      const g = s.feature.geometry;
      const polys = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
      for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
        latLngToVec3(ring[i][1], ring[i][0], R * 1.0022, a);
        latLngToVec3(ring[i + 1][1], ring[i + 1][0], R * 1.0022, b);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geo = new LineSegmentsGeometry().setPositions(pos);
    const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: true, opacity, depthWrite: false });
    mat.resolution.set(this.size.w, this.size.h);
    this.outlineMats.push(mat);
    const line = new LineSegments2(geo, mat);
    line.renderOrder = 4;
    this.scene.add(line);
    return line;
  }

  private dropOutline(line?: LineSegments2) {
    if (!line) return;
    line.removeFromParent();
    line.geometry.dispose();
    const mat = line.material as LineMaterial;
    this.outlineMats = this.outlineMats.filter((m) => m !== mat);
    mat.dispose();
  }

  setHovered(code: string | null) {
    if (code === this.hovered) return;
    this.hovered = code;
    this.dropOutline(this.hoverOutline);
    this.hoverOutline = code && code !== this.selected ? this.outlineFor(code, "#ffffff", 1.4, 0.55) : undefined;
    this.renderer.domElement.style.cursor = code ? "pointer" : "grab";
    this.drawOverlay();
    this.refreshGlow();
  }

  setSelected(code: string | null) {
    this.selected = code;
    this.dropOutline(this.selectOutline);
    this.selectOutline = code ? this.outlineFor(code, "#FFB45E", 2.2, 0.95) : undefined;
    if (code === this.hovered) { this.dropOutline(this.hoverOutline); this.hoverOutline = undefined; }
    this.drawOverlay();
    this.refreshGlow();
  }

  setHeat(heat: Record<string, number> | null, color = "#FFB45E") {
    this.heat = heat;
    this.heatColor = color;
    this.drawOverlay();
  }

  private drawOverlay() {
    const c = this.overlayCanvas, g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    const proj = geoEquirectangular().scale(c.width / (2 * Math.PI)).translate([c.width / 2, c.height / 2]);
    const path = geoPath(proj, g);
    const fill = (code: string, style: string) => {
      for (const s of this.shapeByCode.get(code) || []) {
        g.beginPath();
        path(s.feature);
        g.fillStyle = style;
        g.fill();
      }
    };
    if (this.heat) {
      const col = new THREE.Color(this.heatColor);
      const [r, gg, b] = [col.r, col.g, col.b].map((v) => Math.round(Math.pow(v, 1 / 2.2) * 255));
      for (const [code, v] of Object.entries(this.heat)) fill(code, `rgba(${r},${gg},${b},${(0.03 + Math.pow(v, 1.4) * 0.46).toFixed(3)})`);
    }
    if (this.selected) fill(this.selected, "rgba(255,180,94,0.22)");
    if (this.hovered && this.hovered !== this.selected) fill(this.hovered, "rgba(255,255,255,0.10)");
    this.overlayTex.needsUpdate = true;
  }

  setFocus(point: { lat: number; lng: number } | null, color = "#FFB45E") {
    if (!point) { this.focus.visible = false; return; }
    const n = latLngToVec3(point.lat, point.lng, 1);
    this.focus.position.copy(n).multiplyScalar(R * 1.003);
    this.focus.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.focusMat.uniforms.color.value.set(color);
    this.focus.visible = true;
  }

  // ------------------------------------------------------------------ labels
  setLabels(list: LabelDatum[]) {
    const keep = new Set(list.map((l) => l.code));
    for (const [code, l] of this.labels) if (!keep.has(code)) { l.el.remove(); this.labels.delete(code); }
    for (const d of list) {
      let l = this.labels.get(d.code);
      if (!l) {
        const el = document.createElement("div");
        el.className = "glabel";
        el.innerHTML = `<span class="glabel-name"></span><span class="glabel-count"></span>`;
        el.addEventListener("click", () => this.events.onClick(d.code));
        el.addEventListener("pointerenter", () => this.events.onHover(d.code, -1, -1));
        el.addEventListener("pointerleave", () => this.events.onHover(null, -1, -1));
        this.labelLayer.appendChild(el);
        l = { el, datum: d, vis: 0 };
        this.labels.set(d.code, l);
      }
      l.datum = d;
      (l.el.firstChild as HTMLElement).textContent = d.name;
      (l.el.lastChild as HTMLElement).textContent = d.count ? String(d.count) : "";
    }
  }

  private updateLabels() {
    if (!this.labels.size) return;
    const camPos = this.camera.position;
    const dist = camPos.length();
    const v = new THREE.Vector3(), toCam = new THREE.Vector3();
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const sorted = [...this.labels.values()].sort((a, b) => b.datum.priority - a.datum.priority);
    // Zoomed out, only the busiest countries are named; zooming in reveals more.
    const budget = dist > 2.6 ? 9 : dist > 1.8 ? 22 : 60;
    let shown = 0;
    for (const l of sorted) {
      latLngToVec3(l.datum.lat, l.datum.lng, R * 1.004, v);
      toCam.copy(camPos).sub(v).normalize();
      const facing = v.clone().normalize().dot(toCam);
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.size.w;
      const y = (-v.y * 0.5 + 0.5) * this.size.h;
      const w = l.datum.name.length * 7 + 34, h = 22;
      let visible = this.opts.labels && facing > 0.28 && shown < budget && x > 0 && x < this.size.w && y > 0 && y < this.size.h;
      const forced = l.datum.code === this.selected || l.datum.code === this.hovered;
      if (visible || (forced && facing > 0.1)) {
        const rect = { x: x + 10, y: y - 11, w, h };
        const overlaps = placed.some((p) => rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y);
        if (overlaps && !forced) visible = false;
        else { placed.push(rect); visible = true; shown++; }
      } else visible = false;
      const target = visible ? Math.min(1, (facing - 0.1) * 3) : 0;
      l.vis += (target - l.vis) * 0.18;
      l.el.style.opacity = l.vis.toFixed(3);
      l.el.style.pointerEvents = l.vis > 0.5 ? "auto" : "none";
      l.el.style.transform = `translate3d(${(x + 12).toFixed(1)}px, ${(y - 11).toFixed(1)}px, 0)`;
      l.el.classList.toggle("is-active", forced);
    }
  }

  /** Screen position of a point on the globe, or null if it is on the far side. */
  project(lat: number, lng: number) {
    const v = latLngToVec3(lat, lng, R * 1.01);
    const facing = v.clone().normalize().dot(this.camera.position.clone().sub(v).normalize());
    if (facing < 0.05) return null;
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.size.w, y: (-v.y * 0.5 + 0.5) * this.size.h };
  }

  // ------------------------------------------------------------------ picking
  private bindPointer() {
    const el = this.renderer.domElement;
    el.style.cursor = "grab";
    el.style.touchAction = "none";
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("dblclick", this.onDblClick);
  }

  private pickAt(x: number, y: number): string | null {
    // Beacons first: small island states are easier to hit by their marker than their outline.
    let best: string | null = null, bestD = 18;
    const v = new THREE.Vector3(), toCam = new THREE.Vector3();
    if (this.opts.beacons) for (const b of this.beacons) {
      v.copy(b.pos);
      toCam.copy(this.camera.position).sub(v).normalize();
      if (b.normal.dot(toCam) < 0.1) continue;
      v.project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * this.size.w, sy = (-v.y * 0.5 + 0.5) * this.size.h;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) { bestD = d; best = b.code; }
    }
    if (best) return best;

    this.ndc.set((x / this.size.w) * 2 - 1, -(y / this.size.h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.earth, false)[0];
    if (!hit) return null;
    const { lat, lng } = vec3ToLatLng(hit.point);
    for (const s of this.shapes) {
      const [[x0, y0], [x1, y1]] = s.bounds;
      const inLng = x0 <= x1 ? lng >= x0 && lng <= x1 : lng >= x0 || lng <= x1;
      if (lat < y0 || lat > y1 || !inLng) continue;
      if (geoContains(s.feature, [lng, lat])) return s.code;
    }
    return "";
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = e.clientX - r.left;
    this.pointer.y = e.clientY - r.top;
    this.pointer.inside = true;
    if (e.buttons) {
      if (Math.hypot(e.clientX - this.pointer.downX, e.clientY - this.pointer.downY) > 4) {
        this.pointer.dragging = true;
        this.renderer.domElement.style.cursor = "grabbing";
      }
      return;
    }
    if (e.pointerType === "touch") return;
    const code = this.pickAt(this.pointer.x, this.pointer.y) || null;
    this.setHovered(code);
    this.events.onHover(code, e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent) => {
    this.pointer.downX = e.clientX;
    this.pointer.downY = e.clientY;
    this.pointer.downT = performance.now();
    this.pointer.dragging = false;
    this.lastInteraction = performance.now();
  };

  private onPointerUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.pointer.downX, e.clientY - this.pointer.downY);
    this.renderer.domElement.style.cursor = this.hovered ? "pointer" : "grab";
    this.lastInteraction = performance.now();
    if (moved < 6 && performance.now() - this.pointer.downT < 500) {
      const r = this.renderer.domElement.getBoundingClientRect();
      const code = this.pickAt(e.clientX - r.left, e.clientY - r.top);
      if (code !== null) this.events.onClick(code || null);
    }
    this.pointer.dragging = false;
  };

  private onPointerLeave = () => {
    this.pointer.inside = false;
    this.setHovered(null);
    this.events.onHover(null, 0, 0);
  };

  private onDblClick = (e: MouseEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / this.size.w) * 2 - 1, -((e.clientY - r.top) / this.size.h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.earth, false)[0];
    if (!hit) return;
    const d = Math.max(this.controls.minDistance + 0.05, this.camera.position.length() * 0.6);
    this.flyToDir(hit.point.clone().normalize(), d, 900);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const l of this.labels.values()) l.el.remove();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
        if ((mat as THREE.ShaderMaterial).uniforms) for (const u of Object.values((mat as THREE.ShaderMaterial).uniforms)) if (u.value instanceof THREE.Texture) u.value.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
