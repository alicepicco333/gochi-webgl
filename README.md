# gochi

Tamagotchi 3D interattivo realizzato in WebGL puro. Una simulazione real-time dove prendersi cura di una creatura virtuale, gestendo fame e umore tramite un'interfaccia intuitiva.

## Tecnologie

- **WebGL 1/2**: rendering 3D nel browser
- **GLSL**: shader per illuminazione e effetti visivi
- **JavaScript**: logica di gioco e gestione stato
- **OBJ/MTL**: caricamento mesh e material
- **dat.GUI**: pannello controlli real-time


## Funzionalità

- Creatura 3D con animazione idle (bobbing + breathing)
- Sistema fame/umore (0-20 step) con feedback visivo
- Controlli: pulsanti UI, touch, tastiera, dat.GUI
- Illuminazione diurna stabile e pianeta texturizzato
- Tinta emotiva: rosso per fame, grigio per umore pessimo

## Struttura

```
project/
├── index.html          # Entry point
├── main.js             # Pipeline WebGL e game loop
├── styles.css          # Stili UI
├── assets/             # Modelli OBJ, texture, material
└── [librerie]          # m4.js, jQuery, dat.gui.js, etc.
```



