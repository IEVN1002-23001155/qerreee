/* ArtDedmon QR Studio */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let brandLogo = null;

  const controls = {
    form: $('qr-form'),
    url: $('url-input'),
    urlError: $('url-error'),
    file: $('logo-input'),
    logoError: $('logo-error'),
    drop: $('drop-zone'),
    thumb: $('logo-thumb'),
    logoName: $('logo-name'),
    logoCaption: $('logo-caption'),
    logoSize: $('logo-size'),
    logoSizeValue: $('logo-size-value'),
    fg: $('fg-color'),
    bg: $('bg-color'),
    fgValue: $('fg-value'),
    bgValue: $('bg-value'),
    preview: $('qr-preview'),
    badge: $('preview-badge'),
    destination: $('destination-url'),
    png: $('download-png'),
    svg: $('download-svg'),
    hint: $('download-hint'),
    size: $('export-size')
  };

  const state = {
    logo: null,
    shape: 'square',
    current: null,
    qr: null,
    qrKey: '',
    logoLoading: true,
    exporting: false,
    submitted: false,
    logoRequest: 0
  };

  let updateTimer;
  let toastTimer;

  const MAX_PNG_BYTES = 5 * 1024 * 1024;
  const MAX_URL_BYTES = 1200;
  const QUIET_ZONE = 4;
  const DEFAULT_URL = 'https://example.com/';

  function fieldError(element, message) {
    element.textContent = message || '';
    element.hidden = !message;
  }

  function normalizeUrl(raw) {
    let value = raw.trim();

    if (!value) {
      throw new Error('Pega el enlace que quieres convertir en QR.');
    }

    if (/\s/.test(value)) {
      throw new Error(
        'Revisa tu enlace: no debe contener espacios ni saltos de línea.'
      );
    }

    if (
      /^[a-z][a-z\d+.-]*:/i.test(value) &&
      !/^https?:\/\//i.test(value)
    ) {
      throw new Error(
        'Usa un enlace web que comience con https:// o http://.'
      );
    }

    if (!/^https?:\/\//i.test(value)) {
      value = 'https://' + value;
    }

    let url;

    try {
      url = new URL(value);
    } catch {
      throw new Error(
        'Escribe un enlace válido, por ejemplo https://tupagina.com.'
      );
    }

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      (
        !url.hostname.includes('.') &&
        url.hostname !== 'localhost' &&
        !url.hostname.includes(':')
      )
    ) {
      throw new Error(
        'Escribe un dominio completo, por ejemplo tupagina.com.'
      );
    }

    if (new TextEncoder().encode(url.href).length > MAX_URL_BYTES) {
      throw new Error(
        'El enlace es demasiado largo para este QR. Usa una dirección más corta (máximo 1200 bytes).'
      );
    }

    return url.href;
  }

  function luminance(hex) {
    const channels = hex.slice(1).match(/../g)
      .map(channel => parseInt(channel, 16) / 255)
      .map(channel => (
        channel <= .04045
          ? channel / 12.92
          : ((channel + .055) / 1.055) ** 2.4
      ));

    return (
      channels[0] * .2126 +
      channels[1] * .7152 +
      channels[2] * .0722
    );
  }

  function contrastInfo(fg, bg) {
    const dark = luminance(fg);
    const light = luminance(bg);
    const ratio = (light + .05) / (dark + .05);

    return {
      valid: light > dark && ratio >= 4.5,
      ratio
    };
  }

  function xmlEscape(value) {
    return String(value).replace(/[<>&"']/g, char => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;'
    }[char]));
  }

  function getQr(url) {
    const minimum = state.logo ? 4 : 1;
    const key = url + '|' + minimum;

    if (key !== state.qrKey) {
      state.qr = qrcodegen.QrCode.encodeSegments(
        qrcodegen.QrSegment.makeSegments(url),
        qrcodegen.QrCode.Ecc.HIGH,
        minimum,
        40,
        -1,
        false
      );

      state.qrKey = key;
    }

    return state.qr;
  }

  function inFinder(x, y, size) {
    return (
      (x < 8 && y < 8) ||
      (x >= size - 8 && y < 8) ||
      (x < 8 && y >= size - 8)
    );
  }

  function buildSvg(qr, options) {
    const {
      foreground,
      background,
      shape,
      logo,
      logoPercent,
      url,
      pixels = 1600
    } = options;

    if (
      !/^#[0-9a-f]{6}$/i.test(foreground) ||
      !/^#[0-9a-f]{6}$/i.test(background)
    ) {
      throw new Error('Color inválido.');
    }

    const n = qr.size;
    const side = n + QUIET_ZONE * 2;

    const pieces = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pixels}" height="${pixels}" viewBox="0 0 ${side} ${side}" shape-rendering="${shape === 'square' ? 'crispEdges' : 'geometricPrecision'}">`,
      `<title>${xmlEscape('Código QR: ' + url)}</title>`,
      `<rect width="${side}" height="${side}" fill="${background}"/>`,
      `<g fill="${foreground}">`
    ];

    if (shape === 'square') {
      const paths = [];

      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n;) {
          if (!qr.getModule(x, y)) {
            x++;
            continue;
          }

          const start = x;

          while (x < n && qr.getModule(x, y)) {
            x++;
          }

          const length = x - start;

          paths.push(
            `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${length}v1h-${length}z`
          );
        }
      }

      pieces.push(`<path d="${paths.join('')}"/>`);
    } else {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (qr.getModule(x, y)) {
            pieces.push(
              `<rect x="${x + QUIET_ZONE}" y="${y + QUIET_ZONE}" width="1" height="1" rx="${inFinder(x, y, n) ? 0 : .17}"/>`
            );
          }
        }
      }
    }

    pieces.push('</g>');

    if (logo) {
      const plate = Math.max(
        3,
        Math.floor(
          (n * Math.min(22, logoPercent) / 100 - 1) / 2
        ) * 2 + 1
      );

      const start = QUIET_ZONE + (n - plate) / 2;
      const pad = .55;

      pieces.push(
        `<rect x="${start}" y="${start}" width="${plate}" height="${plate}" rx=".55" fill="${background}" shape-rendering="geometricPrecision"/>`
      );

      pieces.push(
        `<image x="${start + pad}" y="${start + pad}" width="${plate - pad * 2}" height="${plate - pad * 2}" preserveAspectRatio="xMidYMid meet" href="${xmlEscape(logo)}" xlink:href="${xmlEscape(logo)}"/>`
      );
    }

    pieces.push('</svg>');

    return pieces.join('');
  }

  function readOptions(url) {
    return {
      foreground: controls.fg.value,
      background: controls.bg.value,
      shape: state.shape,
      logo: state.logo,
      logoPercent: Number(controls.logoSize.value),
      url,
      pixels: Number(controls.size.value)
    };
  }

  function refreshButtons() {
    const enabled = (
      !!state.current &&
      !state.logoLoading &&
      !state.exporting
    );

    controls.png.disabled = !enabled;
    controls.svg.disabled = !enabled;
  }

  function render(showError = false) {
    clearTimeout(updateTimer);

    let normalized = '';
    let urlProblem = '';

    try {
      normalized = normalizeUrl(controls.url.value);
    } catch (error) {
      urlProblem = error.message;
    }

    const showUrlProblem = !!urlProblem && (
      showError ||
      state.submitted ||
      !!controls.url.value.trim()
    );

    fieldError(
      controls.urlError,
      showUrlProblem ? urlProblem : ''
    );

    controls.url.setAttribute(
      'aria-invalid',
      String(showUrlProblem)
    );

    controls.fgValue.textContent = controls.fg.value.toUpperCase();
    controls.bgValue.textContent = controls.bg.value.toUpperCase();
    controls.logoSizeValue.textContent = controls.logoSize.value + '%';

    const contrast = contrastInfo(
      controls.fg.value,
      controls.bg.value
    );

    fieldError(
      $('color-error'),
      contrast.valid
        ? ''
        : 'Usa un código oscuro sobre un fondo claro. El contraste debe ser de al menos 4.5:1.'
    );

    $('contrast-state').textContent = contrast.valid
      ? (contrast.ratio >= 7 ? 'Contraste alto' : 'Contraste válido')
      : 'Contraste bajo';

    $('contrast-state').classList.toggle(
      'low',
      !contrast.valid
    );

    document.querySelectorAll('[data-palette]').forEach(button => {
      const active = (
        button.dataset.palette.toLowerCase() ===
        controls.fg.value.toLowerCase()
      );

      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    state.current = null;

    try {
      if (typeof qrcodegen === 'undefined') {
        throw new Error('QR_ENGINE_UNAVAILABLE');
      }

      const qr = getQr(normalized || DEFAULT_URL);
      const options = readOptions(normalized || DEFAULT_URL);
      const svg = buildSvg(qr, options);

      controls.preview.innerHTML = svg;
      controls.preview.style.backgroundColor = options.background;

      controls.preview.setAttribute(
        'aria-label',
        normalized
          ? 'Código QR para ' + normalized
          : 'Código QR de ejemplo para example.com'
      );

      $('preview-modules').textContent = (
        qr.size + ' × ' + qr.size + ' / H'
      );

      if (normalized && contrast.valid) {
        state.current = { qr, options, svg };
      }

      controls.badge.textContent = !contrast.valid
        ? 'AJUSTA EL CONTRASTE'
        : normalized
          ? 'QR LISTO PARA DESCARGAR'
          : 'VISTA DE EJEMPLO';

      controls.badge.classList.toggle(
        'ready',
        !!state.current
      );

      controls.destination.textContent = (
        normalized ||
        'Tu próximo destino comienza con un enlace.'
      );

      controls.hint.textContent = state.logoLoading
        ? 'Preparando tu PNG…'
        : !contrast.valid
          ? 'Ajusta los colores para habilitar las descargas.'
          : normalized
            ? 'Corrección alta · Borde de seguridad incluido.'
            : 'Agrega tu enlace para habilitar las descargas.';
    } catch (error) {
      fieldError(
        controls.urlError,
        error.message === 'QR_ENGINE_UNAVAILABLE'
          ? 'No se pudo cargar el generador. Revisa tu conexión y recarga la página.'
          : 'No pudimos generar el QR. Revisa la longitud y el formato del enlace.'
      );

      controls.badge.textContent = (
        error.message === 'QR_ENGINE_UNAVAILABLE'
          ? 'REVISA LA CONEXIÓN'
          : 'REVISA EL ENLACE'
      );

      controls.badge.classList.remove('ready');
      controls.hint.textContent = 'Revisa el enlace para continuar.';
    }

    refreshButtons();

    return !!state.current;
  }

  function toast(message) {
    clearTimeout(toastTimer);

    $('toast-text').textContent = message;
    $('toast').hidden = false;

    toastTimer = setTimeout(() => {
      $('toast').hidden = true;
    }, 4000);
  }

  function showLogo(logo, name) {
    state.logo = logo;

    controls.thumb.hidden = !logo;
    controls.thumb.parentElement.classList.toggle('empty', !logo);

    if (logo) {
      controls.thumb.src = logo;
    } else {
      controls.thumb.removeAttribute('src');
    }

    controls.logoName.textContent = name;

    controls.logoCaption.textContent = logo
      ? 'PNG · se conserva su proporción'
      : 'El QR se generará sin imagen central';

    $('remove-logo').hidden = !logo;
    $('logo-size-row').hidden = !logo;

    $('choose-logo').firstChild.textContent = logo
      ? 'Cambiar PNG '
      : 'Subir PNG ';
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);

      reader.onerror = () => reject(
        new Error('No se pudo leer el PNG. Intenta cargarlo de nuevo.')
      );

      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);

      image.onerror = () => reject(
        new Error('No se pudo abrir la imagen. Elige un PNG válido.')
      );

      image.src = src;
    });
  }

  async function uploadLogo(file) {
    if (!file) return;

    const request = ++state.logoRequest;

    fieldError(controls.logoError, '');

    state.logoLoading = true;
    refreshButtons();

    controls.logoCaption.textContent = 'Preparando tu PNG…';

    try {
      if (!file.size) {
        throw new Error('El archivo está vacío. Elige otro PNG.');
      }

      if (file.size > MAX_PNG_BYTES) {
        throw new Error(
          'Tu PNG supera los 5 MB. Elige una versión más ligera.'
        );
      }

      const signature = new Uint8Array(
        await file.slice(0, 8).arrayBuffer()
      );

      const validSignature = [137,80,78,71,13,10,26,10]
        .every((byte, index) => signature[index] === byte);

      if (!validSignature) {
        throw new Error(
          'Elige una imagen PNG. Cambiar la extensión de otro archivo no lo convierte en PNG.'
        );
      }

      const source = await fileToDataUrl(file);
      const image = await loadImage(source);

      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth > 8192 ||
        image.naturalHeight > 8192
      ) {
        throw new Error(
          'Usa un PNG de hasta 8192 píxeles por lado.'
        );
      }

      const ratio = Math.min(
        1,
        768 / Math.max(image.naturalWidth, image.naturalHeight)
      );

      const canvas = document.createElement('canvas');

      canvas.width = Math.max(
        1,
        Math.round(image.naturalWidth * ratio)
      );

      canvas.height = Math.max(
        1,
        Math.round(image.naturalHeight * ratio)
      );

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(
          'Tu navegador no pudo procesar el PNG. Prueba de nuevo.'
        );
      }

      context.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const logo = canvas.toDataURL('image/png');

      if (request !== state.logoRequest) return;

      showLogo(logo, file.name);
      toast('Tu PNG ya está en el centro del QR.');
    } catch (error) {
      if (request === state.logoRequest) {
        fieldError(
          controls.logoError,
          error.message || 'No se pudo cargar el PNG.'
        );
      }
    } finally {
      if (request === state.logoRequest) {
        state.logoLoading = false;

        controls.logoCaption.textContent = state.logo
          ? 'PNG · se conserva su proporción'
          : 'El QR se generará sin imagen central';

        controls.file.value = '';
        render();
      }
    }
  }

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = objectUrl;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 30000);
  }

  function filenameFor(url, extension) {
    const hostname = new URL(url).hostname
      .replace(/[^a-z0-9.-]/gi, '-')
      .slice(0, 80);

    return 'ArtDedmon-QR-' + hostname + '.' + extension;
  }

  async function exportPng() {
    if (
      !state.current ||
      state.logoLoading ||
      state.exporting
    ) return;

    const snapshot = state.current;

    state.exporting = true;
    refreshButtons();

    let svgUrl;

    try {
      const size = Number(controls.size.value);
      const modules = snapshot.qr.size + QUIET_ZONE * 2;

      const scale = Math.max(
        1,
        Math.floor(size / modules)
      );

      const rasterSize = modules * scale;

      const svg = buildSvg(snapshot.qr, {
        ...snapshot.options,
        pixels: rasterSize
      });

      svgUrl = URL.createObjectURL(
        new Blob([svg], {
          type: 'image/svg+xml;charset=utf-8'
        })
      );

      const image = await loadImage(svgUrl);
      const canvas = document.createElement('canvas');

      canvas.width = size;
      canvas.height = size;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(
          'No se pudo crear la imagen. Prueba descargar el SVG.'
        );
      }

      context.fillStyle = snapshot.options.background;
      context.fillRect(0, 0, size, size);
      context.imageSmoothingEnabled = false;

      const offset = Math.floor((size - rasterSize) / 2);

      context.drawImage(
        image,
        offset,
        offset,
        rasterSize,
        rasterSize
      );

      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png');
      });

      if (!blob) {
        throw new Error(
          'No se pudo crear el PNG. Prueba descargar el SVG.'
        );
      }

      downloadBlob(
        blob,
        filenameFor(snapshot.options.url, 'png')
      );

      toast('PNG preparado para descargar.');
    } catch (error) {
      toast(
        error.message ||
        'No se pudo descargar. Intenta con el formato SVG.'
      );
    } finally {
      if (svgUrl) {
        URL.revokeObjectURL(svgUrl);
      }

      state.exporting = false;
      refreshButtons();
    }
  }

  function exportSvg() {
    if (
      !state.current ||
      state.logoLoading ||
      state.exporting
    ) return;

    const svg = buildSvg(state.current.qr, {
      ...state.current.options,
      pixels: Number(controls.size.value)
    });

    downloadBlob(
      new Blob([svg], {
        type: 'image/svg+xml;charset=utf-8'
      }),
      filenameFor(state.current.options.url, 'svg')
    );

    toast('SVG preparado para descargar.');
  }

  controls.form.addEventListener('submit', event => {
    event.preventDefault();
    state.submitted = true;

    if (render(true)) {
      controls.url.value = state.current.options.url;

      toast('Tu QR está listo para descargar.');

      if (window.matchMedia('(max-width: 720px)').matches) {
        $('preview-title').scrollIntoView({
          behavior: window.matchMedia(
            '(prefers-reduced-motion: reduce)'
          ).matches ? 'instant' : 'smooth',
          block: 'start'
        });
      }
    } else if (
      controls.url.getAttribute('aria-invalid') === 'true'
    ) {
      controls.url.focus();
    }
  });

  controls.url.addEventListener('input', () => {
    state.current = null;
    refreshButtons();

    clearTimeout(updateTimer);

    updateTimer = setTimeout(() => {
      render();
    }, 280);
  });

  controls.url.addEventListener('blur', () => {
    if (controls.url.value.trim()) {
      render();
    }
  });

  $('choose-logo').addEventListener('click', () => {
    controls.file.click();
  });

  controls.file.addEventListener('change', () => {
    uploadLogo(controls.file.files[0]);
  });

  $('remove-logo').addEventListener('click', () => {
    state.logoRequest++;
    state.logoLoading = false;
    controls.file.value = '';

    showLogo(null, 'Sin logo central');
    fieldError(controls.logoError, '');
    render();
  });

  controls.drop.addEventListener('dragover', event => {
    event.preventDefault();
    controls.drop.classList.add('dragging');
  });

  controls.drop.addEventListener('dragleave', event => {
    if (!controls.drop.contains(event.relatedTarget)) {
      controls.drop.classList.remove('dragging');
    }
  });

  controls.drop.addEventListener('drop', event => {
    event.preventDefault();
    controls.drop.classList.remove('dragging');

    uploadLogo(event.dataTransfer.files[0]);
  });

  window.addEventListener('dragover', event => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
    }
  });

  window.addEventListener('drop', event => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
    }
  });

  controls.logoSize.addEventListener('input', () => render());
  controls.fg.addEventListener('input', () => render());
  controls.bg.addEventListener('input', () => render());
  controls.size.addEventListener('change', () => render());

  document.querySelectorAll('[data-shape]').forEach(button => {
    button.addEventListener('click', () => {
      state.shape = button.dataset.shape;

      document.querySelectorAll('[data-shape]').forEach(option => {
        const active = option === button;

        option.classList.toggle('active', active);
        option.setAttribute('aria-pressed', String(active));
      });

      render();
    });
  });

  document.querySelectorAll('[data-palette]').forEach(button => {
    button.addEventListener('click', () => {
      controls.fg.value = button.dataset.palette;
      controls.bg.value = '#ffffff';

      render();
    });
  });

  $('reset-button').addEventListener('click', () => {
    state.logoRequest++;
    state.logoLoading = false;
    state.submitted = false;

    controls.form.reset();
    controls.size.value = '1600';
    state.shape = 'square';

    document.querySelectorAll('[data-shape]').forEach(option => {
      const active = option.dataset.shape === 'square';

      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });

    showLogo(
      brandLogo,
      brandLogo ? 'ArtDedmon · logo original' : 'Sin logo central'
    );

    fieldError(controls.logoError, '');

    render();
    controls.url.focus();

    toast('Estudio reiniciado.');
  });

  controls.png.addEventListener('click', exportPng);
  controls.svg.addEventListener('click', exportSvg);

  const help = $('help-dialog');

  $('help-open').addEventListener('click', () => {
    help.showModal();
  });

  $('help-close').addEventListener('click', () => {
    help.close();
  });

  $('help-done').addEventListener('click', () => {
    help.close();
  });

  help.addEventListener('click', event => {
    const rect = help.getBoundingClientRect();

    if (
      event.target === help &&
      (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
    ) {
      help.close();
    }
  });

  render();

  async function loadBrandLogo() {
    const request = state.logoRequest;

    try {
      const response = await fetch('./log.png');

      if (!response.ok) {
        throw new Error('Logo no disponible');
      }

      const file = await response.blob();
      const data = await fileToDataUrl(file);

      await loadImage(data);

      brandLogo = data;

      if (request === state.logoRequest) {
        showLogo(data, 'ArtDedmon · logo original');
      }
    } catch {
      if (request === state.logoRequest) {
        showLogo(null, 'Sin logo central');

        fieldError(
          controls.logoError,
          'Sube log.png junto a index.html para usar tu logo, o elige otro PNG.'
        );
      }
    } finally {
      if (request === state.logoRequest) {
        state.logoLoading = false;
        render();
      }
    }
  }

  loadBrandLogo();
})();