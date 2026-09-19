/* Nebula background — performance-tuned version
 * Drop-in replacement for the inline nebula <script>.
 * Load with: <script src="nebula.js" defer></script>
 */
(function () {
  const canvas = document.getElementById('nebula-canvas');
  if (!canvas) return;

  // ---- Tuning knobs ------------------------------------------------------
  const TARGET_FPS = 30;                          // the drift is very slow; 30fps looks the same as 144
  const QUALITY_LEVELS = [0.66, 0.5, 0.35, 0.25]; // render resolution as a fraction of the window size
  const SLOW_FRAME_MS = 1000 / 20;                // averaging slower than 20fps? drop a quality level
  const SAMPLE_FRAMES = 45;                       // frames to average before deciding
  const WARMUP_FRAMES = 30;                       // ignore the busy first second after page load
  // ------------------------------------------------------------------------

  const gl = canvas.getContext('webgl', {
    alpha: false,       // opaque canvas = cheaper compositing
    antialias: false,   // a full-screen quad gains nothing from MSAA
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false
  });
  if (!gl) return; // no WebGL: the body's background colour shows instead

  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

  const fs = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    uniform float t;
    uniform vec2 res;

    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float hash2(vec2 p){return fract(sin(dot(p,vec2(269.5,183.3)))*43758.5453);}

    float noise(vec2 p){
      vec2 i=floor(p),f=fract(p);
      vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
                 mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
    }

    // The warp fields only steer the shape, so 3 octaves is plenty there.
    float fbm3(vec2 p){
      float v=0.0,a=0.5;
      for(int i=0;i<3;i++){v+=a*noise(p);p=p*2.1+vec2(1.3,0.7);a*=0.5;}
      return v;
    }
    // The final layer is what you actually see, so it keeps all 4.
    float fbm4(vec2 p){
      float v=0.0,a=0.5;
      for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.1+vec2(1.3,0.7);a*=0.5;}
      return v;
    }

    float star(vec2 uv, float grid, float threshold, float size){
      vec2 cell=floor(uv*grid);
      vec2 local=fract(uv*grid)-0.5;
      float rng=hash(cell);
      if(rng<threshold) return 0.0;
      vec2 offset=vec2(hash2(cell)-0.5, hash(cell+vec2(7.3,2.1))-0.5)*0.6;
      float d=length(local-offset);
      return smoothstep(size, 0.0, d);
    }

    void main(){
      vec2 uv=(gl_FragCoord.xy/res)*2.0-1.0;
      uv.x*=res.x/res.y;
      float s=t*0.035;

      vec2 q=vec2(fbm3(uv+s), fbm3(uv+vec2(1.7,9.2)+s*0.8));
      vec2 r=vec2(fbm3(uv+1.5*q+vec2(1.7,9.2)+s*0.5),
                  fbm3(uv+1.5*q+vec2(8.3,2.8)+s*0.3));
      float f=fbm4(uv+1.5*r);

      vec3 col=vec3(0.01,0.01,0.06);
      col=mix(col, vec3(0.1,0.03,0.22), clamp(f*2.5,0.0,1.0));
      col=mix(col, vec3(0.0,0.2,0.35), clamp(f*f*3.5,0.0,1.0));
      col=mix(col, vec3(0.15,0.35,0.55), clamp(pow(f,6.0)*4.0,0.0,1.0));

      col+=vec3(0.7,0.8,1.0)*star(uv, 80.0, 0.92, 0.04)*0.9;
      col+=vec3(0.5,0.6,0.9)*star(uv, 200.0, 0.96, 0.018)*0.5;
      col+=vec3(0.4,0.5,0.8)*star(uv, 400.0, 0.975, 0.01)*0.3;

      float v=1.0-length(uv)*0.45;
      col*=max(v,0.0);

      gl_FragColor=vec4(col,1.0);
    }`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('Nebula shader error:', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  const vsh = compile(gl.VERTEX_SHADER, vs);
  const fsh = compile(gl.FRAGMENT_SHADER, fs);
  if (!vsh || !fsh) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vsh);
  gl.attachShader(prog, fsh);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('Nebula link error:', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pLoc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(pLoc);
  gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

  const tLoc = gl.getUniformLocation(prog, 't');
  const resLoc = gl.getUniformLocation(prog, 'res');

  // ---- Sizing: render small, let CSS stretch it to full screen -------------
  let level = 0;

  function resize() {
    const scale = QUALITY_LEVELS[level];
    const w = Math.max(1, Math.round(window.innerWidth * scale));
    const h = Math.max(1, Math.round(window.innerHeight * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(resLoc, w, h);
  }

  const t0 = performance.now();
  function draw(now) {
    gl.uniform1f(tLoc, (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---- Animation loop with frame cap + adaptive quality -------------------
  const frameInterval = 1000 / TARGET_FPS;
  let running = false;
  let gaveUp = false;   // true if even the lowest quality was too slow
  let rafId = 0;
  let last = 0;
  let warmup = WARMUP_FRAMES;
  let sampleStart = 0;
  let sampleCount = 0;

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (now - last < frameInterval - 2) return; // not time for a new frame yet
    last = now;
    draw(now);

    if (warmup > 0) { warmup--; return; }

    if (sampleCount === 0) sampleStart = now;
    sampleCount++;
    if (sampleCount > SAMPLE_FRAMES) {
      const avg = (now - sampleStart) / (sampleCount - 1);
      sampleCount = 0;
      if (avg > SLOW_FRAME_MS) {
        if (level < QUALITY_LEVELS.length - 1) {
          level++;
          resize();
        } else {
          // Machine can't keep up even at the lowest quality:
          // freeze on the current frame instead of making the whole site lag.
          gaveUp = true;
          stop();
        }
      }
    }
  }

  function start() {
    if (running || gaveUp) return;
    running = true;
    sampleCount = 0;
    warmup = 5; // brief settle after resuming
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  // ---- Respect reduced-motion and hidden tabs ------------------------------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function applyState() {
    if (document.hidden) { stop(); return; }
    if (reduceMotion.matches || gaveUp) {
      stop();
      draw(performance.now()); // one still frame
    } else {
      start();
    }
  }

  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', applyState);
  document.addEventListener('visibilitychange', applyState);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (!running) draw(performance.now());
    }, 150);
  });

  resize();
  applyState();
})();
