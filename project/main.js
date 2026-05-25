
// ---------- Wrapper matrici/vettori → m4.js (Gregg Tavares' webgl-3d-math) ----------
// Le funzioni custom sono sostituite con le equivalenti della libreria m4.js
// che espone tutto sotto l'oggetto globale `m4`.

// Moltiplicazione matrici 4x4  (m4.multiply)
const mat4Mul      = (a, b)           => m4.multiply(a, b);
// Matrice di traslazione  (m4.translation)
const mat4Translate = (tx, ty, tz)    => m4.translation(tx, ty, tz);
// Matrice di scala  (m4.scaling)
const mat4Scale    = (sx, sy, sz)     => m4.scaling(sx, sy, sz);
// Rotazione attorno all'asse Y  (m4.yRotation)
const mat4RotateY  = (rad)            => m4.yRotation(rad);
// Rotazione attorno all'asse X  (m4.xRotation)
const mat4RotateX  = (rad)            => m4.xRotation(rad);
// Matrice di proiezione prospettica  (m4.perspective)
const mat4Perspective = (fovy, aspect, near, far) => m4.perspective(fovy, aspect, near, far);
// Trasforma un punto 3D con una matrice 4x4  (m4.transformPoint)
const mat4TransformPoint = (mat, p)   => m4.transformPoint(mat, p);

// Matrice vista (view matrix)
// m4.lookAt restituisce la matrice camera; l'inversa è la matrice vista usata da WebGL
function mat4LookAt(eye, center, up) {
  return m4.inverse(m4.lookAt(eye, center, up));
}

// Tamagotchi WebGL

// Riferimenti agli elementi del DOM
// >>> USO JQUERY: $() seleziona elementi per ID; [0] estrae l'elemento DOM nativo
// (necessario per le API canvas/WebGL che richiedono l'oggetto DOM reale)
const canvas   = $('#webglcanvas')[0];
const hungerBar = $('#hungerBar')[0];  // Elemento barra di avanzamento
const moodBar  = $('#moodBar')[0];     // Elemento barra di avanzamento
const sizeVal  = $('#sizeVal')[0];
const lightVal = $('#lightVal')[0];
const loadingOverlay = $('#loadingOverlay')[0];

// Contesto WebGL
// Tenta prima WebGL2, poi fallback a WebGL1 per maggiore compatibilità
const gl =
  canvas.getContext("webgl2", { antialias: true }) ||
  canvas.getContext("webgl", { antialias: true }) ||
  canvas.getContext("experimental-webgl");

if (!gl) {
  const msg = "WebGL non disponibile. Assicurati di usare un browser moderno che supporti WebGL.";
  console.error(msg);
  if (loadingOverlay) {
    loadingOverlay.style.display = 'flex';
    loadingOverlay.textContent = msg;
  }
} else {



// ---------- Funzioni di utilità ----------
function clamp01(x) { return Math.max(0, Math.min(1, x)); }  // Limita il valore all'intervallo 0-1
function lerp(a,b,t){ return a + (b-a)*t; }  // Interpolazione lineare tra a e b

// VERTEX SHADER (VS) - Eseguito per ogni vertice
// Trasforma le posizioni 3D in coordinate schermo e passa i dati al fragment shader
// Attributi: aPos (posizione), aNor (normale), aCol (colore vertice da Blender)
// Uniform: uMVP (matrice trasformazione combinata), uModel (matrice modello per illuminazione)
const VS = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec3 aCol;

uniform mat4 uMVP;
uniform mat4 uModel;

varying vec3 vN;
varying vec4 vPos;
varying vec3 vCol;

void main() {
  vN = mat3(uModel) * aNor;
  vPos = uModel * vec4(aPos, 1.0);
  vCol = aCol;
  // Usa proiezione*vista*modello completa (uMVP) per posizionare i vertici nel clip space
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

// FRAGMENT SHADER (FS) - Eseguito per ogni pixel
// Calcola il colore finale del pixel usando:
// - Colori vertice (da Blender sculpt paint)
// - Illuminazione direzionale (diffuse semplice)
// - Tinte umore (triste rende i colori più freddi, fame aggiunge tinta rossa)
const FS = `
precision mediump float;

varying vec3 vN;
varying vec4 vPos;
varying vec3 vCol;

uniform float uSad;      // 0..1
uniform float uHunger;   // 0..1
uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uFillLightColor;

void main() {
  vec3 n = normalize(vN);
  
  // Luce puntuale principale: sole
  vec3 lightDir = normalize(uLightPos - vPos.xyz);
  float diffuse = max(0.0, dot(n, lightDir));
  float fillDiffuse = max(0.0, dot(n, normalize(vec3(0.0, 1.0, 0.35))));
  vec3 light = uAmbientColor + (uLightColor * diffuse) + (uFillLightColor * fillDiffuse);
  
  // Usa il colore vertice del materiale
  vec3 col = vCol;
  col *= light;
  
  // Effetti umore: triste => più spento/grigio, fame => più rossastro
  vec3 sadTint = mix(vec3(1.0), vec3(0.30, 0.3, 0.30), uSad);
  vec3 hungerTint = mix(vec3(1.0), vec3(2.4, 0.7, 0.7), uHunger);
  
  col *= sadTint;
  col *= hungerTint;
  
  
  gl_FragColor = vec4(col, 1.0);
}
`;

// SHADER CON TEXTURE - Usati per il piano dell'erba e pianeta
// Coppia di shader separata per il rendering di oggetti texturizzati
// Usa coordinate UV e campiona da una texture invece dei colori vertice
const VS_TEX = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec2 aUV;

uniform mat4 uMVP;
uniform mat4 uModel;

varying vec3 vN;
varying vec2 vUV;
varying vec3 vWorldPos;

void main() {
  vN = mat3(uModel) * aNor;
  vUV = aUV;
  vWorldPos = (uModel * vec4(aPos, 1.0)).xyz;
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

const FS_TEX = `
precision mediump float;

varying vec3 vN;
varying vec2 vUV;
varying vec3 vWorldPos;

uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uFillLightColor;

uniform sampler2D uTexture;
uniform float uUseWorldUV;
uniform float uWorldUVScale;

void main() {
  vec3 n = normalize(vN);
  
  // Luce puntuale principale: sole
  vec3 lightDir = normalize(uLightPos - vWorldPos);
  float diffuse = max(0.0, dot(n, lightDir));
  float fillDiffuse = max(0.0, dot(n, normalize(vec3(0.0, 1.0, 0.35))));
  vec3 light = uAmbientColor + (uLightColor * diffuse) + (uFillLightColor * fillDiffuse);
  
  // Campiona la texture: opzionale UV world-space per evitare stretching sui lati
  vec2 sampleUV = vUV;
  if (uUseWorldUV > 0.5) {
    vec3 an = abs(n);
    if (an.y >= an.x && an.y >= an.z) {
      sampleUV = vWorldPos.xz * uWorldUVScale; // superfici orizzontali
    } else if (an.x >= an.z) {
      sampleUV = vWorldPos.zy * uWorldUVScale; // lati orientati su X
    } else {
      sampleUV = vWorldPos.xy * uWorldUVScale; // lati orientati su Z
    }
  }
  vec4 texColor = texture2D(uTexture, sampleUV);
  
  
  
  vec3 col = texColor.rgb * light;
  
  gl_FragColor = vec4(col, texColor.a);
}
`;

  // Shader sole: sfera emissiva usata come fonte di luce visibile
  const VS_SUN = `
  attribute vec3 aPos;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;
  uniform mat4 uMVP;
  void main() {
    vTexCoord = aTexCoord;
    gl_Position = uMVP * vec4(aPos, 1.0);
  }
  `;

  const FS_SUN = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform vec3 uSunColor;
  uniform sampler2D uSunTexture;
  void main() {
    // Spostiamo la coordinata X verso sinistra (+0.25 sposta significativamente a sx)
    vec2 uvSpostata = vec2(vTexCoord.x + 0.25, vTexCoord.y);

    // Campioniamo la foto normalmente
    vec4 texColor = texture2D(uSunTexture, uvSpostata);
    
    // Diminuiamo l'opacità sbiadendo la foto verso il bianco puro (75% bianco)
    vec3 fotoSbiadita = mix(texColor.rgb, vec3(1.0), 0.75);

    // Blending Moltiplica
    gl_FragColor = vec4(uSunColor * fotoSbiadita, 1.0);
  }
  `;

// CREAZIONE DEI PROGRAMMI SHADER
// USO WEBGL-UTILS: createProgramFromSources() compila e collega gli shader.
let program = webglUtils.createProgramFromSources(gl, [VS, FS]);
if (!program) throw new Error('Failed to create program via webglUtils');
gl.useProgram(program);

// Crea il programma shader con texture
// >>> WEBGL-UTILS: createProgramFromSources(gl, [vertexShaderSource, fragmentShaderSource])
let texProgram = webglUtils.createProgramFromSources(gl, [VS_TEX, FS_TEX]);
if (!texProgram) throw new Error('Failed to create texProgram via webglUtils');

// Crea il programma shader del sole
// >>> WEBGL-UTILS: createProgramFromSources(gl, [vertexShaderSource, fragmentShaderSource])
let sunProgram = webglUtils.createProgramFromSources(gl, [VS_SUN, FS_SUN]);
if (!sunProgram) throw new Error('Failed to create sunProgram via webglUtils');

//loading 

const TOTAL_ASSETS = 6; // 3 OBJ + 3 texture
let loadedAssets = 0;
let initCoreReady = false;
let appStarted = false;
let loadFailed = false;

function markAssetLoaded() {
  loadedAssets = Math.min(TOTAL_ASSETS, loadedAssets + 1);
  tryStartApp();
}

function failLoading(reason) {
  loadFailed = true;
  console.error("Errore caricamento asset:", reason);
}

function tryStartApp() {
  if (appStarted || loadFailed) return;
  if (!initCoreReady) return;
  if (loadedAssets < TOTAL_ASSETS) return;

  appStarted = true;
  if (loadingOverlay) {
    loadingOverlay.style.display = 'none';
  }

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  requestAnimationFrame(loop);
}

// TEXTURE
// Carica un'immagine in una texture WebGL usando createTexture 
function loadTexture(url) {
  const texture = gl.createTexture();

  const image = new Image();
  image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    console.log("Texture loaded:", url, image.width, "x", image.height);
    markAssetLoaded();
  };
  image.onerror = function() {
    console.error("Failed to load texture:", url);
    failLoading(url);
  };
  image.src = url;
  return texture;
}

// CARICATORI FILE OBJ
// Recupera il file OBJ, lo parsifica con glmReadOBJ e notifica il caricamento
async function loadOBJ(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load: ' + url);
  const text = await res.text();
  markAssetLoaded();
  return parseOBJ(text);
}

// PARSER OBJ
// Usa glmReadOBJ per ottenere la mesh indicizzata e la adatta al formato
// piatto richiesto dai buffer WebGL esistenti.
// Restituisce: { pos, uv, nor, col, vertCount } - tutti come Float32Arrays
function parseOBJ(objText) {
  const parsed = glmReadOBJ(objText, new subd_mesh());
  const sourceMesh = parsed.mesh;
  Unitize(sourceMesh);  // normalizza a [-1,+1] e centra nell'origine
  const outPos = [];
  const outUV = [];
  const outNor = [];
  const outCol = [];

  for (let faceIndex = 1; faceIndex <= sourceMesh.nface; faceIndex++) {
    const face = sourceMesh.face[faceIndex];

    for (let vertexSlot = 0; vertexSlot < face.n_v_e; vertexSlot++) {
      const vertex = sourceMesh.vert[face.vert[vertexSlot]];
      outPos.push(vertex.x, vertex.y, vertex.z);

      const texCoordIndex = face.textCoordsIndex[vertexSlot];
      if (texCoordIndex && sourceMesh.textCoords[texCoordIndex]) {
        const texCoord = sourceMesh.textCoords[texCoordIndex];
        outUV.push(texCoord.u, 1.0 - texCoord.v);
      } else {
        outUV.push(0, 0);
      }

      const normalIndex = face.normalVertexIndex[vertexSlot];
      if (normalIndex && sourceMesh.normal[normalIndex]) {
        const normal = sourceMesh.normal[normalIndex];
        outNor.push(normal.i, normal.j, normal.k);
      } else if (sourceMesh.facetnorms[face.normalFaceIndex]) {
        const normal = sourceMesh.facetnorms[face.normalFaceIndex];
        outNor.push(normal.i, normal.j, normal.k);
      } else {
        outNor.push(0, 1, 0);
      }

      const vertCol = sourceMesh.vert[face.vert[vertexSlot]];
      outCol.push(vertCol.r, vertCol.g, vertCol.b);
    }
  }

  return {
    pos: new Float32Array(outPos),
    uv: new Float32Array(outUV),
    nor: new Float32Array(outNor),
    col: new Float32Array(outCol),
    vertCount: outPos.length / 3
  };
}

// CREAZIONE DEI BUFFER WEBGL
// Crea buffer GPU per memorizzare i dati dei vertici (posizioni, normali, colori, UV)


// Crea e riempie un buffer direttamente con le API WebGL
function createArrayBuffer(data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

// Collega un buffer a un attributo shader (connette i dati alla variabile shader)
function bindAttrib(name, size, buffer) {
  const loc = gl.getAttribLocation(program, name);
  if (loc < 0) {
    console.warn("Attribute", name, "not found in shader");
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  return loc;
}

// POSIZIONI DEGLI UNIFORM SHADER
// Ottieni riferimenti alle variabili shader per aggiornarle ogni frame
const uMVP = gl.getUniformLocation(program, "uMVP");     // Matrice Model-View-Projection
const uModel = gl.getUniformLocation(program, "uModel"); // Matrice modello (per illuminazione)
const uSad = gl.getUniformLocation(program, "uSad");     // Livello tristezza 0-1
const uHunger = gl.getUniformLocation(program, "uHunger"); // Livello fame 0-1
const uLightPos = gl.getUniformLocation(program, "uLightPos"); // Posizione luce sole
const uLightColor = gl.getUniformLocation(program, "uLightColor");
const uAmbientColor = gl.getUniformLocation(program, "uAmbientColor");
const uFillLightColor = gl.getUniformLocation(program, "uFillLightColor");

const SUN_BASE_POS = [1.4, 4.8, 2.4];

// STATO DEL GIOCO
// Oggetto centrale che traccia tutte le variabili di gioco
const state = {
  // secondi
  t: 0,
  lastT: 0,

  // Statistiche creatura
  hungerInt: 0,   // contatore intero fame, incrementa ogni 5s, max 20
  nextHungerAtMs: Date.now() + 5000, // prossimo istante (ms reali) in cui incrementare fame
  moodLevel: 0,   // umore intero: 0=felice .. 20=triste
  nextMoodAtMs: Date.now() + 5000, // prossimo istante (ms reali) in cui peggiorare l'umore

  // La dimensione aumenta quando viene nutrito
  size: 1.0,
  targetSize: 1.0,

  //Giorno e notte
  isNight: false, // false = Giorno, true = Notte

  // Rotazione guidata dal touch
  rotY: 0,
  rotX: 0,

  // Posizione camera
  camX: 0,
  camY: 0,
  camZ: 17,
};

// Parametri di tuning (tutti espressi "al secondo")
const RATES = {
  sizeSmoothPerSec: 3.0,  // velocità di smoothing (lerp)
};

const HUNGER_MAX = 20;
const MOOD_MAX = 20;
const STAT_STEP_MS = 5000;
const MIN_SIZE = 0.15;
const MAX_SIZE = 0.75;

// ==========================================
// CONTROLLI INTERATTIVI (TOUCH, TASTIERA, MOUSE)
// ==========================================

// --- 1. CONTROLLI TOUCH (Mobile: Trascina = Ruota, Tap Secco = Giorno/Notte) ---
let touching = false;
let lastTouchX = 0;
let lastTouchY = 0;

let touchStartX = 0;
let touchStartY = 0;
let hasMoved = false;
let lastTapTime = 0; // <--- Variabile Cooldown per bloccare lo sfarfallio

canvas.addEventListener("touchstart", function(e) {
  touching = true;
  const t = e.touches[0];
  lastTouchX = t.clientX;
  lastTouchY = t.clientY;
  
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  hasMoved = false; 
}, { passive: false });

function updateDisplay(rotY, rotX) {
  if (guiRotY) guiRotY.setValue(rotY);
  if (guiRotX) guiRotX.setValue(rotX);
}


canvas.addEventListener("touchmove", function(e) {
  if (!touching) return;

  const t = e.touches[0];
  const dx = t.clientX - lastTouchX;
  const dy = t.clientY - lastTouchY;
  lastTouchX = t.clientX;
  lastTouchY = t.clientY;

// Controllo base standard (se si muove anche di poco, è una rotazione)
  const totalDistX = Math.abs(t.clientX - touchStartX);
  const totalDistY = Math.abs(t.clientY - touchStartY);
  if (totalDistX > 5 || totalDistY > 5) {
    hasMoved = true;
  }

  const s = 0.006; 
  state.rotY += dx * s;
  state.rotX += dy * s;
  state.rotY = Math.max(-1.0, Math.min(1.0, state.rotY)); 
  state.rotX = Math.max(-1.0, Math.min(1.0, state.rotX));

  updateDisplay(state.rotY, state.rotX);



}, { passive: true }); 
canvas.addEventListener("touchend", function(e) {
  touching = false;

  const now = Date.now();
  // Se non si è spostato ED è passato abbastanza tempo dall'ultimo switch (400ms)
  if (!hasMoved && (now - lastTapTime > 400)) {
    if (e.cancelable) e.preventDefault();
    lastTapTime = now; // Salva il tempo di questo click
    state.isNight = !state.isNight;
    console.log("Cambio ciclo da Touch! Notte =", state.isNight);
    updateHud();
  }
});

canvas.addEventListener("touchcancel", function() { touching = false; });


// --- 2. CONTROLLI TASTIERA (Rotazione della scena su Desktop) ---
const KEYBOARD_ROTATION_SPEED = 0.05;

$(document).on('keydown', function(e) {
  switch (e.key) {
    case "ArrowLeft":
      state.rotY -= KEYBOARD_ROTATION_SPEED;
      state.rotY = Math.max(-1.0, Math.min(1.0, state.rotY)); 
      e.preventDefault();
      break;
    case "ArrowRight":
      state.rotY += KEYBOARD_ROTATION_SPEED;
      state.rotY = Math.max(-1.0, Math.min(1.0, state.rotY)); 
      e.preventDefault();
      break;
    case "ArrowUp":
      state.rotX -= KEYBOARD_ROTATION_SPEED;
      state.rotX = Math.max(-1.0, Math.min(1.0, state.rotX)); 
      e.preventDefault();
      break;
    case "ArrowDown":
      state.rotX += KEYBOARD_ROTATION_SPEED;
      state.rotX = Math.max(-1.0, Math.min(1.0, state.rotX));
      e.preventDefault();
      break;
  }

  updateDisplay(state.rotY, state.rotX);
});


// --- 3. CONTROLLI MOUSE (Solo cambio Giorno/Notte al click su Desktop) ---
$(canvas).on('click', function() {
  const now = Date.now();
  // Applichiamo lo stesso cooldown al mouse per sicurezza
  if (now - lastTapTime > 400) {
    lastTapTime = now;
    state.isNight = !state.isNight;
    console.log("Cambio ciclo da Mouse! Notte =", state.isNight);
    updateHud();
  }
});


// --- 4. GESTORI DEI PULSANTI HUD ---
$('#feedBtn').on('click', function() {
  state.hungerInt = Math.max(0, state.hungerInt - 1);
});

$('#cheerBtn').on('click', function() {
  state.moodLevel = Math.max(0, state.moodLevel - 1);
});

// CONTROLLI DAT.GUI
// >>> USO LIBRERIA DAT.GUI
// dat.GUI crea un pannello di controllo flottante in alto a destra
// Permette di regolare rotazione
// La libreria è caricata da dat.gui.js in index.html
// --- VARIABILI GLOBALI PER I CONTROLLER DAT.GUI ---

let guiRotY, guiRotX;

// CONTROLLI DAT.GUI AGGIORNATI
if (window.dat && dat.GUI) {
  const gui = new dat.GUI();
  
  // Associano i controller direttamente all'oggetto 'state' principale
  guiRotY = gui.add(state, 'rotY', -1, 1).step(0.01).name('Rotate Y');
  guiRotX = gui.add(state, 'rotX', -1, 1).step(0.01).name('Rotate X');
  

}

// CARICAMENTO ASSET E INIZIALIZZAZIONE
// Variabili globali per le mesh caricate e i buffer GPU
let mesh = null;  // Mesh principale della creatura
let bufPos = null, bufNor = null, bufCol = null;  // Buffer creatura

// Mesh base scenario (caricata da piano.obj)
let grassMesh = null;
let grassBufPos = null, grassBufNor = null, grassBufUV = null;
let grassTexture = null;  // Texture erba (grass.jpg)

// Pianeta distante (sfera con texture)
let planetBufPos = null, planetBufNor = null, planetBufUV = null;
let planetVertCount = 0;
let planetTexture = null;


//Sole o Luna
let sunTexture = null;

// Sfera condivisa (sfera.obj) riusata per sole e pianeta
let sphereBufPos = null;
let sphereVertCount = 0;

// Funzione di inizializzazione asincrona: carica gli asset e avvia il render loop
async function init() {
  try {
    mesh = await loadOBJ("assets/creature.obj");
    window.__OBJ_BOUNDS__ = computeBounds(mesh.pos);
    bufPos = createArrayBuffer(mesh.pos);
    bufNor = createArrayBuffer(mesh.nor);
    bufCol = createArrayBuffer(mesh.col);

    grassMesh = await loadOBJ("assets/piano.obj");
    window.__GRASS_BOUNDS__ = computeBounds(grassMesh.pos);
    grassBufPos = createArrayBuffer(grassMesh.pos);
    grassBufNor = createArrayBuffer(grassMesh.nor);
    grassBufUV = createArrayBuffer(grassMesh.uv);
    grassTexture = loadTexture("assets/grass.jpg");

    // Carica sfera.obj condivisa per sole e pianeta
    const sferaMesh = await loadOBJ("assets/sfera.obj");
    sphereBufPos = createArrayBuffer(sferaMesh.pos);
    sphereVertCount = sferaMesh.vertCount;

    // Carica la texture del pianeta e riusa la stessa geometria sfera
    planetTexture = loadTexture("assets/pianetarosmarino.jpeg");
    planetBufPos = sphereBufPos;
    planetBufNor = createArrayBuffer(sferaMesh.nor);
    planetBufUV = createArrayBuffer(sferaMesh.uv);
    planetVertCount = sphereVertCount;

    //carica texture sole e luna
    sunTexture = loadTexture("assets/foto.jpg");

    initCoreReady = true;
    tryStartApp();
  } catch (err) {
    console.error("Init error:", err);
    failLoading(String(err));
    document.body.innerHTML = '<pre style="color:white; padding:12px">Error: ' + String(err) + '</pre>';
  }
}

init();



function computeBounds(pos) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i+1], z = pos[i+2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const radius = Math.max(dx, dy, dz) * 0.5;

  return { minX, minY, minZ, maxX, maxY, maxZ, cx, cy, cz, radius };
}




// CICLO DI GIOCO
// Loop di animazione principale - chiamato ogni frame tramite requestAnimationFrame
// Gestisce i tempi, aggiorna lo stato del gioco e renderizza la scena
function loop(tsMs) {
  // Ridimensiona il canvas se la finestra è cambiata
  // >>> WEBGL-UTILS: resizeCanvasToDisplaySize restituisce true se ridimensionato
  if (webglUtils.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // Converti il timestamp in secondi
  const t = tsMs * 0.001;
  if (!state.lastT) state.lastT = t;
  const dt = Math.min(0.05, Math.max(0.0001, t - state.lastT)); // limita dt
  state.lastT = t;
  state.t = t;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

// FUNZIONE DI AGGIORNAMENTO
// Aggiorna lo stato del gioco ogni frame: fame, umore, dimensione e UI
function update(dt) {
  const nowMs = Date.now();
  updateHunger(nowMs);
  updateMood(nowMs);
  updateSize(dt);
  updateHud();
}

function updateHunger(nowMs) {
  // La fame aumenta di 1 ogni 5 secondi, max 20
  if (nowMs >= state.nextHungerAtMs) {
    const steps = Math.floor((nowMs - state.nextHungerAtMs) / STAT_STEP_MS) + 1;
    state.hungerInt = Math.min(HUNGER_MAX, state.hungerInt + steps);
    state.nextHungerAtMs += steps * STAT_STEP_MS;
  }
}

function updateMood(nowMs) {
  // L'umore peggiora ogni 5 secondi (un passo alla volta, max 20)
  if (nowMs >= state.nextMoodAtMs) {
    const steps = Math.floor((nowMs - state.nextMoodAtMs) / STAT_STEP_MS) + 1;
    state.moodLevel = Math.min(MOOD_MAX, state.moodLevel + steps);
    state.nextMoodAtMs += steps * STAT_STEP_MS;
  }

}

function updateSize(dt) {
  // Mappatura invertita: fame alta -> creatura più piccola
  const sizeHunger = clamp01(state.hungerInt / HUNGER_MAX);
  state.targetSize = lerp(MIN_SIZE, MAX_SIZE, 1 - sizeHunger);

  const k = 1 - Math.exp(-RATES.sizeSmoothPerSec * dt);
  state.size = lerp(state.size, state.targetSize, k);
}

function updateHud() {
  // Barra fame: 0% quando hungerInt=0, 100% quando hungerInt=20
  const hungerPercent = Math.min(100, (state.hungerInt / HUNGER_MAX) * 100);
  $(hungerBar).css({ width: hungerPercent + '%', backgroundPosition: hungerPercent + '% 0' });

  // Barra umore: 100% felice -> 0% triste
  const moodPercent = 100 - Math.min(100, (state.moodLevel / MOOD_MAX) * 100);
  $(moodBar).css('width', moodPercent + '%');

  $(sizeVal).text(state.size.toFixed(2));
if (lightVal) {
  lightVal.textContent = state.isNight ? 'Night' : 'Day';
}}


function drawCreature(rotatedVP, sceneRotation, planeY) {
  const meshScale = state.size;
  const grassSurfaceY = planeY + 0.8;
  const bounds = window.__OBJ_BOUNDS__ || { minY: 0 };
  const creatureBottomOffset = bounds.minY * meshScale;

  // Piccola animazione idle: galleggiamento + respiro
  const idleTime = state.t;
  const bobAmount = 0.02;
  const bobSpeed = 2.0;
  const breatheAmount = 0.015;
  const breatheSpeed = 1.5;

  const bobOffset = Math.sin(idleTime * bobSpeed) * bobAmount;
  const breatheScale = 1.0 + Math.sin(idleTime * breatheSpeed) * breatheAmount;

  const creatureY = grassSurfaceY - creatureBottomOffset + bobOffset;
  const animatedScale = meshScale * breatheScale;
  const creatureModel = mat4Mul(mat4Translate(0, creatureY, 0), mat4Scale(animatedScale, animatedScale, animatedScale));
  const creatureMVP = mat4Mul(rotatedVP, creatureModel);

  gl.uniformMatrix4fv(uModel, false, mat4Mul(sceneRotation, creatureModel));
  if (uMVP) gl.uniformMatrix4fv(uMVP, false, creatureMVP);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.vertCount);
}

function drawGrass(rotatedVP, sceneRotation, planeY, sunLightPos, sunLightColor, ambientColor, fillLightColor) {
  if (!grassMesh || !grassBufPos || !grassBufNor || !grassBufUV || !grassTexture || !window.__GRASS_BOUNDS__) return;

  gl.useProgram(texProgram);

  const texLocPos = gl.getAttribLocation(texProgram, "aPos");
  const texLocNor = gl.getAttribLocation(texProgram, "aNor");
  const texLocUV = gl.getAttribLocation(texProgram, "aUV");

  gl.bindBuffer(gl.ARRAY_BUFFER, grassBufPos);
  gl.enableVertexAttribArray(texLocPos);
  gl.vertexAttribPointer(texLocPos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, grassBufNor);
  gl.enableVertexAttribArray(texLocNor);
  gl.vertexAttribPointer(texLocNor, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, grassBufUV);
  gl.enableVertexAttribArray(texLocUV);
  gl.vertexAttribPointer(texLocUV, 2, gl.FLOAT, false, 0, 0);

  // Dopo Unitize la mesh è già centrata in origine e si estende in [-1,+1]
  const targetGroundSpan = 13.0;
  const grassScale = targetGroundSpan / 2.0;

  const scaleM = mat4Scale(grassScale, grassScale, grassScale);
  const translateM = mat4Translate(0, planeY, 0);
  const grassModel = mat4Mul(translateM, scaleM);
  const grassMVP = mat4Mul(rotatedVP, grassModel);

  const texUMVP = gl.getUniformLocation(texProgram, "uMVP");
  const texUModel = gl.getUniformLocation(texProgram, "uModel");
  const texUTexture = gl.getUniformLocation(texProgram, "uTexture");
  const texUUseWorldUV = gl.getUniformLocation(texProgram, "uUseWorldUV");
  const texUWorldUVScale = gl.getUniformLocation(texProgram, "uWorldUVScale");
  const texULightPos = gl.getUniformLocation(texProgram, "uLightPos");
  const texULightColor = gl.getUniformLocation(texProgram, "uLightColor");
  const texUAmbientColor = gl.getUniformLocation(texProgram, "uAmbientColor");
  const texUFillLightColor = gl.getUniformLocation(texProgram, "uFillLightColor");

  gl.uniformMatrix4fv(texUModel, false, mat4Mul(sceneRotation, grassModel));
  gl.uniformMatrix4fv(texUMVP, false, grassMVP);
  if (texUUseWorldUV) gl.uniform1f(texUUseWorldUV, 1.0);
  if (texUWorldUVScale) gl.uniform1f(texUWorldUVScale, 0.24);
  if (texULightPos) gl.uniform3fv(texULightPos, sunLightPos);
  if (texULightColor) gl.uniform3fv(texULightColor, sunLightColor);
  if (texUAmbientColor) gl.uniform3fv(texUAmbientColor, ambientColor);
  if (texUFillLightColor) gl.uniform3fv(texUFillLightColor, fillLightColor);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, grassTexture);
  gl.uniform1i(texUTexture, 0);

  gl.drawArrays(gl.TRIANGLES, 0, grassMesh.vertCount);
  gl.useProgram(program);
}

function drawPlanet(rotatedVP, sceneRotation, sunLightPos, sunLightColor, ambientColor, fillLightColor) {
  if (!planetBufPos || !planetBufNor || !planetBufUV || !planetTexture || planetVertCount <= 0) return;

  gl.useProgram(texProgram);

  const texLocPos = gl.getAttribLocation(texProgram, "aPos");
  const texLocNor = gl.getAttribLocation(texProgram, "aNor");
  const texLocUV = gl.getAttribLocation(texProgram, "aUV");

  gl.bindBuffer(gl.ARRAY_BUFFER, planetBufPos);
  gl.enableVertexAttribArray(texLocPos);
  gl.vertexAttribPointer(texLocPos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, planetBufNor);
  gl.enableVertexAttribArray(texLocNor);
  gl.vertexAttribPointer(texLocNor, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, planetBufUV);
  gl.enableVertexAttribArray(texLocUV);
  gl.vertexAttribPointer(texLocUV, 2, gl.FLOAT, false, 0, 0);

  const planetScale = 2.6;
  const planetSpin = mat4RotateY(state.t * 0.12);
  const planetModel = mat4Mul(
    mat4Translate(-16.0, 8.5, -26.0),
    mat4Mul(planetSpin, mat4Scale(planetScale, planetScale, planetScale))
  );
  const planetMVP = mat4Mul(rotatedVP, planetModel);

  const texUMVP = gl.getUniformLocation(texProgram, "uMVP");
  const texUModel = gl.getUniformLocation(texProgram, "uModel");
  const texUTexture = gl.getUniformLocation(texProgram, "uTexture");
  const texUUseWorldUV = gl.getUniformLocation(texProgram, "uUseWorldUV");
  const texUWorldUVScale = gl.getUniformLocation(texProgram, "uWorldUVScale");
  const texULightPos = gl.getUniformLocation(texProgram, "uLightPos");
  const texULightColor = gl.getUniformLocation(texProgram, "uLightColor");
  const texUAmbientColor = gl.getUniformLocation(texProgram, "uAmbientColor");
  const texUFillLightColor = gl.getUniformLocation(texProgram, "uFillLightColor");

  gl.uniformMatrix4fv(texUModel, false, mat4Mul(sceneRotation, planetModel));
  gl.uniformMatrix4fv(texUMVP, false, planetMVP);
  if (texUUseWorldUV) gl.uniform1f(texUUseWorldUV, 0.0);
  if (texUWorldUVScale) gl.uniform1f(texUWorldUVScale, 1.0);
  if (texULightPos) gl.uniform3fv(texULightPos, sunLightPos);
  if (texULightColor) gl.uniform3fv(texULightColor, sunLightColor);

  const planetAmbient = [
    Math.max(0.35, ambientColor[0]),
    Math.max(0.35, ambientColor[1]),
    Math.max(0.35, ambientColor[2])
  ];
  if (texUAmbientColor) gl.uniform3fv(texUAmbientColor, planetAmbient);
  if (texUFillLightColor) gl.uniform3fv(texUFillLightColor, fillLightColor);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, planetTexture);
  gl.uniform1i(texUTexture, 0);

  gl.drawArrays(gl.TRIANGLES, 0, planetVertCount);
  gl.useProgram(program);
}

function drawSun(rotatedVP, sunBasePos, currentSunColor) { // Aggiunto parametro currentSunColor
  if (!sunProgram || !sphereBufPos || sphereVertCount <= 0) return;

  gl.useProgram(sunProgram);

  // 1. Collega le UV specificatamente per lo shader del sole utilizzando il buffer globale
  const sunTexLoc = gl.getAttribLocation(sunProgram, "aTexCoord");
  gl.bindBuffer(gl.ARRAY_BUFFER, planetBufUV); // Usa il buffer UV della sfera condivisa
  gl.enableVertexAttribArray(sunTexLoc);
  gl.vertexAttribPointer(sunTexLoc, 2, gl.FLOAT, false, 0, 0);

  // 2. Attiva e lega la texture del sole
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sunTexture);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const samplerLoc = gl.getUniformLocation(sunProgram, "uSunTexture");
  gl.uniform1i(samplerLoc, 0);

  // 3. Calcolo matrici e invio Uniform standard
  const sunUMVP = gl.getUniformLocation(sunProgram, "uMVP"); //
  const sunUColor = gl.getUniformLocation(sunProgram, "uSunColor"); //

  const sunScale = 0.55; //
  const sunMVP = mat4Mul(rotatedVP, mat4Mul( //
    mat4Translate(sunBasePos[0], sunBasePos[1], sunBasePos[2]), //
    mat4Scale(sunScale, sunScale, sunScale) //
  )); //
  gl.uniformMatrix4fv(sunUMVP, false, sunMVP); //
  
  gl.uniform3fv(sunUColor, currentSunColor);  //
  
  gl.drawArrays(gl.TRIANGLES, 0, sphereVertCount); //

  gl.useProgram(program); //
}


// FUNZIONE DI RENDERING
// Disegna la scena ogni frame: creatura + piano erboso
function render() {
  if (!mesh) return;

  // Collega gli attributi
  bindAttrib("aPos", 3, bufPos);
  bindAttrib("aNor", 3, bufNor);
  bindAttrib("aCol", 3, bufCol);
  bindAttrib("aTexCoord", 2, planetBufUV);

  // Uniform
  gl.uniform1f(uSad, state.moodLevel / MOOD_MAX);
  gl.uniform1f(uHunger, clamp01(state.hungerInt / HUNGER_MAX));

  // --- CAMERA E PROIEZIONE ---
  const aspectRatio = canvas.width / canvas.height;
  const projectionMatrix = mat4Perspective(Math.PI / 4, aspectRatio, 0.1, 1000.0); // fov 45 gradi
  const camEye = [state.camX, state.camY, state.camZ];
  const camLook = [0, 0, 0];
  const camUp = [0, 1, 0];
  const viewMatrix = mat4LookAt(camEye, camLook, camUp);

  // --- Rotazione scena dai controlli touch  ---
 const ROT_RANGE = Math.PI * 2;

const sceneRotY = mat4RotateY(state.rotY * ROT_RANGE);
const sceneRotX = mat4RotateX(state.rotX * ROT_RANGE);
  const sceneRotation = mat4Mul(sceneRotX, sceneRotY);

  const sunLightPos = mat4TransformPoint(sceneRotation, SUN_BASE_POS);

  let skyColor, sunLightColor, ambientColor, fillLightColor, sunHexColor;

  if (!state.isNight) {
    // Colori diurni (quelli originali del tuo codice)
    skyColor = [0.44, 0.62, 0.86, 1.0];
    sunLightColor = [1.05, 0.95, 0.78];
    ambientColor = [0.22, 0.24, 0.28];
    fillLightColor = [0.06, 0.07, 0.10];
    sunHexColor = [1.0, 0.92, 0.52]; // Giallo caldo per il sole
  } else {
    // Colori notturni (nuovi per l'esame)
    skyColor = [0.04, 0.06, 0.14, 1.0];      // Blu notte scuro
    sunLightColor = [0.30, 0.40, 0.65];     // Luce lunare soffusa e fredda
    ambientColor = [0.06, 0.08, 0.15];      // Ombre scure tendenti al blu/notte
    fillLightColor = [0.01, 0.01, 0.03];     // Luce di riempimento quasi azzerata
    sunHexColor = [0.90, 0.93, 1.0];        // Bianco/Azzurro pallido per la luna
  }

  // Applica il colore del cielo
  gl.clearColor(skyColor[0], skyColor[1], skyColor[2], skyColor[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);


// Invia i colori correnti agli shader
  if (uLightPos) gl.uniform3fv(uLightPos, sunLightPos);
  if (uLightColor) gl.uniform3fv(uLightColor, sunLightColor);
  if (uAmbientColor) gl.uniform3fv(uAmbientColor, ambientColor);
  if (uFillLightColor) gl.uniform3fv(uFillLightColor, fillLightColor);

  const viewProjection = mat4Mul(projectionMatrix, viewMatrix);
  const rotatedVP = mat4Mul(viewProjection, sceneRotation);

  const planeY = -1.5;
  drawCreature(rotatedVP, sceneRotation, planeY);
  drawGrass(rotatedVP, sceneRotation, planeY, sunLightPos, sunLightColor, ambientColor, fillLightColor);
  drawPlanet(rotatedVP, sceneRotation, sunLightPos, sunLightColor, ambientColor, fillLightColor);

  // Passiamo il colore dinamico alla funzione che disegna il sole/luna
  drawSun(rotatedVP, SUN_BASE_POS, sunHexColor);

  const err = gl.getError();
  if (err !== 0) console.warn('GL error after draw:', err);
}


}
