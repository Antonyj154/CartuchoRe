# CartuchoRe

Juego móvil **Calles Muertas** (HTML5, Canvas 2D, JavaScript puro, PWA), publicado gratis con GitHub Pages.

Dirección del sitio: https://antonyj154.github.io/CartuchoRe/

## Calles Muertas – Entrega 1 (prototipo)

- Muévete agachado arrastrando el dedo (joystick flotante donde toques). En PC: WASD o flechas.
- Tu pistola dispara sola al zombi más cercano que tengas a la vista (daño 10, 4 disparos/s, cargador de 12, recarga en 1,4 s, alcance 300, munición infinita).
- 100 de vida con regeneración lenta 3 s después del último golpe.
- PWA instalable y jugable sin conexión (`manifest.json` + `sw.js`).

## Probar en local

En la raíz del repositorio:

```bash
python3 -m http.server
```

Abre http://localhost:8000. Para imitar la ruta de GitHub Pages, sirve la carpeta padre de un directorio llamado `CartuchoRe` y entra en http://localhost:8000/CartuchoRe/.

## Publicar

Cada push a `main` despliega la raíz del repositorio con GitHub Actions (`.github/workflows/pages.yml`). En los ajustes del repositorio, Pages tiene que usar el origen **GitHub Actions**.

`start_url` y `scope` del manifiesto, el registro del service worker y la lista de caché usan rutas relativas, así el juego funciona bajo `/CartuchoRe/`.

Si cambias archivos que entran en la caché, sube la versión de `CACHE` en `sw.js` para que los celulares descarguen lo nuevo.
