// tex8web: MathJax's TeX input, adjusted to draw math at the sizes TeX does
// (CONTRIBUTING.md, "MathJax sizes"). tex8web(config, tex) returns MathJax's
// configuration with the adjustments hooked in. tex holds lengths from the
// document, in ems of its body font (tex8web-page.tex):
//   exscale: the math extension font's size (TeX draws \big delimiters and
//     large operators from it at its design size, 10pt, also in an 11pt
//     document)
//   baselineskip, jot: rows of arrays and alignments
//   arraycolsep: the columns of arrays and matrices
//   pt: 1pt (MathJax reads pt as a tenth of an em)
// In a page, this file configures MathJax from the page's tex8web-config
// (at the end); prerender.mjs calls tex8web() itself.
//
// Code marked "internal" uses MathJax's internals, so MathJax's version is
// pinned in package.json.
function tex8web(config, tex) {
  const startup = config.startup = config.startup || {};
  const loader = config.loader = config.loader || {};

  // \big and co.: delimiters of TeX's sizes. MathJax asks for 1.2em and up,
  // a little above its glyph for \big, which then comes out a size larger.
  const bigSizes = {big: 1.19, Big: 1.79, bigg: 2.39, Bigg: 2.99};
  function sizeBigDelimiters() {
    // (internal: the macro map, and a macro's arguments)
    const macros = MathJax._.input.tex.MapHandler.MapHandler.getMap('macros');
    const factor = macros.lookup('big')._args[1] / 1.2;  // MathJax's size per em
    for (const [name, size] of Object.entries(bigSizes)) {
      for (const suffix of ['', 'l', 'r', 'm']) {
        const token = macros.lookup(name + suffix);
        if (token) token._args[1] = size * factor;
      }
    }
  }

  // each table row as high as MathJax means it to be. MathJax adds the rule
  // below a row to the row's height, and the last row has none (internal:
  // the table wrapper's rLines, one short). The last row's height is then
  // NaN, which Node writes as NaNem and a browser ignores, keeping any height
  // the row had from an earlier rendering.
  function fixRowHeights() {
    const Mtable = MathJax._.output.chtml.Wrappers.mtable.ChtmlMtable.prototype;
    const updateRowHeights = Mtable.updateRowHeights;
    Mtable.updateRowHeights = function () {
      const lines = this.rLines;
      this.rLines = [...lines, 0];
      updateRowHeights.call(this);
      this.rLines = lines;
    };
  }

  // \color[model]{values}: MathJax's color extension knows the models rgb,
  // RGB, and gray. Once it has loaded, xcolor's HTML, Gray, cmy, and cmyk
  // are added, converted to RGB as xcolor does (internal: the extension's
  // ColorModel, whose models are private to it, and its TexError).
  const decimal = max => v => /^(\d+(\.\d*)?|\.\d+)$/.test(v) && v <= max;
  const colorModels = {
    HTML: {count: 1, valid: v => /^[0-9A-Fa-f]{6}$/.test(v),
      rgb: ([hex]) => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)},
    Gray: {count: 1, valid: decimal(15), rgb: ([g]) => [g / 15, g / 15, g / 15]},
    cmy: {count: 3, valid: decimal(1), rgb: ([c, m, y]) => [1 - c, 1 - m, 1 - y]},
    cmyk: {count: 4, valid: decimal(1), rgb: ([c, m, y, k]) => [c, m, y].map(x => 1 - Math.min(1, +x + +k))},
  };
  loader['[tex]/color'] = {...loader['[tex]/color'], ready: addColorModels};
  function addColorModels() {
    const {ColorModel} = MathJax._.input.tex.color.ColorUtil;
    const TexError = MathJax._.input.tex.TexError.default;
    const normalizeColor = ColorModel.prototype.normalizeColor;
    ColorModel.prototype.normalizeColor = function (model, value) {
      const spec = colorModels[model];
      if (!spec) return normalizeColor.call(this, model, value);
      const values = value.trim().split(/\s*,\s*/);
      if (values.length !== spec.count || !values.every(spec.valid)) {
        throw new TexError('BadColorValue', 'Invalid color values for the %1 model', model);
      }
      const bytes = spec.rgb(values).map(x => Math.round(255 * x).toString(16).padStart(2, '0'));
      return '#' + bytes.join('');
    };
  }

  // MathJax's default space between rows (in its ems, in which 1pt is
  // 0.1em), and TeX's struts and space, for each environment.
  // tex8web-math.tex lists the environments it numbers.
  const alignment = {rowspacing: 0.3, stretch: 1, space: tex.jot};
  // In arrays and matrices, \arraycolsep is on each side of a column
  // (colsep), and also at an array's edges (edges).
  const matrix = {rowspacing: 0.4, stretch: 1, space: 0, colsep: true};
  const array = {...matrix, edges: true};
  // mathtools' cases environments set rows on struts with \jot between
  // them, as an alignment does. Their \quad starts the second column, so
  // it is there only when a row has a second cell, as in MathJax
  // (mathtools.sty, \MT_start_cases:nnnn).
  const mathtoolsCases = {...alignment, rowspacing: 0.2};
  const environments = {
    align: alignment, 'align*': alignment, alignat: alignment, 'alignat*': alignment,
    flalign: alignment, 'flalign*': alignment, gather: alignment, 'gather*': alignment,
    aligned: alignment, alignedat: alignment, gathered: alignment, split: alignment,
    multline: {...alignment, rowspacing: 0.5}, 'multline*': {...alignment, rowspacing: 0.5},
    array: array, matrix: matrix, pmatrix: matrix, bmatrix: matrix, Bmatrix: matrix,
    vmatrix: matrix, Vmatrix: matrix,
    'matrix*': matrix, 'pmatrix*': matrix, 'bmatrix*': matrix, 'Bmatrix*': matrix,
    'vmatrix*': matrix, 'Vmatrix*': matrix,
    // amsmath's cases sets \arraystretch to 1.2, and has two columns a
    // \quad apart, also when the second is empty
    cases: {rowspacing: 0.2, stretch: 1.2, space: 0, columns: 2},
    'cases*': mathtoolsCases, dcases: mathtoolsCases, 'dcases*': mathtoolsCases,
    rcases: mathtoolsCases, 'rcases*': mathtoolsCases,
    drcases: mathtoolsCases, 'drcases*': mathtoolsCases,
  };

  // the environment of each table, which MathJax does not record (an
  // mtable's data-latex holds its source with macros expanded): the
  // environments' functions are wrapped to mark the tables they make
  function markEnvironments(parseOptions) {
    // internal: the environment handlers, and their functions
    for (const {item} of parseOptions.handlers.get('environment')._configuration.items) {
      for (const [name, token] of item.map || []) {
        const make = token._func;
        token._func = function (parser, begin, ...args) {
          const result = make.call(this, parser, begin, ...args);
          if (result && result.arraydef) result.arraydef['data-tex8web-env'] = name;
          return result;
        };
      }
    }
  }

  function environment(mtable) {
    return environments[mtable.attributes.get('data-tex8web-env')];
  }

  function ems(length) {
    const [, value, unit] = String(length).match(/^([-\d.]+)(em|pt)?$/) || [, 0];
    return unit === 'pt' ? value / 10 : +value;
  }

  // rows on struts, 0.7 and 0.3 of the baselineskip (times \arraystretch)
  // above and below the baseline, with TeX's space between rows, plus any
  // \\[..]
  function spaceRows(mtable, env, factory) {
    const em = n => n.toFixed(3) + 'em';
    for (const row of mtable.childNodes) {
      const cell = row.childNodes[row.isKind('mlabeledtr') ? 1 : 0];
      if (!cell) continue;
      const strut = factory.create('node', 'mspace', [], {
        width: '0em',
        height: em(0.7 * tex.baselineskip * env.stretch),
        depth: em(0.3 * tex.baselineskip * env.stretch),
      });
      cell.childNodes[0].childNodes.unshift(strut);
      strut.parent = cell.childNodes[0];
    }
    const row = mtable.childNodes[0];
    if (row && env.columns > Math.max(...mtable.childNodes.map(row => row.childNodes.length))) {
      row.appendChild(factory.create('node', 'mtd'));
    }
    const spacing = String(mtable.attributes.get('rowspacing')).split(/\s+/).map(space =>
      em(Math.max(0, (ems(space) - env.rowspacing) * 10 * tex.pt + env.space)));
    mtable.attributes.set('rowspacing', spacing.join(' '));
  }

  // TeX's \arraycolsep where MathJax has its 0.5em on each side of a
  // column: 1em between columns, 0.5em at a !{} column, and 0.5em at an
  // array's edges, written as data-array-padding only where an edge has
  // @{}. An @{} column is a column of its own, with 0 around it, so the
  // space that the source sets is kept.
  function spaceColumns(mtable, env) {
    const sep = {'1em': 2 * tex.arraycolsep, '.5em': tex.arraycolsep};
    const space = list => String(list).split(/\s+/)
      .map(s => s in sep ? sep[s].toFixed(3) + 'em' : s).join(' ');
    mtable.attributes.set('columnspacing', space(mtable.attributes.get('columnspacing')));
    if (env.edges) {
      const padding = mtable.attributes.getExplicit('data-array-padding') ?? '.5em .5em';
      mtable.attributes.set('data-array-padding', space(padding));
    }
  }

  // colors (\color, \colorbox, \fcolorbox: mathcolor, mathbackground, and a
  // border in style) at another lightness in dark mode (css/tex8web.css's
  // --tex8web-dark-*). Black text takes the text's color.
  const lightDark = (color, property) =>
    `light-dark(${color}, oklch(from ${color} var(--tex8web-dark-${property}) c h))`;
  const text = color => /^(black|#000000)$/i.test(color) ? 'var(--tex8web-text)' : lightDark(color, 'color');
  function darken(node) {
    const color = node.attributes.getExplicit('mathcolor');
    if (color) node.attributes.set('mathcolor', text(color));
    // \rule is an mspace with a background, drawn in the text's color
    const background = node.attributes.getExplicit('mathbackground');
    if (background) {
      node.attributes.set('mathbackground',
        node.isKind('mspace') ? text(background) : lightDark(background, 'background'));
    }
    const style = node.attributes.getExplicit('style');
    if (style?.startsWith('border: ')) {
      node.attributes.set('style', style.replace(/^(border: \S+ solid )([^;]+)/,
        (_, border, color) => border + lightDark(color, 'border')));
    }
  }

  const bars = ['|', '‖', '∥'];
  const wideAccents = ['^', '~'];
  let TEXCLASS;

  function adjust({math, data}) {
    const factory = data.nodeFactory;
    const scale = (100 * tex.exscale).toFixed(1) + '%';
    const operators = [];
    data.root.walkTree(node => {
      darken(node);
      if (node.isKind('mtable')) {
        const env = environment(node);
        if (env) spaceRows(node, env, factory);
        if (env?.colsep) spaceColumns(node, env);
      } else if (node.isKind('mspace') && !math.display && node.attributes.getExplicit('width')
          && !node.attributes.getExplicit('linebreak')) {
        // inline math never breaks at a space, such as the \, between a
        // number and its unit, as TeX never breaks a formula at glue
        // (\allowbreak is a space without a width)
        node.attributes.set('linebreak', 'nobreak');
      } else if (node.isKind('mo')) {
        // inline math breaks after a relation or binary operator, as in TeX
        if (node.texClass === TEXCLASS.REL || node.texClass === TEXCLASS.BIN) {
          node.attributes.set('linebreakstyle', 'after');
        }
        const minsize = node.attributes.getExplicit('minsize');
        if (node.getProperty('mathaccent') && wideAccents.includes(node.getText())
            && node.attributes.getExplicit('stretchy') !== false) {
          // \widehat and \widetilde: the widest of TeX's sizes (0.556, 1,
          // and 1.444em) not wider than the base, or else the narrowest.
          // Internal, getStretchedVariant: an accent takes the size before
          // the first one at least as wide as its base, that width clamped
          // to minsize and maxsize, hence bounds a little above 0.556 and
          // 1.444em. Without them, MathJax aims wider than the base, among
          // sizes from \hat's 0.5em to 1.889em.
          node.attributes.set('minsize', '0.557em');
          node.attributes.set('maxsize', '1.445em');
        } else if (minsize) {
          node.attributes.set('mathsize', scale);
          // TeX builds a big bar from pieces, a little (0.04em) taller
          // than the glyphs of the other delimiters
          if (bars.includes(node.getText())) {
            const size = (ems(minsize) + 0.04 / tex.exscale).toFixed(3) + 'em';
            node.attributes.set('minsize', size);
            node.attributes.set('maxsize', size);
          }
        } else if (node.attributes.get('largeop')) {
          operators.push(node);
        }
      }
    });
    // large operators: scaled by an mstyle around them, because MathJax
    // misplaces the limits of \int (tucked into its slant) when the <mo>
    // itself is scaled
    for (const mo of operators) {
      const parent = mo.parent;
      const style = factory.create('node', 'mstyle', [], {mathsize: scale});
      parent.replaceChild(style, mo);
      style.childNodes[0].appendChild(mo);
    }
  }

  // the parts of an alignment split at \intertext (tex8web-math.tex), each a
  // formula with \webalignment{n} at its start: the same columns in each,
  // each column as wide as in its widest part, so the parts line up as
  // TeX's one alignment does
  function markAlignment(math) {
    math.math = math.math.replace(/\\webalignment\s*\{(\d+)\}/, (_, n) => {
      math.tex8webAlignment = n;
      // internal: ui/lazy's flags, which would leave the formula uncompiled
      // until it is in view
      math.lazyCompile = math.lazyTypeset = false;
      return '';
    });
  }
  function markAlignments(doc) {
    for (const math of doc.math) markAlignment(math);
  }
  // the top table of a part (none if MathJax could not parse it), and its
  // columns' widths (internal: its wrapper, made as getBBox makes it, with
  // the TeX classes that space operators, and a container for measuring
  // text)
  function measure(math, doc) {
    const jax = doc.outputJax;
    jax.setDocument(doc);
    jax.math = math;
    jax.container = jax.createNode();
    math.root.setTeXclass(null);
    jax.nodeMap = new Map();
    const wrappers = [jax.factory.wrap(math.root)];
    let table;
    while (!table && wrappers.length) {
      const wrapper = wrappers.shift();
      if (wrapper.node.isKind('mtable')) table = wrapper;
      else wrappers.push(...wrapper.childNodes);
    }
    jax.nodeMap = null;
    return table && {node: table.node, widths: table.getComputedWidths()};
  }
  function alignColumns(doc) {
    const alignments = {};
    for (const math of doc.math) {
      if (math.tex8webAlignment) (alignments[math.tex8webAlignment] ||= []).push(math);
    }
    for (const parts of Object.values(alignments)) {
      // once per compiled formula: ui/lazy and the menu render the page
      // again, and the widths would then be the ones set here
      if (parts.every(math => math.root.getProperty('tex8web-columns'))) continue;
      parts.forEach(math => math.root.setProperty('tex8web-columns', true));
      const tables = parts.map(math => measure(math, doc)).filter(Boolean);
      if (!tables.length) continue;
      const widths = [];
      for (const table of tables) {
        table.widths.forEach((width, i) => { widths[i] = Math.max(widths[i] || 0, width); });
      }
      // A part with fewer columns gets the columns of the part with the
      // most, with their spacing and alignment, which MathJax sets per
      // table. flalign's spacers stay as wide as the room left.
      const most = tables.find(table => table.widths.length === widths.length).node.attributes;
      const given = String(most.get('columnwidth')).split(' ');
      for (const {node, widths: own} of tables) {
        const row = node.childNodes[0];
        if (own.length < widths.length) {
          const cells = row.childNodes.length - (row.isKind('mlabeledtr') ? 1 : 0);
          for (let i = cells; i < widths.length; i++) row.appendChild(doc.mmlFactory.create('mtd'));
          for (const name of ['columnalign', 'columnspacing', 'data-break-align']) {
            node.attributes.set(name, most.getExplicit(name));
          }
        }
        // rounded up, so that a cell's content fits
        node.attributes.set('columnwidth', widths.map((w, i) =>
          given[i] === 'fit' ? 'fit' : Math.ceil(w * 1000) / 1000 + 'em').join(' '));
      }
    }
  }

  // in the options, as the menu may make the document anew: before compile
  // (20), and after the metrics (110), which the widths need
  const options = config.options = config.options || {};
  options.renderActions = {
    ...options.renderActions,
    tex8webAlignment: [15, markAlignments, markAlignment],
    tex8webColumns: [115, alignColumns, () => {}],
  };

  // macros.lua's definitions (the page's #tex8web-macros, as text), given
  // to MathJax before any math, which ui/lazy may typeset in any order
  // (internal: ui/lazy compiles math without a node, such as tex2mml's, at
  // once). Given as a promise, because a \definecolor loads the color
  // extension. A TeX error in one definition leaves the ones after it
  // undefined.
  const pageReady = startup.pageReady;
  startup.pageReady = async function () {
    const doc = MathJax.startup.document;
    const [macros] = doc.adaptor.getElements(['#tex8web-macros'], doc.document);
    const mml = macros ? await MathJax.tex2mmlPromise(doc.adaptor.textContent(macros)) : '';
    if (mml.includes('<merror')) console.warn('tex8web: a TeX error in a macro definition:', mml);
    return pageReady ? pageReady() : MathJax.startup.defaultPageReady();
  };

  const ready = startup.ready;
  startup.ready = function () {
    sizeBigDelimiters();
    fixRowHeights();
    if (ready) ready(); else MathJax.startup.defaultReady();
    TEXCLASS = MathJax._.core.MmlTree.MmlNode.TEXCLASS;
    const input = MathJax.startup.document.inputJax.find(jax => jax.name === 'TeX');
    markEnvironments(input.parseOptions);
    input.postFilters.add(adjust);
  };
  return config;
}

if (typeof document !== 'undefined') {
  const data = JSON.parse(document.getElementById('tex8web-config').textContent);
  // MathJax's TeX extensions with separate fonts (bbm and co.) load the
  // fonts from jsDelivr without a version, unlike MathJax's font, so a later
  // release of them would change the page. They are pinned to MathJax's
  // version, which page.lua gives this script. The extensions set the paths
  // only if they are not set.
  const version = document.currentScript.dataset.mathjax;
  const paths = data.mathjax.loader.paths = data.mathjax.loader.paths || {};
  for (const name of ['bbm', 'bboldx', 'dsfont', 'mhchem']) {
    paths[`mathjax-${name}-extension`] = `https://cdn.jsdelivr.net/npm/@mathjax/mathjax-${name}-font-extension@${version}`;
  }
  window.MathJax = tex8web(data.mathjax, data.tex);
  // an option of ui/lazy, which prerender.mjs leaves out: the math in the
  // table of contents is typeset at once, because the bar on a phone copies
  // the entry being read. Set only on a page with a table of contents,
  // which page.lua marks: ui/lazy 4.1.3 fails on a selector that matches
  // nothing.
  if ('contents' in document.currentScript.dataset) window.MathJax.options.lazyAlwaysTypeset = '.tex8web-toc';
}
